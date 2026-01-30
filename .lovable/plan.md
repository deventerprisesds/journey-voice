

## Implement Full Streaming with Tool Execution

### Current Architecture

The hybrid-assistant-api currently has two modes:

1. **Streaming Mode** (lines 340-565): Starts a streaming run with `stream: true`, but when the AI wants to use tools (`requires_action`), it just notes the tool calls and never executes them during streaming. The stream ends with no content.

2. **Polling Mode** (lines 570-969): Non-streaming run that properly handles `requires_action` by executing tools via `execute-tool` and submitting outputs back to OpenAI.

3. **Frontend Fallback** (CommsConsoleContext lines 425-478): When streaming returns empty content, it makes a second call with `stream: false`.

### Problem

This creates:
- Extra round-trip latency (~500ms+ for run cancellation + second request)
- Race conditions between streaming and polling runs on the same thread
- Complexity in error handling

---

### Solution: Execute Tools Within Streaming Mode

Modify `handleStreamingRequest` to:
1. Detect `requires_action` during streaming
2. Pause stream consumption
3. Execute tool calls via `execute-tool`
4. Submit tool outputs back to OpenAI
5. Start a NEW streaming run to continue the response
6. Resume streaming deltas to the client

---

### Technical Implementation

#### File: `supabase/functions/hybrid-assistant-api/index.ts`

**1. Refactor the transform stream into a manual stream consumption loop**

Instead of piping OpenAI's response through a TransformStream (which doesn't allow pausing), manually consume the stream and handle events:

```typescript
async function handleStreamingRequest(...) {
  // ... existing pre-processing (lines 350-489) ...
  
  // Create a ReadableStream to send SSE to client
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  
  // Start processing in background
  (async () => {
    try {
      let currentRunId = '';
      let fullContent = '';
      
      // Helper to process a streaming run
      async function processStreamingRun(runResponse: Response): Promise<{
        content: string;
        requiresAction: boolean;
        toolCalls: ToolCall[];
        runId: string;
      }> {
        const decoder = new TextDecoder();
        const reader = runResponse.body?.getReader();
        let content = '';
        let requiresAction = false;
        let toolCalls: ToolCall[] = [];
        let runId = '';
        
        while (reader) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const text = decoder.decode(value);
          const lines = text.split('\n');
          
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6);
            if (data === '[DONE]') continue;
            
            try {
              const event = JSON.parse(data);
              
              if (event.object === 'thread.run') {
                runId = event.id;
                if (event.status === 'requires_action') {
                  requiresAction = true;
                  toolCalls = event.required_action?.submit_tool_outputs?.tool_calls || [];
                }
              }
              
              if (event.object === 'thread.message.delta') {
                const delta = event.delta?.content?.[0]?.text?.value || '';
                if (delta) {
                  content += delta;
                  // Forward to client immediately
                  await writer.write(encoder.encode(
                    `data: {"type":"delta","content":"${delta.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"}\n\n`
                  ));
                }
              }
              
              if (event.object === 'thread.run.step.delta') {
                const toolDelta = event.delta?.step_details?.tool_calls?.[0];
                if (toolDelta?.function?.name) {
                  await writer.write(encoder.encode(
                    `data: {"type":"tool_call","name":"${toolDelta.function.name}"}\n\n`
                  ));
                }
              }
            } catch {}
          }
        }
        
        return { content, requiresAction, toolCalls, runId };
      }
      
      // Initial streaming run
      let result = await processStreamingRun(runResponse);
      fullContent += result.content;
      currentRunId = result.runId;
      
      // Tool execution loop - handle requires_action
      while (result.requiresAction && result.toolCalls.length > 0) {
        console.log(`[HYBRID-STREAM] Processing ${result.toolCalls.length} tool calls`);
        
        // Execute tools
        const toolOutputs = await Promise.all(
          result.toolCalls.map(async (toolCall) => ({
            tool_call_id: toolCall.id,
            output: await executeToolCall(toolCall, userId, undefined, userTimezone)
          }))
        );
        
        // Submit tool outputs WITH streaming
        const submitResponse = await fetch(
          `https://api.openai.com/v1/threads/${openaiThreadId}/runs/${currentRunId}/submit_tool_outputs`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${openaiApiKey}`,
              'Content-Type': 'application/json',
              'OpenAI-Beta': 'assistants=v2'
            },
            body: JSON.stringify({
              tool_outputs: toolOutputs,
              stream: true  // Continue streaming after tool submission
            })
          }
        );
        
        if (!submitResponse.ok) {
          throw new Error(`Failed to submit tool outputs: ${await submitResponse.text()}`);
        }
        
        // Process the continued stream
        result = await processStreamingRun(submitResponse);
        fullContent += result.content;
      }
      
      // Send done event
      await writer.write(encoder.encode(
        `data: {"type":"done","content":"${fullContent.replace(/"/g, '\\"').replace(/\n/g, '\\n')}","threadId":"${openaiThreadId}"}\n\n`
      ));
      
    } catch (error) {
      console.error('[HYBRID-STREAM] Error:', error);
      await writer.write(encoder.encode(
        `data: {"type":"error","message":"${error instanceof Error ? error.message : 'Unknown error'}"}\n\n`
      ));
    } finally {
      await writer.close();
    }
  })();
  
  return new Response(readable, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  });
}
```

**2. Key Changes:**

| Current | New |
|---------|-----|
| TransformStream pipes through | Manual stream consumption with ReadableStream/WritableStream |
| No tool execution in streaming | Execute tools and submit outputs with `stream: true` |
| Empty content triggers frontend fallback | Full response delivered via single stream |

**3. Frontend Simplification (Optional)**

Once streaming handles tools properly, the fallback logic (lines 425-478 in CommsConsoleContext) becomes unnecessary but can be kept as a safety net for edge cases.

---

### Files Changed

| File | Changes |
|------|---------|
| `supabase/functions/hybrid-assistant-api/index.ts` | Rewrite `handleStreamingRequest` to execute tools mid-stream and continue streaming after tool submission |

---

### Benefits

1. **Single request** - No more fallback polling call
2. **No race conditions** - Only one run active at a time
3. **Faster perceived latency** - Text deltas stream immediately, tool execution happens inline
4. **Simpler frontend** - No fallback logic needed

---

### Risk Mitigation

- The frontend fallback logic remains in place as a safety net
- Extensive logging for debugging tool execution flow
- If tool submission streaming fails, gracefully degrade to error message


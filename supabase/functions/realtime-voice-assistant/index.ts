import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseKey);

// Task management function handlers
async function handleCreateTask(args: any) {
  try {
    console.log('Creating task:', args);
    
    // Get the default board for the user (simplified - in real app would need user auth)
    const { data: board } = await supabase
      .from('boards')
      .select('*')
      .eq('is_default', true)
      .single();
    
    if (!board) {
      return { success: false, message: 'No default board found' };
    }
    
    const taskData = {
      title: args.title,
      description: args.description || null,
      priority: args.priority || 'MEDIUM',
      category: args.category,
      due_date: args.due_date || null,
      estimate_minutes: args.estimate_minutes || null,
      status: 'TODO',
      board_id: board.id,
      user_id: board.user_id,
    };
    
    const { data, error } = await supabase
      .from('tasks')
      .insert(taskData)
      .select()
      .single();
    
    if (error) {
      console.error('Error creating task:', error);
      return { success: false, message: 'Failed to create task' };
    }
    
    return { 
      success: true, 
      message: `Task "${args.title}" created successfully`,
      task: data 
    };
  } catch (error) {
    console.error('Error in handleCreateTask:', error);
    return { success: false, message: 'Failed to create task' };
  }
}

async function handleUpdateTask(args: any) {
  try {
    console.log('Updating task:', args);
    
    const updates: any = {};
    if (args.title) updates.title = args.title;
    if (args.description) updates.description = args.description;
    if (args.priority) updates.priority = args.priority;
    if (args.status) {
      updates.status = args.status;
      if (args.status === 'DONE') {
        updates.completed_at = new Date().toISOString();
      }
    }
    if (args.due_date) updates.due_date = args.due_date;
    if (args.estimate_minutes) updates.estimate_minutes = args.estimate_minutes;
    
    const { data, error } = await supabase
      .from('tasks')
      .update(updates)
      .eq('id', args.task_id)
      .select()
      .single();
    
    if (error) {
      console.error('Error updating task:', error);
      return { success: false, message: 'Failed to update task' };
    }
    
    return { 
      success: true, 
      message: `Task updated successfully`,
      task: data 
    };
  } catch (error) {
    console.error('Error in handleUpdateTask:', error);
    return { success: false, message: 'Failed to update task' };
  }
}

async function handleGetTasks(args: any) {
  try {
    console.log('Getting tasks:', args);
    
    let query = supabase
      .from('tasks')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (args.status_filter) {
      query = query.eq('status', args.status_filter);
    }
    
    const { data, error } = await query.limit(10);
    
    if (error) {
      console.error('Error getting tasks:', error);
      return { success: false, message: 'Failed to get tasks' };
    }
    
    return { 
      success: true, 
      message: `Found ${data.length} tasks`,
      tasks: data 
    };
  } catch (error) {
    console.error('Error in handleGetTasks:', error);
    return { success: false, message: 'Failed to get tasks' };
  }
}

serve(async (req) => {
  const { headers } = req;
  const upgradeHeader = headers.get("upgrade") || "";

  if (upgradeHeader.toLowerCase() !== "websocket") {
    return new Response("Expected WebSocket connection", { status: 400 });
  }

  const { socket, response } = Deno.upgradeWebSocket(req);
  
  let openAISocket: WebSocket | null = null;
  let currentThreadId: string | null = null;
  let voiceSessionId = crypto.randomUUID();
  
  socket.onopen = () => {
    console.log("Client WebSocket connected");
    
    // Connect to OpenAI Realtime API
    try {
      const openaiUrl = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01";
      openAISocket = new WebSocket(openaiUrl, {
        headers: {
          "Authorization": `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
          "OpenAI-Beta": "realtime=v1"
        }
      });

      openAISocket.onopen = () => {
        console.log("Connected to OpenAI Realtime API");
      };

      openAISocket.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log("OpenAI message type:", data.type);
          
          // Create thread ID when session starts
          if (data.type === "session.created") {
            currentThreadId = crypto.randomUUID();
            console.log("Created thread ID for session:", currentThreadId);
            
            // Create thread record in database
            try {
              await supabase.from('ai_threads').insert({
                id: currentThreadId,
                user_id: '00000000-0000-0000-0000-000000000000' // Using anonymous UUID
              });
            } catch (error) {
              console.error("Error creating thread record:", error);
            }
          }
          
          // Handle assistant responses for RAG storage
          if (data.type === "response.audio_transcript.done" && data.transcript && currentThreadId) {
            console.log("Storing assistant response transcript for RAG");
            await fetch('https://wwxgajrtmslzklnyplah.functions.supabase.co/generate-embeddings', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                userId: '00000000-0000-0000-0000-000000000000',
                threadId: currentThreadId,
                content: data.transcript,
                messageType: 'assistant',
                role: 'assistant',
                voiceSessionId: voiceSessionId,
                metadata: { source: 'realtime_api' }
              })
            }).catch(error => console.error("Error storing assistant response:", error));
          }
          
          // Handle function calls for task management
          if (data.type === 'response.function_call_arguments.done') {
            console.log("Function call:", data.name, data.arguments);
            
            let functionResult;
            
            try {
              const args = JSON.parse(data.arguments);
              
              switch (data.name) {
                case 'create_task':
                  functionResult = await handleCreateTask(args);
                  break;
                case 'update_task':
                  functionResult = await handleUpdateTask(args);
                  break;
                case 'get_tasks':
                  functionResult = await handleGetTasks(args);
                  break;
                default:
                  functionResult = { success: false, message: `Unknown function: ${data.name}` };
              }
            } catch (error) {
              console.error('Error executing function:', error);
              functionResult = { success: false, message: 'Function execution failed' };
            }
            
            const functionResponse = {
              type: 'conversation.item.create',
              item: {
                type: 'function_call_output',
                call_id: data.call_id,
                output: JSON.stringify(functionResult)
              }
            };
            
            openAISocket?.send(JSON.stringify(functionResponse));
            openAISocket?.send(JSON.stringify({ type: 'response.create' }));
          }
          
          // Forward all messages to client
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(event.data);
          }
        } catch (error) {
          console.error("Error processing OpenAI message:", error);
        }
      };

      openAISocket.onerror = (error) => {
        console.error("OpenAI WebSocket error:", error);
      };

      openAISocket.onclose = (event) => {
        console.log("OpenAI WebSocket closed:", event.code, event.reason);
        if (socket.readyState === WebSocket.OPEN) {
          socket.close();
        }
      };

    } catch (error) {
      console.error("Error connecting to OpenAI:", error);
      socket.close();
    }
  };

  socket.onmessage = async (event) => {
    try {
      const data = JSON.parse(event.data);
      console.log("Client message type:", data.type);
      
      // Handle conversation.item.create to capture user text input for RAG
      if (data.type === 'conversation.item.create' && 
          data.item?.content?.[0]?.type === 'input_text') {
        const userText = data.item.content[0].text;
        console.log("User text input:", userText);
        
        // Check for hybrid routing and get context
        try {
          const contextResponse = await fetch('https://wwxgajrtmslzklnyplah.functions.supabase.co/rag-context-retrieval', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              userInput: userText,
              userId: '00000000-0000-0000-0000-000000000000',
              threadId: currentThreadId,
              action: 'should_use_assistant'
            })
          });
          
          if (contextResponse.ok) {
            const contextData = await contextResponse.json();
            console.log("Routing decision:", contextData);
            
            if (contextData.useAssistantAPI) {
              console.log("Routing to Assistant API for complex query");
              
              // Get full context and enhanced instructions
              const fullContextResponse = await fetch('https://wwxgajrtmslzklnyplah.functions.supabase.co/rag-context-retrieval', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  userInput: userText,
                  userId: '00000000-0000-0000-0000-000000000000',
                  threadId: currentThreadId,
                  action: 'get_context'
                })
              });
              
              if (fullContextResponse.ok) {
                const fullContext = await fullContextResponse.json();
                
                // Make Assistant API call
                const assistantResponse = await fetch('https://wwxgajrtmslzklnyplah.functions.supabase.co/hybrid-assistant-api', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    userInput: userText,
                    userId: '00000000-0000-0000-0000-000000000000',
                    threadId: currentThreadId || (currentThreadId = crypto.randomUUID()),
                    contextualInstructions: fullContext.contextualInstructions
                  })
                });
                
                if (assistantResponse.ok) {
                  const assistantData = await assistantResponse.json();
                  console.log("Assistant API response received");
                  
                  // Store the assistant response for RAG
                  await fetch('https://wwxgajrtmslzklnyplah.functions.supabase.co/generate-embeddings', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      userId: '00000000-0000-0000-0000-000000000000',
                      threadId: currentThreadId,
                      content: assistantData.response,
                      messageType: 'assistant',
                      role: 'assistant',
                      voiceSessionId: voiceSessionId,
                      metadata: { source: 'assistant_api', routing_reason: contextData.reason }
                    })
                  }).catch(error => console.error("Error storing assistant response:", error));
                  
                  // Send the response back to the client as a text message that will be spoken
                  socket.send(JSON.stringify({
                    type: 'conversation.item.create',
                    item: {
                      type: 'message',
                      role: 'assistant',
                      content: [
                        {
                          type: 'text',
                          text: assistantData.response
                        }
                      ]
                    }
                  }));
                  
                  socket.send(JSON.stringify({ type: 'response.create' }));
                  
                  return; // Don't forward to OpenAI Realtime API
                }
              }
            }
          }
        } catch (error) {
          console.error("Error in hybrid routing:", error);
        }
        
        // Store user input for RAG
        if (currentThreadId) {
          await fetch('https://wwxgajrtmslzklnyplah.functions.supabase.co/generate-embeddings', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              userId: '00000000-0000-0000-0000-000000000000',
              threadId: currentThreadId,
              content: userText,
              messageType: 'user',
              role: 'user',
              voiceSessionId: voiceSessionId,
              metadata: { source: 'realtime_api' }
            })
          }).catch(error => console.error("Error storing user input:", error));
        }
      }
      
      // Forward client messages to OpenAI
      if (openAISocket && openAISocket.readyState === WebSocket.OPEN) {
        openAISocket.send(event.data);
      }
    } catch (error) {
      console.error("Error processing client message:", error);
    }
  };

  socket.onclose = () => {
    console.log("Client WebSocket disconnected");
    if (openAISocket) {
      openAISocket.close();
    }
  };

  socket.onerror = (error) => {
    console.error("Client WebSocket error:", error);
    if (openAISocket) {
      openAISocket.close();
    }
  };

  return response;
});
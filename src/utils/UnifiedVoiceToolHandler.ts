import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '@/integrations/supabase/client';

interface ToolExecutionContext {
  userId: string;
  assistantId?: string;
  threadId?: string;
  timezone?: string;
  interface: 'voice' | 'chat' | 'phone';
}

interface ToolExecutionResult {
  success?: boolean;
  error?: string;
  [key: string]: unknown;
}

/**
 * Unified tool handler that routes all tools through the centralized execute-tool edge function.
 * 
 * This replaces the inline switch/case in RealtimeVoiceAssistant.ts
 * while keeping the original code intact in the backup file for fallback.
 * 
 * Benefits:
 * - Single source of truth for all tool logic
 * - Feature parity across Voice, Chat, and Phone interfaces
 * - Changes to execute-tool automatically apply everywhere
 */
export async function executeToolUnified(
  functionName: string,
  args: Record<string, unknown>,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  console.log(`[UNIFIED_TOOL] Executing ${functionName} via execute-tool`);

  try {
    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/execute-tool`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_PUBLISHABLE_KEY,
          'Authorization': `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          toolName: functionName,
          args,
          userId: context.userId,
          context: {
            interface: context.interface,
            timezone: context.timezone || 'America/New_York',
            threadId: context.threadId,
            assistantId: context.assistantId
          }
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[UNIFIED_TOOL] Error from execute-tool:`, errorText);
      return { success: false, error: `Tool execution failed: ${response.status}` };
    }

    const result = await response.json();
    console.log(`[UNIFIED_TOOL] Result from ${functionName}:`, result);
    return result;
  } catch (error) {
    console.error(`[UNIFIED_TOOL] Exception executing ${functionName}:`, error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

/**
 * Fetch RAG context for conversation continuity.
 * Scoped to user + assistant for consistent memory per assistant.
 * 
 * This is called during voice session initialization to inject
 * relevant conversation history into the AI's context.
 */
export async function fetchRagContext(
  userInput: string,
  userId: string,
  assistantId?: string,
  threadId?: string
): Promise<string> {
  try {
    console.log('[UNIFIED_RAG] Fetching context for:', userInput.substring(0, 50));

    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/rag-context-retrieval`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_PUBLISHABLE_KEY,
          'Authorization': `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          action: 'get_context',
          userInput,
          userId,
          threadId: threadId || null,
          assistantId: assistantId || null
        })
      }
    );

    if (!response.ok) {
      console.warn('[UNIFIED_RAG] Failed to fetch context:', response.status);
      return '';
    }

    const data = await response.json();
    const contextualInstructions = data.contextualInstructions || '';
    
    console.log(`[UNIFIED_RAG] Got context (${data.context?.conversationContext?.length || 0} matches)`);
    return contextualInstructions;
  } catch (error) {
    console.warn('[UNIFIED_RAG] Error fetching context:', error);
    return '';
  }
}

/**
 * Check if a function should be handled locally vs via execute-tool.
 * Some functions (like disconnect) need direct access to the voice session.
 */
export function isLocalOnlyFunction(functionName: string): boolean {
  const localOnlyFunctions = [
    'disconnect',      // Needs access to voice session to disconnect
    'hang_up',         // Phone-only, handled by twilio-realtime-bridge
  ];
  
  return localOnlyFunctions.includes(functionName);
}

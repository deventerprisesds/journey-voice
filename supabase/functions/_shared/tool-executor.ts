/**
 * Tool Executor - Centralized tool execution via execute-tool edge function
 * Includes session-level tool tracking for voicemail safety net
 */

import { VOICE_CONFIG } from "./config.ts";

/** Track which tools have been called during the current session */
const sessionToolHistory = new Set<string>();

/** Reset tool history at the start of a new call session */
export function resetToolHistory(): void {
  sessionToolHistory.clear();
}

/**
 * Execute a tool via the execute-tool edge function
 */
export async function executeTool(
  toolName: string,
  args: any,
  userId: string | null,
  context: { 
    timezone?: string; 
    userProfile?: any; 
    twilioWs?: WebSocket; 
    streamSid?: string | null;
    supabaseUrl: string;
    supabaseServiceKey: string;
    callContext?: string;
  }
): Promise<any> {
  // Track every tool call
  sessionToolHistory.add(toolName);

  // Handle hang_up specially - needs direct access to WebSocket
  if (toolName === 'hang_up') {
    console.log('[BRIDGE] Hang up requested:', args.farewell_message);

    // Safety net: if send_chat_message was never called and we have call context,
    // automatically fire it before disconnecting
    if (!sessionToolHistory.has('send_chat_message') && context.callContext && userId) {
      console.log('[BRIDGE] Safety net: send_chat_message was never called during this session. Firing fallback with context:', context.callContext);
      try {
        const fallbackResponse = await fetch(`${context.supabaseUrl}/functions/v1/execute-tool`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${context.supabaseServiceKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            toolName: 'send_chat_message',
            args: { context: context.callContext },
            userId,
            context: {
              interface: 'phone',
              timezone: context.timezone || 'America/New_York',
              userProfile: context.userProfile || {}
            }
          })
        });
        const fallbackResult = await fallbackResponse.json();
        console.log('[BRIDGE] Safety net fallback result:', JSON.stringify(fallbackResult));
      } catch (err) {
        console.error('[BRIDGE] Safety net fallback failed:', err);
      }
    }
    
    if (context.twilioWs) {
      setTimeout(() => {
        if (context.twilioWs && context.twilioWs.readyState === WebSocket.OPEN) {
          context.twilioWs.close();
        }
      }, VOICE_CONFIG.FAREWELL_DELAY_MS);
    }

    return {
      success: true,
      message: args.farewell_message || "Call ended gracefully"
    };
  }

  if (!userId) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    const response = await fetch(`${context.supabaseUrl}/functions/v1/execute-tool`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${context.supabaseServiceKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        toolName,
        args,
        userId,
        context: {
          interface: 'phone',
          timezone: context.timezone || 'America/New_York',
          userProfile: context.userProfile || {}
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[BRIDGE] execute-tool error: ${response.status}`, errorText);
      return { success: false, error: `Tool execution failed: ${response.status}` };
    }

    return await response.json();
  } catch (error) {
    console.error(`[BRIDGE] Error executing tool ${toolName}:`, error);
    return { success: false, error: String(error) };
  }
}

/**
 * Tool Executor - Centralized tool execution via execute-tool edge function
 */

import { VOICE_CONFIG } from "./config.ts";

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
  }
): Promise<any> {
  // Handle hang_up specially - needs direct access to WebSocket
  if (toolName === 'hang_up') {
    console.log('[BRIDGE] Hang up requested:', args.farewell_message);
    
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

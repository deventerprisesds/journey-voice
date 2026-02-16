import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getToolDefinitions } from "../_shared/tool-definitions.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    const assistantId = Deno.env.get('OPENAI_ASSISTANT_ID');

    if (!openaiApiKey || !assistantId) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing OPENAI_API_KEY or OPENAI_ASSISTANT_ID secret',
      }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const defs = getToolDefinitions();
    const tools = defs.map(t => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    console.log(`[sync-assistant-tools] Syncing ${tools.length} tools to assistant ${assistantId}`);

    const response = await fetch(`https://api.openai.com/v1/assistants/${assistantId}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'assistants=v2',
      },
      body: JSON.stringify({ tools }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[sync-assistant-tools] OpenAI API error: ${errorText}`);
      return new Response(JSON.stringify({
        success: false,
        error: `OpenAI API error: ${response.status}`,
        details: errorText,
      }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const result = await response.json();
    const toolNames = tools.map(t => t.function.name);

    console.log(`[sync-assistant-tools] Successfully synced ${tools.length} tools`);

    return new Response(JSON.stringify({
      success: true,
      assistant_id: assistantId,
      assistant_name: result.name,
      tools_synced: tools.length,
      tool_names: toolNames,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('[sync-assistant-tools] Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

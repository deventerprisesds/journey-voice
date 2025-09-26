import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SlackNotificationRequest {
  webhook_url: string;
  message?: string;
  output?: string;
  type?: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { webhook_url, message, output, type }: SlackNotificationRequest = await req.json();

    if (!webhook_url) {
      return new Response(
        JSON.stringify({ error: 'webhook_url is required' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Build query parameters for the GET request
    const params = new URLSearchParams();
    if (message) params.append('message', message);
    if (output) params.append('output', output);
    if (type) params.append('type', type);
    params.append('timestamp', new Date().toISOString());

    const finalUrl = `${webhook_url}${params.toString() ? '?' + params.toString() : ''}`;

    console.log('Sending Slack notification to:', finalUrl);

    // Make the GET request to the n8n webhook
    const response = await fetch(finalUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Lovable-Task-Manager/1.0',
      },
    });

    console.log('Slack webhook response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Slack webhook error:', response.status, errorText);
      
      return new Response(
        JSON.stringify({ 
          error: `Webhook request failed: ${response.status} ${response.statusText}`,
          details: errorText
        }),
        { 
          status: response.status, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const responseText = await response.text();
    console.log('Slack webhook success:', responseText);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Slack notification sent successfully',
        webhook_response: responseText
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error: any) {
    console.error('Error in send-slack-notification function:', error);
    
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error', 
        details: error.message 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
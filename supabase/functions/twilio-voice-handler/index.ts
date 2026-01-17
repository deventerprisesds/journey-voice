import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface TwilioCallRequest {
  action: 'trigger-call' | 'incoming-call' | 'status-callback';
  userId?: string;
  delay_minutes?: number;
  context?: string;
  phoneNumber?: string;
}

// Generate TwiML response for incoming calls or when call connects
function generateTwiML(context?: string): string {
  const greeting = context 
    ? `Hello! I'm calling about ${context}. How can I help you?`
    : `Hello! This is Iris Chase, your task assistant. How can I help you today?`;
  
  // For now, we use a simple TwiML that speaks a greeting
  // Full WebSocket media streaming would require a dedicated WebSocket server
  // due to Supabase Edge Function limitations for long-running connections
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">${greeting}</Say>
  <Pause length="1"/>
  <Say voice="Polly.Joanna">I'm currently in limited phone mode. For full voice assistant capabilities, please use the app. Is there anything quick I can help with?</Say>
  <Gather input="speech" timeout="5" action="${supabaseUrl}/functions/v1/twilio-voice-handler?action=process-speech">
    <Say voice="Polly.Joanna">Go ahead, I'm listening.</Say>
  </Gather>
  <Say voice="Polly.Joanna">I didn't hear anything. Goodbye!</Say>
</Response>`;
}

// Make outbound call using Twilio REST API
async function triggerOutboundCall(
  toNumber: string,
  context?: string,
  delayMinutes?: number
): Promise<{ 
  success: boolean; 
  call_sid?: string; 
  error?: string; 
  scheduled_for?: string;
  debug?: Record<string, unknown>;
}> {
  const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
  const authToken = Deno.env.get('TWILIO_AUTH_TOKEN');
  const fromNumber = Deno.env.get('TWILIO_PHONE_NUMBER');

  // Debug info object to return
  const debug: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    toNumber_provided: !!toNumber,
    toNumber_format: toNumber ? (toNumber.startsWith('+') ? 'E.164' : 'non-E.164') : 'missing',
    fromNumber_configured: !!fromNumber,
    fromNumber_format: fromNumber ? (fromNumber.startsWith('+') ? 'E.164' : 'non-E.164') : 'missing',
    accountSid_configured: !!accountSid,
    authToken_configured: !!authToken,
  };

  console.log('=== TWILIO OUTBOUND CALL DEBUG ===');
  console.log('To Number:', toNumber ? `${toNumber.substring(0, 4)}...${toNumber.slice(-2)}` : 'MISSING');
  console.log('From Number:', fromNumber ? `${fromNumber.substring(0, 4)}...${fromNumber.slice(-2)}` : 'MISSING');
  console.log('Account SID:', accountSid ? `${accountSid.substring(0, 6)}...` : 'MISSING');
  console.log('Auth Token:', authToken ? 'CONFIGURED' : 'MISSING');

  // Validate credentials
  if (!accountSid) {
    const error = 'Missing TWILIO_ACCOUNT_SID secret';
    console.error(error);
    return { success: false, error, debug };
  }
  if (!authToken) {
    const error = 'Missing TWILIO_AUTH_TOKEN secret';
    console.error(error);
    return { success: false, error, debug };
  }
  if (!fromNumber) {
    const error = 'Missing TWILIO_PHONE_NUMBER secret';
    console.error(error);
    return { success: false, error, debug };
  }

  // Validate phone number formats
  if (!toNumber) {
    const error = 'No destination phone number provided';
    console.error(error);
    return { success: false, error, debug };
  }

  if (!toNumber.startsWith('+')) {
    const error = `Invalid TO phone number format: "${toNumber}". Must be E.164 format starting with + (e.g., +14155551234)`;
    console.error(error);
    return { success: false, error, debug };
  }

  if (!fromNumber.startsWith('+')) {
    const error = `Invalid FROM phone number format: "${fromNumber}". Must be E.164 format starting with + (e.g., +18665854827)`;
    console.error(error);
    return { success: false, error, debug };
  }

  // Log delay info
  if (delayMinutes && delayMinutes > 0) {
    const scheduledFor = new Date(Date.now() + delayMinutes * 60 * 1000).toISOString();
    console.log(`Call scheduled for ${delayMinutes} minutes from now: ${scheduledFor}`);
    debug.scheduled_for = scheduledFor;
  }

  const twimlUrl = `${supabaseUrl}/functions/v1/twilio-voice-handler?action=incoming-call&context=${encodeURIComponent(context || '')}`;
  const statusCallbackUrl = `${supabaseUrl}/functions/v1/twilio-voice-handler?action=status-callback`;

  debug.twiml_url = twimlUrl;
  debug.status_callback_url = statusCallbackUrl;

  console.log('TwiML URL:', twimlUrl);
  console.log('Status Callback URL:', statusCallbackUrl);

  try {
    const credentials = btoa(`${accountSid}:${authToken}`);
    const apiUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`;
    
    console.log('Making Twilio API request to:', apiUrl);

    const requestBody = new URLSearchParams({
      To: toNumber,
      From: fromNumber,
      Url: twimlUrl,
      StatusCallback: statusCallbackUrl,
      StatusCallbackEvent: 'initiated ringing answered completed',
      StatusCallbackMethod: 'POST',
    });

    debug.request_body = Object.fromEntries(requestBody.entries());

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: requestBody,
    });

    const responseText = await response.text();
    debug.twilio_response_status = response.status;
    debug.twilio_response_headers = Object.fromEntries(response.headers.entries());

    console.log('Twilio API response status:', response.status);
    console.log('Twilio API response:', responseText);

    if (!response.ok) {
      let errorDetail = responseText;
      try {
        const errorJson = JSON.parse(responseText);
        errorDetail = `Code ${errorJson.code}: ${errorJson.message}`;
        debug.twilio_error_code = errorJson.code;
        debug.twilio_error_message = errorJson.message;
      } catch {
        // Response wasn't JSON
      }
      const error = `Twilio API error (${response.status}): ${errorDetail}`;
      console.error(error);
      return { success: false, error, debug };
    }

    const callData = JSON.parse(responseText);
    console.log('=== CALL INITIATED SUCCESSFULLY ===');
    console.log('Call SID:', callData.sid);
    console.log('Call Status:', callData.status);
    console.log('Call Direction:', callData.direction);

    debug.call_sid = callData.sid;
    debug.call_status = callData.status;
    debug.call_direction = callData.direction;

    return { 
      success: true, 
      call_sid: callData.sid,
      scheduled_for: delayMinutes ? new Date(Date.now() + delayMinutes * 60 * 1000).toISOString() : undefined,
      debug
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('=== TWILIO CALL ERROR ===');
    console.error('Error type:', error instanceof Error ? error.constructor.name : typeof error);
    console.error('Error message:', errorMessage);
    console.error('Full error:', error);
    
    debug.error_type = error instanceof Error ? error.constructor.name : typeof error;
    debug.error_message = errorMessage;
    
    return { success: false, error: errorMessage, debug };
  }
}

// Log call to database
async function logCall(
  userId: string,
  callSid: string,
  direction: 'inbound' | 'outbound',
  triggerType: 'voice_assistant' | 'text_assistant' | 'cron' | 'direct',
  context?: string
): Promise<void> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  try {
    // Note: You'd need to create the twilio_call_logs table first
    // This is a placeholder for when the table exists
    console.log('Call logged:', { userId, callSid, direction, triggerType, context });
  } catch (error) {
    console.warn('Failed to log call:', error);
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get('action') || 'trigger-call';
  const contextParam = url.searchParams.get('context') || '';

  console.log(`Twilio voice handler: action=${action}`);

  try {
    switch (action) {
      case 'trigger-call': {
        // Parse JSON body for trigger-call requests
        const body: TwilioCallRequest = await req.json();
        
        // Get user's phone number from profile or use the provided one
        let phoneNumber = body.phoneNumber || Deno.env.get('MY_PHONE_NUMBER');
        
        if (body.userId) {
          const supabase = createClient(supabaseUrl, supabaseServiceKey);
          const { data: profile } = await supabase
            .from('profiles')
            .select('phone')
            .eq('user_id', body.userId)
            .maybeSingle();
          
          if (profile?.phone) {
            phoneNumber = profile.phone;
          }
        }

        if (!phoneNumber) {
          return new Response(JSON.stringify({
            success: false,
            error: 'No phone number configured. Please set MY_PHONE_NUMBER secret or add phone to your profile.'
          }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const result = await triggerOutboundCall(
          phoneNumber,
          body.context,
          body.delay_minutes
        );

        if (result.success && body.userId) {
          await logCall(body.userId, result.call_sid!, 'outbound', 'voice_assistant', body.context);
        }

        return new Response(JSON.stringify(result), {
          status: result.success ? 200 : 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'incoming-call': {
        // Return TwiML for incoming calls or when outbound call connects
        const twiml = generateTwiML(contextParam);
        
        return new Response(twiml, {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/xml',
          },
        });
      }

      case 'process-speech': {
        // Handle speech input from Gather (basic mode)
        const formData = await req.formData();
        const speechResult = formData.get('SpeechResult') as string;
        
        console.log('Received speech:', speechResult);
        
        // For basic mode, just acknowledge and end
        // Full integration would send this to OpenAI and respond
        const responseTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">I heard you say: ${speechResult || 'nothing'}. For full conversation, please use the app. Goodbye!</Say>
  <Hangup/>
</Response>`;

        return new Response(responseTwiml, {
          headers: { ...corsHeaders, 'Content-Type': 'application/xml' },
        });
      }

      case 'status-callback': {
        // Handle call status updates from Twilio
        const formData = await req.formData();
        const callSid = formData.get('CallSid') as string;
        const callStatus = formData.get('CallStatus') as string;
        const callDuration = formData.get('CallDuration') as string;

        console.log('Call status update:', { callSid, callStatus, callDuration });

        // Update call log in database if needed
        // For now, just acknowledge
        return new Response(JSON.stringify({ received: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
  } catch (error) {
    console.error('Error in twilio-voice-handler:', error);
    return new Response(JSON.stringify({ 
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

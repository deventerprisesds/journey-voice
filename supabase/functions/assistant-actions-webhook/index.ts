import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key',
}

interface ActionRequest {
  action_type: 'send_slack_message' | 'send_email' | 'create_calendar_event'
  message?: string
  recipient?: string
  subject?: string
  event_details?: {
    title: string
    start_time: string
    end_time: string
    description?: string
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    // Optional API key validation - only enforces if secret is configured
    const apiKey = req.headers.get('x-api-key')
    const configuredKey = Deno.env.get('ASSISTANT_ACTION_API_KEY')
    
    if (configuredKey && apiKey !== configuredKey) {
      console.log('❌ Invalid API key provided')
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid API key' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    
    // If no key is configured, allow all requests (testing mode)
    if (!configuredKey) {
      console.log('ℹ️ No ASSISTANT_ACTION_API_KEY configured - allowing request (testing mode)')
    }

    const body: ActionRequest = await req.json()
    console.log('📥 Action request received:', JSON.stringify(body, null, 2))

    const { action_type, message, recipient, subject, event_details } = body

    if (!action_type) {
      return new Response(
        JSON.stringify({ success: false, error: 'action_type is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Build notification payload based on action type
    // Note: send-unified-notification expects 'body' not 'message'
    let channels: string[] = []
    let notificationPayload: Record<string, unknown> = {
      title: 'Iris Chase',
      body: message || 'Action triggered by assistant',
    }

    switch (action_type) {
      case 'send_slack_message':
        if (!message) {
          return new Response(
            JSON.stringify({ success: false, error: 'message is required for send_slack_message' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
        channels = ['SLACK']
        notificationPayload.body = message
        break
      
      case 'send_email':
        if (!message || !recipient) {
          return new Response(
            JSON.stringify({ success: false, error: 'message and recipient are required for send_email' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
        channels = ['EMAIL']
        notificationPayload.recipient = recipient
        notificationPayload.subject = subject || 'Message from Iris Chase'
        notificationPayload.body = message
        break
      
      case 'create_calendar_event':
        if (!event_details?.title || !event_details?.start_time || !event_details?.end_time) {
          return new Response(
            JSON.stringify({ success: false, error: 'event_details with title, start_time, and end_time are required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
        channels = ['GOOGLE_EVENT', 'OUTLOOK_EVENT']
        notificationPayload.calendarEvent = {
          title: event_details.title,
          startTime: event_details.start_time,
          endTime: event_details.end_time,
          description: event_details.description || '',
        }
        break
      
      default:
        return new Response(
          JSON.stringify({ success: false, error: `Unknown action_type: ${action_type}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }

    console.log('📤 Routing to send-unified-notification with channels:', channels)

    // Call send-unified-notification edge function
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { data, error } = await supabase.functions.invoke('send-unified-notification', {
      body: {
        channels,
        ...notificationPayload,
      }
    })

    if (error) {
      console.error('❌ Unified notification error:', error)
      return new Response(
        JSON.stringify({ success: false, error: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('✅ Action completed successfully:', JSON.stringify(data, null, 2))
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `${action_type} executed successfully`,
        result: data,
        timestamp: new Date().toISOString()
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('❌ Action webhook error:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

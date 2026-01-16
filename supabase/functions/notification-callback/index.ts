import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CallbackPayload {
  notification_id: string;
  status: 'delivered' | 'failed';
  channel?: string;
  error?: string;
  details?: any;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const payload: CallbackPayload = await req.json();
    
    console.log('Received notification callback:', payload);

    if (!payload.notification_id) {
      return new Response(
        JSON.stringify({ error: 'notification_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify the notification exists
    const { data: existing, error: fetchError } = await supabaseClient
      .from('scheduled_notifications')
      .select('id, failure_reason')
      .eq('id', payload.notification_id)
      .single();

    if (fetchError || !existing) {
      console.error('Notification not found:', payload.notification_id);
      return new Response(
        JSON.stringify({ error: 'Notification not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update the notification status
    const updateData: any = {};
    
    if (payload.status === 'delivered') {
      updateData.delivered_at = new Date().toISOString();
      updateData.failed_at = null;
      updateData.failure_reason = null;
    } else if (payload.status === 'failed') {
      updateData.failed_at = new Date().toISOString();
      
      // Build error message
      const errorParts: string[] = [];
      if (payload.channel) errorParts.push(`Channel: ${payload.channel}`);
      if (payload.error) errorParts.push(payload.error);
      if (payload.details) errorParts.push(JSON.stringify(payload.details));
      
      // Append to existing failure reason if present
      const existingReason = existing.failure_reason || '';
      const newReason = errorParts.join(' - ');
      updateData.failure_reason = existingReason 
        ? `${existingReason}; ${newReason}`.substring(0, 500)
        : newReason.substring(0, 500);
    }

    const { error: updateError } = await supabaseClient
      .from('scheduled_notifications')
      .update(updateData)
      .eq('id', payload.notification_id);

    if (updateError) {
      console.error('Error updating notification:', updateError);
      return new Response(
        JSON.stringify({ error: 'Failed to update notification', details: updateError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Notification status updated:', payload.notification_id, payload.status);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Notification marked as ${payload.status}`,
        notification_id: payload.notification_id
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in notification-callback function:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

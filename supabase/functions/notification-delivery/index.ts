import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    console.log('Processing pending notifications...');
    
    const now = new Date();
    
    // Get all pending notifications that should be delivered
    const { data: pendingNotifications, error: fetchError } = await supabaseClient
      .from('scheduled_notifications')
      .select('*')
      .is('delivered_at', null)
      .is('failed_at', null)
      .lte('scheduled_for', now.toISOString())
      .order('scheduled_for', { ascending: true })
      .limit(50); // Process in batches

    if (fetchError) {
      console.error('Error fetching pending notifications:', fetchError);
      throw fetchError;
    }

    if (!pendingNotifications || pendingNotifications.length === 0) {
      console.log('No pending notifications to process');
      return new Response(
        JSON.stringify({ success: true, processed: 0, message: 'No pending notifications' }),
        { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log(`Found ${pendingNotifications.length} pending notifications to process`);
    
    let delivered = 0;
    let failed = 0;

    for (const notification of pendingNotifications) {
      try {
        console.log(`Processing notification ${notification.id} for user ${notification.user_id}`);
        
        // Send the notification via push notification service
        const { data: pushResult, error: pushError } = await supabaseClient.functions.invoke('send-push-notification', {
          body: {
            userId: notification.user_id,
            title: notification.title,
            body: notification.body,
            data: {
              type: notification.notification_type,
              taskId: notification.task_id,
              notificationId: notification.id
            }
          }
        });

        if (pushError) {
          throw new Error(`Push notification failed: ${pushError.message}`);
        }

        // Mark as delivered
        const { error: updateError } = await supabaseClient
          .from('scheduled_notifications')
          .update({ 
            delivered_at: new Date().toISOString(),
            failure_reason: null
          })
          .eq('id', notification.id);

        if (updateError) {
          console.error('Error updating notification status:', updateError);
        } else {
          console.log(`Successfully delivered notification ${notification.id}`);
          delivered++;
        }

      } catch (error) {
        console.error(`Failed to deliver notification ${notification.id}:`, error);
        
        // Mark as failed
        const { error: failError } = await supabaseClient
          .from('scheduled_notifications')
          .update({ 
            failed_at: new Date().toISOString(),
            failure_reason: error.message || 'Unknown error'
          })
          .eq('id', notification.id);

        if (failError) {
          console.error('Error updating notification failure status:', failError);
        }
        
        failed++;
      }
    }

    console.log(`Notification processing complete: ${delivered} delivered, ${failed} failed`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        processed: pendingNotifications.length,
        delivered,
        failed,
        message: `Processed ${pendingNotifications.length} notifications: ${delivered} delivered, ${failed} failed`
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error: any) {
    console.error('Error in notification delivery function:', error);
    
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
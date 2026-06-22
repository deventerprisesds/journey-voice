import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface NotificationRequest {
  userId: string;
  title: string;
  body: string;
  channel?: string;
  data?: {
    type: string;
    taskId?: string;
    notificationId?: string;
    messageId?: string;
    threadId?: string;
    callType?: string;
    openCommsConsole?: boolean;
    batchSize?: number;
    notificationIds?: string[];
    messageData?: {
      id: string;
      role: string;
      content: string;
      source: string;
      assistant_id?: string;
      created_at: string;
      thread_id: string;
    };
  };
}

// ── FCM HTTP v1 helpers ──────────────────────────────────────────────────────

async function getFcmAccessToken(serviceAccountJson: string): Promise<string> {
  const sa = JSON.parse(serviceAccountJson);
  const now = Math.floor(Date.now() / 1000);
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = btoa(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: sa.token_uri,
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claim}`;

  // Import the private key for signing
  const pemBody = sa.private_key
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');
  const keyBytes = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', keyBytes.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );
  const sigBytes = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', cryptoKey,
    new TextEncoder().encode(unsigned)
  );
  const sig = btoa(String.fromCharCode(...new Uint8Array(sigBytes)));
  const jwt = `${unsigned}.${sig}`;

  const tokenRes = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) throw new Error(`FCM token error: ${JSON.stringify(tokenData)}`);
  return tokenData.access_token;
}

async function sendFcmNotification(
  fcmToken: string,
  title: string,
  body: string,
  data: Record<string, string>,
  serviceAccountJson: string,
): Promise<void> {
  const sa = JSON.parse(serviceAccountJson);
  const accessToken = await getFcmAccessToken(serviceAccountJson);

  const message = {
    message: {
      token: fcmToken,
      notification: { title, body },
      data,
      android: {
        priority: 'high',
        notification: {
          channel_id: channel ?? 'task-reminders',
          default_vibrate_timings: true,
          default_sound: true,
        },
      },
    },
  };

  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`FCM send failed (${res.status}): ${err}`);
  }
}

// ── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { userId, title, body, channel, data }: NotificationRequest = await req.json();

    console.log('[send-push-notification] Processing:', { userId, title, body, data });

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: subscriptions, error: fetchError } = await supabaseClient
      .from('push_subscriptions')
      .select('*')
      .eq('user_id', userId);

    if (fetchError) {
      console.error('[send-push-notification] Error fetching subscriptions:', fetchError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch push subscriptions', details: fetchError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!subscriptions || subscriptions.length === 0) {
      console.log('[send-push-notification] No subscriptions for user:', userId);
      supabaseClient.from('activity_log').insert({
        user_id: userId,
        activity_type: 'browser_push_skipped',
        status: 'completed',
        metadata: { reason: 'no_subscriptions', title }
      }).then(() => {}).catch(() => {});

      return new Response(
        JSON.stringify({ success: true, message: 'No push subscriptions found', delivered: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[send-push-notification] Found ${subscriptions.length} subscription(s)`);

    // FCM service account (may be absent for web-only users)
    const serviceAccountJson = Deno.env.get('FIREBASE_SERVICE_ACCOUNT_KEY') ?? '';

    // Web push config
    const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY');
    const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY');
    if (vapidPublicKey && vapidPrivateKey) {
      webpush.setVapidDetails(
        'mailto:support@journey-voice.lovable.app',
        vapidPublicKey,
        vapidPrivateKey
      );
    }

    const webPayload = JSON.stringify({
      title,
      body,
      data: { ...data, messageData: data?.messageData || null },
      icon: '/icons/iris-icon-192.png',
      badge: '/icons/iris-badge-72.png',
      tag: data?.notificationId || data?.messageId || 'default',
      requireInteraction: true,
    });

    // Flatten data values to strings for FCM data payload
    const fcmData: Record<string, string> = {
      title,
      body,
      type: data?.type ?? '',
      taskId: data?.taskId ?? '',
      notificationId: data?.notificationId ?? '',
      channel: channel ?? 'task-reminders',
    };

    // If the user has any FCM token registered, send only via FCM.
    // This prevents duplicate notifications from both the Android app and the browser.
    const hasFcmToken = subscriptions.some((s: any) => s.fcm_token);
    const subsToNotify = hasFcmToken
      ? subscriptions.filter((s: any) => s.fcm_token)
      : subscriptions;

    const results = await Promise.allSettled(
      subsToNotify.map(async (sub) => {
        // Route FCM subscriptions to Firebase
        if (sub.fcm_token) {
          if (!serviceAccountJson) {
            console.warn('[send-push-notification] FCM token present but FIREBASE_SERVICE_ACCOUNT_KEY not set');
            return { success: false, endpoint: sub.endpoint, error: 'No FCM credentials' };
          }
          try {
            await sendFcmNotification(sub.fcm_token, title, body, fcmData, serviceAccountJson);
            console.log('[send-push-notification] FCM sent to token:', sub.fcm_token.substring(0, 20));
            return { success: true, endpoint: sub.endpoint };
          } catch (err: any) {
            console.error('[send-push-notification] FCM send failed:', err.message);
            return { success: false, endpoint: sub.endpoint, error: err.message };
          }
        }

        // Web push path
        if (!vapidPublicKey || !vapidPrivateKey) {
          console.warn('[send-push-notification] VAPID keys not configured, skipping web push');
          return { success: false, endpoint: sub.endpoint, error: 'No VAPID keys' };
        }

        const pushSubscription = {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh_key, auth: sub.auth_key },
        };

        try {
          await webpush.sendNotification(pushSubscription, webPayload);
          console.log('[send-push-notification] Web push sent to:', sub.endpoint.substring(0, 50));
          return { success: true, endpoint: sub.endpoint };
        } catch (pushError: any) {
          console.error('[send-push-notification] Web push failed:', sub.endpoint.substring(0, 50), pushError.message);
          if (pushError.statusCode === 410 || pushError.statusCode === 404) {
            console.log('[send-push-notification] Removing expired subscription');
            await supabaseClient.from('push_subscriptions').delete().eq('id', sub.id);
          }
          return { success: false, endpoint: sub.endpoint, error: pushError.message };
        }
      })
    );

    const successCount = results.filter(r => r.status === 'fulfilled' && (r.value as any).success).length;
    const failureCount = results.length - successCount;

    console.log(`[send-push-notification] Done: ${successCount} success, ${failureCount} failed`);

    supabaseClient.from('activity_log').insert({
      user_id: userId,
      activity_type: failureCount > 0 && successCount === 0 ? 'browser_push_failed' : 'browser_push_sent',
      status: successCount > 0 ? 'completed' : 'error',
      metadata: { title, subscriptionCount: subscriptions.length, successCount, failureCount, taskId: data?.taskId, notificationId: data?.notificationId }
    }).then(() => {}).catch(() => {});

    return new Response(
      JSON.stringify({
        success: true,
        message: `Push notification delivered to ${successCount} of ${subscriptions.length} subscriptions`,
        delivered: successCount,
        failed: failureCount
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[send-push-notification] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

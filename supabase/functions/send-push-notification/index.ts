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
  // Source app that originated this push (e.g. "huddle" for the standalone Huddle bridge app). When
  // set, delivery is targeted to ONLY that app's device tokens (endpoints `fcm:app:<app>:<token>`),
  // so a Huddle-agent push doesn't also fan out to journey's web + bridge subscriptions (the
  // duplicate-notification bug). When absent, this is a journey-native push and delivery goes to
  // everything EXCEPT app-namespaced tokens — byte-identical to the pre-multi-app fan-out.
  app?: string;
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
    // Opt-in delivery controls (default omitted → unchanged behavior). ttl = seconds FCM/web-push may
    // retry an undelivered push; collapseKey = a newer push replaces an older undelivered one.
    ttl?: number | string;
    collapseKey?: string;
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

// JWT requires base64url encoding: replace + with -, / with _, strip = padding
const toBase64Url = (b64: string) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

async function getFcmAccessToken(serviceAccountJson: string): Promise<string> {
  const sa = JSON.parse(serviceAccountJson);
  const now = Math.floor(Date.now() / 1000);
  const header = toBase64Url(btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claim = toBase64Url(btoa(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: sa.token_uri,
    iat: now,
    exp: now + 3600,
  })));
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
  const sig = toBase64Url(btoa(String.fromCharCode(...new Uint8Array(sigBytes))));
  const jwt = `${unsigned}.${sig}`;

  const tokenRes = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${encodeURIComponent(jwt)}`,
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
  opts?: { ttlSeconds?: number; collapseKey?: string },
): Promise<void> {
  const sa = JSON.parse(serviceAccountJson);
  const accessToken = await getFcmAccessToken(serviceAccountJson);

  // OPT-IN delivery controls (default path unchanged → reminders/alarms/messages are unaffected):
  //  - ttl caps how long FCM will retry an undelivered message (so a stale diagnostic can't sit in the
  //    queue and redeliver later); omitted → FCM default (~4 weeks).
  //  - collapse_key makes a newer message REPLACE an older undelivered one with the same key instead of
  //    stacking; omitted → no collapsing (each message independent, as before).
  const android: Record<string, unknown> = { priority: 'high' };
  if (opts?.ttlSeconds != null && Number.isFinite(opts.ttlSeconds)) {
    android.ttl = `${Math.max(0, Math.floor(opts.ttlSeconds))}s`;
  }
  if (opts?.collapseKey) android.collapse_key = opts.collapseKey;

  const message = {
    message: {
      token: fcmToken,
      data,
      android,
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
    const { userId, title, body, channel, data, app }: NotificationRequest = await req.json();

    console.log('[send-push-notification] Processing:', { userId, title, body, app, data });

    // OPT-IN delivery controls (see sendFcmNotification). Only take effect when the caller passes them
    // in `data` — every existing caller (reminders, alarms, messages) omits them, so their behavior is
    // unchanged. Used by the test-push diagnostic so a stale test push expires fast and collapses.
    const ttlSeconds = data?.ttl != null && data.ttl !== '' ? Number(data.ttl) : undefined;
    const collapseKey = typeof data?.collapseKey === 'string' && data.collapseKey ? data.collapseKey : undefined;
    const sendOpts = { ttlSeconds: Number.isFinite(ttlSeconds as number) ? (ttlSeconds as number) : undefined, collapseKey };

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Source-app-aware targeting. App-specific device tokens are namespaced `fcm:app:<app>:<token>`
    // (see manage-push-subscription / execute-tool register_push_token). A push carrying `app` reaches
    // ONLY that app's tokens; a journey-native push (no `app`) reaches everything EXCEPT app-namespaced
    // tokens, which is exactly the set that existed before any standalone app registered — so journey's
    // own reminders/messages don't newly fan out to Huddle, and a Huddle push doesn't hit journey.
    let subQuery = supabaseClient
      .from('push_subscriptions')
      .select('*')
      .eq('user_id', userId);
    if (app) {
      subQuery = subQuery.like('endpoint', `fcm:app:${app}:%`);
    } else {
      subQuery = subQuery.not('endpoint', 'like', 'fcm:app:%');
    }
    const { data: subscriptions, error: fetchError } = await subQuery;

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

    // Flatten data values to strings for FCM data payload.
    // Note: no top-level `notification` object — this is intentionally a data-only
    // message so onMessageReceived fires even when the app is backgrounded. The
    // Android bridge routes alarm-channel payloads to AlarmSoundService (looping),
    // which would be bypassed if FCM auto-displays the notification from a
    // `notification` object.
    const fcmData: Record<string, string> = {
      title,
      body,
      type: data?.type ?? '',
      taskId: data?.taskId ?? '',
      notificationId: data?.notificationId ?? '',
      channel: channel ?? 'task-reminders',
      deepLink: data?.deepLink ?? '/',
      tag: data?.tag ?? data?.notificationId ?? 'fcm',
    };

    const results = await Promise.allSettled(
      subscriptions.map(async (sub) => {
        // Route FCM subscriptions to Firebase
        if (sub.fcm_token) {
          if (!serviceAccountJson) {
            console.warn('[send-push-notification] FCM token present but FIREBASE_SERVICE_ACCOUNT_KEY not set');
            await supabaseClient.from('activity_log').insert({
              user_id: userId, activity_type: 'fcm_send_skipped', status: 'error',
              metadata: { reason: 'no_service_account', token_prefix: sub.fcm_token.substring(0, 20) }
            }).then(() => {}).catch(() => {});
            return { success: false, endpoint: sub.endpoint, error: 'No FCM credentials' };
          }
          try {
            await sendFcmNotification(sub.fcm_token, title, body, fcmData, serviceAccountJson, sendOpts);
            console.log('[send-push-notification] FCM sent to token:', sub.fcm_token.substring(0, 20));
            await supabaseClient.from('activity_log').insert({
              user_id: userId, activity_type: 'fcm_send_success', status: 'completed',
              metadata: { token_prefix: sub.fcm_token.substring(0, 20), channel: fcmData.channel, title }
            }).then(() => {}).catch(() => {});
            return { success: true, endpoint: sub.endpoint };
          } catch (err: any) {
            console.error('[send-push-notification] FCM send failed:', err.message);
            await supabaseClient.from('activity_log').insert({
              user_id: userId, activity_type: 'fcm_send_failed', status: 'error',
              error_message: err.message,
              metadata: { token_prefix: sub.fcm_token.substring(0, 20), channel: fcmData.channel, title }
            }).then(() => {}).catch(() => {});
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
          await webpush.sendNotification(
            pushSubscription,
            webPayload,
            sendOpts.ttlSeconds != null ? { TTL: sendOpts.ttlSeconds } : undefined,
          );
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

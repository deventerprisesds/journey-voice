import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { userId, title, startMs, endMs, description, reminderMinutes } = await req.json();
    if (!userId || !title || !startMs || !endMs) {
      return new Response(JSON.stringify({ error: 'userId, title, startMs, endMs are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const serviceAccountJson = Deno.env.get('FIREBASE_SERVICE_ACCOUNT_KEY') ?? '';
    if (!serviceAccountJson) {
      return new Response(JSON.stringify({ error: 'FIREBASE_SERVICE_ACCOUNT_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get all FCM tokens for the user from push_subscriptions
    const { data: subscriptions, error: subError } = await supabase
      .from('push_subscriptions')
      .select('fcm_token')
      .eq('user_id', userId)
      .not('fcm_token', 'is', null);

    if (subError) throw subError;
    if (!subscriptions || subscriptions.length === 0) {
      return new Response(JSON.stringify({ error: 'No Android device found for user — install the Journey Voice app first' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const sa = JSON.parse(serviceAccountJson);
    const accessToken = await getFcmAccessToken(serviceAccountJson);
    const reminders = Array.isArray(reminderMinutes) ? reminderMinutes : [0, 5];

    const results = await Promise.allSettled(
      subscriptions
        .filter(s => s.fcm_token)
        .map(async (sub) => {
          // Data-only message — no `notification` key — guarantees delivery to
          // onMessageReceived() even when the app is backgrounded/terminated.
          const message = {
            message: {
              token: sub.fcm_token,
              data: {
                type: 'create_calendar_event',
                title: String(title),
                startMs: String(startMs),
                endMs: String(endMs),
                description: String(description ?? ''),
                reminderMinutes: reminders.join(','),
              },
              android: { priority: 'high' },
            },
          };

          const res = await fetch(
            `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
            {
              method: 'POST',
              headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
              body: JSON.stringify(message),
            }
          );
          if (!res.ok) throw new Error(`FCM error ${res.status}: ${await res.text()}`);
          return { success: true };
        })
    );

    const delivered = results.filter(r => r.status === 'fulfilled').length;
    console.log(`[send-android-calendar-event] Delivered to ${delivered}/${subscriptions.length} devices`);

    return new Response(JSON.stringify({ success: true, delivered }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err: any) {
    console.error('[send-android-calendar-event] Error:', err);
    return new Response(JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { userId } = await req.json();
    if (!userId) {
      return new Response(JSON.stringify({ error: 'userId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // 1. Find the user's active Google Calendar connection
    const { data: conn } = await supabase
      .from('calendar_connections')
      .select('id, provider, provider_account_email, expires_at, access_token, refresh_token')
      .eq('user_id', userId)
      .eq('provider', 'google')
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!conn) {
      return new Response(JSON.stringify({ error: 'No active Google Calendar connection found for user' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 2. Get decrypted access token
    const { data: accessToken, error: decryptErr } = await supabase.rpc(
      'decrypt_token', { encrypted_token: conn.access_token, p_user_id: userId }
    );
    if (decryptErr || !accessToken) {
      return new Response(JSON.stringify({ error: 'Failed to decrypt access token', details: decryptErr?.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 3. Build a test event starting 3 minutes from now (UTC)
    const now = new Date();
    const startTime = new Date(now.getTime() + 3 * 60 * 1000);
    const endTime   = new Date(now.getTime() + 18 * 60 * 1000);

    const event = {
      summary: `📅 Samsung Calendar Test — ${startTime.toISOString()}`,
      description: `Programmatic test event created at ${now.toISOString()} UTC.\nStart: ${startTime.toISOString()} UTC\nEnd: ${endTime.toISOString()} UTC`,
      start: {
        dateTime: startTime.toISOString(),
        timeZone: 'UTC',
      },
      end: {
        dateTime: endTime.toISOString(),
        timeZone: 'UTC',
      },
      reminders: { useDefault: false, overrides: [] },
    };

    console.log('[test-google-calendar] Sending event to Google Calendar API:', JSON.stringify(event));

    // 4. POST to Google Calendar API
    const gcalRes = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    });

    const gcalBody = await gcalRes.text();
    if (!gcalRes.ok) {
      console.error('[test-google-calendar] Google Calendar API error:', gcalRes.status, gcalBody);
      return new Response(JSON.stringify({
        error: 'Google Calendar API rejected the event',
        status: gcalRes.status,
        details: gcalBody,
      }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const created = JSON.parse(gcalBody);
    console.log('[test-google-calendar] Event created:', created.id);

    return new Response(JSON.stringify({
      success: true,
      eventId: created.id,
      htmlLink: created.htmlLink,
      account: conn.provider_account_email,
      sentUtc: {
        start: startTime.toISOString(),
        end: endTime.toISOString(),
      },
      googleReturned: {
        start: created.start,
        end: created.end,
      },
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err: any) {
    console.error('[test-google-calendar] Error:', err);
    return new Response(JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

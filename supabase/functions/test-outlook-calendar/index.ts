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

    // 1. Find the user's active Outlook/Office365 connection
    const { data: conn } = await supabase
      .from('calendar_connections')
      .select('id, provider, provider_account_email, expires_at, access_token, refresh_token')
      .eq('user_id', userId)
      .in('provider', ['outlook', 'office365'])
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!conn) {
      return new Response(JSON.stringify({ error: 'No active Outlook connection found for user' }),
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

    // 3. Build a test event starting 15 minutes from now (UTC)
    const now = new Date();
    const startTime = new Date(now.getTime() + 15 * 60 * 1000);
    const endTime   = new Date(now.getTime() + 30 * 60 * 1000);

    const event = {
      subject: `📅 Calendar Test — ${startTime.toISOString()}`,
      body: {
        contentType: 'text',
        content: `This is a programmatic test event created at ${now.toISOString()} UTC.\nStart: ${startTime.toISOString()} UTC\nEnd: ${endTime.toISOString()} UTC`,
      },
      start: {
        dateTime: startTime.toISOString(),
        timeZone: 'UTC',
      },
      end: {
        dateTime: endTime.toISOString(),
        timeZone: 'UTC',
      },
      isReminderOn: false,
    };

    console.log('[test-outlook-calendar] Sending event to Graph API:', JSON.stringify(event));

    // 4. POST directly to Graph API
    const graphRes = await fetch('https://graph.microsoft.com/v1.0/me/calendar/events', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    });

    const graphBody = await graphRes.text();
    if (!graphRes.ok) {
      console.error('[test-outlook-calendar] Graph API error:', graphRes.status, graphBody);
      return new Response(JSON.stringify({
        error: 'Graph API rejected the event',
        status: graphRes.status,
        details: graphBody,
      }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const created = JSON.parse(graphBody);
    console.log('[test-outlook-calendar] Event created:', created.id);

    return new Response(JSON.stringify({
      success: true,
      eventId: created.id,
      webLink: created.webLink,
      account: conn.provider_account_email,
      sentUtc: {
        start: startTime.toISOString(),
        end: endTime.toISOString(),
      },
      graphReturned: {
        start: created.start,
        end: created.end,
      },
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err: any) {
    console.error('[test-outlook-calendar] Error:', err);
    return new Response(JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

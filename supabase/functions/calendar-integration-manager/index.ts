import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CalendarEvent {
  id: string;
  title: string;
  description?: string;
  start_time: string;
  end_time: string;
  is_all_day: boolean;
  location?: string;
  calendar_id: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, provider, connection_id, start_date, end_date, user_id, task, task_id } = await req.json();
    
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log(`Calendar integration action: ${action} for provider: ${provider}`);

    switch (action) {
      case 'sync_events':
        return await syncCalendarEvents(supabaseClient, connection_id, start_date, end_date);
      case 'get_availability':
        return await getCalendarAvailability(supabaseClient, connection_id, start_date, end_date);
      case 'create_event':
        return await createCalendarEvent(supabaseClient, connection_id, { task });
      case 'delete_event':
        return await deleteCalendarEvent(supabaseClient, task_id, user_id, connection_id);
      case 'get_read_connections':
        return await getConnectionsByPurpose(supabaseClient, user_id, 'READ');
      case 'get_write_connections':
        return await getConnectionsByPurpose(supabaseClient, user_id, 'WRITE');
      case 'list_calendars':
        return await listCalendars(supabaseClient, connection_id);
      default:
        return new Response(JSON.stringify({ error: 'Invalid action' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  } catch (error) {
    console.error('Calendar integration error:', error);
    return new Response(
      JSON.stringify({ error: 'Calendar integration failed', details: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function getConnectionsByPurpose(supabaseClient: any, userId: string, purpose: 'READ' | 'WRITE') {
  const { data: connections, error } = await supabaseClient
    .from('calendar_connections')
    .select('id, provider, provider_account_email, purposes, is_active, expires_at')
    .eq('user_id', userId)
    .eq('is_active', true)
    .contains('purposes', [purpose]);

  if (error) throw new Error(`Failed to get connections: ${error.message}`);

  const now = new Date();
  const validConnections = (connections || []).filter((conn: any) => !conn.expires_at || new Date(conn.expires_at) > now);

  return new Response(JSON.stringify({ connections: validConnections }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// Helper: get a valid access token for a connection, refreshing if expired
async function getValidAccessToken(supabaseClient: any, connectionId: string, userId: string): Promise<{ access_token: string; provider: string }> {
  const { data: connRecord, error: connError } = await supabaseClient
    .from('calendar_connections')
    .select('user_id, provider, expires_at, refresh_token')
    .eq('id', connectionId)
    .single();

  if (connError || !connRecord) throw new Error('Calendar connection not found');

  // Check if token is expired (or will expire within 5 minutes)
  const now = new Date();
  const expiresAt = connRecord.expires_at ? new Date(connRecord.expires_at) : null;
  const isExpired = expiresAt && expiresAt < new Date(now.getTime() + 5 * 60 * 1000);

  if (isExpired && connRecord.refresh_token) {
    console.log(`[calendar-integration-manager] Token expired for ${connectionId}, attempting refresh...`);
    
    // Attempt silent refresh via calendar-token-manager
    try {
      const refreshResult = await doInlineRefresh(supabaseClient, connRecord.provider, connectionId, userId);
      if (refreshResult.access_token) {
        return { access_token: refreshResult.access_token, provider: connRecord.provider };
      }
    } catch (refreshErr) {
      console.warn(`[calendar-integration-manager] Inline refresh failed:`, refreshErr);
      // Fall through to try with existing token
    }
  }

  // Get tokens via RPC
  const { data: tokenData, error: tokenError } = await supabaseClient
    .rpc('get_calendar_connection_tokens_service', { _connection_id: connectionId, _user_id: userId || connRecord.user_id });

  if (tokenError || !tokenData || tokenData.length === 0) throw new Error('Calendar connection tokens not found');

  return { access_token: tokenData[0].access_token, provider: tokenData[0].provider };
}

// Inline token refresh without calling another edge function
async function doInlineRefresh(supabaseClient: any, provider: string, connectionId: string, userId: string): Promise<{ access_token: string }> {
  // Get current refresh token
  const { data: tokenData } = await supabaseClient
    .rpc('get_calendar_connection_tokens_service', { _connection_id: connectionId, _user_id: userId });

  if (!tokenData?.[0]?.refresh_token) throw new Error('No refresh token');

  const refreshToken = tokenData[0].refresh_token;
  let tokenEndpoint: string;
  let body: URLSearchParams;

  if (provider === 'google') {
    const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
    const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
    if (!clientId || !clientSecret) throw new Error('Google OAuth credentials not configured');
    tokenEndpoint = 'https://oauth2.googleapis.com/token';
    body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' });
  } else {
    const clientId = Deno.env.get('MICROSOFT_CLIENT_ID');
    const clientSecret = Deno.env.get('MICROSOFT_CLIENT_SECRET');
    if (!clientId || !clientSecret) throw new Error('Microsoft OAuth credentials not configured');
    tokenEndpoint = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
    body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token', scope: 'Calendars.ReadWrite User.Read offline_access' });
  }

  const tokenResponse = await fetch(tokenEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!tokenResponse.ok) throw new Error('Refresh failed');

  const tokens = await tokenResponse.json();
  const expiresAtStr = tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null;

  // Use RPC to ensure tokens are encrypted via encrypt_token()
  await supabaseClient.rpc('update_calendar_connection_tokens_for_user', {
    _connection_id: connectionId,
    _user_id: userId,
    _access_token: tokens.access_token,
    _refresh_token: tokens.refresh_token || null,
    _expires_at: expiresAtStr,
  });

  console.log(`[calendar-integration-manager] Inline refresh succeeded for ${connectionId}`);
  return { access_token: tokens.access_token };
}

async function syncCalendarEvents(supabaseClient: any, connectionId: string, startDate: string, endDate: string) {
  const { data: connRecord } = await supabaseClient
    .from('calendar_connections')
    .select('user_id, purposes')
    .eq('id', connectionId)
    .single();

  if (!connRecord) throw new Error('Calendar connection not found');

  if (!connRecord?.purposes?.includes('READ')) {
    return new Response(JSON.stringify({ success: false, error: 'Connection does not have READ purpose' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const { access_token, provider } = await getValidAccessToken(supabaseClient, connectionId, connRecord.user_id);
  const connection = { access_token, provider, user_id: connRecord.user_id };

  const events = await fetchExternalCalendarEvents(connection, startDate, endDate);
  
  const eventsToInsert = events.map(event => ({
    user_id: connection.user_id, connection_id: connectionId,
    external_event_id: event.id, title: event.title, description: event.description,
    start_time: event.start_time, end_time: event.end_time, is_all_day: event.is_all_day,
    location: event.location, calendar_id: event.calendar_id,
    last_synced_at: new Date().toISOString(),
  }));

  const { error: upsertError } = await supabaseClient
    .from('external_calendar_events')
    .upsert(eventsToInsert, { onConflict: 'connection_id,external_event_id', ignoreDuplicates: false });

  if (upsertError) throw new Error(`Failed to sync events: ${upsertError.message}`);

  return new Response(JSON.stringify({ success: true, synced_events: events.length }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

async function getCalendarAvailability(supabaseClient: any, connectionId: string, startDate: string, endDate: string) {
  const { data: events, error } = await supabaseClient
    .from('external_calendar_events')
    .select('start_time, end_time, is_all_day')
    .eq('connection_id', connectionId)
    .gte('start_time', startDate)
    .lte('end_time', endDate)
    .order('start_time');

  if (error) throw new Error(`Failed to get availability: ${error.message}`);

  return new Response(JSON.stringify({ busy_slots: events.map((e: any) => ({ start: e.start_time, end: e.end_time, is_all_day: e.is_all_day })) }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

async function createCalendarEvent(supabaseClient: any, connectionId: string, body: { task: any }) {
  const { task } = body;
  
  const { data: connInfo } = await supabaseClient
    .from('calendar_connections')
    .select('purposes, user_id')
    .eq('id', connectionId)
    .single();

  if (!connInfo) throw new Error('Calendar connection not found');

  if (!connInfo?.purposes?.includes('WRITE')) {
    return new Response(JSON.stringify({ success: false, error: 'Connection does not have WRITE purpose' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const { access_token, provider } = await getValidAccessToken(supabaseClient, connectionId, connInfo.user_id);
  const connection = { access_token, provider };

  const externalEventId = await createExternalCalendarEvent(connection, task);
  
  if (task?.id) {
    await supabaseClient.from('tasks').update({ external_event_id: externalEventId }).eq('id', task.id);
    await supabaseClient.from('external_calendar_events').upsert({
      user_id: connInfo.user_id, connection_id: connectionId,
      external_event_id: externalEventId, title: task.title,
      description: task.description || '', start_time: task.start_time,
      end_time: task.end_time, is_all_day: false, calendar_id: 'primary',
      source_task_id: task.id, last_synced_at: new Date().toISOString(),
    }, { onConflict: 'connection_id,external_event_id', ignoreDuplicates: false });
  }

  return new Response(JSON.stringify({ success: true, external_event_id: externalEventId }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

async function fetchExternalCalendarEvents(connection: any, startDate: string, endDate: string): Promise<CalendarEvent[]> {
  if (connection.provider === 'google') return await fetchGoogleCalendarEvents(connection, startDate, endDate);
  if (connection.provider === 'outlook' || connection.provider === 'office365') return await fetchOutlookCalendarEvents(connection, startDate, endDate);
  return [];
}

async function fetchGoogleCalendarEvents(connection: any, startDate: string, endDate: string): Promise<CalendarEvent[]> {
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${startDate}&timeMax=${endDate}&singleEvents=true&orderBy=startTime`;
  const response = await fetch(url, { headers: { 'Authorization': `Bearer ${connection.access_token}` } });
  if (!response.ok) throw new Error(`Google Calendar API error: ${response.status} ${response.statusText}`);
  const data = await response.json();
  return data.items?.map((event: any) => ({
    id: event.id, title: event.summary || 'Untitled Event', description: event.description,
    start_time: event.start.dateTime || event.start.date, end_time: event.end.dateTime || event.end.date,
    is_all_day: !event.start.dateTime, location: event.location, calendar_id: 'primary',
  })) || [];
}

async function fetchOutlookCalendarEvents(connection: any, startDate: string, endDate: string): Promise<CalendarEvent[]> {
  const url = `https://graph.microsoft.com/v1.0/me/calendar/events?$filter=start/dateTime ge '${startDate}' and end/dateTime le '${endDate}'&$orderby=start/dateTime`;
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${connection.access_token}`,
      'Prefer': 'outlook.timezone="UTC"',
    },
  });
  if (!response.ok) throw new Error(`Outlook Calendar API error: ${response.status} ${response.statusText}`);
  const data = await response.json();
  return data.value?.map((event: any) => ({
    id: event.id, title: event.subject || 'Untitled Event', description: event.body?.content,
    start_time: event.start.dateTime + 'Z', end_time: event.end.dateTime + 'Z',
    is_all_day: event.isAllDay, location: event.location?.displayName, calendar_id: 'primary',
  })) || [];
}

async function createExternalCalendarEvent(connection: any, task: any): Promise<string> {
  if (connection.provider === 'google') return await createGoogleCalendarEvent(connection, task);
  if (connection.provider === 'outlook' || connection.provider === 'office365') return await createOutlookCalendarEvent(connection, task);
  throw new Error('Unsupported calendar provider');
}

async function createGoogleCalendarEvent(connection: any, task: any): Promise<string> {
  const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${connection.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ summary: task.title, description: task.description, start: { dateTime: task.start_time, timeZone: 'UTC' }, end: { dateTime: task.end_time, timeZone: 'UTC' } }),
  });
  if (!response.ok) throw new Error(`Failed to create Google Calendar event: ${response.statusText}`);
  return (await response.json()).id;
}

async function createOutlookCalendarEvent(connection: any, task: any): Promise<string> {
  const response = await fetch('https://graph.microsoft.com/v1.0/me/calendar/events', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${connection.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ subject: task.title, body: { contentType: 'text', content: task.description || '' }, start: { dateTime: task.start_time, timeZone: 'UTC' }, end: { dateTime: task.end_time, timeZone: 'UTC' } }),
  });
  if (!response.ok) throw new Error(`Failed to create Outlook Calendar event: ${response.statusText}`);
  return (await response.json()).id;
}

async function deleteCalendarEvent(supabaseClient: any, taskId: string, userId: string, connectionId?: string) {
  if (!taskId) {
    return new Response(JSON.stringify({ error: 'task_id is required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // Only delete app-originated events (source_task_id is set)
  const { data: eventRow, error: eventError } = await supabaseClient
    .from('external_calendar_events')
    .select('id, external_event_id, connection_id, source_task_id')
    .eq('source_task_id', taskId)
    .maybeSingle();

  if (eventError) {
    console.error(`[delete_event] Error looking up event for task ${taskId}:`, eventError);
    throw new Error(`Failed to look up calendar event: ${eventError.message}`);
  }

  if (!eventRow) {
    console.log(`[delete_event] No app-originated calendar event found for task ${taskId} — skipping`);
    return new Response(JSON.stringify({ success: true, skipped: true, reason: 'no_app_originated_event' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const effectiveConnectionId = connectionId || eventRow.connection_id;

  // Get connection info for user_id lookup
  const { data: connRecord } = await supabaseClient
    .from('calendar_connections')
    .select('user_id')
    .eq('id', effectiveConnectionId)
    .single();

  if (!connRecord) throw new Error('Calendar connection not found');

  const effectiveUserId = userId || connRecord.user_id;

  try {
    const { access_token, provider } = await getValidAccessToken(supabaseClient, effectiveConnectionId, effectiveUserId);

    // Call provider DELETE API
    if (provider === 'google') {
      await deleteGoogleCalendarEvent(access_token, eventRow.external_event_id);
    } else if (provider === 'outlook' || provider === 'office365' || provider === 'microsoft') {
      await deleteOutlookCalendarEvent(access_token, eventRow.external_event_id);
    }

    console.log(`[delete_event] Deleted external event ${eventRow.external_event_id} from ${provider}`);
  } catch (deleteErr) {
    // Log but don't fail — the event may already be deleted externally
    console.warn(`[delete_event] Provider delete failed (non-fatal):`, deleteErr);
  }

  // Clean up DB: remove from external_calendar_events
  await supabaseClient
    .from('external_calendar_events')
    .delete()
    .eq('id', eventRow.id);

  // Clear external_event_id on the task
  await supabaseClient
    .from('tasks')
    .update({ external_event_id: null, updated_at: new Date().toISOString() })
    .eq('id', taskId);

  console.log(`[delete_event] Cleaned up DB for task ${taskId}`);
  return new Response(JSON.stringify({ success: true, deleted_event_id: eventRow.external_event_id }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

async function deleteGoogleCalendarEvent(accessToken: string, eventId: string): Promise<void> {
  const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });
  if (!response.ok && response.status !== 404 && response.status !== 410) {
    throw new Error(`Google Calendar DELETE failed: ${response.status} ${response.statusText}`);
  }
}

async function deleteOutlookCalendarEvent(accessToken: string, eventId: string): Promise<void> {
  const response = await fetch(`https://graph.microsoft.com/v1.0/me/events/${eventId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Outlook Calendar DELETE failed: ${response.status} ${response.statusText}`);
  }
}

async function listCalendars(supabaseClient: any, connectionId: string) {
  const { data: connRecord } = await supabaseClient
    .from('calendar_connections')
    .select('user_id')
    .eq('id', connectionId)
    .single();

  if (!connRecord) throw new Error('Calendar connection not found');

  // Use getValidAccessToken which handles auto-refresh
  const { access_token, provider } = await getValidAccessToken(supabaseClient, connectionId, connRecord.user_id);

  let calendars: Array<{ id: string; name: string; primary: boolean }> = [];

  if (provider === 'google') {
    const res = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
      headers: { 'Authorization': `Bearer ${access_token}` },
    });
    if (!res.ok) throw new Error(`Google API error: ${res.status} ${res.statusText}`);
    const data = await res.json();
    calendars = (data.items || []).map((c: any) => ({ id: c.id, name: c.summary || c.id, primary: !!c.primary }));
  } else if (provider === 'outlook' || provider === 'office365' || provider === 'microsoft') {
    const res = await fetch('https://graph.microsoft.com/v1.0/me/calendars', {
      headers: { 'Authorization': `Bearer ${access_token}` },
    });
    if (!res.ok) throw new Error(`Microsoft Graph error: ${res.status} ${res.statusText}`);
    const data = await res.json();
    calendars = (data.value || []).map((c: any) => ({ id: c.id, name: c.name || c.id, primary: c.isDefaultCalendar || false }));
  }

  console.log(`Listed ${calendars.length} calendars for connection ${connectionId}`);
  return new Response(JSON.stringify({ calendars }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

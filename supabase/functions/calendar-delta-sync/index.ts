import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DeltaSyncResult {
  connection_id: string;
  provider: string;
  events_added: number;
  events_updated: number;
  events_deleted: number;
  error?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  try {
    const { user_id, connection_id } = await req.json().catch(() => ({}));
    
    console.log('[calendar-delta-sync] Starting delta sync', { user_id, connection_id });

    // Get all active READ-purpose connections (or specific one if connection_id provided)
    let query = supabaseClient
      .from('calendar_connections')
      .select('id, user_id, provider, sync_token, purposes, expires_at, access_token, refresh_token')
      .eq('is_active', true)
      .contains('purposes', ['READ']);

    if (connection_id) {
      query = query.eq('id', connection_id);
    } else if (user_id) {
      query = query.eq('user_id', user_id);
    }

    const { data: connections, error: connError } = await query;

    if (connError) {
      console.error('[calendar-delta-sync] Failed to fetch connections:', connError);
      throw new Error(`Failed to fetch connections: ${connError.message}`);
    }

    if (!connections || connections.length === 0) {
      console.log('[calendar-delta-sync] No READ connections found');
      return new Response(
        JSON.stringify({ success: true, message: 'No READ connections to sync', results: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const results: DeltaSyncResult[] = [];
    const now = new Date();

    for (const connection of connections) {
      // Skip expired connections
      if (connection.expires_at && new Date(connection.expires_at) < now) {
        console.log(`[calendar-delta-sync] Skipping expired connection: ${connection.id}`);
        results.push({
          connection_id: connection.id,
          provider: connection.provider,
          events_added: 0,
          events_updated: 0,
          events_deleted: 0,
          error: 'Token expired - needs re-authentication'
        });
        continue;
      }

      try {
        // Get decrypted tokens
        const { data: tokenData, error: tokenError } = await supabaseClient
          .rpc('get_calendar_connection_tokens', { _connection_id: connection.id });

        if (tokenError || !tokenData?.[0]) {
          console.error(`[calendar-delta-sync] Failed to get tokens for ${connection.id}:`, tokenError);
          results.push({
            connection_id: connection.id,
            provider: connection.provider,
            events_added: 0,
            events_updated: 0,
            events_deleted: 0,
            error: 'Failed to decrypt tokens'
          });
          continue;
        }

        const tokens = tokenData[0];
        let result: DeltaSyncResult;

        if (connection.provider === 'outlook' || connection.provider === 'office365') {
          result = await syncOutlookDelta(supabaseClient, connection, tokens);
        } else if (connection.provider === 'google') {
          result = await syncGoogleDelta(supabaseClient, connection, tokens);
        } else {
          result = {
            connection_id: connection.id,
            provider: connection.provider,
            events_added: 0,
            events_updated: 0,
            events_deleted: 0,
            error: `Unsupported provider: ${connection.provider}`
          };
        }

        results.push(result);
      } catch (error: any) {
        console.error(`[calendar-delta-sync] Error syncing ${connection.id}:`, error);
        results.push({
          connection_id: connection.id,
          provider: connection.provider,
          events_added: 0,
          events_updated: 0,
          events_deleted: 0,
          error: error.message
        });
      }
    }

    console.log('[calendar-delta-sync] Sync completed', { results });

    return new Response(
      JSON.stringify({ success: true, results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[calendar-delta-sync] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function syncOutlookDelta(
  supabaseClient: any, 
  connection: any, 
  tokens: { access_token: string; refresh_token: string }
): Promise<DeltaSyncResult> {
  const result: DeltaSyncResult = {
    connection_id: connection.id,
    provider: connection.provider,
    events_added: 0,
    events_updated: 0,
    events_deleted: 0
  };

  // Calculate date range: 7 days ago to 30 days ahead
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 7);
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + 30);

  let url: string;
  
  if (connection.sync_token) {
    // Use delta link for incremental sync
    url = connection.sync_token;
    console.log(`[calendar-delta-sync] Using delta token for Outlook connection ${connection.id}`);
  } else {
    // Initial sync - get all events in range
    url = `https://graph.microsoft.com/v1.0/me/calendarView/delta?startDateTime=${startDate.toISOString()}&endDateTime=${endDate.toISOString()}&$select=id,subject,body,start,end,isAllDay,location,showAs`;
    console.log(`[calendar-delta-sync] Initial sync for Outlook connection ${connection.id}`);
  }

  let allEvents: any[] = [];
  let deletedEventIds: string[] = [];
  let nextDeltaLink: string | null = null;

  // Paginate through all results
  while (url) {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${tokens.access_token}`,
        'Prefer': 'odata.maxpagesize=50'
      }
    });

    if (!response.ok) {
      if (response.status === 401) {
        // Token expired, try to refresh
        const refreshed = await refreshOutlookToken(supabaseClient, connection, tokens);
        if (refreshed) {
          // Retry with new token
          return await syncOutlookDelta(supabaseClient, connection, { 
            access_token: refreshed, 
            refresh_token: tokens.refresh_token 
          });
        }
        throw new Error('Token expired and refresh failed');
      }
      
      const errorText = await response.text();
      console.error(`[calendar-delta-sync] Outlook API error:`, errorText);
      throw new Error(`Outlook API error: ${response.status}`);
    }

    const data = await response.json();
    
    // Process events
    for (const event of (data.value || [])) {
      if (event['@removed']) {
        deletedEventIds.push(event.id);
      } else {
        allEvents.push(event);
      }
    }

    // Get next page or delta link
    url = data['@odata.nextLink'] || null;
    if (data['@odata.deltaLink']) {
      nextDeltaLink = data['@odata.deltaLink'];
    }
  }

  // Process deleted events
  if (deletedEventIds.length > 0) {
    const { error: deleteError } = await supabaseClient
      .from('external_calendar_events')
      .delete()
      .eq('connection_id', connection.id)
      .in('external_event_id', deletedEventIds);

    if (deleteError) {
      console.warn('[calendar-delta-sync] Error deleting events:', deleteError);
    } else {
      result.events_deleted = deletedEventIds.length;
    }
  }

  // Upsert events
  if (allEvents.length > 0) {
    const eventsToUpsert = allEvents.map(event => ({
      user_id: connection.user_id,
      connection_id: connection.id,
      external_event_id: event.id,
      title: event.subject || 'Untitled Event',
      description: event.body?.content || null,
      start_time: event.start.dateTime,
      end_time: event.end.dateTime,
      is_all_day: event.isAllDay || false,
      location: event.location?.displayName || null,
      calendar_id: 'primary',
      last_synced_at: new Date().toISOString()
    }));

    const { error: upsertError, data: upsertData } = await supabaseClient
      .from('external_calendar_events')
      .upsert(eventsToUpsert, {
        onConflict: 'connection_id,external_event_id',
        ignoreDuplicates: false
      })
      .select('id');

    if (upsertError) {
      console.error('[calendar-delta-sync] Error upserting events:', upsertError);
    } else {
      result.events_added = allEvents.length;  // Simplification - could distinguish adds vs updates
    }
  }

  // Save the delta link for next sync
  if (nextDeltaLink) {
    await supabaseClient
      .rpc('update_calendar_sync_token', {
        _connection_id: connection.id,
        _sync_token: nextDeltaLink
      });
    console.log(`[calendar-delta-sync] Saved delta link for connection ${connection.id}`);
  }

  return result;
}

async function syncGoogleDelta(
  supabaseClient: any,
  connection: any,
  tokens: { access_token: string; refresh_token: string }
): Promise<DeltaSyncResult> {
  const result: DeltaSyncResult = {
    connection_id: connection.id,
    provider: connection.provider,
    events_added: 0,
    events_updated: 0,
    events_deleted: 0
  };

  // Calculate date range for initial sync
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 7);
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + 30);

  let url: string;
  const params = new URLSearchParams();

  if (connection.sync_token) {
    // Use sync token for incremental sync
    params.set('syncToken', connection.sync_token);
    url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`;
    console.log(`[calendar-delta-sync] Using sync token for Google connection ${connection.id}`);
  } else {
    // Initial sync
    params.set('timeMin', startDate.toISOString());
    params.set('timeMax', endDate.toISOString());
    params.set('singleEvents', 'true');
    params.set('maxResults', '250');
    url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`;
    console.log(`[calendar-delta-sync] Initial sync for Google connection ${connection.id}`);
  }

  let allEvents: any[] = [];
  let deletedEventIds: string[] = [];
  let nextSyncToken: string | null = null;

  while (url) {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${tokens.access_token}`
      }
    });

    if (!response.ok) {
      if (response.status === 401) {
        // Token expired, try to refresh
        const refreshed = await refreshGoogleToken(supabaseClient, connection, tokens);
        if (refreshed) {
          return await syncGoogleDelta(supabaseClient, connection, {
            access_token: refreshed,
            refresh_token: tokens.refresh_token
          });
        }
        throw new Error('Token expired and refresh failed');
      }

      if (response.status === 410) {
        // Sync token expired - need full re-sync
        console.log(`[calendar-delta-sync] Sync token expired for ${connection.id}, clearing for full re-sync`);
        await supabaseClient.rpc('update_calendar_sync_token', {
          _connection_id: connection.id,
          _sync_token: null
        });
        // Retry without sync token
        return await syncGoogleDelta(supabaseClient, { ...connection, sync_token: null }, tokens);
      }

      const errorText = await response.text();
      console.error(`[calendar-delta-sync] Google API error:`, errorText);
      throw new Error(`Google API error: ${response.status}`);
    }

    const data = await response.json();

    // Process events
    for (const event of (data.items || [])) {
      if (event.status === 'cancelled') {
        deletedEventIds.push(event.id);
      } else {
        allEvents.push(event);
      }
    }

    // Get next page or sync token
    if (data.nextPageToken) {
      const nextParams = new URLSearchParams();
      nextParams.set('pageToken', data.nextPageToken);
      if (connection.sync_token) {
        nextParams.set('syncToken', connection.sync_token);
      }
      url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?${nextParams.toString()}`;
    } else {
      url = '';
    }

    if (data.nextSyncToken) {
      nextSyncToken = data.nextSyncToken;
    }
  }

  // Process deleted events
  if (deletedEventIds.length > 0) {
    const { error: deleteError } = await supabaseClient
      .from('external_calendar_events')
      .delete()
      .eq('connection_id', connection.id)
      .in('external_event_id', deletedEventIds);

    if (!deleteError) {
      result.events_deleted = deletedEventIds.length;
    }
  }

  // Upsert events
  if (allEvents.length > 0) {
    const eventsToUpsert = allEvents.map(event => ({
      user_id: connection.user_id,
      connection_id: connection.id,
      external_event_id: event.id,
      title: event.summary || 'Untitled Event',
      description: event.description || null,
      start_time: event.start.dateTime || event.start.date,
      end_time: event.end.dateTime || event.end.date,
      is_all_day: !event.start.dateTime,
      location: event.location || null,
      calendar_id: 'primary',
      last_synced_at: new Date().toISOString()
    }));

    const { error: upsertError } = await supabaseClient
      .from('external_calendar_events')
      .upsert(eventsToUpsert, {
        onConflict: 'connection_id,external_event_id',
        ignoreDuplicates: false
      });

    if (!upsertError) {
      result.events_added = allEvents.length;
    }
  }

  // Save sync token for next sync
  if (nextSyncToken) {
    await supabaseClient.rpc('update_calendar_sync_token', {
      _connection_id: connection.id,
      _sync_token: nextSyncToken
    });
    console.log(`[calendar-delta-sync] Saved sync token for connection ${connection.id}`);
  }

  return result;
}

async function refreshOutlookToken(
  supabaseClient: any,
  connection: any,
  tokens: { access_token: string; refresh_token: string }
): Promise<string | null> {
  if (!tokens.refresh_token) {
    console.error('[calendar-delta-sync] No refresh token available for Outlook');
    return null;
  }

  const clientId = Deno.env.get('MICROSOFT_CLIENT_ID');
  const clientSecret = Deno.env.get('MICROSOFT_CLIENT_SECRET');

  if (!clientId || !clientSecret) {
    console.error('[calendar-delta-sync] Microsoft OAuth credentials not configured');
    return null;
  }

  try {
    const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: tokens.refresh_token,
        grant_type: 'refresh_token'
      })
    });

    if (!response.ok) {
      console.error('[calendar-delta-sync] Outlook token refresh failed:', await response.text());
      return null;
    }

    const newTokens = await response.json();
    
    // Update stored tokens
    const expiresAt = newTokens.expires_in 
      ? new Date(Date.now() + newTokens.expires_in * 1000).toISOString()
      : null;

    await supabaseClient.rpc('update_calendar_connection_tokens_for_user', {
      _connection_id: connection.id,
      _user_id: connection.user_id,
      _access_token: newTokens.access_token,
      _refresh_token: newTokens.refresh_token || tokens.refresh_token,
      _expires_at: expiresAt
    });

    console.log(`[calendar-delta-sync] Refreshed Outlook token for connection ${connection.id}`);
    return newTokens.access_token;
  } catch (error: any) {
    console.error('[calendar-delta-sync] Error refreshing Outlook token:', error);
    return null;
  }
}

async function refreshGoogleToken(
  supabaseClient: any,
  connection: any,
  tokens: { access_token: string; refresh_token: string }
): Promise<string | null> {
  if (!tokens.refresh_token) {
    console.error('[calendar-delta-sync] No refresh token available for Google');
    return null;
  }

  const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');

  if (!clientId || !clientSecret) {
    console.error('[calendar-delta-sync] Google OAuth credentials not configured');
    return null;
  }

  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: tokens.refresh_token,
        grant_type: 'refresh_token'
      })
    });

    if (!response.ok) {
      console.error('[calendar-delta-sync] Google token refresh failed:', await response.text());
      return null;
    }

    const newTokens = await response.json();

    const expiresAt = newTokens.expires_in
      ? new Date(Date.now() + newTokens.expires_in * 1000).toISOString()
      : null;

    await supabaseClient.rpc('update_calendar_connection_tokens_for_user', {
      _connection_id: connection.id,
      _user_id: connection.user_id,
      _access_token: newTokens.access_token,
      _refresh_token: newTokens.refresh_token || tokens.refresh_token,
      _expires_at: expiresAt
    });

    console.log(`[calendar-delta-sync] Refreshed Google token for connection ${connection.id}`);
    return newTokens.access_token;
  } catch (error: any) {
    console.error('[calendar-delta-sync] Error refreshing Google token:', error);
    return null;
  }
}

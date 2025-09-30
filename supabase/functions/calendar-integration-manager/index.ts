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
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, provider, connection_id, start_date, end_date } = await req.json();
    
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
        return await createCalendarEvent(supabaseClient, connection_id, req);
      
      default:
        return new Response(
          JSON.stringify({ error: 'Invalid action' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
  } catch (error) {
    console.error('Calendar integration error:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Calendar integration failed', 
        details: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function syncCalendarEvents(supabaseClient: any, connectionId: string, startDate: string, endDate: string) {
  // Get calendar connection tokens securely
  const { data: tokenData, error: tokenError } = await supabaseClient
    .rpc('get_calendar_connection_tokens', {
      _connection_id: connectionId
    });

  if (tokenError || !tokenData || tokenData.length === 0) {
    console.error('Failed to get connection tokens:', tokenError);
    throw new Error('Calendar connection not found or access denied');
  }
  
  const connection = tokenData[0];

  const events = await fetchExternalCalendarEvents(connection, startDate, endDate);
  
  // Store events in database
  const eventsToInsert = events.map(event => ({
    user_id: connection.user_id,
    connection_id: connectionId,
    external_event_id: event.id,
    title: event.title,
    description: event.description,
    start_time: event.start_time,
    end_time: event.end_time,
    is_all_day: event.is_all_day,
    location: event.location,
    calendar_id: event.calendar_id,
    last_synced_at: new Date().toISOString(),
  }));

  // Use upsert to handle existing events
  const { error: upsertError } = await supabaseClient
    .from('external_calendar_events')
    .upsert(eventsToInsert, { 
      onConflict: 'connection_id,external_event_id',
      ignoreDuplicates: false 
    });

  if (upsertError) {
    throw new Error(`Failed to sync events: ${upsertError.message}`);
  }

  return new Response(
    JSON.stringify({ success: true, synced_events: events.length }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

async function getCalendarAvailability(supabaseClient: any, connectionId: string, startDate: string, endDate: string) {
  // Get external calendar events for the date range
  const { data: events, error } = await supabaseClient
    .from('external_calendar_events')
    .select('start_time, end_time, is_all_day')
    .eq('connection_id', connectionId)
    .gte('start_time', startDate)
    .lte('end_time', endDate)
    .order('start_time');

  if (error) {
    throw new Error(`Failed to get availability: ${error.message}`);
  }

  const busySlots = events.map((event: any) => ({
    start: event.start_time,
    end: event.end_time,
    is_all_day: event.is_all_day
  }));

  return new Response(
    JSON.stringify({ busy_slots: busySlots }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

async function createCalendarEvent(supabaseClient: any, connectionId: string, req: Request) {
  const { task } = await req.json();
  
  // Get calendar connection tokens securely
  const { data: tokenData, error: tokenError } = await supabaseClient
    .rpc('get_calendar_connection_tokens', {
      _connection_id: connectionId
    });

  if (tokenError || !tokenData || tokenData.length === 0) {
    console.error('Failed to get connection tokens:', tokenError);
    throw new Error('Calendar connection not found or access denied');
  }
  
  const connection = tokenData[0];

  // Create event in external calendar
  const externalEventId = await createExternalCalendarEvent(connection, task);
  
  // Update task with external event ID
  const { error: updateError } = await supabaseClient
    .from('tasks')
    .update({ external_event_id: externalEventId })
    .eq('id', task.id);

  if (updateError) {
    console.error('Failed to update task with external event ID:', updateError);
  }

  return new Response(
    JSON.stringify({ success: true, external_event_id: externalEventId }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

async function fetchExternalCalendarEvents(connection: any, startDate: string, endDate: string): Promise<CalendarEvent[]> {
  if (connection.provider === 'google') {
    return await fetchGoogleCalendarEvents(connection, startDate, endDate);
  } else if (connection.provider === 'outlook' || connection.provider === 'office365') {
    return await fetchOutlookCalendarEvents(connection, startDate, endDate);
  }
  return [];
}

async function fetchGoogleCalendarEvents(connection: any, startDate: string, endDate: string): Promise<CalendarEvent[]> {
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${startDate}&timeMax=${endDate}&singleEvents=true&orderBy=startTime`;
  
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${connection.access_token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      // Token expired, try to refresh
      await refreshGoogleToken(connection);
      throw new Error('Token expired, please retry');
    }
    throw new Error(`Google Calendar API error: ${response.statusText}`);
  }

  const data = await response.json();
  
  return data.items?.map((event: any) => ({
    id: event.id,
    title: event.summary || 'Untitled Event',
    description: event.description,
    start_time: event.start.dateTime || event.start.date,
    end_time: event.end.dateTime || event.end.date,
    is_all_day: !event.start.dateTime,
    location: event.location,
    calendar_id: 'primary',
  })) || [];
}

async function fetchOutlookCalendarEvents(connection: any, startDate: string, endDate: string): Promise<CalendarEvent[]> {
  const url = `https://graph.microsoft.com/v1.0/me/calendar/events?$filter=start/dateTime ge '${startDate}' and end/dateTime le '${endDate}'&$orderby=start/dateTime`;
  
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${connection.access_token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Outlook Calendar API error: ${response.statusText}`);
  }

  const data = await response.json();
  
  return data.value?.map((event: any) => ({
    id: event.id,
    title: event.subject || 'Untitled Event',
    description: event.body?.content,
    start_time: event.start.dateTime,
    end_time: event.end.dateTime,
    is_all_day: event.isAllDay,
    location: event.location?.displayName,
    calendar_id: 'primary',
  })) || [];
}

async function createExternalCalendarEvent(connection: any, task: any): Promise<string> {
  if (connection.provider === 'google') {
    return await createGoogleCalendarEvent(connection, task);
  } else if (connection.provider === 'outlook' || connection.provider === 'office365') {
    return await createOutlookCalendarEvent(connection, task);
  }
  throw new Error('Unsupported calendar provider');
}

async function createGoogleCalendarEvent(connection: any, task: any): Promise<string> {
  const event = {
    summary: task.title,
    description: task.description,
    start: {
      dateTime: task.start_time,
      timeZone: 'UTC',
    },
    end: {
      dateTime: task.end_time,
      timeZone: 'UTC',
    },
  };

  const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${connection.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(event),
  });

  if (!response.ok) {
    throw new Error(`Failed to create Google Calendar event: ${response.statusText}`);
  }

  const data = await response.json();
  return data.id;
}

async function createOutlookCalendarEvent(connection: any, task: any): Promise<string> {
  const event = {
    subject: task.title,
    body: {
      contentType: 'text',
      content: task.description || '',
    },
    start: {
      dateTime: task.start_time,
      timeZone: 'UTC',
    },
    end: {
      dateTime: task.end_time,
      timeZone: 'UTC',
    },
  };

  const response = await fetch('https://graph.microsoft.com/v1.0/me/calendar/events', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${connection.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(event),
  });

  if (!response.ok) {
    throw new Error(`Failed to create Outlook Calendar event: ${response.statusText}`);
  }

  const data = await response.json();
  return data.id;
}

async function refreshGoogleToken(connection: any) {
  // Implementation for refreshing Google OAuth tokens
  console.log('Token refresh needed for connection:', connection.id);
  // This would implement the OAuth refresh flow
}
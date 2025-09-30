import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Calendar, Loader2 } from 'lucide-react';

interface CalendarInfo {
  id: string;
  name: string;
  provider: string;
  connectionId: string;
  enabled: boolean;
}

interface CalendarSelectionPanelProps {
  onSelectionChange?: () => void;
}

export function CalendarSelectionPanel({ onSelectionChange }: CalendarSelectionPanelProps) {
  const [calendars, setCalendars] = useState<CalendarInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadCalendars();
  }, []);

  const loadCalendars = async () => {
    try {
      setLoading(true);
      
      // Get all external calendar events to extract unique calendars
      const { data: events, error: eventsError } = await supabase
        .from('external_calendar_events')
        .select('calendar_id, connection_id');

      if (eventsError) throw eventsError;

      // Get connection info
      const { data: connections, error: connectionsError } = await supabase.rpc('get_calendar_connections_safe');
      if (connectionsError) throw connectionsError;

      // Extract unique calendars
      const uniqueCalendars = new Map<string, CalendarInfo>();
      
      if (events && connections) {
        events.forEach((event: any) => {
          if (!uniqueCalendars.has(event.calendar_id)) {
            const connection = connections.find((c: any) => c.id === event.connection_id);
            if (connection) {
              uniqueCalendars.set(event.calendar_id, {
                id: event.calendar_id,
                name: event.calendar_id === 'primary' ? 'Primary Calendar' : event.calendar_id,
                provider: connection.provider,
                connectionId: connection.id,
                enabled: true // Default to enabled
              });
            }
          }
        });
      }

      setCalendars(Array.from(uniqueCalendars.values()));
    } catch (error) {
      console.error('Failed to load calendars:', error);
      toast.error('Failed to load calendar list');
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = (calendarId: string, enabled: boolean) => {
    setCalendars(prev => 
      prev.map(cal => 
        cal.id === calendarId ? { ...cal, enabled } : cal
      )
    );
    
    // Store preferences in localStorage
    const preferences = calendars.reduce((acc, cal) => {
      acc[cal.id] = cal.id === calendarId ? enabled : cal.enabled;
      return acc;
    }, {} as Record<string, boolean>);
    
    localStorage.setItem('calendar_preferences', JSON.stringify(preferences));
    
    onSelectionChange?.();
    toast.success(`Calendar ${enabled ? 'enabled' : 'disabled'}`);
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (calendars.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Calendar Selection
          </CardTitle>
          <CardDescription>
            Connect a calendar to see available calendars here
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-5 w-5" />
          Calendar Selection
        </CardTitle>
        <CardDescription>
          Choose which calendars to display
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {calendars.map(calendar => (
          <div key={calendar.id} className="flex items-center justify-between space-x-4 p-3 rounded-lg border">
            <div className="flex-1">
              <Label htmlFor={`calendar-${calendar.id}`} className="text-sm font-medium cursor-pointer">
                {calendar.name}
              </Label>
              <p className="text-xs text-muted-foreground capitalize">
                {calendar.provider} Calendar
              </p>
            </div>
            <Switch
              id={`calendar-${calendar.id}`}
              checked={calendar.enabled}
              onCheckedChange={(checked) => handleToggle(calendar.id, checked)}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

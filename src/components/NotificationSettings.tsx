import React, { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Calendar, Mail, MessageSquare, Volume2, VolumeX, CheckCircle2, AlertCircle, Loader2, RefreshCw, Bell, BellOff, Smartphone, X, Settings } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { z } from "zod";
import { CalendarOAuthManager } from "./CalendarOAuthManager";
import { useNotifications } from "@/hooks/useNotifications";
import { useBridgeDiagnostics } from "@/hooks/useBridgeDiagnostics";

// Per-calendar toggle sub-component
function CalendarPullToggles({ connection, onUpdate }: { connection: CalendarConnection; onUpdate: () => void }) {
  const [calendars, setCalendars] = useState<{ id: string; name: string }[]>([]);
  const [selectedCalendars, setSelectedCalendars] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadCalendars();
  }, [connection.id]);

  const loadCalendars = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('calendar-integration-manager', {
        body: { action: 'list_calendars', connection_id: connection.id }
      });
      if (fnError) throw fnError;
      const calList = data?.calendars || [];
      setCalendars(calList);

      const stored = localStorage.getItem(`cal-pull-${connection.id}`);
      if (stored) {
        try { setSelectedCalendars(JSON.parse(stored)); } catch { setSelectedCalendars([]); }
      }
    } catch (e: any) {
      console.error('Failed to load calendars:', e);
      setError(e.message || 'Failed to load calendars. Token may be expired.');
    } finally {
      setLoading(false);
    }
  };

  const toggleCalendar = async (calId: string, checked: boolean) => {
    const newSelection = checked ? [...selectedCalendars, calId] : selectedCalendars.filter(id => id !== calId);
    setSelectedCalendars(newSelection);
    localStorage.setItem(`cal-pull-${connection.id}`, JSON.stringify(newSelection));
    onUpdate();
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-2 text-sm text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />Loading calendars...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 p-2 text-sm text-destructive">
        <AlertCircle className="h-3 w-3" />{error}
      </div>
    );
  }

  if (calendars.length === 0) {
    return <div className="p-2 text-sm text-muted-foreground">No calendars found for this account.</div>;
  }

  return (
    <div className="space-y-1 mt-2">
      <p className="text-xs font-medium text-muted-foreground mb-1">Pull events from:</p>
      {calendars.map(cal => (
        <div key={cal.id} className="flex items-center justify-between p-2 rounded-md bg-muted/30 border border-border">
          <span className="text-sm">{cal.name}</span>
          <Switch
            checked={selectedCalendars.includes(cal.id)}
            onCheckedChange={(checked) => toggleCalendar(cal.id, checked)}
          />
        </div>
      ))}
    </div>
  );
}

// Recurring events toggle sub-component
function RecurringEventsToggle({ connectionId, onRefresh }: { connectionId: string; onRefresh: () => void }) {
  const [showRecurring, setShowRecurring] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('calendar_connections')
        .select('metadata')
        .eq('id', connectionId)
        .single();
      const meta = data?.metadata as any;
      setShowRecurring(meta?.show_recurring_events ?? true);
      setLoading(false);
    };
    load();
  }, [connectionId]);

  const toggle = async (checked: boolean) => {
    setShowRecurring(checked);
    // Read existing metadata, merge, update
    const { data: existing } = await supabase
      .from('calendar_connections')
      .select('metadata')
      .eq('id', connectionId)
      .single();
    const meta = (existing?.metadata as any) || {};
    await supabase
      .from('calendar_connections')
      .update({ metadata: { ...meta, show_recurring_events: checked } })
      .eq('id', connectionId);
    onRefresh();
  };

  if (loading) return null;

  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm">Show recurring events</p>
        <p className="text-xs text-muted-foreground">Include repeating calendar events in views</p>
      </div>
      <Switch
        checked={showRecurring}
        onCheckedChange={toggle}
      />
    </div>
  );
}

type NotificationChannel = 'EMAIL' | 'SLACK' | 'PUSH' | 'OUTLOOK_EVENT' | 'GOOGLE_EVENT' | 'ANDROID_CALENDAR';
type DatabaseChannel = NotificationChannel;

interface NotificationPrefs {
  due_reminders_enabled: boolean;
  overdue_reminders_enabled: boolean;
  task_created_enabled: boolean;
  daily_digest_enabled: boolean;
  weekly_digest_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
  timezone: string;
  channels: NotificationChannel[];
  calendar_reminders_enabled: boolean;
  calendar_reminder_minutes: number;
  calendar_reminder_channels: string[];
  morning_review_enabled: boolean;
}

interface CalendarConnection {
  id: string;
  provider: string;
  provider_account_email: string;
  is_active: boolean;
  expires_at?: string;
  purposes?: string[];
}

// Connection card component for each account
function CalendarConnectionCard({ 
  connection, 
  onTogglePush, 
  onTogglePull, 
  onDisconnect, 
  onRefresh 
}: { 
  connection: CalendarConnection;
  onTogglePush: (conn: CalendarConnection, enabled: boolean) => void;
  onTogglePull: (conn: CalendarConnection, enabled: boolean) => void;
  onDisconnect: (conn: CalendarConnection) => void;
  onRefresh: () => void;
}) {
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const now = new Date();
  const isExpired = connection.expires_at && new Date(connection.expires_at) < now;
  const hasPush = connection.purposes?.includes('WRITE') ?? false;
  const hasPull = connection.purposes?.includes('READ') ?? false;

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    try {
      await supabase.functions.invoke('calendar-token-manager', {
        body: { action: 'disconnect', connectionId: connection.id }
      });
      onDisconnect(connection);
    } catch (e) {
      console.error('Disconnect failed:', e);
    } finally {
      setIsDisconnecting(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-3">
      {/* Header: email + status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          {isExpired ? (
            <AlertCircle className="h-4 w-4 text-amber-500 flex-shrink-0" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
          )}
          <span className="text-sm font-medium truncate">{connection.provider_account_email}</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDisconnect}
          disabled={isDisconnecting}
          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
        >
          {isDisconnecting ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
        </Button>
      </div>

      {isExpired && (
        <div className="text-xs text-amber-600 flex items-center gap-1">
          <AlertCircle className="h-3 w-3" />
          Token expired — reconnect or refresh
          <CalendarOAuthManager
            provider={connection.provider === 'google' ? 'google' : 'outlook'}
            connectionId={connection.id}
            label="Reconnect"
            onSuccess={onRefresh}
            onError={() => {}}
          />
        </div>
      )}

      {!isExpired && (
        <>
          {/* Push toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">Push tasks to calendar</p>
              <p className="text-xs text-muted-foreground">Create events when tasks are scheduled</p>
            </div>
            <Switch
              checked={hasPush}
              onCheckedChange={(checked) => onTogglePush(connection, checked)}
            />
          </div>

          {/* Pull toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">Pull events for scheduling</p>
              <p className="text-xs text-muted-foreground">Use calendar events to find free time</p>
            </div>
            <Switch
              checked={hasPull}
              onCheckedChange={(checked) => onTogglePull(connection, checked)}
            />
          </div>

          {/* Show recurring events toggle */}
          <RecurringEventsToggle connectionId={connection.id} onRefresh={onRefresh} />

          {/* Sub-calendar selection when pull is enabled */}
          {hasPull && (
            <CalendarPullToggles connection={connection} onUpdate={onRefresh} />
          )}
        </>
      )}
    </div>
  );
}

const NotificationSettings = () => {
  const [prefs, setPrefs] = useState<NotificationPrefs>({
    due_reminders_enabled: true,
    overdue_reminders_enabled: true,
    task_created_enabled: true,
    daily_digest_enabled: false,
    weekly_digest_enabled: false,
    quiet_hours_start: '22:00',
    quiet_hours_end: '08:00',
    timezone: 'UTC',
    channels: ['EMAIL'],
    calendar_reminders_enabled: true,
    calendar_reminder_minutes: 15,
    calendar_reminder_channels: ['PUSH'],
    morning_review_enabled: true
  });
  const [isSaving, setIsSaving] = useState(false);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [slackWebhookUrl, setSlackWebhookUrl] = useState('');
  const [useCustomSlackWebhook, setUseCustomSlackWebhook] = useState(false);
  const [outlookConnections, setOutlookConnections] = useState<CalendarConnection[]>([]);
  const [googleConnections, setGoogleConnections] = useState<CalendarConnection[]>([]);
  const [isTestingOutlook, setIsTestingOutlook] = useState(false);
  const [isTestingPush, setIsTestingPush] = useState(false);
  const [isTestingGoogleCal, setIsTestingGoogleCal] = useState(false);
  const [alarmSoundName, setAlarmSoundName] = useState<string>('Default');
  const { toast } = useToast();
  const { user, isDemoMode } = useAuth();
  const pushNotifications = useNotifications();
  const bridgeDiag = useBridgeDiagnostics();

  useEffect(() => {
    if (isDemoMode) {
      loadDemoNotificationPrefs();
    } else if (user) {
      loadNotificationPrefs();
      loadCalendarConnections();
    }
  }, [isDemoMode, user]);

  useEffect(() => {
    if (window.AndroidBridge?.getAlarmSoundName) {
      setAlarmSoundName(window.AndroidBridge.getAlarmSoundName());
    }
    const onSoundSelected = (e: Event) => {
      const name = (e as CustomEvent<{ name: string }>).detail?.name;
      if (name) setAlarmSoundName(name);
    };
    window.addEventListener('bridgeAlarmSoundSelected', onSoundSelected);
    return () => window.removeEventListener('bridgeAlarmSoundSelected', onSoundSelected);
  }, []);

  useEffect(() => {
    const handleConnectionUpdate = () => {
      console.log('[NotificationSettings] OAuth completion detected, refreshing connections...');
      loadCalendarConnections();
    };
    window.addEventListener('calendar-connection-updated', handleConnectionUpdate);
    return () => window.removeEventListener('calendar-connection-updated', handleConnectionUpdate);
  }, [user]);

  const loadCalendarConnections = async () => {
    if (!user?.id) return;
    try {
      const { data, error } = await supabase.rpc('get_calendar_connections_safe');
      if (error) { console.error('Error loading calendar connections:', error); return; }

      if (data && Array.isArray(data)) {
        const outlook = data.filter((c: any) => (c.provider === 'office365' || c.provider === 'outlook') && c.is_active)
          .map((c: any) => ({
            id: c.id, provider: c.provider, provider_account_email: c.provider_account_email,
            is_active: c.is_active, expires_at: c.expires_at, purposes: c.purposes || ['READ', 'WRITE'],
          }));
        const google = data.filter((c: any) => c.provider === 'google' && c.is_active)
          .map((c: any) => ({
            id: c.id, provider: c.provider, provider_account_email: c.provider_account_email,
            is_active: c.is_active, expires_at: c.expires_at, purposes: c.purposes || ['READ', 'WRITE'],
          }));
        setOutlookConnections(outlook);
        setGoogleConnections(google);
      }
    } catch (error) {
      console.error('Error loading calendar connections:', error);
    }
  };

  const handleTogglePurpose = async (connection: CalendarConnection, purpose: 'READ' | 'WRITE', enabled: boolean) => {
    const currentPurposes = connection.purposes || [];
    let newPurposes: string[];
    if (enabled) {
      newPurposes = [...new Set([...currentPurposes, purpose])];
    } else {
      newPurposes = currentPurposes.filter(p => p !== purpose);
      if (newPurposes.length === 0) newPurposes = []; // Allow empty — just disconnects purpose
    }

    try {
      await supabase.functions.invoke('calendar-token-manager', {
        body: { action: 'update_purposes', connectionId: connection.id, purposes: newPurposes }
      });
      
      // Update notification channel prefs based on any connection having WRITE
      const outlookHasWrite = connection.provider !== 'google' 
        ? (enabled && purpose === 'WRITE') || outlookConnections.some(c => c.id !== connection.id && c.purposes?.includes('WRITE'))
        : outlookConnections.some(c => c.purposes?.includes('WRITE'));
      const googleHasWrite = connection.provider === 'google'
        ? (enabled && purpose === 'WRITE') || googleConnections.some(c => c.id !== connection.id && c.purposes?.includes('WRITE'))
        : googleConnections.some(c => c.purposes?.includes('WRITE'));

      let newChannels = [...prefs.channels];
      if (outlookHasWrite && !newChannels.includes('OUTLOOK_EVENT')) newChannels.push('OUTLOOK_EVENT');
      if (!outlookHasWrite) newChannels = newChannels.filter(c => c !== 'OUTLOOK_EVENT');
      if (googleHasWrite && !newChannels.includes('GOOGLE_EVENT')) newChannels.push('GOOGLE_EVENT');
      if (!googleHasWrite) newChannels = newChannels.filter(c => c !== 'GOOGLE_EVENT');
      setPrefs({ ...prefs, channels: newChannels });
      
      loadCalendarConnections();
    } catch (e) {
      console.error('Failed to update purposes:', e);
    }
  };

  const handleDisconnect = (connection: CalendarConnection) => {
    loadCalendarConnections();
    toast({ title: "Disconnected", description: `${connection.provider_account_email} has been disconnected.` });
  };

  const loadNotificationPrefs = async () => {
    if (!user?.id) return;
    try {
      const { data: prefsData, error: prefsError } = await supabase
        .from('notification_prefs').select('*').eq('user_id', user.id).maybeSingle();
      if (prefsError && prefsError.code !== 'PGRST116') return;
      if (prefsData) {
        setPrefs({
          due_reminders_enabled: prefsData.due_reminders_enabled ?? true,
          overdue_reminders_enabled: prefsData.overdue_reminders_enabled ?? true,
          task_created_enabled: prefsData.task_created_enabled ?? true,
          daily_digest_enabled: prefsData.daily_digest_enabled ?? false,
          weekly_digest_enabled: prefsData.weekly_digest_enabled ?? false,
          quiet_hours_start: prefsData.quiet_hours_start ?? '22:00',
          quiet_hours_end: prefsData.quiet_hours_end ?? '08:00',
          timezone: prefsData.timezone ?? 'UTC',
          channels: (prefsData.channels ?? ['EMAIL']) as NotificationChannel[],
          calendar_reminders_enabled: (prefsData as any).calendar_reminders_enabled ?? true,
          calendar_reminder_minutes: (prefsData as any).calendar_reminder_minutes ?? 15,
          calendar_reminder_channels: (prefsData as any).calendar_reminder_channels ?? ['PUSH'],
          morning_review_enabled: (prefsData as any).morning_review_enabled ?? true
        });
      }
      const { data: profileData } = await supabase
        .from('profiles').select('phone, email').eq('user_id', user.id).maybeSingle();
      if (profileData?.phone) setPhone(profileData.phone);
      if (profileData?.email) setEmail(profileData.email);
      const useCustom = localStorage.getItem('use-custom-slack-webhook') === 'true';
      setUseCustomSlackWebhook(useCustom);
      if (useCustom) {
        const storedSlackWebhook = localStorage.getItem('slack-webhook-url');
        if (storedSlackWebhook) setSlackWebhookUrl(storedSlackWebhook);
      }
    } catch (error) { console.error('Error loading notification preferences:', error); }
  };

  const loadDemoNotificationPrefs = () => {
    const stored = localStorage.getItem('demo-notification-prefs');
    const storedPhone = localStorage.getItem('demo-phone');
    const storedEmail = localStorage.getItem('demo-email');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setPrefs({
          due_reminders_enabled: parsed.due_reminders_enabled ?? true,
          overdue_reminders_enabled: parsed.overdue_reminders_enabled ?? true,
          task_created_enabled: parsed.task_created_enabled ?? true,
          daily_digest_enabled: parsed.daily_digest_enabled ?? false,
          weekly_digest_enabled: parsed.weekly_digest_enabled ?? false,
          quiet_hours_start: parsed.quiet_hours_start ?? '22:00',
          quiet_hours_end: parsed.quiet_hours_end ?? '08:00',
          timezone: parsed.timezone ?? 'UTC',
          channels: parsed.channels ?? ['EMAIL'],
          calendar_reminders_enabled: parsed.calendar_reminders_enabled ?? true,
          calendar_reminder_minutes: parsed.calendar_reminder_minutes ?? 15,
          calendar_reminder_channels: parsed.calendar_reminder_channels ?? ['PUSH'],
          morning_review_enabled: parsed.morning_review_enabled ?? true
        });
      } catch {}
    }
    if (storedPhone) setPhone(storedPhone);
    if (storedEmail) setEmail(storedEmail);
    const useCustom = localStorage.getItem('use-custom-slack-webhook') === 'true';
    setUseCustomSlackWebhook(useCustom);
    if (useCustom) {
      const w = localStorage.getItem('slack-webhook-url');
      if (w) setSlackWebhookUrl(w);
    }
  };

  const saveNotificationPrefs = async () => {
    setIsSaving(true);
    try {
      if (prefs.channels.includes('EMAIL') && (!email || !z.string().email().safeParse(email).success)) {
        toast({ title: "Validation Error", description: "Please enter a valid email address for email notifications.", variant: "destructive" });
        return;
      }
      localStorage.setItem('use-custom-slack-webhook', useCustomSlackWebhook.toString());
      if (useCustomSlackWebhook && slackWebhookUrl) localStorage.setItem('slack-webhook-url', slackWebhookUrl);

      if (isDemoMode || !user?.id) {
        localStorage.setItem('demo-notification-prefs', JSON.stringify(prefs));
        localStorage.setItem('demo-phone', phone);
        localStorage.setItem('demo-email', email);
        toast({ title: "Settings saved", description: "Your notification preferences have been saved locally for this demo." });
        return;
      }

      const normalizedPrefs = {
        ...prefs,
        quiet_hours_start: prefs.quiet_hours_start.length === 5 ? prefs.quiet_hours_start + ':00' : prefs.quiet_hours_start,
        quiet_hours_end: prefs.quiet_hours_end.length === 5 ? prefs.quiet_hours_end + ':00' : prefs.quiet_hours_end
      };
      const dbPrefs = { ...normalizedPrefs, channels: normalizedPrefs.channels as DatabaseChannel[] };

      const { error: updatePrefsError } = await supabase.from('notification_prefs').update(dbPrefs as any).eq('user_id', user.id);
      if (updatePrefsError && updatePrefsError.code === 'PGRST116') {
        const { error: insertPrefsError } = await supabase.from('notification_prefs').insert({ user_id: user.id, ...dbPrefs } as any);
        if (insertPrefsError) throw new Error(`Failed to save notification preferences: ${insertPrefsError.message}`);
      } else if (updatePrefsError) {
        throw new Error(`Failed to update notification preferences: ${updatePrefsError.message}`);
      }

      const { error: updateProfileError } = await supabase.from('profiles').update({ phone, email }).eq('user_id', user.id);
      if (updateProfileError && updateProfileError.code === 'PGRST116') {
        const { error: insertProfileError } = await supabase.from('profiles').insert({ user_id: user.id, phone, email });
        if (insertProfileError) throw new Error(`Failed to save profile: ${insertProfileError.message}`);
      } else if (updateProfileError) {
        throw new Error(`Failed to update profile: ${updateProfileError.message}`);
      }

      toast({ title: "Settings saved", description: "Your notification preferences have been updated." });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      toast({ title: "Error saving settings", description: errorMessage, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleChannel = (channel: NotificationChannel) => {
    const newChannels = prefs.channels.includes(channel) ? prefs.channels.filter(c => c !== channel) : [...prefs.channels, channel];
    setPrefs({ ...prefs, channels: newChannels });
  };

  const sendTestEmail = async () => {
    if (!email || !z.string().email().safeParse(email).success) {
      toast({ title: "Invalid Email", description: "Please enter a valid email address.", variant: "destructive" }); return;
    }
    try {
      const { error } = await supabase.functions.invoke('send-unified-notification', {
        body: { userId: user?.id || 'demo-user', title: '🧪 Test Email', body: 'Test email notification.', channels: ['EMAIL'], data: { type: 'test_notification' }, userProfile: { email, phone } }
      });
      if (error) throw error;
      toast({ title: "Test Email Sent", description: `Email sent to ${email}.` });
    } catch (error: any) {
      toast({ title: "Email Test Failed", description: error.message || "Could not send test email.", variant: "destructive" });
    }
  };

  const sendTestOutlookEvent = async () => {
    const conn = outlookConnections.find(c => c.purposes?.includes('WRITE'));
    if (!conn) { toast({ title: "No Outlook Push Account", description: "Enable push on an Outlook account first.", variant: "destructive" }); return; }
    setIsTestingOutlook(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-unified-notification', {
        body: { userId: user?.id, title: 'Test Outlook Reminder', body: 'Test calendar event', channels: ['OUTLOOK_EVENT'], userProfile: { email },
          data: { type: 'test_notification', taskTitle: 'Test Calendar Event', taskDescription: 'Test event with native reminder.', startTime: new Date(Date.now() + 5 * 60 * 1000).toISOString(), estimateMinutes: 30 } }
      });
      if (error) throw error;
      toast({ title: "✓ Outlook Event Created", description: `Calendar event created in ${conn.provider_account_email}.` });
    } catch (error: any) {
      toast({ title: "Test Failed", description: error.message || "Failed to create Outlook event", variant: "destructive" });
    } finally { setIsTestingOutlook(false); }
  };

  const sendTestGoogleEvent = async () => {
    try {
      const { error } = await supabase.functions.invoke('send-unified-notification', {
        body: { userId: user?.id, channels: ['GOOGLE_EVENT'], userProfile: { email },
          data: { type: 'test_notification', taskTitle: 'Test Calendar Event', taskDescription: 'Test event.', startTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(), estimateMinutes: 60 } }
      });
      if (error) throw error;
      toast({ title: "Test Google Event Sent", description: "AI-generated calendar event sent." });
    } catch (error: any) {
      toast({ title: "Test Failed", description: error.message || "Failed to send test Google event", variant: "destructive" });
    }
  };

  const sendTestSamsungCalendar = async () => {
    setIsTestingGoogleCal(true);
    try {
      const { error } = await supabase.functions.invoke('send-unified-notification', {
        body: {
          userId: user?.id,
          channels: ['GOOGLE_EVENT'],
          userProfile: { email },
          data: {
            type: 'test_notification',
            taskTitle: 'Test Android Calendar Event',
            taskDescription: 'Test event from Android Calendar settings.',
            startTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            estimateMinutes: 60,
          },
        }
      });
      if (error) throw error;
      toast({ title: 'Android Calendar Test Sent', description: 'Event created in your Google Calendar (syncs to device).' });
    } catch (err: any) {
      toast({ title: 'Android Calendar Test Failed', description: err.message, variant: 'destructive' });
    } finally {
      setIsTestingGoogleCal(false);
    }
  };

  const sendTestSlack = async () => {
    try {
      if (useCustomSlackWebhook && !slackWebhookUrl) { toast({ title: "Custom webhook URL is empty", variant: "destructive" }); return; }
      await supabase.functions.invoke('send-unified-notification', {
        body: { userId: user?.id || 'demo-user', title: '🧪 Test Slack', body: 'Test Slack notification.', channels: ['SLACK'], data: { type: 'test_notification' }, slackWebhook: useCustomSlackWebhook ? slackWebhookUrl : undefined, userProfile: { email, phone } }
      });
      toast({ title: "Test Slack notification sent" });
    } catch { toast({ title: "Error", description: "Failed to send test Slack notification.", variant: "destructive" }); }
  };

  const sendTestAlarm = () => {
    if (!window.AndroidBridge) return;
    window.AndroidBridge.cancelAlarm?.('test-alarm');
    window.AndroidBridge.notify(JSON.stringify({
      channel: 'calendar_events',
      title: '🔔 Event Starting Now',
      body: 'Test: system alarm with Snooze and Dismiss',
      deepLink: '/calendar',
      tag: 'test-alarm',
      soundSource: 'system',
    }));
    toast({ title: 'System alarm fired', description: 'Check your notification shade' });
  };

  const openAlarmSoundPicker = () => {
    if (!window.AndroidBridge?.openAlarmSoundPicker) return;
    window.AndroidBridge.openAlarmSoundPicker();
  };

  const sendTestCustomAlarm = () => {
    if (!window.AndroidBridge) return;
    window.AndroidBridge.cancelAlarm?.('test-alarm-custom');
    window.AndroidBridge.notify(JSON.stringify({
      channel: 'calendar_events',
      title: '🔔 Event Starting Now',
      body: 'Test: custom sound alarm with Snooze and Dismiss',
      deepLink: '/calendar',
      tag: 'test-alarm-custom',
      soundSource: 'custom',
    }));
    toast({ title: 'Custom alarm fired', description: 'Check your notification shade' });
  };

  const sendTestMessage = () => {
    if (!window.AndroidBridge) return;
    const result = window.AndroidBridge.notify(JSON.stringify({
      channel: 'messages',
      title: '💬 Journey Voice',
      body: 'Test: new message notification — tap to open chat',
      deepLink: '/',
      tag: 'test-message'
    }));
    let parsed: any = null;
    try { parsed = JSON.parse(result); } catch {}
    if (parsed) {
      toast({ title: parsed.success ? 'Message notification sent' : 'Notification failed',
        description: parsed.success ? `Channel: ${parsed.channelId}` : (parsed.error || JSON.stringify(parsed)),
        variant: parsed.success ? 'default' : 'destructive' });
    } else {
      toast({ title: 'Message notification sent', description: 'Check your notification shade' });
    }
  };

  const sendTestPush = async () => {
    if (!pushNotifications.subscription) { toast({ title: "Not Subscribed", variant: "destructive" }); return; }
    // On Android bridge: fire a local native notification immediately via the bridge.
    // This tests the native notification channel without requiring FCM round-trip.
    if (pushNotifications.isAndroidBridge) {
      await pushNotifications.sendTestNotification();
      return;
    }
    setIsTestingPush(true);
    try {
      const { error } = await supabase.functions.invoke('send-push-notification', {
        body: { userId: user?.id, title: '🧪 Test Push', body: 'Push notifications are working!', data: { type: 'test_notification' } }
      });
      if (error) throw error;
      toast({ title: "Test Push Sent" });
    } catch (error: any) {
      toast({ title: "Test Failed", description: error.message, variant: "destructive" });
    } finally { setIsTestingPush(false); }
  };

  const handleEnablePush = async () => {
    const permissionGranted = await pushNotifications.requestPermission();
    if (permissionGranted) {
      const subscribed = await pushNotifications.subscribe();
      if (subscribed && !prefs.channels.includes('PUSH')) setPrefs({ ...prefs, channels: [...prefs.channels, 'PUSH'] });
    }
  };

  const handleDisablePush = async () => {
    const unsubscribed = await pushNotifications.unsubscribe();
    if (unsubscribed) setPrefs({ ...prefs, channels: prefs.channels.filter(c => c !== 'PUSH') });
  };

  const testQuietHours = async () => {
    const now = new Date();
    const [startHour, startMin] = prefs.quiet_hours_start.split(':').map(Number);
    const [endHour, endMin] = prefs.quiet_hours_end.split(':').map(Number);
    const quietStart = new Date(); quietStart.setHours(startHour, startMin, 0, 0);
    const quietEnd = new Date(); quietEnd.setHours(endHour, endMin, 0, 0);
    if (quietEnd < quietStart) { if (now.getHours() < 12) quietStart.setDate(quietStart.getDate() - 1); else quietEnd.setDate(quietEnd.getDate() + 1); }
    const isQuietTime = now >= quietStart && now <= quietEnd;
    toast({ title: isQuietTime ? "🤫 Quiet hours active" : "🔔 Outside quiet hours", description: isQuietTime ? "Notifications would be suppressed." : "Notifications would be delivered normally." });
  };

  const createTestTaskWithNotifications = async () => {
    try {
      const { error } = await supabase.functions.invoke('create-test-task', { body: { userId: user?.id || 'demo-user' } });
      if (error) throw error;
      toast({ title: "Test task created", description: "A test task has been created with due reminders." });
    } catch { toast({ title: "Error", description: "Failed to create test task.", variant: "destructive" }); }
  };

  // Render calendar provider section
  const renderCalendarSection = (
    providerLabel: string,
    providerKey: 'google' | 'outlook',
    connections: CalendarConnection[],
    iconColor: string
  ) => (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Calendar className={`h-5 w-5 ${iconColor}`} />
        <div>
          <h4 className="font-medium">{providerLabel} Calendar</h4>
          <p className="text-sm text-muted-foreground">
            {connections.length === 0 ? 'Not connected' : `${connections.length} account${connections.length > 1 ? 's' : ''} connected`}
          </p>
        </div>
      </div>

      {/* Per-connection cards */}
      <div className="space-y-2 pl-8">
        {connections.map(conn => (
          <CalendarConnectionCard
            key={conn.id}
            connection={conn}
            onTogglePush={(c, enabled) => handleTogglePurpose(c, 'WRITE', enabled)}
            onTogglePull={(c, enabled) => handleTogglePurpose(c, 'READ', enabled)}
            onDisconnect={handleDisconnect}
            onRefresh={loadCalendarConnections}
          />
        ))}

        {/* Add Another Account button */}
        <CalendarOAuthManager
          provider={providerKey}
          label={connections.length > 0 ? `Add Another ${providerLabel} Account` : `Connect ${providerLabel} Calendar`}
          onSuccess={loadCalendarConnections}
          onError={(err) => toast({ title: "Connection Failed", description: err, variant: "destructive" })}
        />
      </div>
    </div>
  );

  return (
    <div className="space-y-6">

      {/* Notification Types */}
      <Card>
        <CardHeader>
          <CardTitle>Notification Types</CardTitle>
          <CardDescription>Choose which events trigger notifications</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div><Label className="text-sm font-medium">Due Date Reminders</Label><p className="text-xs text-muted-foreground">Get notified when tasks are approaching their due date</p></div>
            <Switch checked={prefs.due_reminders_enabled} onCheckedChange={(checked) => setPrefs({ ...prefs, due_reminders_enabled: checked })} />
          </div>
          <div className="flex items-center justify-between">
            <div><Label className="text-sm font-medium">Overdue Alerts</Label><p className="text-xs text-muted-foreground">Get notified when tasks become overdue</p></div>
            <Switch checked={prefs.overdue_reminders_enabled} onCheckedChange={(checked) => setPrefs({ ...prefs, overdue_reminders_enabled: checked })} />
          </div>
          <div className="flex items-center justify-between">
            <div><Label className="text-sm font-medium">Task Created</Label><p className="text-xs text-muted-foreground">Get notified when new tasks are added</p></div>
            <Switch checked={prefs.task_created_enabled} onCheckedChange={(checked) => setPrefs({ ...prefs, task_created_enabled: checked })} />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div><Label className="text-sm font-medium">Daily Digest</Label><p className="text-xs text-muted-foreground">Daily summary of your tasks and progress</p></div>
            <Switch checked={prefs.daily_digest_enabled} onCheckedChange={(checked) => setPrefs({ ...prefs, daily_digest_enabled: checked })} />
          </div>
          <div className="flex items-center justify-between">
            <div><Label className="text-sm font-medium">Weekly Digest</Label><p className="text-xs text-muted-foreground">Weekly overview of completed tasks and upcoming deadlines</p></div>
            <Switch checked={prefs.weekly_digest_enabled} onCheckedChange={(checked) => setPrefs({ ...prefs, weekly_digest_enabled: checked })} />
          </div>
          <div className="flex items-center justify-between">
            <div><Label className="text-sm font-medium">Daily Focus Briefing</Label><p className="text-xs text-muted-foreground">Automatically open today's briefing panel on first Focus tab visit</p></div>
            <Switch checked={prefs.morning_review_enabled} onCheckedChange={(checked) => setPrefs({ ...prefs, morning_review_enabled: checked })} />
          </div>
        </CardContent>
      </Card>

      {/* Calendar Event Reminders */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Calendar Event Reminders
          </CardTitle>
          <CardDescription>Get notified before external calendar events start</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Enable Reminders</Label>
              <p className="text-xs text-muted-foreground">Send alerts before synced calendar events</p>
            </div>
            <Switch
              checked={prefs.calendar_reminders_enabled}
              onCheckedChange={(checked) => setPrefs({ ...prefs, calendar_reminders_enabled: checked })}
            />
          </div>

          {prefs.calendar_reminders_enabled && (
            <>
              <div className="space-y-2">
                <Label className="text-sm font-medium">Lead Time</Label>
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={prefs.calendar_reminder_minutes}
                  onChange={(e) => setPrefs({ ...prefs, calendar_reminder_minutes: parseInt(e.target.value) })}
                >
                  <option value={5}>5 minutes before</option>
                  <option value={10}>10 minutes before</option>
                  <option value={15}>15 minutes before</option>
                  <option value={30}>30 minutes before</option>
                  <option value={60}>1 hour before</option>
                </select>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">Reminder Channels</Label>
                <p className="text-xs text-muted-foreground">Choose how you want to be reminded</p>
                <div className="space-y-2">
                  {[
                    { key: 'PUSH', label: 'Push Notification', icon: <Smartphone className="h-4 w-4" /> },
                    { key: 'SLACK', label: 'Slack', icon: <MessageSquare className="h-4 w-4" /> },
                    { key: 'EMAIL', label: 'Email', icon: <Mail className="h-4 w-4" /> },
                  ].map(({ key, label, icon }) => (
                    <div key={key} className="flex items-center space-x-2">
                      <Checkbox
                        id={`cal-reminder-${key}`}
                        checked={prefs.calendar_reminder_channels.includes(key)}
                        onCheckedChange={(checked) => {
                          const newChannels = checked
                            ? [...prefs.calendar_reminder_channels, key]
                            : prefs.calendar_reminder_channels.filter(c => c !== key);
                          setPrefs({ ...prefs, calendar_reminder_channels: newChannels });
                        }}
                      />
                      <Label htmlFor={`cal-reminder-${key}`} className="flex items-center gap-2 text-sm cursor-pointer">
                        {icon} {label}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>


      <Card>
        <CardHeader>
          <CardTitle>Quiet Hours</CardTitle>
          <CardDescription>Set hours when notifications should be muted</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="quiet-start">Start Time</Label>
              <Input id="quiet-start" type="time" value={prefs.quiet_hours_start} onChange={(e) => setPrefs({ ...prefs, quiet_hours_start: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quiet-end">End Time</Label>
              <Input id="quiet-end" type="time" value={prefs.quiet_hours_end} onChange={(e) => setPrefs({ ...prefs, quiet_hours_end: e.target.value })} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="timezone">Timezone</Label>
            <Input id="timezone" placeholder="UTC" value={prefs.timezone} onChange={(e) => setPrefs({ ...prefs, timezone: e.target.value })} />
          </div>
          <Button onClick={testQuietHours} variant="outline" className="w-full">
            <Volume2 className="h-4 w-4 mr-2" /> Test Quiet Hours
          </Button>
        </CardContent>
      </Card>

      {/* Delivery Channels */}
      <Card>
        <CardHeader>
          <CardTitle>Delivery Channels</CardTitle>
          <CardDescription>Choose how you want to receive notifications</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Email */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Mail className="h-5 w-5 text-primary" />
                <div><h4 className="font-medium">Email</h4><p className="text-sm text-muted-foreground">Send notifications via email</p></div>
              </div>
              <Switch checked={prefs.channels.includes('EMAIL')} onCheckedChange={() => handleToggleChannel('EMAIL')} />
            </div>
            {prefs.channels.includes('EMAIL') && (
              <div className="space-y-2 mt-4">
                <Label htmlFor="email">Email Address</Label>
                <Input id="email" type="email" placeholder="your@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
            )}
          </div>

          {/* Push Notifications */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Smartphone className="h-5 w-5 text-primary" />
                <div>
                  <h4 className="font-medium">Push Notifications</h4>
                  <p className="text-sm text-muted-foreground">Browser/device notifications</p>
                  {!pushNotifications.isSupported ? (
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1"><AlertCircle className="h-3 w-3" />Not supported</p>
                  ) : pushNotifications.permission === 'denied' ? (
                    <p className="text-xs text-destructive flex items-center gap-1 mt-1"><BellOff className="h-3 w-3" />Blocked</p>
                  ) : pushNotifications.subscription ? (
                    <p className="text-xs text-green-600 flex items-center gap-1 mt-1"><CheckCircle2 className="h-3 w-3" />Enabled</p>
                  ) : (
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1"><Bell className="h-3 w-3" />Not enabled</p>
                  )}
                </div>
              </div>
              <Switch
                checked={prefs.channels.includes('PUSH') && !!pushNotifications.subscription}
                onCheckedChange={(checked) => checked ? handleEnablePush() : handleDisablePush()}
                disabled={!pushNotifications.isSupported || pushNotifications.permission === 'denied' || pushNotifications.isLoading}
              />
            </div>
            {pushNotifications.isSupported && pushNotifications.permission !== 'denied' && (
              <div className="space-y-2 mt-4 pl-8">
                {pushNotifications.subscription ? (
                  <>
                    <div className="flex items-center gap-2 p-3 rounded-md bg-muted/50 border border-border">
                      <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                      <div className="text-sm"><span className="font-medium">Push notifications active</span></div>
                    </div>
                    <div className="flex gap-2">
                      <Button onClick={sendTestPush} variant="outline" size="sm" disabled={isTestingPush} className="flex-1">
                        {isTestingPush ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Bell className="h-4 w-4 mr-2" />}
                        Send Test
                      </Button>
                      <Button onClick={pushNotifications.forceResubscribe} variant="outline" size="sm" disabled={pushNotifications.isLoading} className="flex-1">
                        {pushNotifications.isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                        Refresh
                      </Button>
                    </div>
                  </>
                ) : (
                  <Button onClick={handleEnablePush} variant="outline" size="sm" disabled={pushNotifications.isLoading} className="w-full">
                    {pushNotifications.isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Bell className="h-4 w-4 mr-2" />}
                    Enable Push Notifications
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* Outlook Calendar — multi-account */}
          {renderCalendarSection('Outlook', 'outlook', outlookConnections, 'text-blue-500')}

          {/* Google Calendar — multi-account */}
          {renderCalendarSection('Google', 'google', googleConnections, 'text-primary')}

          {/* Android Calendar — direct device write, no Google dependency */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Smartphone className="h-5 w-5 text-green-600" />
                <div>
                  <h4 className="font-medium">Android Calendar</h4>
                  <p className="text-sm text-muted-foreground">Writes tasks directly to your device calendar — no Google account needed. Requires the Journey Voice Android app.</p>
                </div>
              </div>
              <Switch
                checked={prefs.channels.includes('ANDROID_CALENDAR')}
                onCheckedChange={() => handleToggleChannel('ANDROID_CALENDAR')}
              />
            </div>
          </div>

          {/* Slack */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <MessageSquare className="h-5 w-5 text-primary" />
                <div><h4 className="font-medium">Slack</h4><p className="text-sm text-muted-foreground">Send notifications to a Slack channel</p></div>
              </div>
              <Switch checked={prefs.channels.includes('SLACK')} onCheckedChange={() => handleToggleChannel('SLACK')} />
            </div>
            {prefs.channels.includes('SLACK') && (
              <div className="space-y-4 mt-4">
                <div className="flex items-center gap-2 p-3 rounded-md bg-muted/50 border border-border">
                  <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                  <div className="text-sm"><span className="font-medium">Using server-configured webhook</span></div>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox id="use-custom-slack" checked={useCustomSlackWebhook} onCheckedChange={(checked) => setUseCustomSlackWebhook(checked === true)} />
                  <Label htmlFor="use-custom-slack" className="text-sm cursor-pointer">Use a different webhook URL</Label>
                </div>
                {useCustomSlackWebhook && (
                  <div className="space-y-2 pl-6">
                    <Label htmlFor="slack-webhook-url">Custom Webhook URL</Label>
                    <Input id="slack-webhook-url" type="url" placeholder="https://hooks.slack.com/services/..." value={slackWebhookUrl} onChange={(e) => setSlackWebhookUrl(e.target.value)} />
                  </div>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Test Notifications */}
      <Card>
        <CardHeader>
          <CardTitle>Test Notifications</CardTitle>
          <CardDescription>Send test notifications to verify your settings</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Button onClick={sendTestEmail} variant="outline" className="w-full" disabled={!prefs.channels.includes('EMAIL') || !email}>
              <Mail className="h-4 w-4 mr-2" />Test Email
            </Button>
            <Button onClick={sendTestOutlookEvent} variant="outline" className="w-full" disabled={!outlookConnections.some(c => c.purposes?.includes('WRITE')) || isTestingOutlook}>
              {isTestingOutlook ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Calendar className="h-4 w-4 mr-2" />}
              Test Outlook Event
            </Button>
            <Button onClick={sendTestGoogleEvent} variant="outline" className="w-full" disabled={!googleConnections.some(c => c.purposes?.includes('WRITE'))}>
              <Calendar className="h-4 w-4 mr-2" />Test Google Event
            </Button>
            <Button onClick={sendTestSamsungCalendar} variant="outline" className="w-full" disabled={isTestingGoogleCal}>
              {isTestingGoogleCal ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Smartphone className="h-4 w-4 mr-2" />}
              Test Android Calendar
            </Button>
            <Button onClick={sendTestSlack} variant="outline" className="w-full" disabled={!prefs.channels.includes('SLACK')}>
              <MessageSquare className="h-4 w-4 mr-2" />Test Slack
            </Button>
            <Button onClick={sendTestPush} variant="outline" className="w-full" disabled={!pushNotifications.subscription || isTestingPush}>
              {isTestingPush ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Bell className="h-4 w-4 mr-2" />}
              Test Push
            </Button>
            <Button onClick={() => toast({ title: "🧪 In-App Test", description: "Sample in-app notification." })} variant="outline" className="w-full">
              <Volume2 className="h-4 w-4 mr-2" />Test In-App Toast
            </Button>
            <Button onClick={createTestTaskWithNotifications} variant="outline" className="w-full col-span-2">
              <Calendar className="h-4 w-4 mr-2" />Create Test Task
            </Button>
            {pushNotifications.isAndroidBridge && (
              <div className="col-span-2 flex items-center justify-between rounded-md border px-3 py-2">
                <div className="flex items-center gap-2 text-sm">
                  <Bell className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Alarm sound:</span>
                  <span className="font-medium">{alarmSoundName}</span>
                </div>
                <Button variant="ghost" size="sm" onClick={openAlarmSoundPicker} className="h-7 w-7 p-0">
                  <Settings className="h-4 w-4" />
                </Button>
              </div>
            )}
            {pushNotifications.isAndroidBridge && (
              <Button onClick={sendTestAlarm} variant="outline" className="w-full">
                <Bell className="h-4 w-4 mr-2" />Test System Alarm
              </Button>
            )}
            {pushNotifications.isAndroidBridge && (
              <Button onClick={sendTestCustomAlarm} variant="outline" className="w-full">
                <Bell className="h-4 w-4 mr-2" />Test Custom Sound
              </Button>
            )}
            {pushNotifications.isAndroidBridge && (
              <Button onClick={sendTestMessage} variant="outline" className="w-full">
                <Bell className="h-4 w-4 mr-2" />Test Message
              </Button>
            )}
            {pushNotifications.isAndroidBridge && (
              <Button onClick={() => (window as any).AndroidBridge?.testAlarmConfirmScreen?.()} variant="outline" className="w-full">
                <Bell className="h-4 w-4 mr-2" />Test Alarm Screen
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Bridge Diagnostics — shows ground-truth state logged on load */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5" />
            Bridge Diagnostics
          </CardTitle>
          <CardDescription>Logged on this page load — confirms what the app actually detected</CardDescription>
        </CardHeader>
        <CardContent>
          {!bridgeDiag ? (
            <p className="text-sm text-muted-foreground">Collecting diagnostics...</p>
          ) : (
            <div className="space-y-2 text-sm font-mono">
              <Row label="isAndroidBridge" value={String(bridgeDiag.isAndroidBridge)} ok={bridgeDiag.isAndroidBridge} />
              <Row label="window.AndroidBridge" value={String(bridgeDiag.windowAndroidBridgePresent)} ok={bridgeDiag.windowAndroidBridgePresent} />
              <Row label="BridgeApp/ in UA" value={String(bridgeDiag.userAgentHasBridgeApp)} ok={bridgeDiag.userAgentHasBridgeApp} />
              <Row label="__BRIDGE_PLATFORM__" value={bridgeDiag.bridgePlatformFlag ?? 'undefined'} ok={bridgeDiag.bridgePlatformFlag === 'android'} />
              <Row label="APK version" value={bridgeDiag.apkVersion ?? 'n/a'} ok={!!bridgeDiag.apkVersion} />
              <Row label="FCM token present" value={String(bridgeDiag.fcmTokenPresent)} ok={bridgeDiag.fcmTokenPresent} />
              {bridgeDiag.fcmTokenPrefix && (
                <Row label="FCM token prefix" value={bridgeDiag.fcmTokenPrefix + '...'} ok={true} />
              )}
              <Row label="Push sub endpoint" value={bridgeDiag.pushSubEndpoint ? bridgeDiag.pushSubEndpoint.slice(0, 40) + '...' : 'none'} ok={!!bridgeDiag.pushSubEndpoint} />
              <div className="pt-2 border-t text-xs text-muted-foreground break-all">
                <span className="font-semibold">JS bundle: </span>{bridgeDiag.jsBundle.split('/').pop() ?? bridgeDiag.jsBundle}
              </div>
              <div className="text-xs text-muted-foreground break-all">
                <span className="font-semibold">UA: </span>{bridgeDiag.userAgent}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="flex justify-end">
        <Button onClick={saveNotificationPrefs} disabled={isSaving} className="min-w-[120px]">
          {isSaving ? "Saving..." : "Save Settings"}
        </Button>
      </div>
    </div>
  );
};

function Row({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className={ok ? 'text-green-600 font-semibold' : 'text-red-500 font-semibold'}>{value}</span>
    </div>
  );
}

export default NotificationSettings;

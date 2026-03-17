import React, { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Calendar, Mail, MessageSquare, Volume2, VolumeX, CheckCircle2, AlertCircle, Loader2, RefreshCw, Bell, BellOff, Smartphone } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { z } from "zod";
import { CalendarOAuthManager } from "./CalendarOAuthManager";
import { useNotifications } from "@/hooks/useNotifications";

type NotificationChannel = 'EMAIL' | 'SLACK' | 'PUSH' | 'OUTLOOK_EVENT' | 'GOOGLE_EVENT';
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
}

interface CalendarConnection {
  id: string;
  provider: string;
  provider_account_email: string;
  is_active: boolean;
  expires_at?: string;
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
    channels: ['EMAIL']
  });
  const [isSaving, setIsSaving] = useState(false);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [slackWebhookUrl, setSlackWebhookUrl] = useState('');
  const [useCustomSlackWebhook, setUseCustomSlackWebhook] = useState(false);
  const [outlookConnection, setOutlookConnection] = useState<CalendarConnection | null>(null);
  const [googleConnection, setGoogleConnection] = useState<CalendarConnection | null>(null);
  const [outlookExpired, setOutlookExpired] = useState(false);
  const [googleExpired, setGoogleExpired] = useState(false);
  const [isTestingOutlook, setIsTestingOutlook] = useState(false);
  const [isTestingPush, setIsTestingPush] = useState(false);
  const { toast } = useToast();
  const { user, isDemoMode } = useAuth();
  const pushNotifications = useNotifications();

  useEffect(() => {
    if (isDemoMode) {
      loadDemoNotificationPrefs();
    } else if (user) {
      loadNotificationPrefs();
      loadCalendarConnections();
    }
  }, [isDemoMode, user]);

  // Listen for OAuth completion events to auto-refresh connection status
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
      // Use the safe RPC that doesn't expose tokens
      const { data, error } = await supabase.rpc('get_calendar_connections_safe');
      
      if (error) {
        console.error('Error loading calendar connections:', error);
        return;
      }

      if (data && Array.isArray(data)) {
        const now = new Date();
        
        // Helper to select best connection: prefer non-expired, then most recent
        const selectBestConnection = (connections: any[]) => {
          if (connections.length === 0) return null;
          
          // First try to find a non-expired connection
          const validConnection = connections.find(c => 
            !c.expires_at || new Date(c.expires_at) > now
          );
          if (validConnection) return validConnection;
          
          // If all expired, return the most recently updated one
          return connections.sort((a, b) => 
            new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
          )[0];
        };
        
        // Filter Outlook connections (both provider names)
        const outlookConnections = data.filter((c: any) => 
          (c.provider === 'office365' || c.provider === 'outlook') && c.is_active
        );
        const outlook = selectBestConnection(outlookConnections);
        
        // Filter Google connections
        const googleConnections = data.filter((c: any) => 
          c.provider === 'google' && c.is_active
        );
        const google = selectBestConnection(googleConnections);
        
        // Set state for Outlook
        if (outlook) {
          const isExpired = outlook.expires_at && new Date(outlook.expires_at) < now;
          setOutlookExpired(isExpired);
          setOutlookConnection({
            id: outlook.id,
            provider: outlook.provider,
            provider_account_email: outlook.provider_account_email,
            is_active: outlook.is_active,
            expires_at: outlook.expires_at
          });
        } else {
          setOutlookConnection(null);
          setOutlookExpired(false);
        }
        
        // Set state for Google
        if (google) {
          const isExpired = google.expires_at && new Date(google.expires_at) < now;
          setGoogleExpired(isExpired);
          setGoogleConnection({
            id: google.id,
            provider: google.provider,
            provider_account_email: google.provider_account_email,
            is_active: google.is_active,
            expires_at: google.expires_at
          });
        } else {
          setGoogleConnection(null);
          setGoogleExpired(false);
        }
      }
    } catch (error) {
      console.error('Error loading calendar connections:', error);
    }
  };

  const loadNotificationPrefs = async () => {
    if (!user?.id) return;

    try {
      // Load notification preferences
      const { data: prefsData, error: prefsError } = await supabase
        .from('notification_prefs')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (prefsError && prefsError.code !== 'PGRST116') {
        console.error('Error loading notification preferences:', prefsError);
        return;
      }

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
          channels: (prefsData.channels ?? ['EMAIL']) as NotificationChannel[]
        });
      }

      // Load user phone number and email
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('phone, email')
        .eq('user_id', user.id)
        .maybeSingle();

      if (profileError && profileError.code !== 'PGRST116') {
        console.error('Error loading profile data:', profileError);
        return;
      }

      if (profileData?.phone) {
        setPhone(profileData.phone);
      }
      if (profileData?.email) {
        setEmail(profileData.email);
      }

      // Load Slack custom webhook preference from localStorage
      const useCustom = localStorage.getItem('use-custom-slack-webhook') === 'true';
      setUseCustomSlackWebhook(useCustom);
      if (useCustom) {
        const storedSlackWebhook = localStorage.getItem('slack-webhook-url');
        if (storedSlackWebhook) {
          setSlackWebhookUrl(storedSlackWebhook);
        }
      }
    } catch (error) {
      console.error('Error loading notification preferences:', error);
    }
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
          channels: parsed.channels ?? ['EMAIL']
        });
      } catch (error) {
        console.error('Error parsing stored demo preferences:', error);
      }
    }
    
    if (storedPhone) {
      setPhone(storedPhone);
    }
      if (storedEmail) {
        setEmail(storedEmail);
      }
      
      // Load Slack custom webhook preference
      const useCustom = localStorage.getItem('use-custom-slack-webhook') === 'true';
      setUseCustomSlackWebhook(useCustom);
      if (useCustom) {
        const storedSlackWebhook = localStorage.getItem('slack-webhook-url');
        if (storedSlackWebhook) {
          setSlackWebhookUrl(storedSlackWebhook);
        }
      }
  };

  const saveNotificationPrefs = async () => {
    setIsSaving(true);
    
    try {
      // Validate email if EMAIL channel is enabled
      if (prefs.channels.includes('EMAIL') && (!email || !z.string().email().safeParse(email).success)) {
        toast({
          title: "Validation Error",
          description: "Please enter a valid email address for email notifications.",
          variant: "destructive",
        });
        return;
      }


      // Save Slack custom webhook preference to localStorage
      localStorage.setItem('use-custom-slack-webhook', useCustomSlackWebhook.toString());
      if (useCustomSlackWebhook && slackWebhookUrl) {
        localStorage.setItem('slack-webhook-url', slackWebhookUrl);
      }

      if (isDemoMode || !user?.id) {
        // Demo mode - save to localStorage
        localStorage.setItem('demo-notification-prefs', JSON.stringify(prefs));
        localStorage.setItem('demo-phone', phone);
        localStorage.setItem('demo-email', email);
        toast({
          title: "Settings saved",
          description: "Your notification preferences have been saved locally for this demo.",
        });
        return;
      }

      // Normalize quiet hours to HH:MM:00 format
      const normalizedPrefs = {
        ...prefs,
        quiet_hours_start: prefs.quiet_hours_start.length === 5 ? prefs.quiet_hours_start + ':00' : prefs.quiet_hours_start,
        quiet_hours_end: prefs.quiet_hours_end.length === 5 ? prefs.quiet_hours_end + ':00' : prefs.quiet_hours_end
      };

      // Use channels directly as they now match the database format
      const dbPrefs = {
        ...normalizedPrefs,
        channels: normalizedPrefs.channels as DatabaseChannel[]
      };

      // Try to update notification preferences first, then insert if not exists
      const { error: updatePrefsError } = await supabase
        .from('notification_prefs')
        .update(dbPrefs)
        .eq('user_id', user.id);

      if (updatePrefsError && updatePrefsError.code === 'PGRST116') {
        // No rows updated, try insert
        const { error: insertPrefsError } = await supabase
          .from('notification_prefs')
          .insert({ user_id: user.id, ...dbPrefs });
        
        if (insertPrefsError) {
          console.error('Error inserting notification preferences:', insertPrefsError);
          throw new Error(`Failed to save notification preferences: ${insertPrefsError.message || insertPrefsError.hint || 'Unknown database error'}`);
        }
      } else if (updatePrefsError) {
        console.error('Error updating notification preferences:', updatePrefsError);
        throw new Error(`Failed to update notification preferences: ${updatePrefsError.message || updatePrefsError.hint || 'Unknown database error'}`);
      }

      // Try to update profile first, then insert if not exists
      const { error: updateProfileError } = await supabase
        .from('profiles')
        .update({ phone, email })
        .eq('user_id', user.id);

      if (updateProfileError && updateProfileError.code === 'PGRST116') {
        // No rows updated, try insert
        const { error: insertProfileError } = await supabase
          .from('profiles')
          .insert({ user_id: user.id, phone, email });
        
        if (insertProfileError) {
          console.error('Error inserting profile:', insertProfileError);
          throw new Error(`Failed to save profile: ${insertProfileError.message || insertProfileError.hint || 'Unknown database error'}`);
        }
      } else if (updateProfileError) {
        console.error('Error updating profile:', updateProfileError);
        throw new Error(`Failed to update profile: ${updateProfileError.message || updateProfileError.hint || 'Unknown database error'}`);
      }

      toast({
        title: "Settings saved",
        description: "Your notification preferences have been updated.",
      });
    } catch (error) {
      console.error('Error saving notification preferences:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      toast({
        title: "Error saving settings",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleChannel = (channel: NotificationChannel) => {
    const newChannels = prefs.channels.includes(channel)
      ? prefs.channels.filter(c => c !== channel)
      : [...prefs.channels, channel];
    
    setPrefs({ ...prefs, channels: newChannels });
  };

  const sendTestEmail = async () => {
    if (!email) {
      toast({
        title: "Email Required",
        description: "Please enter an email address before testing.",
        variant: "destructive",
      });
      return;
    }

    if (!z.string().email().safeParse(email).success) {
      toast({
        title: "Invalid Email",
        description: "Please enter a valid email address.",
        variant: "destructive",
      });
      return;
    }

    try {
      const { data, error } = await supabase.functions.invoke('send-unified-notification', {
        body: {
          userId: user?.id || 'demo-user',
          title: '🧪 Test Email Notification',
          body: 'Test email notification - Email notifications will be sent here when enabled.',
          channels: ['EMAIL'],
          data: { type: 'test_notification' },
          userProfile: { email, phone }
        }
      });
      
      if (error) throw error;
      
      toast({
        title: "Test Email Sent",
        description: `Email notification sent to ${email}. Please check your inbox.`,
      });
    } catch (error: any) {
      console.error('Error sending test email:', error);
      toast({
        title: "Email Test Failed",
        description: error.message || "Could not send test email. Check your email configuration.",
        variant: "destructive",
      });
    }
  };

  const sendTestOutlookEvent = async () => {
    if (!outlookConnection) {
      toast({
        title: "Outlook Not Connected",
        description: "Please connect your Outlook account in Calendar settings first.",
        variant: "destructive",
      });
      return;
    }

    setIsTestingOutlook(true);
    try {
      console.log('Testing Outlook event notification via direct Graph API...');
      const { data, error } = await supabase.functions.invoke('send-unified-notification', {
        body: {
          userId: user?.id,
          title: 'Test Outlook Reminder',
          body: 'This is a test calendar event created directly via Microsoft Graph API',
          channels: ['OUTLOOK_EVENT'],
          userProfile: { email },
          data: { 
            type: 'test_notification',
            taskTitle: 'Test Calendar Event',
            taskDescription: 'This is a test calendar event with native reminder. You should see a notification from your Outlook app.',
            startTime: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // 5 minutes from now
            estimateMinutes: 30
          }
        }
      });

      if (error) throw error;

      const outlookResult = data?.channelResults?.outlook;
      
      if (outlookResult?.success) {
        toast({
          title: "✓ Outlook Event Created",
          description: `Calendar event created in ${outlookConnection.provider_account_email}. Check your Outlook app for the reminder!`,
        });
      } else {
        throw new Error(outlookResult?.error || 'Unknown error creating Outlook event');
      }
    } catch (error: any) {
      console.error('Error sending test Outlook event:', error);
      toast({
        title: "Test Failed", 
        description: error.message || "Failed to create Outlook calendar event",
        variant: "destructive",
      });
    } finally {
      setIsTestingOutlook(false);
    }
  };

  const sendTestGoogleEvent = async () => {
    try {
      console.log('Testing Google event notification...');
      const { data, error } = await supabase.functions.invoke('send-unified-notification', {
        body: {
          userId: user?.id,
          channels: ['GOOGLE_EVENT'],
          userProfile: { email },
          data: { 
            type: 'test_notification',
            taskTitle: 'Test Calendar Event',
            taskDescription: 'This is a test calendar event created by AI',
            startTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour from now
            estimateMinutes: 60
          }
        }
      });

      if (error) throw error;

      toast({
        title: "Test Google Event Sent",
        description: "AI-generated calendar event sent to your integration.",
      });
    } catch (error: any) {
      console.error('Error sending test Google event:', error);
      toast({
        title: "Test Failed", 
        description: error.message || "Failed to send test Google event",
        variant: "destructive",
      });
    }
  };

  const sendTestSlack = async () => {
    try {
      // Only require custom webhook URL if custom mode is enabled
      if (useCustomSlackWebhook && !slackWebhookUrl) {
        toast({
          title: "Custom webhook URL is empty",
          description: "Please enter your custom Slack webhook URL or disable custom mode.",
          variant: "destructive",
        });
        return;
      }
      
      console.log('Testing Slack notification:', useCustomSlackWebhook ? 'using custom webhook' : 'using server secret');
      
      const { data, error } = await supabase.functions.invoke('send-unified-notification', {
        body: {
          userId: user?.id || 'demo-user',
          title: '🧪 Test Slack Notification',
          body: 'Test Slack notification - Slack notifications will be sent here when enabled.',
          channels: ['SLACK'],
          data: { type: 'test_notification' },
          slackWebhook: useCustomSlackWebhook ? slackWebhookUrl : undefined,
          userProfile: { email, phone }
        }
      });

      if (error) throw error;

      const slackResult = data?.channelResults?.slack;
      if (slackResult?.success) {
        toast({
          title: "✓ Slack Delivered",
          description: slackResult.details || "Check your Slack channel for the notification.",
        });
      } else {
        throw new Error(slackResult?.error || 'Slack delivery failed - check webhook configuration');
      }
    } catch (error: any) {
      console.error('Error sending test Slack notification:', error);
      toast({
        title: "Slack Test Failed",
        description: error.message || "Failed to send test Slack notification.",
        variant: "destructive",
      });
    }
  };

  const sendTestInApp = async () => {
    try {
      toast({
        title: "🧪 In-App Notification Test",
        description: "This is a sample in-app notification shown locally in your browser. No webhook call is made for in-app notifications.",
      });
    } catch (error) {
      console.error('Error displaying in-app test notification:', error);
    }
  };

  const sendTestPush = async () => {
    if (!pushNotifications.subscription) {
      toast({
        title: "Not Subscribed",
        description: "Please enable push notifications first.",
        variant: "destructive",
      });
      return;
    }

    setIsTestingPush(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-push-notification', {
        body: {
          userId: user?.id,
          title: '🧪 Test Push Notification',
          body: 'If you see this, browser push notifications are working!',
          data: { type: 'test_notification' }
        }
      });

      if (error) throw error;

      if (data?.success && data?.delivered > 0) {
        toast({
          title: "✓ Push Delivered",
          description: `Sent to ${data.delivered} endpoint(s). If you don't see the notification, check your browser notification permissions.`,
        });
      } else if (data?.delivered === 0) {
        toast({
          title: "No Active Subscriptions",
          description: "Push was sent but no subscriptions found. Try re-enabling push notifications.",
          variant: "destructive",
        });
      } else {
        throw new Error(data?.error || 'Push delivery failed');
      }
    } catch (error: any) {
      console.error('Error sending test push:', error);
      toast({
        title: "Push Test Failed",
        description: error.message || "Could not send test push notification.",
        variant: "destructive",
      });
    } finally {
      setIsTestingPush(false);
    }
  };

  const handleEnablePush = async () => {
    const permissionGranted = await pushNotifications.requestPermission();
    if (permissionGranted) {
      const subscribed = await pushNotifications.subscribe();
      if (subscribed) {
        // Add PUSH to channels if not already there
        if (!prefs.channels.includes('PUSH')) {
          setPrefs({ ...prefs, channels: [...prefs.channels, 'PUSH'] });
        }
      }
    }
  };

  const handleDisablePush = async () => {
    const unsubscribed = await pushNotifications.unsubscribe();
    if (unsubscribed) {
      // Remove PUSH from channels
      setPrefs({ ...prefs, channels: prefs.channels.filter(c => c !== 'PUSH') });
    }
  };

  const testQuietHours = async () => {
    try {
      const now = new Date();
      const quietStart = new Date();
      const quietEnd = new Date();
      
      const [startHour, startMin] = prefs.quiet_hours_start.split(':').map(Number);
      const [endHour, endMin] = prefs.quiet_hours_end.split(':').map(Number);
      
      quietStart.setHours(startHour, startMin, 0, 0);
      quietEnd.setHours(endHour, endMin, 0, 0);
      
      // Handle overnight quiet hours
      if (quietEnd < quietStart) {
        if (now.getHours() < 12) {
          quietStart.setDate(quietStart.getDate() - 1);
        } else {
          quietEnd.setDate(quietEnd.getDate() + 1);
        }
      }
      
      const isQuietTime = now >= quietStart && now <= quietEnd;
      
      toast({
        title: isQuietTime ? "🤫 Quiet hours active" : "🔔 Outside quiet hours",
        description: isQuietTime 
          ? "Notifications would be suppressed right now due to quiet hours settings."
          : "Notifications would be delivered normally right now.",
      });
    } catch (error) {
      console.error('Error testing quiet hours:', error);
      toast({
        title: "Error",
        description: "Failed to test quiet hours settings.",
        variant: "destructive",
      });
    }
  };

  const createTestTaskWithNotifications = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('create-test-task', {
        body: {
          userId: user?.id || 'demo-user'
        }
      });

      if (error) {
        throw error;
      }

      toast({
        title: "Test task created",
        description: "A test task has been created and due reminders scheduled. You should receive notifications via your unified webhook when the task becomes due.",
      });
    } catch (error) {
      console.error('Error creating test task:', error);
      toast({
        title: "Error",
        description: "Failed to create test task. Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">

      {/* Notification Types */}
      <Card>
        <CardHeader>
          <CardTitle>Notification Types</CardTitle>
          <CardDescription>
            Choose which events trigger notifications
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Due Date Reminders</Label>
              <p className="text-xs text-muted-foreground">
                Get notified when tasks are approaching their due date
              </p>
            </div>
            <Switch
              checked={prefs.due_reminders_enabled}
              onCheckedChange={(checked) => 
                setPrefs({ ...prefs, due_reminders_enabled: checked })
              }
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Overdue Alerts</Label>
              <p className="text-xs text-muted-foreground">
                Get notified when tasks become overdue
              </p>
            </div>
            <Switch
              checked={prefs.overdue_reminders_enabled}
              onCheckedChange={(checked) => 
                setPrefs({ ...prefs, overdue_reminders_enabled: checked })
              }
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Task Created</Label>
              <p className="text-xs text-muted-foreground">
                Get notified when new tasks are added
              </p>
            </div>
            <Switch
              checked={prefs.task_created_enabled}
              onCheckedChange={(checked) => 
                setPrefs({ ...prefs, task_created_enabled: checked })
              }
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Daily Digest</Label>
              <p className="text-xs text-muted-foreground">
                Daily summary of your tasks and progress
              </p>
            </div>
            <Switch
              checked={prefs.daily_digest_enabled}
              onCheckedChange={(checked) => 
                setPrefs({ ...prefs, daily_digest_enabled: checked })
              }
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Weekly Digest</Label>
              <p className="text-xs text-muted-foreground">
                Weekly overview of completed tasks and upcoming deadlines
              </p>
            </div>
            <Switch
              checked={prefs.weekly_digest_enabled}
              onCheckedChange={(checked) => 
                setPrefs({ ...prefs, weekly_digest_enabled: checked })
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Quiet Hours */}
      <Card>
        <CardHeader>
          <CardTitle>Quiet Hours</CardTitle>
          <CardDescription>
            Set hours when notifications should be muted
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="quiet-start">Start Time</Label>
              <Input
                id="quiet-start"
                type="time"
                value={prefs.quiet_hours_start}
                onChange={(e) => 
                  setPrefs({ ...prefs, quiet_hours_start: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quiet-end">End Time</Label>
              <Input
                id="quiet-end"
                type="time"
                value={prefs.quiet_hours_end}
                onChange={(e) => 
                  setPrefs({ ...prefs, quiet_hours_end: e.target.value })
                }
              />
            </div>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="timezone">Timezone</Label>
            <Input
              id="timezone"
              placeholder="UTC"
              value={prefs.timezone}
              onChange={(e) => 
                setPrefs({ ...prefs, timezone: e.target.value })
              }
            />
          </div>

          <Button 
            onClick={testQuietHours}
            variant="outline" 
            className="w-full"
          >
            {prefs.quiet_hours_start <= new Date().toTimeString().slice(0, 5) && 
             new Date().toTimeString().slice(0, 5) <= prefs.quiet_hours_end ? (
              <VolumeX className="h-4 w-4 mr-2" />
            ) : (
              <Volume2 className="h-4 w-4 mr-2" />
            )}
            Test Quiet Hours
          </Button>
        </CardContent>
      </Card>

      {/* Delivery Channels */}
      <Card>
        <CardHeader>
          <CardTitle>Delivery Channels</CardTitle>
          <CardDescription>
            Choose how you want to receive notifications
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Mail className="h-5 w-5 text-primary" />
                <div>
                  <h4 className="font-medium">Email</h4>
                  <p className="text-sm text-muted-foreground">Send notifications via email</p>
                </div>
              </div>
              <Switch
                checked={prefs.channels.includes('EMAIL')}
                onCheckedChange={(checked) => handleToggleChannel('EMAIL')}
              />
            </div>
            
            {prefs.channels.includes('EMAIL') && (
              <div className="space-y-2 mt-4">
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            )}
          </div>

          {/* Push Notifications Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Smartphone className="h-5 w-5 text-primary" />
                <div>
                  <h4 className="font-medium">Push Notifications</h4>
                  <p className="text-sm text-muted-foreground">Browser/device notifications for instant alerts</p>
                  {/* Status indicator */}
                  {!pushNotifications.isSupported ? (
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                      <AlertCircle className="h-3 w-3" />
                      Not supported in this browser
                    </p>
                  ) : pushNotifications.permission === 'denied' ? (
                    <p className="text-xs text-destructive flex items-center gap-1 mt-1">
                      <BellOff className="h-3 w-3" />
                      Blocked - enable in browser settings
                    </p>
                  ) : pushNotifications.subscription ? (
                    <p className="text-xs text-green-600 flex items-center gap-1 mt-1">
                      <CheckCircle2 className="h-3 w-3" />
                      Enabled and subscribed
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                      <Bell className="h-3 w-3" />
                      Not enabled
                    </p>
                  )}
                </div>
              </div>
              <Switch
                checked={prefs.channels.includes('PUSH') && pushNotifications.subscription}
                onCheckedChange={(checked) => {
                  if (checked) {
                    handleEnablePush();
                  } else {
                    handleDisablePush();
                  }
                }}
                disabled={!pushNotifications.isSupported || pushNotifications.permission === 'denied' || pushNotifications.isLoading}
              />
            </div>
            
            {/* Push subscription controls */}
            {pushNotifications.isSupported && pushNotifications.permission !== 'denied' && (
              <div className="space-y-2 mt-4 pl-8">
                {pushNotifications.subscription ? (
                  <>
                    <div className="flex items-center gap-2 p-3 rounded-md bg-muted/50 border border-border">
                      <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                      <div className="text-sm">
                        <span className="font-medium">Push notifications active</span>
                        <p className="text-xs text-muted-foreground">
                          You'll receive instant browser notifications for task reminders.
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button 
                        onClick={sendTestPush}
                        variant="outline"
                        size="sm"
                        disabled={isTestingPush || pushNotifications.isLoading}
                        className="flex-1"
                      >
                        {isTestingPush ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Sending...
                          </>
                        ) : (
                          <>
                            <Bell className="h-4 w-4 mr-2" />
                            Send Test
                          </>
                        )}
                      </Button>
                      <Button
                        onClick={pushNotifications.forceResubscribe}
                        variant="outline"
                        size="sm"
                        disabled={pushNotifications.isLoading}
                        className="flex-1"
                        title="Force refresh push subscription - use if notifications aren't working"
                      >
                        {pushNotifications.isLoading ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Refreshing...
                          </>
                        ) : (
                          <>
                            <RefreshCw className="h-4 w-4 mr-2" />
                            Refresh
                          </>
                        )}
                      </Button>
                    </div>
                  </>
                ) : (
                  <Button 
                    onClick={handleEnablePush}
                    variant="outline"
                    size="sm"
                    disabled={pushNotifications.isLoading}
                    className="w-full"
                  >
                    {pushNotifications.isLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Enabling...
                      </>
                    ) : (
                      <>
                        <Bell className="h-4 w-4 mr-2" />
                        Enable Push Notifications
                      </>
                    )}
                  </Button>
                )}
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Calendar className="h-5 w-5 text-blue-500" />
                <div>
                  <h4 className="font-medium">Outlook Calendar</h4>
                  <p className="text-sm text-muted-foreground">Create events with native phone reminders</p>
                  {/* Connection status with expiry detection */}
                  {outlookConnection && outlookExpired ? (
                    <p className="text-xs text-amber-600 flex items-center gap-1 mt-1">
                      <AlertCircle className="h-3 w-3" />
                      Connection expired - reconnect below
                    </p>
                  ) : outlookConnection ? (
                    <p className="text-xs text-green-600 flex items-center gap-1 mt-1">
                      <CheckCircle2 className="h-3 w-3" />
                      Connected: {outlookConnection.provider_account_email}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                      <AlertCircle className="h-3 w-3" />
                      Not connected
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={prefs.channels.includes('OUTLOOK_EVENT')}
                  onCheckedChange={(checked) => handleToggleChannel('OUTLOOK_EVENT')}
                  disabled={!outlookConnection || outlookExpired}
                />
              </div>
            </div>
            
            {/* Show OAuth button if not connected or expired */}
            {(!outlookConnection || outlookExpired) && (
              <div className="mt-2 pl-8">
                <CalendarOAuthManager
                  provider="outlook"
                  onSuccess={() => {
                    loadCalendarConnections();
                    toast({
                      title: "Outlook Connected",
                      description: "Your Outlook calendar is now connected for reminders.",
                    });
                  }}
                  onError={(err) => toast({
                    title: "Connection Failed",
                    description: err,
                    variant: "destructive",
                  })}
                />
              </div>
            )}
            
            {prefs.channels.includes('OUTLOOK_EVENT') && outlookConnection && !outlookExpired && (
              <div className="space-y-2 mt-4 pl-8">
                <div className="flex items-center gap-2 p-3 rounded-md bg-muted/50 border border-border">
                  <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                  <div className="text-sm">
                    <span className="font-medium">Direct Microsoft Graph API</span>
                    <p className="text-xs text-muted-foreground">
                      Events are created directly in your Outlook calendar with native reminders.
                    </p>
                  </div>
                </div>
                <Button 
                  onClick={sendTestOutlookEvent}
                  variant="outline"
                  size="sm"
                  disabled={isTestingOutlook}
                  className="w-full"
                >
                  {isTestingOutlook ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Creating Event...
                    </>
                  ) : (
                    <>
                      <Calendar className="h-4 w-4 mr-2" />
                      Send Test Reminder
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Calendar className="h-5 w-5 text-primary" />
                <div>
                  <h4 className="font-medium">Google Calendar</h4>
                  <p className="text-sm text-muted-foreground">Create calendar events in Google Calendar</p>
                  {/* Connection status with expiry detection */}
                  {googleConnection && googleExpired ? (
                    <p className="text-xs text-amber-600 flex items-center gap-1 mt-1">
                      <AlertCircle className="h-3 w-3" />
                      Connection expired - reconnect below
                    </p>
                  ) : googleConnection ? (
                    <p className="text-xs text-green-600 flex items-center gap-1 mt-1">
                      <CheckCircle2 className="h-3 w-3" />
                      Connected: {googleConnection.provider_account_email}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                      <AlertCircle className="h-3 w-3" />
                      Not connected
                    </p>
                  )}
                </div>
              </div>
              <Switch
                checked={prefs.channels.includes('GOOGLE_EVENT')}
                onCheckedChange={(checked) => handleToggleChannel('GOOGLE_EVENT')}
                disabled={!googleConnection || googleExpired}
              />
            </div>
            
            {/* Show OAuth button if not connected or expired */}
            {(!googleConnection || googleExpired) && (
              <div className="mt-2 pl-8">
                <CalendarOAuthManager
                  provider="google"
                  onSuccess={() => {
                    loadCalendarConnections();
                    toast({
                      title: "Google Calendar Connected",
                      description: "Your Google calendar is now connected for reminders.",
                    });
                  }}
                  onError={(err) => toast({
                    title: "Connection Failed",
                    description: err,
                    variant: "destructive",
                  })}
                />
              </div>
            )}
            
            {prefs.channels.includes('GOOGLE_EVENT') && googleConnection && !googleExpired && (
              <div className="space-y-2 mt-4 pl-8">
                <div className="flex items-center gap-2 p-3 rounded-md bg-muted/50 border border-border">
                  <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                  <div className="text-sm">
                    <span className="font-medium">Connected to Google Calendar</span>
                    <p className="text-xs text-muted-foreground">
                      Events are created directly in your Google calendar with native reminders.
                    </p>
                  </div>
                </div>
                <Button 
                  onClick={sendTestGoogleEvent}
                  variant="outline"
                  size="sm"
                  className="w-full"
                >
                  <Calendar className="h-4 w-4 mr-2" />
                  Send Test Reminder
                </Button>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <MessageSquare className="h-5 w-5 text-primary" />
                <div>
                  <h4 className="font-medium">Slack</h4>
                  <p className="text-sm text-muted-foreground">Send notifications to a Slack channel</p>
                </div>
              </div>
              <Switch
                checked={prefs.channels.includes('SLACK')}
                onCheckedChange={(checked) => handleToggleChannel('SLACK')}
              />
            </div>
            
            {prefs.channels.includes('SLACK') && (
              <div className="space-y-4 mt-4">
                {/* Server webhook indicator */}
                <div className="flex items-center gap-2 p-3 rounded-md bg-muted/50 border border-border">
                  <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                  <div className="text-sm">
                    <span className="font-medium">Using server-configured webhook</span>
                    <p className="text-xs text-muted-foreground">
                      The SLACK_WEBHOOK_URL secret will be used automatically.
                    </p>
                  </div>
                </div>

                {/* Custom webhook toggle */}
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="use-custom-slack"
                    checked={useCustomSlackWebhook}
                    onCheckedChange={(checked) => setUseCustomSlackWebhook(checked === true)}
                  />
                  <Label htmlFor="use-custom-slack" className="text-sm cursor-pointer">
                    Use a different webhook URL
                  </Label>
                </div>

                {/* Custom webhook input (only visible when enabled) */}
                {useCustomSlackWebhook && (
                  <div className="space-y-2 pl-6">
                    <Label htmlFor="slack-webhook-url">Custom Webhook URL</Label>
                    <Input
                      id="slack-webhook-url"
                      type="url"
                      placeholder="https://hooks.slack.com/services/..."
                      value={slackWebhookUrl}
                      onChange={(e) => setSlackWebhookUrl(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      This overrides the server secret and is stored locally in your browser.
                    </p>
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
          <CardDescription>
            Send test notifications to verify your settings are working
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Button 
              onClick={sendTestEmail}
              variant="outline" 
              className="w-full"
              disabled={!prefs.channels.includes('EMAIL') || !email}
            >
              <Mail className="h-4 w-4 mr-2" />
              Test Email
            </Button>

            <Button 
              onClick={sendTestOutlookEvent}
              variant="outline" 
              className="w-full"
              disabled={!prefs.channels.includes('OUTLOOK_EVENT') || !outlookConnection || isTestingOutlook}
            >
              {isTestingOutlook ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Calendar className="h-4 w-4 mr-2" />
              )}
              Test Outlook Event
            </Button>
            
            <Button 
              onClick={sendTestGoogleEvent}
              variant="outline" 
              className="w-full"
              disabled={!prefs.channels.includes('GOOGLE_EVENT')}
            >
              <Calendar className="h-4 w-4 mr-2" />
              Test Google Event
            </Button>

            <Button 
              onClick={sendTestSlack}
              variant="outline" 
              className="w-full"
              disabled={!prefs.channels.includes('SLACK')}
            >
              <MessageSquare className="h-4 w-4 mr-2" />
              Test Slack
            </Button>

            <Button 
              onClick={sendTestPush}
              variant="outline" 
              className="w-full"
              disabled={!pushNotifications.subscription || isTestingPush}
            >
              {isTestingPush ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Bell className="h-4 w-4 mr-2" />
              )}
              Test Push
            </Button>

            <Button 
              onClick={sendTestInApp}
              variant="outline" 
              className="w-full"
            >
              <Volume2 className="h-4 w-4 mr-2" />
              Test In-App Toast
            </Button>

            <Button 
              onClick={createTestTaskWithNotifications}
              variant="outline" 
              className="w-full"
            >
              <Calendar className="h-4 w-4 mr-2" />
              Create Test Task
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="flex justify-end">
        <Button 
          onClick={saveNotificationPrefs}
          disabled={isSaving}
          className="min-w-[120px]"
        >
          {isSaving ? "Saving..." : "Save Settings"}
        </Button>
      </div>
    </div>
  );
};

export default NotificationSettings;
import React, { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Phone, Mail, MessageSquare, Volume2, VolumeX } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

type NotificationChannel = 'EMAIL' | 'SMS' | 'SLACK' | 'PUSH';

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
    channels: ['EMAIL', 'PUSH']
  });
  const [isSaving, setIsSaving] = useState(false);
  const [phone, setPhone] = useState('');
  const { toast } = useToast();
  const { user } = useAuth();

  useEffect(() => {
    if (user) {
      loadNotificationPrefs();
    } else {
      loadDemoNotificationPrefs();
    }
  }, [user]);

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
          channels: prefsData.channels ?? ['EMAIL']
        });
      }

      // Load user phone number
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('phone')
        .eq('user_id', user.id)
        .maybeSingle();

      if (profileError && profileError.code !== 'PGRST116') {
        console.error('Error loading phone number:', profileError);
        return;
      }

      if (profileData?.phone) {
        setPhone(profileData.phone);
      }
    } catch (error) {
      console.error('Error loading notification preferences:', error);
    }
  };

  const loadDemoNotificationPrefs = () => {
    const stored = localStorage.getItem('demo-notification-prefs');
    const storedPhone = localStorage.getItem('demo-phone');
    
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
  };

  const saveNotificationPrefs = async () => {
    setIsSaving(true);
    
    try {
      // Save Slack webhook URL to localStorage (not in database for security)
      const slackWebhookUrl = (document.getElementById('slack-webhook-url') as HTMLInputElement)?.value;
      if (slackWebhookUrl) {
        localStorage.setItem('slack-webhook-url', slackWebhookUrl);
      }

      if (!user?.id) {
        // Demo mode - save to localStorage
        localStorage.setItem('demo-notification-prefs', JSON.stringify(prefs));
        localStorage.setItem('demo-phone', phone);
        toast({
          title: "Settings saved",
          description: "Your notification preferences have been saved locally for this demo.",
        });
        return;
      }

      // Save notification preferences
      const { error: prefsError } = await supabase
        .from('notification_prefs')
        .upsert({
          user_id: user.id,
          ...prefs
        });

      if (prefsError) {
        throw prefsError;
      }

      // Save phone number to profile
      const { error: phoneError } = await supabase
        .from('profiles')
        .update({ phone })
        .eq('user_id', user.id);

      if (phoneError) {
        throw phoneError;
      }

      toast({
        title: "Settings saved",
        description: "Your notification preferences have been updated.",
      });
    } catch (error) {
      console.error('Error saving notification preferences:', error);
      toast({
        title: "Error saving settings",
        description: "There was a problem saving your notification preferences. Please try again.",
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
    try {
      await supabase.functions.invoke('send-unified-notification', {
        body: {
          userId: user?.id || 'demo-user',
          title: '🧪 Test Email Notification',
          body: 'Test email notification - Email notifications will be sent here when enabled.',
          channels: ['EMAIL'],
          data: { type: 'test_notification' }
        }
      });
      
      toast({
        title: "Test email sent",
        description: "Check your unified webhook for the email notification.",
      });
    } catch (error) {
      console.error('Error sending test email:', error);
      toast({
        title: "Error",
        description: "Failed to send test email notification.",
        variant: "destructive",
      });
    }
  };

  const sendTestSMS = async () => {
    try {
      await supabase.functions.invoke('send-unified-notification', {
        body: {
          userId: user?.id || 'demo-user',
          title: '🧪 Test SMS Notification',
          body: 'Test SMS notification - SMS notifications will be sent here when enabled.',
          channels: ['SMS'],
          data: { type: 'test_notification' }
        }
      });
      
      toast({
        title: "Test SMS sent",
        description: "Check your unified webhook for the SMS notification.",
      });
    } catch (error) {
      console.error('Error sending test SMS:', error);
      toast({
        title: "Error",
        description: "Failed to send test SMS notification.",
        variant: "destructive",
      });
    }
  };

  const sendTestSlack = async () => {
    try {
      await supabase.functions.invoke('send-unified-notification', {
        body: {
          userId: user?.id || 'demo-user',
          title: '🧪 Test Slack Notification',
          body: 'Test Slack notification - Slack notifications will be sent here when enabled.',
          channels: ['SLACK'],
          data: { type: 'test_notification' }
        }
      });

      toast({
        title: "Test Slack notification sent",
        description: "Check your unified webhook for the Slack notification.",
      });
    } catch (error) {
      console.error('Error sending test Slack notification:', error);
      toast({
        title: "Error",
        description: "Failed to send test Slack notification.",
        variant: "destructive",
      });
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
      {/* Phone Number */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Phone className="h-5 w-5" />
            Phone Number
          </CardTitle>
          <CardDescription>
            Required for SMS notifications
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label htmlFor="phone">Phone Number</Label>
            <Input
              id="phone"
              type="tel"
              placeholder="+1234567890"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <p className="text-sm text-muted-foreground">
              Include country code (e.g., +1 for US)
            </p>
          </div>
        </CardContent>
      </Card>

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
                Weekly summary and productivity insights
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
          <CardTitle className="flex items-center gap-2">
            <Volume2 className="h-5 w-5" />
            Quiet Hours
          </CardTitle>
          <CardDescription>
            Set times when you don't want to receive notifications
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
              value={prefs.timezone}
              onChange={(e) => 
                setPrefs({ ...prefs, timezone: e.target.value })
              }
              placeholder="UTC"
            />
          </div>
        </CardContent>
      </Card>

      {/* Delivery Channels */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Delivery Channels
          </CardTitle>
          <CardDescription>
            Choose how you want to receive notifications via your unified webhook
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Volume2 className="h-4 w-4" />
                <Label htmlFor="push-channel">Push Notifications</Label>
              </div>
              <Switch
                id="push-channel"
                checked={prefs.channels.includes('PUSH')}
                onCheckedChange={() => handleToggleChannel('PUSH')}
              />
            </div>
            
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4" />
                <Label htmlFor="email-channel">Email</Label>
              </div>
              <Switch
                id="email-channel"
                checked={prefs.channels.includes('EMAIL')}
                onCheckedChange={() => handleToggleChannel('EMAIL')}
              />
            </div>
            
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4" />
                <Label htmlFor="sms-channel">SMS</Label>
              </div>
              <Switch
                id="sms-channel"
                checked={prefs.channels.includes('SMS')}
                onCheckedChange={() => handleToggleChannel('SMS')}
                disabled={!phone}
              />
            </div>
            
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4" />
                <Label htmlFor="slack-channel">Slack</Label>
              </div>
              <Switch
                id="slack-channel"
                checked={prefs.channels.includes('SLACK')}
                onCheckedChange={() => handleToggleChannel('SLACK')}
              />
            </div>
          </div>
          
          {!phone && prefs.channels.includes('SMS') && (
            <div className="text-sm text-yellow-600 bg-yellow-50 p-2 rounded">
              Please add your phone number above to enable SMS notifications.
            </div>
          )}
          
          {prefs.channels.includes('SLACK') && (
            <div className="space-y-2 pt-2 border-t">
              <Label htmlFor="slack-webhook-url">Slack Webhook URL</Label>
              <Input
                id="slack-webhook-url"
                type="url"
                placeholder="https://hooks.slack.com/services/..."
                defaultValue={localStorage.getItem('slack-webhook-url') || ''}
              />
              <p className="text-sm text-muted-foreground">
                Get this from your Slack app's "Incoming Webhooks" settings
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Test Notifications */}
      <Card>
        <CardHeader>
          <CardTitle>Test Notifications</CardTitle>
          <CardDescription>
            Send test notifications to verify your unified webhook setup
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Button
              onClick={sendTestEmail}
              variant="outline"
              className="w-full"
            >
              Test Email
            </Button>
            
            <Button
              onClick={sendTestSMS}
              disabled={!prefs.channels.includes('SMS') || !phone}
              variant="outline"
              className="w-full"
            >
              Test SMS
            </Button>
            
            <Button
              onClick={sendTestSlack}
              disabled={!prefs.channels.includes('SLACK')}
              variant="outline"
              className="w-full"
            >
              Test Slack
            </Button>
            
            <Button
              onClick={testQuietHours}
              variant="outline"
              className="w-full"
            >
              Test Quiet Hours
            </Button>
            
            <Button
              onClick={createTestTaskWithNotifications}
              variant="outline"
              className="w-full col-span-1 md:col-span-2"
            >
              Create Test Task
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Save Settings */}
      <div className="flex justify-end">
        <Button onClick={saveNotificationPrefs} disabled={isSaving}>
          {isSaving ? "Saving..." : "Save Settings"}
        </Button>
      </div>
    </div>
  );
};

export default NotificationSettings;
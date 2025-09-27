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
import { z } from "zod";

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
  const [email, setEmail] = useState('');
  const { toast } = useToast();
  const { user, isDemoMode } = useAuth();

  useEffect(() => {
    if (isDemoMode) {
      loadDemoNotificationPrefs();
    } else if (user) {
      loadNotificationPrefs();
    }
  }, [isDemoMode, user]);

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
  };

  const saveNotificationPrefs = async () => {
    setIsSaving(true);
    
    try {
      // Validate email and phone if their channels are enabled
      const validationSchema = z.object({
        email: prefs.channels.includes('EMAIL') 
          ? z.string().email("Please enter a valid email address").min(1, "Email is required when Email channel is enabled")
          : z.string().optional(),
        phone: prefs.channels.includes('SMS')
          ? z.string().min(1, "Phone is required when SMS channel is enabled").regex(/^\+?[1-9]\d{1,14}$/, "Please enter a valid phone number with country code")
          : z.string().optional()
      });

      const validation = validationSchema.safeParse({ email, phone });
      if (!validation.success) {
        const errors = validation.error.errors.map(err => err.message).join(', ');
        toast({
          title: "Validation Error",
          description: errors,
          variant: "destructive",
        });
        return;
      }

      // Save Slack webhook URL to localStorage (not in database for security)
      const slackWebhookUrl = (document.getElementById('slack-webhook-url') as HTMLInputElement)?.value;
      if (slackWebhookUrl) {
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

      // Try to update notification preferences first, then insert if not exists
      const { error: updatePrefsError } = await supabase
        .from('notification_prefs')
        .update({ ...normalizedPrefs })
        .eq('user_id', user.id);

      if (updatePrefsError && updatePrefsError.code === 'PGRST116') {
        // No rows updated, try insert
        const { error: insertPrefsError } = await supabase
          .from('notification_prefs')
          .insert({ user_id: user.id, ...normalizedPrefs });
        
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
    try {
      await supabase.functions.invoke('send-unified-notification', {
        body: {
          userId: user?.id || 'demo-user',
          title: '🧪 Test Email Notification',
          body: 'Test email notification - Email notifications will be sent here when enabled.',
          channels: ['EMAIL'],
          data: { type: 'test_notification' },
          userProfile: { email, phone }
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
          data: { type: 'test_notification' },
          userProfile: { email, phone }
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
      const slackWebhookUrl = (document.getElementById('slack-webhook-url') as HTMLInputElement)?.value || localStorage.getItem('slack-webhook-url') || '';
      
      await supabase.functions.invoke('send-unified-notification', {
        body: {
          userId: user?.id || 'demo-user',
          title: '🧪 Test Slack Notification',
          body: 'Test Slack notification - Slack notifications will be sent here when enabled.',
          channels: ['SLACK'],
          data: { type: 'test_notification' },
          slackWebhook: slackWebhookUrl,
          userProfile: { email, phone }
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
                <Label htmlFor="push-channel">In-App Notifications</Label>
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
            
            {prefs.channels.includes('EMAIL') && (
              <div className="space-y-2 pt-2 border-t">
                <Label htmlFor="email-address">Email Address</Label>
                <Input
                  id="email-address"
                  type="email"
                  placeholder="user@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <p className="text-sm text-muted-foreground">
                  Email address for receiving notifications
                </p>
              </div>
            )}
            
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4" />
                <Label htmlFor="sms-channel">SMS</Label>
              </div>
              <Switch
                id="sms-channel"
                checked={prefs.channels.includes('SMS')}
                onCheckedChange={() => handleToggleChannel('SMS')}
              />
            </div>
            
            {prefs.channels.includes('SMS') && (
              <div className="space-y-2 pt-2 border-t">
                <Label htmlFor="phone-number">Phone Number</Label>
                <Input
                  id="phone-number"
                  type="tel"
                  placeholder="+1234567890"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
                <p className="text-sm text-muted-foreground">
                  Include country code (e.g., +1 for US)
                </p>
              </div>
            )}
            
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
          </div>
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
              onClick={sendTestInApp}
              disabled={!prefs.channels.includes('PUSH')}
              variant="outline"
              className="w-full"
            >
              Test In-App
            </Button>
            
            <Button
              onClick={sendTestEmail}
              disabled={!prefs.channels.includes('EMAIL')}
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
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { 
  Bell, 
  BellOff, 
  Clock, 
  Calendar,
  Mail,
  Smartphone,
  Volume2,
  VolumeX,
  Settings,
  TestTube
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useNotifications } from '@/hooks/useNotifications';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

type NotificationChannel = 'WEB_PUSH' | 'EMAIL' | 'IN_APP';

interface NotificationPrefs {
  due_reminders_enabled: boolean;
  overdue_reminders_enabled: boolean;
  daily_digest_enabled: boolean;
  weekly_digest_enabled: boolean;
  task_created_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
  timezone: string;
  channels: NotificationChannel[];
  email_address?: string;
}

const NotificationSettings: React.FC = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const isDemoMode = !user; // Simple demo mode detection
  const {
    isSupported,
    permission,
    subscription,
    isLoading,
    requestPermission,
    subscribe,
    unsubscribe,
    sendTestNotification
  } = useNotifications();

  const [prefs, setPrefs] = useState<NotificationPrefs>({
    due_reminders_enabled: true,
    overdue_reminders_enabled: true,
    daily_digest_enabled: false,
    weekly_digest_enabled: false,
    task_created_enabled: true,
    quiet_hours_start: '22:00',
    quiet_hours_end: '08:00',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    channels: ['WEB_PUSH', 'IN_APP'] as NotificationChannel[],
    email_address: ''
  });

  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (user && !isDemoMode) {
      loadNotificationPrefs();
    }
  }, [user, isDemoMode]);

  const loadNotificationPrefs = async () => {
    try {
      // Load both notification prefs and user profile
      const [prefsResponse, profileResponse] = await Promise.all([
        supabase
          .from('notification_prefs')
          .select('*')
          .eq('user_id', user?.id)
          .maybeSingle(),
        supabase
          .from('profiles')
          .select('email')
          .eq('user_id', user?.id)
          .maybeSingle()
      ]);

      if (prefsResponse.error && prefsResponse.error.code !== 'PGRST116') {
        console.error('Error loading notification preferences:', prefsResponse.error);
        return;
      }

      const userEmail = profileResponse.data?.email || user?.email || '';

      if (prefsResponse.data) {
        setPrefs({
          due_reminders_enabled: prefsResponse.data.due_reminders_enabled,
          overdue_reminders_enabled: prefsResponse.data.overdue_reminders_enabled,
          daily_digest_enabled: prefsResponse.data.daily_digest_enabled,
          weekly_digest_enabled: prefsResponse.data.weekly_digest_enabled,
          task_created_enabled: prefsResponse.data.task_created_enabled ?? true,
          quiet_hours_start: prefsResponse.data.quiet_hours_start ? prefsResponse.data.quiet_hours_start.substring(0, 5) : '22:00',
          quiet_hours_end: prefsResponse.data.quiet_hours_end ? prefsResponse.data.quiet_hours_end.substring(0, 5) : '08:00',
          timezone: prefsResponse.data.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
          channels: (prefsResponse.data.channels as NotificationChannel[]) || ['WEB_PUSH', 'IN_APP'],
          email_address: userEmail
        });
      } else {
        // Set default email if no preferences exist yet
        setPrefs(prev => ({ ...prev, email_address: userEmail }));
      }
    } catch (error) {
      console.error('Error loading notification preferences:', error);
    }
  };

  const saveNotificationPrefs = async () => {
    if (!user || isDemoMode) {
      // For demo mode, just save to localStorage
      localStorage.setItem('demo-notification-prefs', JSON.stringify(prefs));
      toast({
        title: "Settings saved",
        description: "Your notification preferences have been updated",
      });
      return;
    }

    setIsSaving(true);
    try {
      // Ensure time format is HH:MM:SS for database
      const formatTime = (time: string) => {
        return time.length === 5 ? `${time}:00` : time;
      };

      const { error } = await supabase
        .from('notification_prefs')
        .upsert([{
          user_id: user.id,
          due_reminders_enabled: prefs.due_reminders_enabled,
          overdue_reminders_enabled: prefs.overdue_reminders_enabled,
          daily_digest_enabled: prefs.daily_digest_enabled,
          weekly_digest_enabled: prefs.weekly_digest_enabled,
          task_created_enabled: prefs.task_created_enabled,
          quiet_hours_start: formatTime(prefs.quiet_hours_start),
          quiet_hours_end: formatTime(prefs.quiet_hours_end),
          timezone: prefs.timezone,
          channels: prefs.channels
        }], {
          onConflict: 'user_id'
        });

      if (error) {
        console.error('Error saving notification preferences:', error);
        toast({
          title: "Error",
          description: `Failed to save notification preferences: ${error.message}`,
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Settings saved",
        description: "Your notification preferences have been updated",
      });
    } catch (error) {
      console.error('Error saving notification preferences:', error);
      toast({
        title: "Error",
        description: "Failed to save notification preferences",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handlePermissionRequest = async () => {
    const granted = await requestPermission();
    if (granted) {
      await subscribe();
    }
  };

  const handleToggleChannel = (channel: NotificationChannel) => {
    setPrefs(prev => ({
      ...prev,
      channels: prev.channels.includes(channel)
        ? prev.channels.filter(c => c !== channel)
        : [...prev.channels, channel]
    }));
  };

  const getPermissionStatus = () => {
    if (!isSupported) {
      return { color: 'bg-gray-100 text-gray-800', text: 'Not Supported' };
    }
    
    switch (permission) {
      case 'granted':
        return { color: 'bg-green-100 text-green-800', text: 'Enabled' };
      case 'denied':
        return { color: 'bg-red-100 text-red-800', text: 'Blocked' };
      default:
        return { color: 'bg-yellow-100 text-yellow-800', text: 'Not Requested' };
    }
  };

  const permissionStatus = getPermissionStatus();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Bell className="h-5 w-5" />
        <h2 className="text-lg font-semibold">Notification Settings</h2>
      </div>

      {/* Push Notification Status */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Smartphone className="h-4 w-4" />
            Push Notifications
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm">Status:</span>
              <Badge className={permissionStatus.color}>
                {permissionStatus.text}
              </Badge>
              {subscription && (
                <Badge className="bg-blue-100 text-blue-800">
                  Subscribed
                </Badge>
              )}
            </div>
            
            <div className="flex gap-2">
              {permission !== 'granted' && (
                <Button 
                  onClick={handlePermissionRequest}
                  disabled={!isSupported || isLoading}
                  size="sm"
                >
                  {isLoading ? 'Loading...' : 'Enable Notifications'}
                </Button>
              )}
              
              {permission === 'granted' && !subscription && (
                <Button 
                  onClick={subscribe}
                  disabled={isLoading}
                  size="sm"
                >
                  {isLoading ? 'Subscribing...' : 'Subscribe'}
                </Button>
              )}
              
              {subscription && (
                <>
                  <Button 
                    onClick={sendTestNotification}
                    variant="outline"
                    size="sm"
                    className="flex items-center gap-1"
                  >
                    <TestTube className="h-3 w-3" />
                    Test
                  </Button>
                  <Button 
                    onClick={unsubscribe}
                    variant="outline"
                    size="sm"
                    disabled={isLoading}
                  >
                    {isLoading ? 'Unsubscribing...' : 'Unsubscribe'}
                  </Button>
                </>
              )}
            </div>
          </div>

          {!isSupported && (
            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
              <p className="text-sm text-yellow-800">
                Push notifications are not supported in this browser. 
                Try using Chrome, Firefox, or Safari for the best experience.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Notification Types */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Bell className="h-4 w-4" />
            Notification Types
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Due Date Reminders</Label>
              <p className="text-xs text-muted-foreground">
                Get notified when tasks are due soon
              </p>
            </div>
            <Switch
              checked={prefs.due_reminders_enabled}
              onCheckedChange={(checked) => 
                setPrefs(prev => ({ ...prev, due_reminders_enabled: checked }))
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
                setPrefs(prev => ({ ...prev, overdue_reminders_enabled: checked }))
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
                setPrefs(prev => ({ ...prev, daily_digest_enabled: checked }))
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
                setPrefs(prev => ({ ...prev, weekly_digest_enabled: checked }))
              }
            />
          </div>

          <Separator />

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
                setPrefs(prev => ({ ...prev, task_created_enabled: checked }))
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Quiet Hours */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <VolumeX className="h-4 w-4" />
            Quiet Hours
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            No notifications will be sent during these hours
          </p>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm">Start Time</Label>
              <Input
                type="time"
                value={prefs.quiet_hours_start}
                onChange={(e) => 
                  setPrefs(prev => ({ ...prev, quiet_hours_start: e.target.value }))
                }
              />
            </div>
            
            <div className="space-y-2">
              <Label className="text-sm">End Time</Label>
              <Input
                type="time"
                value={prefs.quiet_hours_end}
                onChange={(e) => 
                  setPrefs(prev => ({ ...prev, quiet_hours_end: e.target.value }))
                }
              />
            </div>
          </div>

          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-blue-600" />
              <span className="text-sm text-blue-800">
                Quiet hours: {prefs.quiet_hours_start} - {prefs.quiet_hours_end}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Notification Channels */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Settings className="h-4 w-4" />
            Delivery Channels
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Smartphone className="h-4 w-4" />
                <Label className="text-sm">Push Notifications</Label>
              </div>
              <Switch
                checked={prefs.channels.includes('WEB_PUSH')}
                onCheckedChange={() => handleToggleChannel('WEB_PUSH')}
                disabled={!subscription}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bell className="h-4 w-4" />
                <Label className="text-sm">In-App Notifications</Label>
              </div>
              <Switch
                checked={prefs.channels.includes('IN_APP')}
                onCheckedChange={() => handleToggleChannel('IN_APP')}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4" />
                  <Label className="text-sm">Email Notifications</Label>
                </div>
                <Switch
                  checked={prefs.channels.includes('EMAIL')}
                  onCheckedChange={() => handleToggleChannel('EMAIL')}
                />
              </div>
              {prefs.channels.includes('EMAIL') && (
                <div className="ml-6 space-y-2">
                  <Label className="text-xs text-muted-foreground">Email Address</Label>
                  <Input
                    type="email"
                    value={prefs.email_address || ''}
                    onChange={(e) => 
                      setPrefs(prev => ({ ...prev, email_address: e.target.value }))
                    }
                    placeholder="Enter email address for notifications"
                    className="text-sm"
                  />
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="flex justify-end">
        <Button 
          onClick={saveNotificationPrefs}
          disabled={isSaving}
          className="flex items-center gap-2"
        >
          {isSaving ? 'Saving...' : 'Save Settings'}
        </Button>
      </div>
    </div>
  );
};

export default NotificationSettings;
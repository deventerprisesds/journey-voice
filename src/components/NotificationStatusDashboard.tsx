import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { 
  RefreshCw, 
  CheckCircle, 
  XCircle, 
  Clock, 
  ChevronDown, 
  ChevronRight,
  Mail,
  MessageSquare,
  Calendar,
  Bell,
  RotateCcw,
  Send,
  AlertTriangle
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { format, formatDistanceToNow } from 'date-fns';

interface ScheduledNotification {
  id: string;
  title: string;
  body: string;
  notification_type: string;
  scheduled_for: string;
  delivered_at: string | null;
  failed_at: string | null;
  failure_reason: string | null;
  created_at: string;
  task_id: string | null;
}

type StatusFilter = 'all' | 'delivered' | 'failed' | 'pending';

const NotificationStatusDashboard: React.FC = () => {
  const [notifications, setNotifications] = useState<ScheduledNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [testingChannel, setTestingChannel] = useState<string | null>(null);
  
  const { user } = useAuth();
  const { toast } = useToast();

  const fetchNotifications = useCallback(async () => {
    if (!user?.id) return;
    
    try {
      const { data, error } = await supabase
        .from('scheduled_notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setNotifications(data || []);
    } catch (error) {
      console.error('Error fetching notifications:', error);
      toast({
        title: 'Error',
        description: 'Failed to fetch notification history',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id, toast]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  useEffect(() => {
    if (!autoRefresh) return;
    
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchNotifications]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchNotifications();
  };

  const getStatus = (notification: ScheduledNotification): 'delivered' | 'failed' | 'pending' => {
    if (notification.delivered_at) return 'delivered';
    if (notification.failed_at) return 'failed';
    return 'pending';
  };

  const filteredNotifications = notifications.filter(n => {
    if (statusFilter === 'all') return true;
    return getStatus(n) === statusFilter;
  });

  const toggleExpanded = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const retryNotification = async (notification: ScheduledNotification) => {
    try {
      const { data: profileData } = await supabase
        .from('profiles')
        .select('email, phone')
        .eq('user_id', user?.id)
        .maybeSingle();

      const { data: prefsData } = await supabase
        .from('notification_prefs')
        .select('channels')
        .eq('user_id', user?.id)
        .maybeSingle();

      const { data, error } = await supabase.functions.invoke('send-unified-notification', {
        body: {
          userId: user?.id,
          title: notification.title,
          body: notification.body,
          channels: prefsData?.channels || ['EMAIL'],
          notificationId: notification.id,
          data: { type: notification.notification_type, taskId: notification.task_id },
          userProfile: profileData || {}
        }
      });

      if (error) throw error;

      toast({
        title: 'Notification Retried',
        description: data?.success 
          ? 'Notification sent successfully' 
          : `Partial success: ${data?.errors?.join(', ') || 'Check details'}`
      });

      fetchNotifications();
    } catch (error) {
      console.error('Error retrying notification:', error);
      toast({
        title: 'Retry Failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive'
      });
    }
  };

  const sendDirectTest = async (channel: 'email' | 'slack') => {
    setTestingChannel(channel);
    try {
      const { data: profileData } = await supabase
        .from('profiles')
        .select('email, phone')
        .eq('user_id', user?.id)
        .maybeSingle();

      const slackWebhook = localStorage.getItem('slack-webhook-url');

      const payload: any = {
        userId: user?.id,
        title: `🧪 Direct ${channel.toUpperCase()} Test`,
        body: `This is a direct test of the ${channel} channel at ${new Date().toLocaleTimeString()}`,
        channels: [channel.toUpperCase()],
        data: { type: 'direct_test' },
        userProfile: profileData || {}
      };

      if (channel === 'slack' && slackWebhook) {
        payload.slackWebhook = slackWebhook;
      }

      const { data, error } = await supabase.functions.invoke('send-unified-notification', {
        body: payload
      });

      if (error) throw error;

      const channelResult = data?.channelResults?.[channel];
      
      if (channelResult?.success) {
        toast({
          title: `${channel.toUpperCase()} Test Sent`,
          description: channelResult.details || 'Check your n8n workflow for delivery status'
        });
      } else if (data?.errors?.length > 0) {
        toast({
          title: `${channel.toUpperCase()} Test Issue`,
          description: data.errors.join(', '),
          variant: 'destructive'
        });
      } else {
        toast({
          title: `${channel.toUpperCase()} Test Queued`,
          description: 'Notification sent to webhook - check n8n for final status'
        });
      }

      fetchNotifications();
    } catch (error) {
      console.error(`Error sending direct ${channel} test:`, error);
      toast({
        title: 'Test Failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive'
      });
    } finally {
      setTestingChannel(null);
    }
  };

  const StatusBadge = ({ status }: { status: 'delivered' | 'failed' | 'pending' }) => {
    switch (status) {
      case 'delivered':
        return (
          <Badge variant="default" className="bg-green-500/20 text-green-600 border-green-500/30">
            <CheckCircle className="h-3 w-3 mr-1" />
            Delivered
          </Badge>
        );
      case 'failed':
        return (
          <Badge variant="destructive" className="bg-red-500/20 text-red-600 border-red-500/30">
            <XCircle className="h-3 w-3 mr-1" />
            Failed
          </Badge>
        );
      case 'pending':
        return (
          <Badge variant="secondary" className="bg-yellow-500/20 text-yellow-600 border-yellow-500/30">
            <Clock className="h-3 w-3 mr-1" />
            Pending
          </Badge>
        );
    }
  };

  const TypeIcon = ({ type }: { type: string }) => {
    switch (type.toLowerCase()) {
      case 'email':
        return <Mail className="h-4 w-4" />;
      case 'slack':
        return <MessageSquare className="h-4 w-4" />;
      case 'outlook_event':
      case 'google_event':
        return <Calendar className="h-4 w-4" />;
      default:
        return <Bell className="h-4 w-4" />;
    }
  };

  const stats = {
    total: notifications.length,
    delivered: notifications.filter(n => n.delivered_at).length,
    failed: notifications.filter(n => n.failed_at).length,
    pending: notifications.filter(n => !n.delivered_at && !n.failed_at).length
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Notification Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              Notification Status Dashboard
            </CardTitle>
            <CardDescription>
              View notification delivery status and test channels directly
            </CardDescription>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch
                id="auto-refresh"
                checked={autoRefresh}
                onCheckedChange={setAutoRefresh}
              />
              <Label htmlFor="auto-refresh" className="text-sm">Auto-refresh</Label>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-4 gap-4">
          <div className="text-center p-3 rounded-lg bg-muted/50">
            <div className="text-2xl font-bold">{stats.total}</div>
            <div className="text-xs text-muted-foreground">Total</div>
          </div>
          <div className="text-center p-3 rounded-lg bg-green-500/10">
            <div className="text-2xl font-bold text-green-600">{stats.delivered}</div>
            <div className="text-xs text-muted-foreground">Delivered</div>
          </div>
          <div className="text-center p-3 rounded-lg bg-red-500/10">
            <div className="text-2xl font-bold text-red-600">{stats.failed}</div>
            <div className="text-xs text-muted-foreground">Failed</div>
          </div>
          <div className="text-center p-3 rounded-lg bg-yellow-500/10">
            <div className="text-2xl font-bold text-yellow-600">{stats.pending}</div>
            <div className="text-xs text-muted-foreground">Pending</div>
          </div>
        </div>

        <Separator />

        {/* Direct Test Actions */}
        <div>
          <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
            <Send className="h-4 w-4" />
            Direct Channel Tests
          </h3>
          <p className="text-xs text-muted-foreground mb-3">
            Send test notifications through your n8n webhook to verify channel delivery
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => sendDirectTest('email')}
              disabled={testingChannel !== null}
            >
              <Mail className="h-4 w-4 mr-2" />
              {testingChannel === 'email' ? 'Sending...' : 'Test Email'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => sendDirectTest('slack')}
              disabled={testingChannel !== null}
            >
              <MessageSquare className="h-4 w-4 mr-2" />
              {testingChannel === 'slack' ? 'Sending...' : 'Test Slack'}
            </Button>
          </div>
        </div>

        <Separator />

        {/* Filter Tabs */}
        <div className="flex gap-2">
          {(['all', 'delivered', 'failed', 'pending'] as StatusFilter[]).map(filter => (
            <Button
              key={filter}
              variant={statusFilter === filter ? 'default' : 'outline'}
              size="sm"
              onClick={() => setStatusFilter(filter)}
              className="capitalize"
            >
              {filter}
              {filter !== 'all' && (
                <span className="ml-1 text-xs">
                  ({filter === 'delivered' ? stats.delivered : filter === 'failed' ? stats.failed : stats.pending})
                </span>
              )}
            </Button>
          ))}
        </div>

        {/* Notification List */}
        <ScrollArea className="h-[400px]">
          <div className="space-y-2">
            {filteredNotifications.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Bell className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No notifications found</p>
              </div>
            ) : (
              filteredNotifications.map(notification => {
                const status = getStatus(notification);
                const isExpanded = expandedIds.has(notification.id);
                
                return (
                  <Collapsible
                    key={notification.id}
                    open={isExpanded}
                    onOpenChange={() => toggleExpanded(notification.id)}
                  >
                    <div className={`border rounded-lg p-3 ${
                      status === 'failed' ? 'border-red-500/30 bg-red-500/5' : ''
                    }`}>
                      <CollapsibleTrigger asChild>
                        <div className="flex items-center justify-between cursor-pointer">
                          <div className="flex items-center gap-3">
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            )}
                            <TypeIcon type={notification.notification_type} />
                            <div>
                              <div className="font-medium text-sm">{notification.title}</div>
                              <div className="text-xs text-muted-foreground">
                                {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <StatusBadge status={status} />
                            {status === 'failed' && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  retryNotification(notification);
                                }}
                              >
                                <RotateCcw className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                      </CollapsibleTrigger>
                      
                      <CollapsibleContent className="pt-3">
                        <div className="pl-7 space-y-2 text-sm">
                          <div>
                            <span className="text-muted-foreground">Body:</span>
                            <p className="text-foreground">{notification.body}</p>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <span className="text-muted-foreground">Type:</span>{' '}
                              <Badge variant="outline" className="ml-1">{notification.notification_type}</Badge>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Scheduled:</span>{' '}
                              {format(new Date(notification.scheduled_for), 'PPp')}
                            </div>
                            {notification.delivered_at && (
                              <div>
                                <span className="text-muted-foreground">Delivered:</span>{' '}
                                {format(new Date(notification.delivered_at), 'PPp')}
                              </div>
                            )}
                            {notification.task_id && (
                              <div>
                                <span className="text-muted-foreground">Task ID:</span>{' '}
                                <code className="text-xs">{notification.task_id.substring(0, 8)}...</code>
                              </div>
                            )}
                          </div>
                          {notification.failure_reason && (
                            <div className="mt-2 p-2 rounded bg-red-500/10 border border-red-500/20">
                              <div className="flex items-center gap-2 text-red-600 font-medium text-xs">
                                <AlertTriangle className="h-3 w-3" />
                                Error Details
                              </div>
                              <p className="text-xs text-red-500 mt-1">{notification.failure_reason}</p>
                            </div>
                          )}
                        </div>
                      </CollapsibleContent>
                    </div>
                  </Collapsible>
                );
              })
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
};

export default NotificationStatusDashboard;

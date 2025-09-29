import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Bell, Clock, Trash2, RefreshCw } from 'lucide-react';
import { formatDateOnly, toLocalTimeHHMM } from '@/lib/date';

interface ScheduledNotification {
  id: string;
  notification_type: string;
  title: string;
  body: string;
  scheduled_for: string;
  task_id?: string;
  delivered_at?: string;
  failed_at?: string;
}

const UpcomingReminders: React.FC = () => {
  const [reminders, setReminders] = useState<ScheduledNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchReminders = async () => {
    try {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) return;

      const { data, error } = await supabase
        .from('scheduled_notifications')
        .select('*')
        .eq('user_id', user.user.id)
        .is('delivered_at', null)
        .is('failed_at', null)
        .gte('scheduled_for', new Date().toISOString())
        .order('scheduled_for', { ascending: true })
        .limit(10);

      if (error) throw error;
      setReminders(data || []);
    } catch (error) {
      console.error('Error fetching reminders:', error);
      toast({
        title: "Error",
        description: "Failed to fetch upcoming reminders",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const deleteReminder = async (id: string) => {
    try {
      const { error } = await supabase
        .from('scheduled_notifications')
        .delete()
        .eq('id', id);

      if (error) throw error;
      
      setReminders(prev => prev.filter(r => r.id !== id));
      toast({
        title: "Reminder Deleted",
        description: "The reminder has been cancelled"
      });
    } catch (error) {
      console.error('Error deleting reminder:', error);
      toast({
        title: "Error",
        description: "Failed to delete reminder",
        variant: "destructive"
      });
    }
  };

  useEffect(() => {
    fetchReminders();
  }, []);

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'scheduled_reminder': return 'bg-blue-100 text-blue-800';
      case 'scheduled_start_now': return 'bg-green-100 text-green-800';
      case 'due_reminder_15min': return 'bg-orange-100 text-orange-800';
      case 'due_reminder_now': return 'bg-red-100 text-red-800';
      case 'due_reminder_1day': return 'bg-yellow-100 text-yellow-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'scheduled_reminder': return '15min Before';
      case 'scheduled_start_now': return 'Start Time';
      case 'due_reminder_15min': return 'Due Soon';
      case 'due_reminder_now': return 'Due Now';
      case 'due_reminder_1day': return 'Due Tomorrow';
      default: return type;
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Upcoming Reminders
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
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-5 w-5" />
          Upcoming Reminders
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchReminders}
            className="ml-auto"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {reminders.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Bell className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No upcoming reminders</p>
            <p className="text-sm">Create tasks with due dates or start times to see reminders here</p>
          </div>
        ) : (
          <div className="space-y-3">
            {reminders.map((reminder) => (
              <div
                key={reminder.id}
                className="flex items-start justify-between p-3 border rounded-lg"
              >
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge className={getTypeColor(reminder.notification_type)}>
                      {getTypeLabel(reminder.notification_type)}
                    </Badge>
                    <div className="flex items-center gap-1 text-sm text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {formatDateOnly(reminder.scheduled_for)} at {toLocalTimeHHMM(reminder.scheduled_for)}
                    </div>
                  </div>
                  <h4 className="font-medium">{reminder.title}</h4>
                  <p className="text-sm text-muted-foreground">{reminder.body}</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => deleteReminder(reminder.id)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default UpcomingReminders;
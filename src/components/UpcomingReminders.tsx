import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { formatDateOnly, toLocalTimeHHMM } from '@/lib/date';
import { Clock, Bell, Trash2 } from 'lucide-react';

interface ScheduledNotification {
  id: string;
  title: string;
  body: string;
  notification_type: string;
  scheduled_for: string;
  task_id?: string;
  delivered_at?: string;
  failed_at?: string;
}

const UpcomingReminders: React.FC = () => {
  const [reminders, setReminders] = useState<ScheduledNotification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  const fetchReminders = async () => {
    try {
      const { data, error } = await supabase
        .from('scheduled_notifications')
        .select('*')
        .gte('scheduled_for', new Date().toISOString())
        .is('delivered_at', null)
        .is('failed_at', null)
        .order('scheduled_for', { ascending: true })
        .limit(10);

      if (error) throw error;
      setReminders(data || []);
    } catch (error) {
      console.error('Error fetching reminders:', error);
      toast({
        title: "Error",
        description: "Failed to fetch reminders",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
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
        description: "The reminder has been cancelled",
      });
    } catch (error) {
      console.error('Error deleting reminder:', error);
      toast({
        title: "Error",
        description: "Failed to delete reminder",
        variant: "destructive",
      });
    }
  };

  const triggerImmediateDelivery = async () => {
    try {
      await supabase.functions.invoke('notification-delivery', {
        body: { immediate: true }
      });
      
      toast({
        title: "Delivery Triggered",
        description: "Processing any due notifications now",
      });
      
      // Refresh reminders to see if any were delivered
      setTimeout(fetchReminders, 1000);
    } catch (error) {
      console.error('Error triggering delivery:', error);
      toast({
        title: "Error", 
        description: "Failed to trigger notification delivery",
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    fetchReminders();
  }, []);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Upcoming Reminders
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Loading reminders...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-5 w-5" />
          Upcoming Reminders ({reminders.length})
        </CardTitle>
        <div className="flex gap-2">
          <Button onClick={fetchReminders} variant="outline" size="sm">
            Refresh
          </Button>
          <Button onClick={triggerImmediateDelivery} variant="outline" size="sm">
            <Clock className="h-4 w-4 mr-1" />
            Process Now
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {reminders.length === 0 ? (
          <p className="text-muted-foreground">No upcoming reminders scheduled</p>
        ) : (
          <div className="space-y-3">
            {reminders.map((reminder) => (
              <div key={reminder.id} className="border rounded-lg p-3 space-y-2">
                <div className="flex items-start justify-between">
                  <div className="flex-1 space-y-1">
                    <p className="font-medium text-sm">{reminder.title}</p>
                    <p className="text-xs text-muted-foreground">{reminder.body}</p>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>
                        {formatDateOnly(reminder.scheduled_for)} at {toLocalTimeHHMM(reminder.scheduled_for)}
                      </span>
                      <span className="px-1.5 py-0.5 bg-secondary rounded text-xs">
                        {reminder.notification_type}
                      </span>
                    </div>
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
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default UpcomingReminders;
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Trash2, RefreshCw, Clock, Merge, Pause, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

interface ScheduledNotification {
  id: string;
  notification_type: string;
  title: string;
  body: string;
  scheduled_for: string;
  task_id?: string;
  delivered_at?: string;
  failed_at?: string;
  queued_during_quiet?: boolean;
  original_scheduled_for?: string;
  user_id: string;
}

const UpcomingReminders = () => {
  const [reminders, setReminders] = useState<ScheduledNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const { toast } = useToast();

  const fetchReminders = async () => {
    setLoading(true);
    try {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) return;

      const { data, error } = await supabase
        .from('scheduled_notifications')
        .select('*')
        .eq('user_id', user.user.id)
        .is('delivered_at', null)
        .is('failed_at', null)
        .order('scheduled_for', { ascending: true });

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

      setReminders(reminders.filter(reminder => reminder.id !== id));
      setSelectedIds(selectedIds.filter(selectedId => selectedId !== id));
      toast({
        title: "Success",
        description: "Reminder cancelled successfully",
      });
    } catch (error) {
      console.error('Error deleting reminder:', error);
      toast({
        title: "Error",
        description: "Failed to cancel reminder",
        variant: "destructive",
      });
    }
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(reminders.map(r => r.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelectReminder = (id: string, checked: boolean) => {
    if (checked) {
      setSelectedIds([...selectedIds, id]);
    } else {
      setSelectedIds(selectedIds.filter(selectedId => selectedId !== id));
    }
  };

  const cancelSelected = async () => {
    setBulkActionLoading(true);
    try {
      const { error } = await supabase
        .from('scheduled_notifications')
        .delete()
        .in('id', selectedIds);

      if (error) throw error;

      setReminders(reminders.filter(reminder => !selectedIds.includes(reminder.id)));
      setSelectedIds([]);
      toast({
        title: "Success",
        description: `Cancelled ${selectedIds.length} reminders`,
      });
    } catch (error) {
      console.error('Error cancelling reminders:', error);
      toast({
        title: "Error",
        description: "Failed to cancel selected reminders",
        variant: "destructive",
      });
    } finally {
      setBulkActionLoading(false);
    }
  };

  const snoozeToQuietEnd = async () => {
    setBulkActionLoading(true);
    try {
      // Get user's quiet hours end (default 8 AM tomorrow)
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(8, 0, 0, 0);

      const selectedReminders = reminders.filter(r => selectedIds.includes(r.id));
      
      // Update each reminder individually to handle the original_scheduled_for logic
      for (const reminder of selectedReminders) {
        const { error } = await supabase
          .from('scheduled_notifications')
          .update({
            scheduled_for: tomorrow.toISOString(),
            queued_during_quiet: true,
            original_scheduled_for: reminder.original_scheduled_for || reminder.scheduled_for
          })
          .eq('id', reminder.id);
        
        if (error) throw error;
      }

      await fetchReminders();
      setSelectedIds([]);
      toast({
        title: "Success",
        description: `Snoozed ${selectedIds.length} reminders to 8 AM tomorrow`,
      });
    } catch (error) {
      console.error('Error snoozing reminders:', error);
      toast({
        title: "Error",
        description: "Failed to snooze selected reminders",
        variant: "destructive",
      });
    } finally {
      setBulkActionLoading(false);
    }
  };

  const mergeNow = async () => {
    setBulkActionLoading(true);
    try {
      const selectedReminders = reminders.filter(r => selectedIds.includes(r.id));
      
      if (selectedReminders.length < 2) {
        toast({
          title: "Error",
          description: "Select at least 2 reminders to merge",
          variant: "destructive",
        });
        setBulkActionLoading(false);
        return;
      }

      // Create a merged notification
      const mergedNotification = {
        user_id: selectedReminders[0].user_id,
        notification_type: 'merged_reminders',
        title: `${selectedReminders.length} Merged Reminders`,
        body: '• ' + selectedReminders.map(r => r.body).join('\n• '),
        scheduled_for: new Date().toISOString()
      };

      const { error: insertError } = await supabase
        .from('scheduled_notifications')
        .insert(mergedNotification);

      if (insertError) throw insertError;

      // Mark originals as delivered
      const { error: updateError } = await supabase
        .from('scheduled_notifications')
        .update({ delivered_at: new Date().toISOString() })
        .in('id', selectedIds);

      if (updateError) throw updateError;

      await fetchReminders();
      setSelectedIds([]);
      toast({
        title: "Success",
        description: `Merged ${selectedReminders.length} reminders and scheduled for immediate delivery`,
      });
    } catch (error) {
      console.error('Error merging reminders:', error);
      toast({
        title: "Error",
        description: "Failed to merge selected reminders",
        variant: "destructive",
      });
    } finally {
      setBulkActionLoading(false);
    }
  };

  const cancelAll = async () => {
    setBulkActionLoading(true);
    try {
      const { error } = await supabase
        .from('scheduled_notifications')
        .delete()
        .is('delivered_at', null)
        .is('failed_at', null);

      if (error) throw error;

      setReminders([]);
      setSelectedIds([]);
      toast({
        title: "Success",
        description: "All pending reminders cancelled",
      });
    } catch (error) {
      console.error('Error cancelling all reminders:', error);
      toast({
        title: "Error",
        description: "Failed to cancel all reminders",
        variant: "destructive",
      });
    } finally {
      setBulkActionLoading(false);
    }
  };

  useEffect(() => {
    fetchReminders();
  }, []);

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'scheduled_reminder':
        return { variant: 'default', className: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100' };
      case 'scheduled_start_now':
        return { variant: 'default', className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100' };
      case 'due_reminder':
        return { variant: 'default', className: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-100' };
      case 'due_today':
        return { variant: 'default', className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100' };
      case 'overdue_reminder':
        return { variant: 'destructive', className: '' };
      default:
        return { variant: 'secondary', className: '' };
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'scheduled_reminder': return 'Starting Soon';
      case 'scheduled_start_now': return 'Start Time';
      case 'due_reminder': return 'Due Tomorrow';
      case 'due_today': return 'Due Today';
      case 'overdue_reminder': return 'Overdue';
      case 'daily_digest': return 'Daily Summary';
      case 'weekly_digest': return 'Weekly Summary';
      default: return type.replace(/_/g, ' ');
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
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
        <div className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Upcoming Reminders ({reminders.length})
            </CardTitle>
            <CardDescription>
              Manage your scheduled task reminders
            </CardDescription>
          </div>
          <Button onClick={fetchReminders} variant="outline" size="sm" disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
        
        {reminders.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-4 border-t">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="select-all"
                checked={selectedIds.length === reminders.length}
                onCheckedChange={handleSelectAll}
              />
              <label htmlFor="select-all" className="text-sm font-medium">
                Select All ({selectedIds.length})
              </label>
            </div>
            
            {selectedIds.length > 0 && (
              <>
                <Button 
                  onClick={cancelSelected} 
                  variant="destructive" 
                  size="sm" 
                  disabled={bulkActionLoading}
                >
                  <X className="h-4 w-4 mr-1" />
                  Cancel Selected
                </Button>
                <Button 
                  onClick={snoozeToQuietEnd} 
                  variant="outline" 
                  size="sm" 
                  disabled={bulkActionLoading}
                >
                  <Pause className="h-4 w-4 mr-1" />
                  Snooze to 8 AM
                </Button>
                <Button 
                  onClick={mergeNow} 
                  variant="outline" 
                  size="sm" 
                  disabled={bulkActionLoading || selectedIds.length < 2}
                >
                  <Merge className="h-4 w-4 mr-1" />
                  Merge Now
                </Button>
              </>
            )}
            
            <Button 
              onClick={cancelAll} 
              variant="destructive" 
              size="sm" 
              disabled={bulkActionLoading}
              className="ml-auto"
            >
              Cancel All Pending
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {reminders.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Clock className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No upcoming reminders</p>
            <p className="text-sm">Create tasks with due dates or start times to see reminders here</p>
          </div>
        ) : (
          <div className="space-y-3">
            {reminders.map((reminder) => (
              <div key={reminder.id} className="flex items-center justify-between p-4 border rounded-lg bg-muted/50">
                <div className="flex items-center gap-3">
                  <Checkbox
                    id={`reminder-${reminder.id}`}
                    checked={selectedIds.includes(reminder.id)}
                    onCheckedChange={(checked) => handleSelectReminder(reminder.id, checked as boolean)}
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant={getTypeColor(reminder.notification_type).variant as any}>
                        {getTypeLabel(reminder.notification_type)}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        {format(new Date(reminder.scheduled_for), 'MMM d, yyyy h:mm a')}
                      </span>
                      {reminder.queued_during_quiet && (
                        <Badge variant="secondary" className="text-xs">
                          Quiet Hours
                        </Badge>
                      )}
                    </div>
                    <h4 className="font-medium">{reminder.title}</h4>
                    <p className="text-sm text-muted-foreground mt-1">{reminder.body}</p>
                  </div>
                </div>
                <Button
                  onClick={() => deleteReminder(reminder.id)}
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
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
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Clock, Play, RefreshCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface CronLog {
  timestamp: string;
  type: 'scheduler' | 'delivery';
  status: 'success' | 'error';
  message: string;
}

const CronJobTesting: React.FC = () => {
  const [isRunningScheduler, setIsRunningScheduler] = useState(false);
  const [isRunningDelivery, setIsRunningDelivery] = useState(false);
  const [logs, setLogs] = useState<CronLog[]>([]);
  const { toast } = useToast();

  const addLog = (type: 'scheduler' | 'delivery', status: 'success' | 'error', message: string) => {
    const newLog: CronLog = {
      timestamp: new Date().toLocaleTimeString(),
      type,
      status,
      message
    };
    setLogs(prev => [newLog, ...prev].slice(0, 10)); // Keep only last 10 logs
  };

  const runNotificationScheduler = async () => {
    setIsRunningScheduler(true);
    try {
      const { data, error } = await supabase.functions.invoke('notification-scheduler', {
        body: { trigger: 'manual_test' }
      });

      if (error) {
        addLog('scheduler', 'error', `Failed: ${error.message}`);
        toast({
          title: "Scheduler Test Failed",
          description: error.message,
          variant: "destructive",
        });
      } else {
        addLog('scheduler', 'success', `Processed ${data?.processed || 0} users, scheduled ${data?.scheduled || 0} notifications`);
        toast({
          title: "Scheduler Test Complete",
          description: `Processed ${data?.processed || 0} users and scheduled ${data?.scheduled || 0} notifications`,
        });
      }
    } catch (error: any) {
      addLog('scheduler', 'error', `Error: ${error.message}`);
      toast({
        title: "Scheduler Test Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsRunningScheduler(false);
    }
  };

  const runNotificationDelivery = async () => {
    setIsRunningDelivery(true);
    try {
      const { data, error } = await supabase.functions.invoke('notification-delivery', {
        body: { trigger: 'manual_test' }
      });

      if (error) {
        addLog('delivery', 'error', `Failed: ${error.message}`);
        toast({
          title: "Delivery Test Failed",
          description: error.message,
          variant: "destructive",
        });
      } else {
        addLog('delivery', 'success', `Processed ${data?.processed || 0} notifications, delivered ${data?.delivered || 0}, failed ${data?.failed || 0}`);
        toast({
          title: "Delivery Test Complete",
          description: `Processed ${data?.processed || 0} notifications. Delivered: ${data?.delivered || 0}, Failed: ${data?.failed || 0}`,
        });
      }
    } catch (error: any) {
      addLog('delivery', 'error', `Error: ${error.message}`);
      toast({
        title: "Delivery Test Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsRunningDelivery(false);
    }
  };

  const testCronSetup = async () => {
    try {
      // Check if cron jobs are scheduled
      const { data, error } = await supabase
        .from('scheduled_notifications')
        .select('id, scheduled_for, delivered_at, failed_at')
        .limit(5);

      if (error) {
        toast({
          title: "Database Connection Failed",
          description: error.message,
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Cron Setup Test",
        description: `Found ${data?.length || 0} recent notifications in the database`,
      });
    } catch (error: any) {
      toast({
        title: "Cron Setup Test Failed",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5" />
          Cron Job Testing
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertDescription>
            Test the notification scheduler and delivery systems manually. These normally run automatically via cron jobs.
          </AlertDescription>
        </Alert>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Button
            onClick={runNotificationScheduler}
            disabled={isRunningScheduler}
            variant="outline"
            className="w-full"
          >
            {isRunningScheduler ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Running Scheduler...
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                Run Notification Scheduler
              </>
            )}
          </Button>

          <Button
            onClick={runNotificationDelivery}
            disabled={isRunningDelivery}
            variant="outline"
            className="w-full"
          >
            {isRunningDelivery ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Running Delivery...
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                Run Notification Delivery
              </>
            )}
          </Button>

          <Button
            onClick={testCronSetup}
            variant="outline"
            className="w-full"
          >
            <Clock className="h-4 w-4 mr-2" />
            Test Cron Setup
          </Button>
        </div>

        {logs.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Recent Test Results</h4>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {logs.map((log, index) => (
                <div key={index} className="flex items-center gap-2 text-sm p-2 bg-muted rounded">
                  <Badge variant={log.status === 'success' ? 'default' : 'destructive'}>
                    {log.type}
                  </Badge>
                  <span className="text-muted-foreground text-xs">{log.timestamp}</span>
                  <span className="flex-1">{log.message}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default CronJobTesting;
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { RefreshCw, CheckCircle2, AlertCircle, FileSpreadsheet } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { createTasksFromAssignments, createTasksFromMitAssignments } from '@/utils/assignmentSync';

interface SyncConfig {
  id: string;
  user_id: string;
  service_type: string;
  config_data: any; // JSON field from database
  created_at: string;
  updated_at: string;
}

interface SyncLog {
  id: string;
  user_id: string;
  service_type: string;
  sync_type: string;
  status: string; // Can be 'success', 'failed', 'in_progress'
  started_at: string;
  completed_at?: string;
  records_processed?: number;
  records_added?: number;
  records_updated?: number;
  error_message?: string;
}

export function AssignmentSyncSettings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [syncConfigs, setSyncConfigs] = useState<SyncConfig[]>([]);
  const [isSyncingEmba, setIsSyncingEmba] = useState(false);
  const [isSyncingMit, setIsSyncingMit] = useState(false);
  const [lastSyncLogs, setLastSyncLogs] = useState<SyncLog[]>([]);
  const [embaSheetUrl, setEmbaSheetUrl] = useState('');
  const [mitSheetUrl, setMitSheetUrl] = useState('https://docs.google.com/spreadsheets/d/1P6NyWVhxuuNUu-7dN7KX3GDuVddYWNLOLQ4QCEVcNlc/edit?gid=1544435511#gid=1544435511');

  useEffect(() => {
    if (user) {
      loadSyncConfigs();
      loadSyncLogs();
    }
  }, [user]);

  const loadSyncConfigs = async () => {
    if (!user) return;

    const { data, error } = await supabase
      .from('sync_config')
      .select('*')
      .eq('user_id', user.id)
      .eq('service_type', 'google_sheets');

    if (error) {
      console.error('Error loading sync configs:', error);
      return;
    }

    setSyncConfigs(data as SyncConfig[] || []);
    
    // Populate input fields from existing configs
    const embaConfig = data?.find((c: any) => (c.config_data as any)?.sheet_type === 'emba');
    const mitConfig = data?.find((c: any) => (c.config_data as any)?.sheet_type === 'mit');
    
    if (embaConfig && (embaConfig.config_data as any)?.sheet_url) {
      setEmbaSheetUrl((embaConfig.config_data as any).sheet_url);
    }
    if (mitConfig && (mitConfig.config_data as any)?.sheet_url) {
      setMitSheetUrl((mitConfig.config_data as any).sheet_url);
    }
  };

  const loadSyncLogs = async () => {
    if (!user) return;

    const { data, error } = await supabase
      .from('sync_logs')
      .select('*')
      .eq('user_id', user.id)
      .in('service_type', ['google_sheets', 'mit_sheets'])
      .order('started_at', { ascending: false })
      .limit(5);

    if (error) {
      console.error('Error loading sync logs:', error);
      return;
    }

    setLastSyncLogs(data as SyncLog[] || []);
  };

  const saveSheetUrl = async (sheetType: 'emba' | 'mit', url: string) => {
    if (!user || !url.trim()) return;

    const existing = syncConfigs.find(c => c.config_data?.sheet_type === sheetType);

    try {
      if (existing) {
        await supabase
          .from('sync_config')
          .update({
            config_data: { ...existing.config_data, sheet_url: url, sheet_type: sheetType },
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id);
      } else {
        await supabase
          .from('sync_config')
          .insert({
            user_id: user.id,
            service_type: 'google_sheets',
            config_data: { sheet_type: sheetType, sheet_url: url }
          });
      }

      await loadSyncConfigs();
      toast({
        title: "Sheet URL Saved",
        description: `${sheetType.toUpperCase()} sheet URL has been saved.`
      });
    } catch (error: any) {
      toast({
        title: "Save Failed",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const handleSyncEmba = async () => {
    if (!user) return;

    setIsSyncingEmba(true);
    try {
      const { data, error } = await supabase.functions.invoke('sync-google-sheets', {
        body: {}
      });

      if (error) throw error;

      toast({
        title: "EMBA Sync Complete",
        description: `Processed: ${data?.processed || 0} | Added: ${data?.added || 0} | Updated: ${data?.updated || 0}`
      });

      await loadSyncLogs();

      if (data?.assignmentIds && data.assignmentIds.length > 0) {
        await createTasksFromAssignments(data.assignmentIds, user.id);
        toast({
          title: "EMBA Tasks Created",
          description: `${data.assignmentIds.length} assignments converted to tasks.`
        });
      }

    } catch (error: any) {
      console.error('EMBA sync error:', error);
      toast({
        title: "EMBA Sync Failed",
        description: error.message || 'Failed to sync EMBA assignments',
        variant: "destructive"
      });
    } finally {
      setIsSyncingEmba(false);
    }
  };

  const handleSyncMit = async () => {
    if (!user) return;

    setIsSyncingMit(true);
    try {
      const { data, error } = await supabase.functions.invoke('sync-mit-sheets', {
        body: {}
      });

      if (error) throw error;

      toast({
        title: "MIT Sync Complete",
        description: `Processed: ${data?.processed || 0} | Added: ${data?.added || 0} | Updated: ${data?.updated || 0}`
      });

      await loadSyncLogs();

      if (data?.assignmentIds && data.assignmentIds.length > 0) {
        await createTasksFromMitAssignments(data.assignmentIds, user.id);
        toast({
          title: "MIT Tasks Created",
          description: `${data.assignmentIds.length} assignments converted to tasks.`
        });
      }

    } catch (error: any) {
      console.error('MIT sync error:', error);
      toast({
        title: "MIT Sync Failed",
        description: error.message || 'Failed to sync MIT assignments',
        variant: "destructive"
      });
    } finally {
      setIsSyncingMit(false);
    }
  };

  const hasValidConfig = syncConfigs.length > 0 && 
    syncConfigs.some(c => c.config_data?.sheet_url);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5" />
          <CardTitle>Assignment Import</CardTitle>
        </div>
        <CardDescription>
          Sync assignments from your EMBA and MIT Google Sheets
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* EMBA Sheet Config */}
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="emba-sheet">EMBA Assignments Sheet URL</Label>
            <div className="flex gap-2">
              <Input
                id="emba-sheet"
                value={embaSheetUrl}
                onChange={(e) => setEmbaSheetUrl(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/..."
              />
              <Button
                onClick={() => saveSheetUrl('emba', embaSheetUrl)}
                disabled={!embaSheetUrl.trim()}
                size="sm"
              >
                Save
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Imports assignments until next course weekend from class schedule
            </p>
          </div>
        </div>

        <Separator />

        {/* MIT Sheet Config */}
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="mit-sheet">MIT Assignments Sheet URL</Label>
            <div className="flex gap-2">
              <Input
                id="mit-sheet"
                value={mitSheetUrl}
                onChange={(e) => setMitSheetUrl(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/..."
              />
              <Button
                onClick={() => saveSheetUrl('mit', mitSheetUrl)}
                disabled={!mitSheetUrl.trim()}
                size="sm"
              >
                Save
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Imports assignments for next 2 weeks
            </p>
          </div>
        </div>

        <Separator />

        {/* Sync Buttons */}
        <div className="grid grid-cols-2 gap-3">
          <Button 
            onClick={handleSyncEmba}
            disabled={isSyncingEmba || !embaSheetUrl.trim()}
            variant="default"
          >
            <RefreshCw className={cn("h-4 w-4 mr-2", isSyncingEmba && "animate-spin")} />
            {isSyncingEmba ? 'Syncing...' : 'Sync EMBA'}
          </Button>

          <Button 
            onClick={handleSyncMit}
            disabled={isSyncingMit || !mitSheetUrl.trim()}
            variant="secondary"
          >
            <RefreshCw className={cn("h-4 w-4 mr-2", isSyncingMit && "animate-spin")} />
            {isSyncingMit ? 'Syncing...' : 'Sync MIT'}
          </Button>
        </div>

        {!hasValidConfig && (
          <div className="flex items-start gap-2 p-3 bg-muted rounded-lg text-sm">
            <AlertCircle className="h-4 w-4 text-muted-foreground mt-0.5" />
            <p className="text-muted-foreground">
              Please save at least one sheet URL before syncing.
            </p>
          </div>
        )}

        {/* Recent Sync Logs */}
        {lastSyncLogs.length > 0 && (
          <div className="space-y-3">
            <h4 className="text-sm font-medium">Recent Syncs</h4>
            <div className="space-y-2">
              {lastSyncLogs.map(log => (
                <div key={log.id} className="p-3 bg-muted rounded-lg text-sm space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {log.status === 'success' ? (
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                      ) : (
                        <AlertCircle className="h-4 w-4 text-destructive" />
                      )}
                      <span className="font-medium">{log.sync_type}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(log.started_at), { addSuffix: true })}
                    </span>
                  </div>
                  {log.status === 'success' && (
                    <div className="text-xs text-muted-foreground">
                      Processed: {log.records_processed} | Added: {log.records_added} | Updated: {log.records_updated}
                    </div>
                  )}
                  {log.error_message && (
                    <div className="text-xs text-destructive">{log.error_message}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

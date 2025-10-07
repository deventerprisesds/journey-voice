import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { RefreshCw, CheckCircle2, AlertCircle, FileSpreadsheet, Bug, ChevronDown } from 'lucide-react';
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

// Demo user ID for preview mode
const DEMO_USER_ID = '00000000-0000-0000-0000-000000000001';

export function AssignmentSyncSettings() {
  const { user, isDemoMode } = useAuth();
  const { toast } = useToast();
  const [syncConfigs, setSyncConfigs] = useState<SyncConfig[]>([]);
  const [isSyncingEmba, setIsSyncingEmba] = useState(false);
  const [isSyncingMit, setIsSyncingMit] = useState(false);
  const [lastSyncLogs, setLastSyncLogs] = useState<SyncLog[]>([]);
  const [embaSheetUrl, setEmbaSheetUrl] = useState('');
  const [mitSheetUrl, setMitSheetUrl] = useState('https://docs.google.com/spreadsheets/d/1P6NyWVhxuuNUu-7dN7KX3GDuVddYWNLOLQ4QCEVcNlc/edit?gid=1544435511#gid=1544435511');
  const [showDebug, setShowDebug] = useState(false);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);

  // Get effective user ID - use demo ID if no auth
  const effectiveUserId = user?.id || DEMO_USER_ID;

  const addDebugLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setDebugLogs(prev => [`[${timestamp}] ${message}`, ...prev.slice(0, 49)]);
  };

  useEffect(() => {
    loadSyncConfigs();
    loadSyncLogs();
  }, [user]);

  const loadSyncConfigs = async () => {
    const logMsg = `Loading sync configs for user: ${effectiveUserId}`;
    console.log('[AssignmentSync]', logMsg);
    addDebugLog(logMsg);

    const { data, error } = await supabase
      .from('sync_config')
      .select('*')
      .eq('user_id', effectiveUserId)
      .eq('service_type', 'google_sheets');

    if (error) {
      const errMsg = `Error loading sync configs: ${JSON.stringify(error)}`;
      console.error('[AssignmentSync]', errMsg);
      addDebugLog(errMsg);
      return;
    }

    const successMsg = `Loaded ${data?.length || 0} configs`;
    console.log('[AssignmentSync]', successMsg, data);
    addDebugLog(successMsg);
    setSyncConfigs(data as SyncConfig[] || []);
    
    if (data && data.length > 0) {
      const config = data[0] as any; // Single row per user
      
      // New structure: dedicated fields
      if (config.config_data?.emba_sheet_url) {
        setEmbaSheetUrl(config.config_data.emba_sheet_url);
        addDebugLog(`EMBA URL loaded from new field: ${config.config_data.emba_sheet_url}`);
      }
      if (config.config_data?.mit_sheet_url) {
        setMitSheetUrl(config.config_data.mit_sheet_url);
        addDebugLog(`MIT URL loaded from new field: ${config.config_data.mit_sheet_url}`);
      }
      
      // Backward compatibility: legacy sheet_type structure
      if (!config.config_data?.emba_sheet_url && config.config_data?.sheet_type === 'emba' && config.config_data?.sheet_url) {
        setEmbaSheetUrl(config.config_data.sheet_url);
        addDebugLog(`EMBA URL loaded from legacy field: ${config.config_data.sheet_url}`);
      }
      if (!config.config_data?.mit_sheet_url && config.config_data?.sheet_type === 'mit' && config.config_data?.sheet_url) {
        setMitSheetUrl(config.config_data.sheet_url);
        addDebugLog(`MIT URL loaded from legacy field: ${config.config_data.sheet_url}`);
      }
    }
  };

  const loadSyncLogs = async () => {
    console.log('[AssignmentSync] Loading sync logs for user:', effectiveUserId);

    const { data, error } = await supabase
      .from('sync_logs')
      .select('*')
      .eq('user_id', effectiveUserId)
      .in('service_type', ['google_sheets', 'mit_sheets'])
      .order('started_at', { ascending: false })
      .limit(5);

    if (error) {
      console.error('[AssignmentSync] Error loading sync logs:', error);
      return;
    }

    console.log('[AssignmentSync] Loaded logs:', data);
    setLastSyncLogs(data as SyncLog[] || []);
  };

  const saveSheetUrl = async (sheetType: 'emba' | 'mit', url: string) => {
    if (!url.trim()) return;

    const logMsg = `Saving ${sheetType.toUpperCase()} sheet URL for user: ${effectiveUserId}`;
    console.log('[AssignmentSync]', logMsg);
    addDebugLog(logMsg);
    addDebugLog(`URL: ${url}`);

    try {
      // Get existing google_sheets config (single row per user)
      const { data: existingConfigs } = await supabase
        .from('sync_config')
        .select('*')
        .eq('user_id', effectiveUserId)
        .eq('service_type', 'google_sheets');

      const existing = existingConfigs?.[0];

      if (existing) {
        addDebugLog(`Updating existing google_sheets config...`);
        const updatedConfigData = {
          ...(typeof existing.config_data === 'object' ? existing.config_data : {}),
          [`${sheetType}_sheet_url`]: url
        } as any;

        const { error } = await supabase
          .from('sync_config')
          .update({
            config_data: updatedConfigData,
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id);

        if (error) {
          addDebugLog(`❌ Update error: ${JSON.stringify(error)}`);
          throw error;
        }
        addDebugLog(`✅ ${sheetType.toUpperCase()} URL saved to config_data.${sheetType}_sheet_url`);
      } else {
        addDebugLog(`Creating new google_sheets config...`);
        const { error } = await supabase
          .from('sync_config')
          .insert({
            user_id: effectiveUserId,
            service_type: 'google_sheets',
            config_data: {
              [`${sheetType}_sheet_url`]: url
            },
            is_active: true
          });

        if (error) {
          // Handle duplicate key error by updating instead
          if (error.code === '23505') {
            addDebugLog(`⚠️ Duplicate detected, retrying with update...`);
            const { data: retry } = await supabase
              .from('sync_config')
              .select('*')
              .eq('user_id', effectiveUserId)
              .eq('service_type', 'google_sheets')
              .single();

            if (retry) {
              const { error: updateError } = await supabase
                .from('sync_config')
                .update({
                  config_data: {
                    ...(typeof retry.config_data === 'object' ? retry.config_data : {}),
                    [`${sheetType}_sheet_url`]: url
                  } as any,
                  updated_at: new Date().toISOString()
                })
                .eq('id', retry.id);

              if (updateError) throw updateError;
              addDebugLog(`✅ ${sheetType.toUpperCase()} URL saved via retry update`);
            }
          } else {
            addDebugLog(`❌ Insert error: ${JSON.stringify(error)}`);
            throw error;
          }
        } else {
          addDebugLog(`✅ ${sheetType.toUpperCase()} config created successfully`);
        }
      }

      await loadSyncConfigs();
      toast({
        title: "Sheet URL saved",
        description: `${sheetType.toUpperCase()} sync configuration updated.`,
      });
    } catch (error: any) {
      console.error('Error saving sheet URL:', error);
      const errorMsg = error.code === '23505' 
        ? 'Duplicate configuration detected. Please refresh and try again.'
        : error.message || "Failed to save sheet URL";
      
      addDebugLog(`❌ Save failed: ${errorMsg}`);
      toast({
        variant: "destructive",
        title: "Error",
        description: errorMsg,
      });
    }
  };

  const handleSyncEmba = async () => {
    console.log('[AssignmentSync] Starting EMBA sync for user:', effectiveUserId);
    setIsSyncingEmba(true);
    try {
      const { data, error } = await supabase.functions.invoke('sync-google-sheets', {
        body: { userId: effectiveUserId }
      });

      if (error) {
        console.error('[AssignmentSync] EMBA sync error:', error);
        throw error;
      }

      console.log('[AssignmentSync] EMBA sync result:', data);
      toast({
        title: "EMBA Sync Complete",
        description: `Processed: ${data?.processed || 0} | Added: ${data?.added || 0} | Updated: ${data?.updated || 0}`
      });

      await loadSyncLogs();

      if (data?.assignmentIds && data.assignmentIds.length > 0) {
        await createTasksFromAssignments(data.assignmentIds, effectiveUserId);
        toast({
          title: "EMBA Tasks Created",
          description: `${data.assignmentIds.length} assignments converted to tasks.`
        });
      }

    } catch (error: any) {
      console.error('[AssignmentSync] EMBA sync failed:', error);
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
    console.log('[AssignmentSync] Starting MIT sync for user:', effectiveUserId);
    setIsSyncingMit(true);
    try {
      const { data, error } = await supabase.functions.invoke('sync-mit-sheets', {
        body: { userId: effectiveUserId }
      });

      if (error) {
        console.error('[AssignmentSync] MIT sync error:', error);
        throw error;
      }

      console.log('[AssignmentSync] MIT sync result:', data);
      toast({
        title: "MIT Sync Complete",
        description: `Processed: ${data?.processed || 0} | Added: ${data?.added || 0} | Updated: ${data?.updated || 0}`
      });

      await loadSyncLogs();

      if (data?.assignmentIds && data.assignmentIds.length > 0) {
        await createTasksFromMitAssignments(data.assignmentIds, effectiveUserId);
        toast({
          title: "MIT Tasks Created",
          description: `${data.assignmentIds.length} assignments converted to tasks.`
        });
      }

    } catch (error: any) {
      console.error('[AssignmentSync] MIT sync failed:', error);
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
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            <CardTitle>Assignment Import</CardTitle>
            {isDemoMode && (
              <Badge variant="secondary" className="text-xs">
                🎭 Demo Mode
              </Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            User: {effectiveUserId.substring(0, 8)}...
          </div>
        </div>
        <CardDescription>
          Sync assignments from your EMBA and MIT Google Sheets
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Debug Panel */}
        <Collapsible open={showDebug} onOpenChange={setShowDebug}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" size="sm" className="w-full">
              <Bug className="h-4 w-4 mr-2" />
              Debug Info
              <ChevronDown className={cn("h-4 w-4 ml-auto transition-transform", showDebug && "rotate-180")} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-4 space-y-3">
            <div className="p-4 bg-muted rounded-lg space-y-2">
              <div className="text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="font-medium">Auth Status:</span>
                  <Badge variant={user ? "default" : "secondary"}>
                    {user ? '🔐 Authenticated' : '🎭 Demo Mode'}
                  </Badge>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium">User ID:</span>
                  <code className="text-xs bg-background px-2 py-1 rounded">{effectiveUserId}</code>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium">Configs Loaded:</span>
                  <span>{syncConfigs.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium">EMBA URL Set:</span>
                  <span>{embaSheetUrl ? '✅' : '❌'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium">MIT URL Set:</span>
                  <span>{mitSheetUrl ? '✅' : '❌'}</span>
                </div>
              </div>
              <Separator />
              <div className="space-y-2">
                <div className="text-sm font-medium">Recent Activity:</div>
                <div className="max-h-40 overflow-y-auto space-y-1 text-xs font-mono">
                  {debugLogs.length === 0 ? (
                    <div className="text-muted-foreground">No activity yet</div>
                  ) : (
                    debugLogs.map((log, i) => (
                      <div key={i} className="text-muted-foreground">{log}</div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
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

/**
 * Debug Page - Production diagnostics for auth and boot issues
 * 
 * This page provides:
 * - Boot ID and environment info
 * - Full boot trace timeline
 * - Current auth state (no tokens exposed)
 * - Connectivity probes (REST, Auth, Edge Functions)
 * - Action buttons for debugging
 * 
 * IMPORTANT: This page bypasses auth initialization so it always loads
 * even when supabase-js is hung.
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { bootTrace } from '@/utils/bootTrace';
import { 
  logToErrorLog, 
  probeRestApi, 
  probeAuthApi, 
  probeEdgeFunction 
} from '@/utils/directLog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { 
  Copy, 
  LogOut, 
  RefreshCw, 
  Trash2, 
  ArrowLeft,
  CheckCircle,
  XCircle,
  Clock,
  Wifi,
  Activity,
  Send,
  Zap
} from 'lucide-react';

interface ProbeResult {
  name: string;
  status: 'pending' | 'running' | 'success' | 'error';
  latencyMs?: number;
  error?: string;
  response?: any;
}

const Debug = () => {
  const { user, session, loading, isDemoMode, initError, signOut } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [entries, setEntries] = useState(bootTrace.getEntries());
  const [serviceWorkerStatus, setServiceWorkerStatus] = useState<string>('checking...');
  const [probes, setProbes] = useState<ProbeResult[]>([
    { name: 'REST API', status: 'pending' },
    { name: 'Auth API', status: 'pending' },
    { name: 'Edge Functions', status: 'pending' }
  ]);
  const [testLogSent, setTestLogSent] = useState(false);
  const [widgetLog, setWidgetLog] = useState<string>('');
  const [credAudit, setCredAudit] = useState<Record<string, string>>({});
  const bridge = (window as any).AndroidBridge;

  // Refresh entries periodically
  useEffect(() => {
    const interval = setInterval(() => {
      setEntries(bootTrace.getEntries());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const refreshWidgetLog = () => {
    const log = bridge?.getWidgetDebugLog?.() ?? '(AndroidBridge not available — open this page inside the app)';
    setWidgetLog(log);
  };

  const clearWidgetLog = () => {
    bridge?.clearWidgetDebugLog?.();
    setWidgetLog('(cleared)');
  };

  useEffect(() => { refreshWidgetLog(); }, []);

  const CRED_KEYS = [
    'supabase_url',
    'supabase_anon_key',
    'supabase_access_token',
    'supabase_refresh_token',
    'supabase_user_id',
    'fcm_token',
  ];

  const checkCreds = () => {
    if (!bridge?.secureGet) {
      setCredAudit({ error: 'AndroidBridge.secureGet not available' });
      return;
    }
    const result: Record<string, string> = {};
    for (const key of CRED_KEYS) {
      const val = bridge.secureGet(key) as string;
      if (!val) {
        result[key] = '✗ missing';
      } else if (key.includes('token') || key.includes('key')) {
        result[key] = `✓ present (${val.length} chars)`;
      } else {
        result[key] = `✓ ${val}`;
      }
    }
    setCredAudit(result);
  };

  // Check service worker status
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration().then(reg => {
        if (reg) {
          setServiceWorkerStatus(`Active (scope: ${reg.scope})`);
        } else {
          setServiceWorkerStatus('Not registered');
        }
      }).catch(() => {
        setServiceWorkerStatus('Error checking');
      });
    } else {
      setServiceWorkerStatus('Not supported');
    }
  }, []);

  const handleCopyDiagnostics = async () => {
    const success = await bootTrace.copyDiagnostics();
    if (success) {
      toast({
        title: "Copied!",
        description: "Diagnostics copied to clipboard"
      });
    } else {
      toast({
        variant: "destructive",
        title: "Failed to copy",
        description: "Please manually select and copy the diagnostics"
      });
    }
  };

  const handleSignOut = async () => {
    await signOut();
    toast({
      title: "Signed out",
      description: "You have been signed out"
    });
  };

  const handleClearStorage = () => {
    localStorage.clear();
    sessionStorage.clear();
    toast({
      title: "Storage cleared",
      description: "Local and session storage have been cleared"
    });
  };

  const handleUnregisterSW = async () => {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const reg of registrations) {
        await reg.unregister();
      }
      toast({
        title: "Service Worker unregistered",
        description: "Please refresh the page"
      });
      setServiceWorkerStatus('Unregistered');
    }
  };

  const handleHardRefresh = () => {
    window.location.reload();
  };

  // Run all connectivity probes
  const runProbes = async () => {
    bootTrace.mark('probe_all_start');
    
    // Reset probe states
    setProbes([
      { name: 'REST API', status: 'running' },
      { name: 'Auth API', status: 'running' },
      { name: 'Edge Functions', status: 'running' }
    ]);

    // Run probes in parallel
    const [restResult, authResult, edgeResult] = await Promise.all([
      (async () => {
        bootTrace.mark('probe_rest_start');
        const result = await probeRestApi();
        bootTrace.mark('probe_rest_done', result);
        return result;
      })(),
      (async () => {
        bootTrace.mark('probe_auth_start');
        const result = await probeAuthApi();
        bootTrace.mark('probe_auth_done', result);
        return result;
      })(),
      (async () => {
        bootTrace.mark('probe_edge_start');
        const result = await probeEdgeFunction('ping');
        bootTrace.mark('probe_edge_done', result);
        return result;
      })()
    ]);

    // Update probe results
    setProbes([
      { 
        name: 'REST API', 
        status: restResult.ok ? 'success' : 'error',
        latencyMs: restResult.latencyMs,
        error: restResult.error
      },
      { 
        name: 'Auth API', 
        status: authResult.ok ? 'success' : 'error',
        latencyMs: authResult.latencyMs,
        error: authResult.error
      },
      { 
        name: 'Edge Functions', 
        status: edgeResult.ok ? 'success' : 'error',
        latencyMs: edgeResult.latencyMs,
        error: edgeResult.error,
        response: edgeResult.response
      }
    ]);

    // Log probe results to backend
    await logToErrorLog({
      component: 'Debug',
      error_type: 'probe_results',
      error_message: 'connectivity_probes_complete',
      context: {
        rest: restResult,
        auth: authResult,
        edge: edgeResult
      }
    });

    bootTrace.mark('probe_all_done');
    
    toast({
      title: "Probes complete",
      description: `REST: ${restResult.ok ? '✓' : '✗'} | Auth: ${authResult.ok ? '✓' : '✗'} | Edge: ${edgeResult.ok ? '✓' : '✗'}`
    });
  };

  // Send a test log entry
  const sendTestLog = async () => {
    const success = await logToErrorLog({
      component: 'Debug',
      error_type: 'test_log',
      error_message: 'manual_test_log_from_debug_page',
      context: {
        test: true,
        timestamp: new Date().toISOString()
      }
    });

    setTestLogSent(true);
    
    toast({
      title: success ? "Test log sent!" : "Test log may have failed",
      description: success 
        ? "Check error_log table for this boot_id" 
        : "The log request completed but we couldn't confirm success",
      variant: success ? "default" : "destructive"
    });
  };

  const env = bootTrace.getEnvironment();

  const getProbeIcon = (status: ProbeResult['status']) => {
    switch (status) {
      case 'pending': return <Clock className="w-4 h-4 text-muted-foreground" />;
      case 'running': return <RefreshCw className="w-4 h-4 text-primary animate-spin" />;
      case 'success': return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'error': return <XCircle className="w-4 h-4 text-destructive" />;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 p-4">
      <div className="max-w-4xl mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => window.location.href = '/'}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Home
          </Button>
          <Badge variant="outline" className="font-mono">
            Boot ID: {bootTrace.getBootId()}
          </Badge>
        </div>

        {/* Auth Bypass Notice */}
        <Card className="border-yellow-500/50 bg-yellow-500/5">
          <CardContent className="py-3">
            <p className="text-sm text-yellow-600 dark:text-yellow-400">
              ⚠️ This page bypasses authentication. Auth state shown below may be null.
            </p>
          </CardContent>
        </Card>

        {/* Connectivity Probes Card */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Activity className="w-5 h-5" />
              Connectivity Probes
            </CardTitle>
            <CardDescription>
              Test direct connectivity to Supabase endpoints
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2">
              {probes.map((probe, i) => (
                <div key={i} className="flex items-center justify-between p-2 rounded border bg-muted/30">
                  <div className="flex items-center gap-2">
                    {getProbeIcon(probe.status)}
                    <span className="font-medium text-sm">{probe.name}</span>
                  </div>
                  <div className="text-xs font-mono text-muted-foreground">
                    {probe.status === 'success' && `${probe.latencyMs}ms`}
                    {probe.status === 'error' && (
                      <span className="text-destructive">{probe.error}</span>
                    )}
                    {probe.status === 'pending' && 'Not run'}
                    {probe.status === 'running' && 'Running...'}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Button onClick={runProbes} size="sm">
                <Zap className="w-4 h-4 mr-2" />
                Run All Probes
              </Button>
              <Button onClick={sendTestLog} size="sm" variant="outline" disabled={testLogSent}>
                <Send className="w-4 h-4 mr-2" />
                {testLogSent ? 'Log Sent' : 'Send Test Log'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Environment Card */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Wifi className="w-5 h-5" />
              Environment
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm font-mono">
            <div className="grid grid-cols-2 gap-2">
              <span className="text-muted-foreground">Hostname:</span>
              <span>{env.hostname}</span>
              <span className="text-muted-foreground">Origin:</span>
              <span className="truncate">{env.origin}</span>
              <span className="text-muted-foreground">Path:</span>
              <span>{env.pathname}</span>
              <span className="text-muted-foreground">Production:</span>
              <span>{env.isProduction ? '✅ Yes' : '❌ No'}</span>
              <span className="text-muted-foreground">Preview:</span>
              <span>{env.isPreview ? '✅ Yes' : '❌ No'}</span>
              <span className="text-muted-foreground">Service Worker:</span>
              <span className="truncate">{serviceWorkerStatus}</span>
              <span className="text-muted-foreground">Online:</span>
              <span>{navigator.onLine ? '✅ Yes' : '❌ No'}</span>
            </div>
          </CardContent>
        </Card>

        {/* Auth State Card */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              {user ? (
                <CheckCircle className="w-5 h-5 text-green-500" />
              ) : (
                <XCircle className="w-5 h-5 text-muted-foreground" />
              )}
              Auth State
            </CardTitle>
            <CardDescription>
              Note: Auth is bypassed on this page, so user/session may be null
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm font-mono">
            <div className="grid grid-cols-2 gap-2">
              <span className="text-muted-foreground">Loading:</span>
              <span>{loading ? '⏳ Yes' : '✅ No'}</span>
              <span className="text-muted-foreground">User:</span>
              <span>{user?.email || 'null (expected on /debug)'}</span>
              <span className="text-muted-foreground">User ID:</span>
              <span className="truncate">{user?.id || 'null'}</span>
              <span className="text-muted-foreground">Demo Mode:</span>
              <span>{isDemoMode ? '✅ Yes' : '❌ No'}</span>
              <span className="text-muted-foreground">Session:</span>
              <span>{session ? '✅ Active' : '❌ None (expected on /debug)'}</span>
              {session && (
                <>
                  <span className="text-muted-foreground">Expires At:</span>
                  <span>{new Date((session.expires_at || 0) * 1000).toLocaleString()}</span>
                </>
              )}
              {initError && (
                <>
                  <span className="text-muted-foreground">Init Error:</span>
                  <span className="text-destructive">{initError}</span>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Boot Trace Timeline */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Clock className="w-5 h-5" />
              Boot Trace Timeline
            </CardTitle>
            <CardDescription>
              {entries.length} entries • Last: {bootTrace.getLastStep() || 'none'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-64 rounded border p-2">
              {entries.length === 0 ? (
                <p className="text-muted-foreground text-sm">No trace entries yet</p>
              ) : (
                <div className="space-y-1 font-mono text-xs">
                  {entries.map((entry, i) => (
                    <div key={i} className="flex gap-2 py-1 border-b border-border/50 last:border-0">
                      <span className="text-muted-foreground w-16 flex-shrink-0">
                        {entry.elapsedMs}ms
                      </span>
                      <span className="flex-1">
                        {entry.step}
                        {entry.metadata && (
                          <span className="text-muted-foreground ml-2">
                            {JSON.stringify(entry.metadata)}
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Actions */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Actions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              <Button onClick={handleCopyDiagnostics} variant="default">
                <Copy className="w-4 h-4 mr-2" />
                Copy Diagnostics
              </Button>
              <Button onClick={handleHardRefresh} variant="outline">
                <RefreshCw className="w-4 h-4 mr-2" />
                Hard Refresh
              </Button>
              <Button onClick={handleSignOut} variant="outline" disabled={!user}>
                <LogOut className="w-4 h-4 mr-2" />
                Sign Out
              </Button>
              <Separator orientation="vertical" className="h-9" />
              <Button onClick={handleClearStorage} variant="destructive" size="sm">
                <Trash2 className="w-4 h-4 mr-2" />
                Clear Storage
              </Button>
              <Button onClick={handleUnregisterSW} variant="destructive" size="sm">
                Unregister SW
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Widget Credential Audit */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <CheckCircle className="w-5 h-5" />
              Widget Credential Audit
            </CardTitle>
            <CardDescription>
              Shows which keys are present in EncryptedPrefs (values hidden for tokens/keys)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {Object.keys(credAudit).length > 0 && (
              <div className="space-y-1 font-mono text-xs rounded border bg-muted/50 p-2">
                {Object.entries(credAudit).map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <span className={`flex-shrink-0 ${v.startsWith('✗') ? 'text-destructive' : 'text-green-500'}`}>
                      {v.startsWith('✗') ? '✗' : '✓'}
                    </span>
                    <span className="text-muted-foreground w-40 flex-shrink-0">{k}</span>
                    <span>{v.replace(/^[✓✗] ?/, '')}</span>
                  </div>
                ))}
              </div>
            )}
            <Button onClick={checkCreds} size="sm" disabled={!bridge}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Check Credentials
            </Button>
          </CardContent>
        </Card>

        {/* Widget Debug Log */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Activity className="w-5 h-5" />
              Widget Debug Log
            </CardTitle>
            <CardDescription>
              Live trace from SupabaseTaskClient — credential checks, HTTP statuses, row counts
              {!bridge && <span className="text-destructive ml-2">• AndroidBridge not detected (open inside app)</span>}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ScrollArea className="h-48 rounded border bg-muted/50 p-2">
              <pre className="text-xs font-mono whitespace-pre-wrap">
                {widgetLog || '(tap Refresh to load)'}
              </pre>
            </ScrollArea>
            <div className="flex gap-2">
              <Button onClick={refreshWidgetLog} size="sm">
                <RefreshCw className="w-4 h-4 mr-2" />
                Refresh
              </Button>
              <Button onClick={clearWidgetLog} size="sm" variant="outline" disabled={!bridge}>
                <Trash2 className="w-4 h-4 mr-2" />
                Clear Log
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Raw Diagnostics (for manual copy) */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Raw Diagnostics</CardTitle>
            <CardDescription>
              If copy button doesn't work, select and copy this text
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-48 rounded border bg-muted/50 p-2">
              <pre className="text-xs font-mono whitespace-pre-wrap">
                {bootTrace.getDiagnostics()}
              </pre>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Debug;

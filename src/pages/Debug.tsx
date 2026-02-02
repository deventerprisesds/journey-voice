/**
 * Debug Page - Production diagnostics for auth and boot issues
 * 
 * This page provides:
 * - Boot ID and environment info
 * - Full boot trace timeline
 * - Current auth state (no tokens exposed)
 * - Action buttons for debugging
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { bootTrace } from '@/utils/bootTrace';
import { supabase } from '@/integrations/supabase/client';
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
  Wifi
} from 'lucide-react';

const Debug = () => {
  const { user, session, loading, isDemoMode, initError, signOut } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [entries, setEntries] = useState(bootTrace.getEntries());
  const [serviceWorkerStatus, setServiceWorkerStatus] = useState<string>('checking...');

  // Refresh entries periodically
  useEffect(() => {
    const interval = setInterval(() => {
      setEntries(bootTrace.getEntries());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

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

  const env = bootTrace.getEnvironment();

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 p-4">
      <div className="max-w-4xl mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => navigate(-1)}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <Badge variant="outline" className="font-mono">
            Boot ID: {bootTrace.getBootId()}
          </Badge>
        </div>

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
                <XCircle className="w-5 h-5 text-destructive" />
              )}
              Auth State
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm font-mono">
            <div className="grid grid-cols-2 gap-2">
              <span className="text-muted-foreground">Loading:</span>
              <span>{loading ? '⏳ Yes' : '✅ No'}</span>
              <span className="text-muted-foreground">User:</span>
              <span>{user?.email || 'null'}</span>
              <span className="text-muted-foreground">User ID:</span>
              <span className="truncate">{user?.id || 'null'}</span>
              <span className="text-muted-foreground">Demo Mode:</span>
              <span>{isDemoMode ? '✅ Yes' : '❌ No'}</span>
              <span className="text-muted-foreground">Session:</span>
              <span>{session ? '✅ Active' : '❌ None'}</span>
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

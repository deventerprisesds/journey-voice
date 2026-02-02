import { ReactNode, useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { bootTrace } from '@/utils/bootTrace';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle, RefreshCw, LogIn, Copy, Bug } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface ProtectedRouteProps {
  children: ReactNode;
  requireAdmin?: boolean;
}

const ProtectedRoute = ({ children, requireAdmin = false }: ProtectedRouteProps) => {
  const { user, loading, isAdmin, initError, retryAuth } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [slowLoad, setSlowLoad] = useState(false);
  const [lastStep, setLastStep] = useState<string | null>(null);

  useEffect(() => {
    if (!loading) {
      setSlowLoad(false);
      return;
    }

    // Update last step periodically while loading
    const stepInterval = window.setInterval(() => {
      setLastStep(bootTrace.getLastStep());
    }, 500);

    const t = window.setTimeout(() => setSlowLoad(true), 12000);
    return () => {
      window.clearTimeout(t);
      window.clearInterval(stepInterval);
    };
  }, [loading]);

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
        description: "Please try the debug page for full diagnostics"
      });
    }
  };

  // Show error screen if auth initialization failed
  if (initError) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 w-12 h-12 bg-destructive/10 rounded-full flex items-center justify-center">
              <AlertTriangle className="w-6 h-6 text-destructive" />
            </div>
            <CardTitle className="text-lg">Can't start the app</CardTitle>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <p className="text-sm text-muted-foreground">
              {initError}
            </p>
            <p className="text-xs text-muted-foreground font-mono">
              Boot ID: {bootTrace.getBootId()}
            </p>
            <div className="flex flex-col sm:flex-row gap-2 justify-center">
              <Button variant="outline" onClick={retryAuth}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Retry
              </Button>
              <Button onClick={() => navigate('/auth')}>
                <LogIn className="w-4 h-4 mr-2" />
                Sign In
              </Button>
            </div>
            <div className="flex gap-2 justify-center">
              <Button variant="ghost" size="sm" onClick={handleCopyDiagnostics}>
                <Copy className="w-4 h-4 mr-2" />
                Copy Diagnostics
              </Button>
              <Button variant="ghost" size="sm" onClick={() => window.location.href = '/debug'}>
                <Bug className="w-4 h-4 mr-2" />
                Debug Page
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center">
              <RefreshCw className="w-6 h-6 text-primary animate-spin" />
            </div>
            <CardTitle className="text-lg">Loading…</CardTitle>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <p className="text-sm text-muted-foreground">
              Initializing your session.
            </p>
            
            {/* Always show boot ID for tracing */}
            <p className="text-xs text-muted-foreground font-mono">
              Boot ID: {bootTrace.getBootId()}
            </p>

            {slowLoad && (
              <div className="space-y-3">
                <div className="rounded-md border bg-muted/30 p-3 text-left">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <div className="text-xs text-muted-foreground space-y-1">
                      <p>This is taking longer than expected.</p>
                      {lastStep && (
                        <p className="font-mono">Last step: {lastStep}</p>
                      )}
                      <p>If you're already signed in, something may be blocking the auth session check.</p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-2 justify-center">
                  <Button variant="outline" onClick={retryAuth}>
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Retry
                  </Button>
                  <Button onClick={() => navigate('/auth')}>
                    <LogIn className="w-4 h-4 mr-2" />
                    Sign In
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => window.location.reload()}
                  >
                    Refresh
                  </Button>
                </div>
                
                <div className="flex gap-2 justify-center">
                  <Button variant="ghost" size="sm" onClick={handleCopyDiagnostics}>
                    <Copy className="w-4 h-4 mr-2" />
                    Copy Diagnostics
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => window.location.href = '/debug'}>
                    <Bug className="w-4 h-4 mr-2" />
                    Debug Page
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  if (requireAdmin && !isAdmin) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;

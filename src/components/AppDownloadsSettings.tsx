// WHAT:       Settings "Download" tab: the newest TaskOS and Huddle phone builds, each with a Download button,
//             plus the version installed on this phone when opened inside the TaskOS app.
// WHY:        Owner request 2026-11-10 ("like nexus add the latest huddle and TaskOS apk download links in a
//             settings tab"). Links come fresh from edge fn app-downloads, so they never go stale.
// SUPERSEDES: nothing. SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   supabase/functions/_shared/app-downloads.ts.
import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Download, RefreshCw, Smartphone } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface DownloadRow {
  key: string;
  name: string;
  found: boolean;
  version: string | null;
  builtAt: string | null;
  sizeBytes: number | null;
  downloadUrl: string | null;
}

/** This web app is the TaskOS phone app when it runs inside the Android bridge. */
const THIS_APP_KEY = 'taskos';

function installedVersion(): string | null {
  try {
    const raw = (window as any).AndroidBridge?.getCapabilities?.();
    const v = raw ? JSON.parse(raw)?.version : null;
    return typeof v === 'string' && v ? v : null;
  } catch {
    return null;
  }
}

/** -1 / 0 / 1, numeric per dotted part ("1.0.9" < "1.0.10"). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

const REASONS: Record<string, string> = {
  sign_in_required: 'Sign in to see download links.',
  not_configured: 'The download service is not set up yet.',
  bridge_unreachable: 'The build server did not answer. Try again in a minute.',
  bridge_401: 'The build server rejected this app\'s key. It needs re-syncing.',
  bridge_503: 'The build server is not set up yet.',
};

export default function AppDownloadsSettings() {
  const [rows, setRows] = useState<DownloadRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const installed = installedVersion();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase.functions.invoke('app-downloads', { method: 'GET' });
    if (err || !data?.ok) {
      // A non-2xx reply arrives as err with data null; the function's {reason} is on err.context (the Response).
      let reason = data?.reason as string | undefined;
      if (!reason && err) {
        try { reason = (await (err as { context?: Response }).context?.json())?.reason; } catch { /* not JSON */ }
      }
      setError((reason && REASONS[reason]) || 'Could not load the latest builds.');
      setRows(null);
    } else {
      setRows(data.apps as DownloadRow[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2"><Smartphone className="h-5 w-5" /> Download</CardTitle>
          <CardDescription>Latest Android builds. Each link is fresh for 30 days.</CardDescription>
        </div>
        <Button variant="ghost" size="icon" onClick={() => void load()} disabled={loading} aria-label="Refresh">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!rows && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
        {rows?.map((r) => {
          const mine = r.key === THIS_APP_KEY && installed;
          const behind = mine && r.version ? compareVersions(installed!, r.version) < 0 : false;
          return (
            <div key={r.key} className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 font-medium">
                  {r.name}
                  {r.version && <Badge variant="secondary">v{r.version}</Badge>}
                  {behind && <Badge>Update available</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">
                  {r.found
                    ? [r.builtAt && `Built ${new Date(r.builtAt).toLocaleDateString()}`,
                       r.sizeBytes && `${(r.sizeBytes / 1048576).toFixed(1)} MB`,
                       mine && `Installed here: v${installed}`].filter(Boolean).join(' · ')
                    : 'No build found.'}
                </p>
              </div>
              {r.downloadUrl && (
                <Button asChild size="sm">
                  <a href={r.downloadUrl} rel="noopener noreferrer"><Download className="mr-1 h-4 w-4" />Download</a>
                </Button>
              )}
            </div>
          );
        })}
        <p className="text-xs text-muted-foreground">
          On the phone, the download opens in your browser. Open the file when it finishes and allow installs from this source if Android asks.
        </p>
      </CardContent>
    </Card>
  );
}

import { useState, useEffect } from 'react';
import { AlertTriangle, X, ExternalLink } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

interface QuotaAlert {
  provider: 'elevenlabs' | 'openai';
  message: string;
  link: string;
  timestamp: string;
}

const PROVIDER_CONFIG = {
  elevenlabs: {
    label: 'ElevenLabs',
    message: 'Voice features unavailable - ElevenLabs quota exhausted',
    link: 'https://elevenlabs.io/app/subscription',
    linkText: 'Add Credits'
  },
  openai: {
    label: 'OpenAI',
    message: 'AI features unavailable - OpenAI quota exceeded',
    link: 'https://platform.openai.com/account/billing',
    linkText: 'Check Billing'
  }
};

const DISMISS_DURATION_MS = 60 * 60 * 1000; // 1 hour

const QuotaAlertBanner = () => {
  const { user } = useAuth();
  const [alerts, setAlerts] = useState<QuotaAlert[]>([]);
  const [dismissedUntil, setDismissedUntil] = useState<Record<string, number>>({});

  // Load dismissed state from localStorage
  useEffect(() => {
    const stored = localStorage.getItem('quota_alerts_dismissed');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        // Clean up expired dismissals
        const now = Date.now();
        const valid: Record<string, number> = {};
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value === 'number' && value > now) {
            valid[key] = value;
          }
        }
        setDismissedUntil(valid);
        localStorage.setItem('quota_alerts_dismissed', JSON.stringify(valid));
      } catch {
        localStorage.removeItem('quota_alerts_dismissed');
      }
    }
  }, []);

  // Check for quota errors
  useEffect(() => {
    if (!user?.id) return;

    const checkQuotaErrors = async () => {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      
      const { data, error } = await supabase
        .from('error_log')
        .select('error_type, error_message, created_at, context')
        .in('error_type', ['quota_exceeded_elevenlabs', 'quota_exceeded_openai'])
        .gte('created_at', twentyFourHoursAgo)
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) {
        console.warn('[QuotaAlertBanner] Failed to check quota errors:', error);
        return;
      }

      if (!data || data.length === 0) {
        setAlerts([]);
        return;
      }

      // Dedupe by provider, keep most recent
      const alertMap = new Map<string, QuotaAlert>();
      for (const row of data) {
        const provider = row.error_type === 'quota_exceeded_elevenlabs' ? 'elevenlabs' : 'openai';
        if (!alertMap.has(provider)) {
          const config = PROVIDER_CONFIG[provider];
          alertMap.set(provider, {
            provider,
            message: config.message,
            link: config.link,
            timestamp: row.created_at
          });
        }
      }

      setAlerts(Array.from(alertMap.values()));
    };

    checkQuotaErrors();
    const interval = setInterval(checkQuotaErrors, 60000); // Poll every minute
    return () => clearInterval(interval);
  }, [user?.id]);

  const handleDismiss = (provider: string) => {
    const until = Date.now() + DISMISS_DURATION_MS;
    const updated = { ...dismissedUntil, [provider]: until };
    setDismissedUntil(updated);
    localStorage.setItem('quota_alerts_dismissed', JSON.stringify(updated));
  };

  // Filter out dismissed alerts
  const visibleAlerts = alerts.filter(alert => {
    const dismissedTime = dismissedUntil[alert.provider];
    return !dismissedTime || dismissedTime < Date.now();
  });

  if (visibleAlerts.length === 0) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[100] flex flex-col">
      {visibleAlerts.map(alert => {
        const config = PROVIDER_CONFIG[alert.provider];
        return (
          <div
            key={alert.provider}
            className="bg-destructive text-destructive-foreground px-4 py-2 flex items-center justify-between gap-4"
          >
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span className="text-sm font-medium truncate">
                {alert.message}
              </span>
            </div>
            
            <div className="flex items-center gap-2 shrink-0">
              <a
                href={config.link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm font-medium underline underline-offset-2 hover:opacity-80"
              >
                {config.linkText}
                <ExternalLink className="h-3 w-3" />
              </a>
              
              <button
                onClick={() => handleDismiss(alert.provider)}
                className="p-1 rounded hover:bg-destructive-foreground/10"
                title="Dismiss for 1 hour"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default QuotaAlertBanner;


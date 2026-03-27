import { useEffect } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// Trace helper — writes to error_log for remote debugging
async function oauthTrace(stage: string, details: Record<string, any>) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) return;
    await supabase.from('error_log').insert({
      user_id: userId,
      error_type: 'oauth_trace',
      error_message: stage,
      source: 'useOAuthCallback',
      component: details.provider || 'unknown',
      context: details as any,
    });
  } catch {
    // silently fail trace writes
  }
}

export function useOAuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const handleOAuthCallback = async () => {
      const code = searchParams.get('code');
      const state = searchParams.get('state');
      const error = searchParams.get('error');

      if (!code && !error) return;

      if (error) {
        console.error('[OAuth] Error from provider:', error);
        await oauthTrace('provider_error', { error, state });
        toast.error(`Calendar connection failed: ${error}`);
        navigate(location.pathname, { replace: true });
        return;
      }

      if (code && state && (state === 'google' || state === 'outlook')) {
        const provider = state as 'google' | 'outlook';
        const providerDisplayName = provider === 'google' ? 'Google' : 'Outlook';
        
        try {
          toast.info('Completing calendar connection...');
          await oauthTrace('exchange_start', { provider });
          
          let { data: sessionData } = await supabase.auth.getSession();
          
          if (!sessionData.session) {
            const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
            if (refreshError) {
              await oauthTrace('session_refresh_failed', { provider, error: refreshError.message });
            } else if (refreshed.session) {
              sessionData = refreshed;
            }
          }
          
          if (!sessionData.session) {
            await oauthTrace('session_wait', { provider });
            const sessionPromise = new Promise<boolean>((resolve) => {
              const timeout = setTimeout(() => resolve(false), 5000);
              const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
                if (session) { clearTimeout(timeout); subscription.unsubscribe(); resolve(true); }
              });
            });
            
            const hasSession = await sessionPromise;
            if (!hasSession) {
              await oauthTrace('session_timeout', { provider });
              sessionStorage.setItem('pending_oauth_exchange', JSON.stringify({
                code, provider, redirect_uri: `${window.location.origin}${location.pathname}`, return_path: location.pathname
              }));
              toast.error('Please sign in to complete calendar connection');
              navigate('/auth', { replace: true });
              return;
            }
            const { data: finalSession } = await supabase.auth.getSession();
            sessionData = finalSession;
          }

          await oauthTrace('exchange_invoke', { provider });
          
          const { data, error: exchangeError } = await supabase.functions.invoke('calendar-token-manager', {
            body: {
              action: 'exchange_code', provider, code,
              redirect_uri: `${window.location.origin}${location.pathname}`
            }
          });

          if (exchangeError) {
            const errorMessage = exchangeError.message || '';
            await oauthTrace('exchange_error', { provider, error: errorMessage });

            if (errorMessage.includes('ALREADY_CONNECTED') || errorMessage.includes('23505') || errorMessage.includes('duplicate key')) {
              toast.success(`${providerDisplayName} Calendar is already connected!`);
              window.dispatchEvent(new CustomEvent('calendar-connection-updated', { detail: { provider } }));
              navigate(location.pathname, { replace: true });
              return;
            }

            if (errorMessage.includes('User authentication required')) {
              toast.error('Could not verify your sign-in. Please sign in and try again.');
            } else if (errorMessage.includes('REFRESH_FAILED')) {
              toast.error(`Failed to refresh ${providerDisplayName} connection. Please try again.`);
            } else {
              toast.error(`Failed to connect calendar: ${errorMessage}`);
            }

            window.dispatchEvent(new CustomEvent('calendar-connection-updated', { detail: { provider } }));
            throw exchangeError;
          }

          await oauthTrace('exchange_success', { provider, connectionId: data?.connection_id, refreshed: data?.refreshed });

          if (data?.refreshed) {
            toast.success(`${providerDisplayName} Calendar connection refreshed!`);
          } else {
            toast.success(`Successfully connected to ${providerDisplayName} Calendar`);
          }
          
          window.dispatchEvent(new CustomEvent('calendar-connection-updated', { detail: { provider } }));
          
          if (data?.connection_id) {
            try {
              await supabase.functions.invoke('calendar-integration-manager', {
                body: {
                  action: 'sync_events', connection_id: data.connection_id,
                  start_date: new Date().toISOString(),
                  end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
                }
              });
            } catch (syncError) {
              console.warn('[OAuth] Initial sync failed, will retry later:', syncError);
            }
          }

          navigate(location.pathname, { replace: true });
        } catch (error) {
          console.error('[OAuth] Failed to complete OAuth flow:', error);
          navigate(location.pathname, { replace: true });
        }
      }
    };

    handleOAuthCallback();
  }, [searchParams, navigate, location.pathname]);
}

import { useEffect } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export function useOAuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const handleOAuthCallback = async () => {
      const code = searchParams.get('code');
      const state = searchParams.get('state');
      const error = searchParams.get('error');

      // Check if this is an OAuth callback
      if (!code && !error) {
        return;
      }

      // Handle OAuth error
      if (error) {
        console.error('[OAuth] Error from provider:', error);
        toast.error(`Calendar connection failed: ${error}`);
        navigate(location.pathname, { replace: true });
        return;
      }

      // Handle successful OAuth callback - ONLY for calendar OAuth (not Supabase Auth)
      // Supabase Auth uses PKCE tokens in state, calendar OAuth uses 'google' or 'outlook'
      if (code && state && (state === 'google' || state === 'outlook')) {
        const provider = state as 'google' | 'outlook';
        
        try {
          toast.info('Completing calendar connection...');
          console.log('[OAuth] Starting token exchange for provider:', provider);
          
          // First try to get existing session
          let { data: sessionData } = await supabase.auth.getSession();
          
          if (!sessionData.session) {
            console.warn('[OAuth] No session found immediately. Attempting refresh...');
            
            // Force refresh the session from localStorage
            const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
            
            if (refreshError) {
              console.warn('[OAuth] Session refresh failed:', refreshError.message);
            } else if (refreshed.session) {
              console.log('[OAuth] Session restored after refresh');
              sessionData = refreshed;
            }
          }
          
          // If still no session, wait for auth state change
          if (!sessionData.session) {
            console.warn('[OAuth] No session after refresh, waiting for auth state change...');
            
            // Wait up to 5 seconds for session to be restored
            const sessionPromise = new Promise<boolean>((resolve) => {
              const timeout = setTimeout(() => resolve(false), 5000);
              
              const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
                if (session) {
                  clearTimeout(timeout);
                  subscription.unsubscribe();
                  resolve(true);
                }
              });
            });
            
            const hasSession = await sessionPromise;
            
            if (!hasSession) {
              // No session after waiting - store OAuth params and redirect to sign in
              console.error('[OAuth] No session available after timeout');
              sessionStorage.setItem('pending_oauth_exchange', JSON.stringify({
                code,
                provider,
                redirect_uri: `${window.location.origin}${location.pathname}`,
                return_path: location.pathname
              }));
              toast.error('Please sign in to complete calendar connection');
              navigate('/auth', { replace: true });
              return;
            }
            
            // Refresh session data after waiting
            const { data: finalSession } = await supabase.auth.getSession();
            sessionData = finalSession;
          }

          console.log('[OAuth] Session found, exchanging code for tokens');
          
          const { data, error: exchangeError } = await supabase.functions.invoke('calendar-token-manager', {
            body: {
              action: 'exchange_code',
              provider: provider,
              code: code,
              redirect_uri: `${window.location.origin}${location.pathname}`
            }
          });

          if (exchangeError) {
            console.error('[OAuth] Token exchange error:', exchangeError);
            
            // Check for specific authentication error
            if (exchangeError.message?.includes('User authentication required')) {
              toast.error('Could not verify your sign-in. Please sign in and try again.');
            } else {
              toast.error(`Failed to connect calendar: ${exchangeError.message || 'Unknown error'}`);
            }
            throw exchangeError;
          }

          console.log('[OAuth] Token exchange successful:', data);
          toast.success(`Successfully connected to ${provider === 'google' ? 'Google' : 'Outlook'} Calendar`);
          
          // Trigger a sync of calendar events
          try {
            await supabase.functions.invoke('calendar-integration-manager', {
              body: {
                action: 'sync_events',
                connection_id: data.connection_id,
                start_date: new Date().toISOString(),
                end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
              }
            });
          } catch (syncError) {
            console.warn('[OAuth] Initial sync failed, will retry later:', syncError);
          }

          // Clean URL and navigate back to current page
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

import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export function useOAuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

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
        console.error('OAuth error:', error);
        toast.error(`Calendar connection failed: ${error}`);
        navigate('/settings', { replace: true });
        return;
      }

      // Handle successful OAuth callback
      if (code && state) {
        const provider = state; // 'google' or 'outlook'
        
        try {
          toast.info('Completing calendar connection...');
          
          const { data, error: exchangeError } = await supabase.functions.invoke('calendar-token-manager', {
            body: {
              action: 'exchange_code',
              provider: provider,
              code: code,
              redirect_uri: `${window.location.origin}/settings`
            }
          });

          if (exchangeError) throw exchangeError;

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
            console.warn('Initial sync failed, will retry later:', syncError);
          }

          // Clean URL and navigate
          navigate('/settings', { replace: true });
        } catch (error) {
          console.error('Failed to complete OAuth flow:', error);
          toast.error('Failed to complete calendar connection. Please try again.');
          navigate('/settings', { replace: true });
        }
      }
    };

    handleOAuthCallback();
  }, [searchParams, navigate]);
}

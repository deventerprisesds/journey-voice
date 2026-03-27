import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Calendar, RefreshCw } from 'lucide-react';
import { useLocation } from 'react-router-dom';

interface CalendarOAuthManagerProps {
  provider: 'google' | 'outlook';
  onSuccess: () => void;
  onError: (error: string) => void;
  connectionId?: string; // If provided, try silent refresh first
}

export function CalendarOAuthManager({ provider, onSuccess, onError, connectionId }: CalendarOAuthManagerProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const location = useLocation();

  const tryRefresh = async () => {
    if (!connectionId) return false;
    
    setIsRefreshing(true);
    try {
      const { data, error } = await supabase.functions.invoke('calendar-token-manager', {
        body: {
          action: 'refresh',
          connectionId,
        }
      });

      if (error || !data?.success) {
        console.warn('Silent refresh failed, will require full re-auth:', error || data);
        return false;
      }

      toast.success(`${provider === 'google' ? 'Google' : 'Outlook'} Calendar refreshed successfully`);
      onSuccess();
      return true;
    } catch (err) {
      console.warn('Silent refresh exception:', err);
      return false;
    } finally {
      setIsRefreshing(false);
    }
  };

  const initiateOAuth = async () => {
    // Try silent refresh first if we have a connectionId
    if (connectionId) {
      const refreshed = await tryRefresh();
      if (refreshed) return;
    }

    setIsConnecting(true);
    
    try {
      toast.info(`Redirecting to ${provider === 'google' ? 'Google' : 'Microsoft'}...`);
      
      const { data, error } = await supabase.functions.invoke('calendar-token-manager', {
        body: {
          action: 'get_oauth_url',
          provider,
          redirect_uri: `${window.location.origin}${location.pathname}`
        }
      });

      if (error) throw error;

      if (data?.auth_url) {
        window.location.href = data.auth_url;
      } else {
        throw new Error('No authorization URL received');
      }
    } catch (error) {
      console.error('OAuth initiation failed:', error);
      toast.error(`Failed to connect to ${provider === 'google' ? 'Google' : 'Outlook'} Calendar.`);
      onError(`Failed to connect to ${provider === 'google' ? 'Google' : 'Outlook'} Calendar.`);
      setIsConnecting(false);
    }
  };

  return (
    <div className="flex gap-2 w-full">
      {connectionId && (
        <Button 
          onClick={tryRefresh}
          disabled={isRefreshing || isConnecting}
          variant="outline"
          size="sm"
        >
          {isRefreshing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
      )}
      <Button 
        onClick={initiateOAuth}
        disabled={isConnecting || isRefreshing}
        className="flex-1"
      >
        {isConnecting ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Connecting...
          </>
        ) : (
          <>
            <Calendar className="h-4 w-4 mr-2" />
            {connectionId ? 'Reconnect' : 'Connect'} {provider === 'google' ? 'Google' : 'Outlook'} Calendar
          </>
        )}
      </Button>
    </div>
  );
}
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Calendar, RefreshCw, Plus } from 'lucide-react';
import { useLocation } from 'react-router-dom';

interface CalendarOAuthManagerProps {
  provider: 'google' | 'outlook';
  onSuccess: () => void;
  onError: (error: string) => void;
  connectionId?: string;
  label?: string; // Custom button label
}

export function CalendarOAuthManager({ provider, onSuccess, onError, connectionId, label }: CalendarOAuthManagerProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const location = useLocation();

  const tryRefresh = async () => {
    if (!connectionId) return false;
    setIsRefreshing(true);
    try {
      const { data, error } = await supabase.functions.invoke('calendar-token-manager', {
        body: { action: 'refresh', connectionId }
      });
      if (error || !data?.success) return false;
      toast.success(`${provider === 'google' ? 'Google' : 'Outlook'} Calendar refreshed successfully`);
      onSuccess();
      return true;
    } catch { return false; }
    finally { setIsRefreshing(false); }
  };

  const initiateOAuth = async () => {
    if (connectionId) {
      const refreshed = await tryRefresh();
      if (refreshed) return;
    }

    setIsConnecting(true);
    try {
      toast.info(`Redirecting to ${provider === 'google' ? 'Google' : 'Microsoft'}...`);
      const { data, error } = await supabase.functions.invoke('calendar-token-manager', {
        body: {
          action: 'get_oauth_url', provider,
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

  const providerName = provider === 'google' ? 'Google' : 'Outlook';
  const buttonLabel = label || (connectionId ? `Reconnect ${providerName} Calendar` : `Connect ${providerName} Calendar`);

  return (
    <div className="flex gap-2 w-full">
      {connectionId && (
        <Button onClick={tryRefresh} disabled={isRefreshing || isConnecting} variant="outline" size="sm">
          {isRefreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      )}
      <Button onClick={initiateOAuth} disabled={isConnecting || isRefreshing} className="flex-1" variant={connectionId ? "default" : "outline"}>
        {isConnecting ? (
          <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Connecting...</>
        ) : (
          <>{connectionId ? <Calendar className="h-4 w-4 mr-2" /> : <Plus className="h-4 w-4 mr-2" />}{buttonLabel}</>
        )}
      </Button>
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Calendar, ExternalLink } from 'lucide-react';

interface CalendarOAuthManagerProps {
  provider: 'google' | 'outlook';
  onSuccess: () => void;
  onError: (error: string) => void;
}

export function CalendarOAuthManager({ provider, onSuccess, onError }: CalendarOAuthManagerProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [authUrl, setAuthUrl] = useState<string | null>(null);

  const initiateOAuth = async () => {
    setIsConnecting(true);
    
    try {
      if (provider === 'google') {
        await initiateGoogleOAuth();
      } else if (provider === 'outlook') {
        await initiateOutlookOAuth();
      }
    } catch (error) {
      console.error('OAuth initiation failed:', error);
      onError(`Failed to initiate ${provider} OAuth`);
      setIsConnecting(false);
    }
  };

  const initiateGoogleOAuth = async () => {
    const clientId = 'your-google-client-id'; // This should come from environment/secrets
    const redirectUri = `${window.location.origin}/auth/google/callback`;
    const scope = 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events';
    
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: scope,
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent'
    });

    const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    
    // For now, we'll show a notification that real OAuth would be implemented
    toast.info('Real Google OAuth would redirect here. This is a demo implementation.');
    setIsConnecting(false);
    
    // Simulate successful connection for demo
    setTimeout(() => {
      simulateConnection('google');
    }, 1000);
  };

  const initiateOutlookOAuth = async () => {
    const clientId = 'your-outlook-client-id'; // This should come from environment/secrets
    const redirectUri = `${window.location.origin}/auth/outlook/callback`;
    const scope = 'https://graph.microsoft.com/calendars.read https://graph.microsoft.com/calendars.readwrite';
    
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: scope,
      response_type: 'code',
      access_type: 'offline'
    });

    const url = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
    
    // For now, we'll show a notification that real OAuth would be implemented
    toast.info('Real Outlook OAuth would redirect here. This is a demo implementation.');
    setIsConnecting(false);
    
    // Simulate successful connection for demo
    setTimeout(() => {
      simulateConnection('outlook');
    }, 1000);
  };

  const simulateConnection = async (providerName: string) => {
    try {
      // Simulate storing the connection
      const { data, error } = await supabase.rpc('insert_calendar_connection', {
        _provider: providerName,
        _provider_account_id: `demo_${providerName}_account_${Date.now()}`,
        _provider_account_email: `demo@${providerName}.com`,
        _access_token: `demo_access_token_${Date.now()}`,
        _refresh_token: `demo_refresh_token_${Date.now()}`,
        _expires_at: new Date(Date.now() + 3600000).toISOString(),
        _scope: 'calendar.read calendar.events'
      });

      if (error) throw error;

      toast.success(`Successfully connected to ${providerName} Calendar (Demo)`);
      onSuccess();
    } catch (error) {
      console.error('Failed to simulate connection:', error);
      onError(`Failed to connect to ${providerName}`);
    }
  };

  return (
    <Button 
      onClick={initiateOAuth}
      disabled={isConnecting}
      className="w-full"
    >
      {isConnecting ? (
        <>
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          Connecting...
        </>
      ) : (
        <>
          <Calendar className="h-4 w-4 mr-2" />
          Connect {provider === 'google' ? 'Google' : 'Outlook'} Calendar
        </>
      )}
    </Button>
  );
}
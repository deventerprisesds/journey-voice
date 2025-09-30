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
    try {
      // Get Google OAuth credentials from Supabase secrets
      const { data, error } = await supabase.functions.invoke('calendar-token-manager', {
        body: {
          action: 'get_oauth_url',
          provider: 'google',
          redirect_uri: `${window.location.origin}/settings`
        }
      });

      if (error) throw error;

      if (data?.auth_url) {
        // Redirect to Google OAuth consent screen
        window.location.href = data.auth_url;
      } else {
        throw new Error('No authorization URL received');
      }
    } catch (error) {
      console.error('Google OAuth initiation failed:', error);
      onError('Failed to connect to Google Calendar. Please try again.');
      setIsConnecting(false);
    }
  };

  const initiateOutlookOAuth = async () => {
    try {
      // Get Microsoft OAuth credentials from Supabase secrets
      const { data, error } = await supabase.functions.invoke('calendar-token-manager', {
        body: {
          action: 'get_oauth_url',
          provider: 'outlook',
          redirect_uri: `${window.location.origin}/settings`
        }
      });

      if (error) throw error;

      if (data?.auth_url) {
        // Redirect to Microsoft OAuth consent screen
        window.location.href = data.auth_url;
      } else {
        throw new Error('No authorization URL received');
      }
    } catch (error) {
      console.error('Outlook OAuth initiation failed:', error);
      onError('Failed to connect to Outlook Calendar. Please try again.');
      setIsConnecting(false);
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
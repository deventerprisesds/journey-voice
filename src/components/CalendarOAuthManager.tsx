import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Calendar, ExternalLink } from 'lucide-react';
import { useLocation } from 'react-router-dom';

interface CalendarOAuthManagerProps {
  provider: 'google' | 'outlook';
  onSuccess: () => void;
  onError: (error: string) => void;
}

export function CalendarOAuthManager({ provider, onSuccess, onError }: CalendarOAuthManagerProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const location = useLocation();

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
      toast.info('Redirecting to Google...');
      
      // Get Google OAuth credentials from Supabase secrets
      const { data, error } = await supabase.functions.invoke('calendar-token-manager', {
        body: {
          action: 'get_oauth_url',
          provider: 'google',
          redirect_uri: `${window.location.origin}${location.pathname}`
        }
      });

      if (error) {
        console.error('OAuth URL generation error:', error);
        throw error;
      }

      if (data?.auth_url) {
        console.log('Redirecting to Google OAuth consent screen');
        // Redirect to Google OAuth consent screen
        window.location.href = data.auth_url;
      } else {
        throw new Error('No authorization URL received');
      }
    } catch (error) {
      console.error('Google OAuth initiation failed:', error);
      toast.error('Failed to connect to Google Calendar. Please try again.');
      onError('Failed to connect to Google Calendar. Please try again.');
      setIsConnecting(false);
    }
  };

  const initiateOutlookOAuth = async () => {
    try {
      toast.info('Redirecting to Microsoft...');
      
      // Get Microsoft OAuth credentials from Supabase secrets
      const { data, error } = await supabase.functions.invoke('calendar-token-manager', {
        body: {
          action: 'get_oauth_url',
          provider: 'outlook',
          redirect_uri: `${window.location.origin}${location.pathname}`
        }
      });

      if (error) {
        console.error('OAuth URL generation error:', error);
        throw error;
      }

      if (data?.auth_url) {
        console.log('Redirecting to Microsoft OAuth consent screen');
        // Redirect to Microsoft OAuth consent screen
        window.location.href = data.auth_url;
      } else {
        throw new Error('No authorization URL received');
      }
    } catch (error) {
      console.error('Outlook OAuth initiation failed:', error);
      toast.error('Failed to connect to Outlook Calendar. Please try again.');
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
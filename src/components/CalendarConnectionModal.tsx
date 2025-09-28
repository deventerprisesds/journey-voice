import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Calendar, Check, Loader2, AlertCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { CalendarOAuthManager } from './CalendarOAuthManager';

interface CalendarConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnectionSuccess: () => void;
}

export function CalendarConnectionModal({ isOpen, onClose, onConnectionSuccess }: CalendarConnectionModalProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectedProviders, setConnectedProviders] = useState<string[]>([]);

  useEffect(() => {
    if (isOpen) {
      loadConnectedProviders();
    }
  }, [isOpen]);

  const loadConnectedProviders = async () => {
    try {
      const { data, error } = await supabase.rpc('get_calendar_connections_secure');
      if (error) throw error;
      
      const providers = data?.map((conn: any) => conn.provider) || [];
      setConnectedProviders(providers);
    } catch (error) {
      console.error('Failed to load connected providers:', error);
    }
  };

  const providers = [
    {
      id: 'google',
      name: 'Google Calendar',
      description: 'Connect your Google Calendar to sync events and manage availability',
      icon: '🔵',
      authUrl: 'https://accounts.google.com/oauth/authorize'
    },
    {
      id: 'outlook',
      name: 'Outlook Calendar',
      description: 'Connect your Microsoft Outlook calendar for unified scheduling',
      icon: '🔵',
      authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
    }
  ];

  const handleConnectionSuccess = () => {
    loadConnectedProviders();
    onConnectionSuccess();
  };

  const handleConnectionError = (error: string) => {
    toast.error(error);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Connect External Calendars
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-start gap-3 p-4 bg-blue-50 rounded-lg">
            <AlertCircle className="h-5 w-5 text-blue-600 mt-0.5" />
            <div className="text-sm text-blue-800">
              <p className="font-medium">Calendar Integration Benefits:</p>
              <ul className="mt-1 space-y-1 list-disc list-inside">
                <li>Automatic conflict detection when scheduling tasks</li>
                <li>View external events alongside your tasks</li>
                <li>Smart scheduling that respects your existing commitments</li>
                <li>Bi-directional sync to keep everything up-to-date</li>
              </ul>
            </div>
          </div>

          <div className="grid gap-4">
            {providers.map(provider => (
              <Card key={provider.id} className="relative">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-3">
                    <span className="text-2xl">{provider.icon}</span>
                    <div>
                      <div className="flex items-center gap-2">
                        {provider.name}
                        {connectedProviders.includes(provider.id) && (
                          <Check className="h-4 w-4 text-green-600" />
                        )}
                      </div>
                    </div>
                  </CardTitle>
                  <CardDescription>
                    {provider.description}
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  {connectedProviders.includes(provider.id) ? (
                    <Button 
                      disabled
                      className="w-full"
                      variant="secondary"
                    >
                      <Check className="h-4 w-4 mr-2" />
                      Connected
                    </Button>
                  ) : (
                    <CalendarOAuthManager
                      provider={provider.id as 'google' | 'outlook'}
                      onSuccess={handleConnectionSuccess}
                      onError={handleConnectionError}
                    />
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="text-sm text-muted-foreground text-center pt-2">
            <p>Note: OAuth integration is implemented for demo purposes. In production, you would need to configure OAuth apps with Google and Microsoft.</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
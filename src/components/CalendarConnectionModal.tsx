import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Calendar, Check, Loader2, AlertCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface CalendarConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnectionSuccess: () => void;
}

export function CalendarConnectionModal({ isOpen, onClose, onConnectionSuccess }: CalendarConnectionModalProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectedProviders, setConnectedProviders] = useState<string[]>([]);

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

  const handleConnect = async (provider: any) => {
    setIsConnecting(true);
    try {
      // In a real implementation, this would redirect to OAuth flow
      // For now, we'll simulate the connection
      toast.info(`Connecting to ${provider.name}...`);
      
      // Simulate OAuth flow
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Mock successful connection
      const mockConnection = {
        user_id: (await supabase.auth.getUser()).data.user?.id,
        provider: provider.id,
        provider_account_id: 'mock_account_id',
        provider_account_email: 'user@example.com',
        access_token: 'mock_access_token',
        refresh_token: 'mock_refresh_token',
        expires_at: new Date(Date.now() + 3600000).toISOString(), // 1 hour
        scope: 'calendar.read calendar.events',
        is_active: true
      };

      const { error } = await supabase
        .from('calendar_connections')
        .insert(mockConnection);

      if (error) throw error;

      setConnectedProviders(prev => [...prev, provider.id]);
      toast.success(`Successfully connected to ${provider.name}`);
      onConnectionSuccess();
      
    } catch (error) {
      console.error('Failed to connect calendar:', error);
      toast.error(`Failed to connect to ${provider.name}`);
    } finally {
      setIsConnecting(false);
    }
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
                  <Button 
                    onClick={() => handleConnect(provider)}
                    disabled={isConnecting || connectedProviders.includes(provider.id)}
                    className="w-full"
                    variant={connectedProviders.includes(provider.id) ? "secondary" : "default"}
                  >
                    {isConnecting ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Connecting...
                      </>
                    ) : connectedProviders.includes(provider.id) ? (
                      <>
                        <Check className="h-4 w-4 mr-2" />
                        Connected
                      </>
                    ) : (
                      `Connect ${provider.name}`
                    )}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="text-sm text-muted-foreground text-center pt-2">
            <p>Note: This is a demo implementation. In production, this would use real OAuth flows.</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
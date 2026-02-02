import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Calendar, Check, Loader2, AlertCircle, Settings2 } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { CalendarOAuthManager } from './CalendarOAuthManager';

interface CalendarConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnectionSuccess: () => void;
}

interface ConnectionStatus {
  connected: boolean;
  expired: boolean;
  connectionId?: string;
  purposes?: string[];
  email?: string;
}

export function CalendarConnectionModal({ isOpen, onClose, onConnectionSuccess }: CalendarConnectionModalProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<Record<string, ConnectionStatus>>({});
  const [editingPurposes, setEditingPurposes] = useState<string | null>(null);
  const [selectedPurposes, setSelectedPurposes] = useState<string[]>(['READ', 'WRITE']);
  const [isSavingPurposes, setIsSavingPurposes] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadConnectedProviders();
    }
  }, [isOpen]);

  const loadConnectedProviders = async () => {
    try {
      const { data, error } = await supabase.rpc('get_calendar_connections_safe');
      if (error) throw error;
      
      const status: Record<string, ConnectionStatus> = {};
      
      if (data && Array.isArray(data)) {
        data.forEach((conn: any) => {
          const isExpired = conn.expires_at ? new Date(conn.expires_at) < new Date() : false;
          
          // Normalize provider name - treat 'office365' as 'outlook'
          const providerKey = conn.provider === 'office365' ? 'outlook' : conn.provider;
          
          // Only store if not already set, or if this one is more recent/valid
          if (!status[providerKey] || (!isExpired && status[providerKey].expired)) {
            status[providerKey] = {
              connected: true,
              expired: isExpired,
              connectionId: conn.id,
              purposes: conn.purposes || ['READ', 'WRITE'],
              email: conn.provider_account_email
            };
          }
        });
      }
      
      setConnectionStatus(status);
    } catch (error) {
      console.error('Failed to load connected providers:', error);
      toast.error('Failed to load calendar connections');
    }
  };

  const handleDisconnect = async (provider: string) => {
    const connection = connectionStatus[provider];
    if (!connection?.connectionId) return;

    try {
      const { error } = await supabase.rpc('revoke_calendar_connection', {
        _connection_id: connection.connectionId
      });

      if (error) throw error;

      toast.success(`${provider === 'google' ? 'Google' : 'Outlook'} Calendar disconnected`);
      loadConnectedProviders();
    } catch (error) {
      console.error('Failed to disconnect:', error);
      toast.error('Failed to disconnect calendar');
    }
  };

  const handleEditPurposes = (provider: string) => {
    const connection = connectionStatus[provider];
    if (connection) {
      setSelectedPurposes(connection.purposes || ['READ', 'WRITE']);
      setEditingPurposes(provider);
    }
  };

  const handleSavePurposes = async () => {
    if (!editingPurposes) return;
    
    const connection = connectionStatus[editingPurposes];
    if (!connection?.connectionId) return;

    if (selectedPurposes.length === 0) {
      toast.error('Please select at least one purpose');
      return;
    }

    setIsSavingPurposes(true);
    try {
      const { data, error } = await supabase.functions.invoke('calendar-token-manager', {
        body: {
          action: 'update_purposes',
          connectionId: connection.connectionId,
          purposes: selectedPurposes
        }
      });

      if (error) throw error;

      toast.success('Calendar purpose updated');
      setEditingPurposes(null);
      loadConnectedProviders();
    } catch (error: any) {
      console.error('Failed to update purposes:', error);
      toast.error(error.message || 'Failed to update calendar purpose');
    } finally {
      setIsSavingPurposes(false);
    }
  };

  const togglePurpose = (purpose: string) => {
    setSelectedPurposes(prev => 
      prev.includes(purpose) 
        ? prev.filter(p => p !== purpose)
        : [...prev, purpose]
    );
  };

  const providers = [
    {
      id: 'google',
      name: 'Google Calendar',
      description: 'Connect your Google Calendar to sync events and manage availability',
      icon: '🔵',
    },
    {
      id: 'outlook',
      name: 'Outlook Calendar',
      description: 'Connect your Microsoft Outlook calendar for unified scheduling',
      icon: '🔵',
    }
  ];

  const handleConnectionSuccess = () => {
    loadConnectedProviders();
    onConnectionSuccess();
  };

  const handleConnectionError = (error: string) => {
    toast.error(error);
  };

  const getPurposeLabel = (purposes: string[] | undefined) => {
    if (!purposes || purposes.length === 0) return 'No purpose set';
    if (purposes.includes('READ') && purposes.includes('WRITE')) return 'Read & Write';
    if (purposes.includes('READ')) return 'Read only (pull events)';
    if (purposes.includes('WRITE')) return 'Write only (push reminders)';
    return purposes.join(', ');
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
          <div className="flex items-start gap-3 p-4 bg-blue-50 dark:bg-blue-950/30 rounded-lg">
            <AlertCircle className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5" />
            <div className="text-sm text-blue-800 dark:text-blue-200">
              <p className="font-medium">Multi-Account Calendar Support:</p>
              <ul className="mt-1 space-y-1 list-disc list-inside">
                <li><strong>Read:</strong> Pull events from this calendar for conflict detection</li>
                <li><strong>Write:</strong> Push task reminders/events to this calendar</li>
                <li>You can connect multiple accounts with different purposes</li>
              </ul>
            </div>
          </div>

          <div className="grid gap-4">
            {providers.map(provider => (
              <Card key={provider.id} className="relative">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-3">
                    <span className="text-2xl">{provider.icon}</span>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        {provider.name}
                        {connectionStatus[provider.id]?.connected && !connectionStatus[provider.id]?.expired && (
                          <Check className="h-4 w-4 text-green-600" />
                        )}
                        {connectionStatus[provider.id]?.expired && (
                          <AlertCircle className="h-4 w-4 text-yellow-600" />
                        )}
                      </div>
                      {connectionStatus[provider.id]?.email && (
                        <p className="text-xs text-muted-foreground font-normal mt-1">
                          {connectionStatus[provider.id].email}
                        </p>
                      )}
                    </div>
                  </CardTitle>
                  <CardDescription>
                    {provider.description}
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  {(() => {
                    const status = connectionStatus[provider.id];
                    
                    if (status?.connected && !status.expired) {
                      // Valid connection - show purpose editor or status
                      if (editingPurposes === provider.id) {
                        return (
                          <div className="space-y-4 p-3 bg-muted/50 rounded-lg">
                            <p className="text-sm font-medium">Use this calendar for:</p>
                            <div className="space-y-3">
                              <div className="flex items-center space-x-2">
                                <Checkbox 
                                  id={`${provider.id}-read`}
                                  checked={selectedPurposes.includes('READ')}
                                  onCheckedChange={() => togglePurpose('READ')}
                                />
                                <Label htmlFor={`${provider.id}-read`} className="text-sm">
                                  Reading events (meetings, appointments)
                                </Label>
                              </div>
                              <div className="flex items-center space-x-2">
                                <Checkbox 
                                  id={`${provider.id}-write`}
                                  checked={selectedPurposes.includes('WRITE')}
                                  onCheckedChange={() => togglePurpose('WRITE')}
                                />
                                <Label htmlFor={`${provider.id}-write`} className="text-sm">
                                  Writing task reminders/events
                                </Label>
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <Button 
                                size="sm" 
                                onClick={handleSavePurposes}
                                disabled={isSavingPurposes || selectedPurposes.length === 0}
                              >
                                {isSavingPurposes && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                Save
                              </Button>
                              <Button 
                                size="sm" 
                                variant="outline"
                                onClick={() => setEditingPurposes(null)}
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        );
                      }
                      
                      return (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between p-2 bg-muted/50 rounded">
                            <span className="text-sm text-muted-foreground">
                              Purpose: <span className="text-foreground font-medium">{getPurposeLabel(status.purposes)}</span>
                            </span>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleEditPurposes(provider.id)}
                            >
                              <Settings2 className="h-4 w-4" />
                            </Button>
                          </div>
                          <div className="flex gap-2">
                            <Button 
                              disabled
                              className="flex-1"
                              variant="secondary"
                            >
                              <Check className="h-4 w-4 mr-2" />
                              Connected
                            </Button>
                            <Button
                              onClick={() => handleDisconnect(provider.id)}
                              variant="outline"
                              size="sm"
                            >
                              Disconnect
                            </Button>
                          </div>
                        </div>
                      );
                    } else if (status?.connected && status.expired) {
                      // Expired connection
                      return (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 px-3 py-2 bg-yellow-50 dark:bg-yellow-950/30 text-yellow-800 dark:text-yellow-200 rounded-md text-sm">
                            <AlertCircle className="h-4 w-4" />
                            <span>Connection expired - please reconnect</span>
                          </div>
                          <CalendarOAuthManager
                            provider={provider.id as 'google' | 'outlook'}
                            onSuccess={handleConnectionSuccess}
                            onError={handleConnectionError}
                          />
                        </div>
                      );
                    } else {
                      // Not connected
                      return (
                        <CalendarOAuthManager
                          provider={provider.id as 'google' | 'outlook'}
                          onSuccess={handleConnectionSuccess}
                          onError={handleConnectionError}
                        />
                      );
                    }
                  })()}
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="text-sm text-muted-foreground text-center pt-2">
            <p>Connect multiple calendars with different purposes for flexible sync control.</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

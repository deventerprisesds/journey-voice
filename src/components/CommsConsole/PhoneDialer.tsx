import React, { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Phone, PhoneOff, Delete } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import type { PhoneCallState } from './types';

interface PhoneDialerProps {
  callState: PhoneCallState;
  onCallStateChange: (state: PhoneCallState) => void;
  className?: string;
}

const DIAL_PAD = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['*', '0', '#'],
];

const PhoneDialer: React.FC<PhoneDialerProps> = ({
  callState,
  onCallStateChange,
  className,
}) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Load user's phone number from profile
  useEffect(() => {
    if (!user?.id) return;

    const loadUserPhone = async () => {
      const { data } = await supabase
        .from('profiles')
        .select('phone')
        .eq('user_id', user.id)
        .single();

      if (data?.phone) {
        setPhoneNumber(data.phone);
      }
    };

    loadUserPhone();
  }, [user?.id]);

  const handleDigitPress = (digit: string) => {
    if (callState !== 'idle') return;
    setPhoneNumber((prev) => prev + digit);
  };

  const handleBackspace = () => {
    if (callState !== 'idle') return;
    setPhoneNumber((prev) => prev.slice(0, -1));
  };

  const formatPhoneNumber = (num: string): string => {
    // Remove non-digits
    const digits = num.replace(/\D/g, '');
    
    // Format as (XXX) XXX-XXXX or +X XXX XXX XXXX
    if (digits.startsWith('1') && digits.length === 11) {
      return `+1 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
    }
    if (digits.length === 10) {
      return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    return num;
  };

  const initiateCall = async () => {
    if (!phoneNumber.trim() || !user?.id) return;

    setIsLoading(true);
    onCallStateChange('dialing');

    try {
      const { data, error } = await supabase.functions.invoke('twilio-voice-handler', {
        body: {
          action: 'initiate-outbound-call',
          userId: user.id,
          phoneNumber: phoneNumber.replace(/\D/g, ''),
        },
      });

      if (error) throw error;

      if (data?.success) {
        onCallStateChange('ringing');
        toast({
          title: 'Calling...',
          description: `Dialing ${formatPhoneNumber(phoneNumber)}`,
        });

        // Simulate call connection after a delay (in reality, this would be webhook-driven)
        setTimeout(() => {
          onCallStateChange('connected');
        }, 3000);
      } else {
        throw new Error(data?.error || 'Failed to initiate call');
      }
    } catch (err) {
      console.error('Failed to initiate call:', err);
      onCallStateChange('idle');
      toast({
        title: 'Call Failed',
        description: err instanceof Error ? err.message : 'Could not connect call',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const endCall = async () => {
    onCallStateChange('ended');
    toast({
      title: 'Call Ended',
      description: 'The call has been disconnected',
    });

    // Reset to idle after showing ended state
    setTimeout(() => {
      onCallStateChange('idle');
    }, 2000);
  };

  const isInCall = callState === 'dialing' || callState === 'ringing' || callState === 'connected';

  return (
    <div className={cn('flex flex-col items-center gap-6 p-4', className)}>
      {/* Phone number display */}
      <div className="w-full max-w-xs">
        <Input
          type="tel"
          value={formatPhoneNumber(phoneNumber)}
          onChange={(e) => setPhoneNumber(e.target.value.replace(/[^\d+\-() ]/g, ''))}
          placeholder="Enter phone number"
          className="text-center text-xl font-mono h-14 bg-background"
          disabled={isInCall}
        />
      </div>

      {/* Call state indicator */}
      {callState !== 'idle' && (
        <div className="text-sm text-muted-foreground animate-pulse">
          {callState === 'dialing' && 'Dialing...'}
          {callState === 'ringing' && 'Ringing...'}
          {callState === 'connected' && 'Connected'}
          {callState === 'ended' && 'Call ended'}
        </div>
      )}

      {/* Dial pad */}
      <div className="grid grid-cols-3 gap-3">
        {DIAL_PAD.flat().map((digit) => (
          <Button
            key={digit}
            variant="outline"
            className="w-16 h-16 text-2xl font-semibold rounded-full hover:bg-accent"
            onClick={() => handleDigitPress(digit)}
            disabled={isInCall}
          >
            {digit}
          </Button>
        ))}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-4">
        {/* Backspace */}
        <Button
          variant="ghost"
          size="icon"
          className="w-14 h-14 rounded-full"
          onClick={handleBackspace}
          disabled={isInCall || !phoneNumber}
        >
          <Delete className="h-6 w-6" />
        </Button>

        {/* Call/End button */}
        {isInCall ? (
          <Button
            variant="destructive"
            size="icon"
            className="w-16 h-16 rounded-full"
            onClick={endCall}
          >
            <PhoneOff className="h-7 w-7" />
          </Button>
        ) : (
          <Button
            variant="default"
            size="icon"
            className="w-16 h-16 rounded-full bg-green-600 hover:bg-green-700"
            onClick={initiateCall}
            disabled={!phoneNumber.trim() || isLoading}
          >
            <Phone className="h-7 w-7" />
          </Button>
        )}

        {/* Spacer for symmetry */}
        <div className="w-14 h-14" />
      </div>
    </div>
  );
};

export default PhoneDialer;

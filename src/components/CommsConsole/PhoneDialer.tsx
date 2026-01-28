import React, { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Phone, PhoneOff, Mic, MicOff, Volume2, VolumeX, Clock, Users, Grid3X3, Delete, Smartphone } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useCommsConsole } from '@/contexts/CommsConsoleContext';
import { useVoiceAssistant } from '@/contexts/VoiceAssistantContext';
import { loadUserSchedulingConfig } from '@/services/schedulingService';
import AssistantAvatar from './AssistantAvatar';
import LiveTranscriptPanel from './LiveTranscriptPanel';
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

const DIAL_PAD_LETTERS: Record<string, string> = {
  '2': 'ABC',
  '3': 'DEF',
  '4': 'GHI',
  '5': 'JKL',
  '6': 'MNO',
  '7': 'PQRS',
  '8': 'TUV',
  '9': 'WXYZ',
};

// Twilio number display (could be fetched from env/config)
const TWILIO_NUMBER = '+1 (866) 585-4827';

interface RecentCall {
  id: string;
  assistantName: string;
  assistantColor: string;
  timestamp: Date;
  duration?: number;
  type: 'outgoing' | 'incoming' | 'missed';
}

const PhoneDialer: React.FC<PhoneDialerProps> = ({
  callState,
  onCallStateChange,
  className,
}) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const { currentAssistant, assistants, selectAssistant, connectVoice, disconnectVoice, sendVoiceTextMessage, isConnected } = useCommsConsole();
  const { liveTranscript } = useVoiceAssistant();
  
  // User timezone for live transcript display
  const [userTimezone, setUserTimezone] = useState('America/New_York');
  
  // Load user timezone on mount
  useEffect(() => {
    if (user?.id) {
      loadUserSchedulingConfig(user.id).then(config => {
        setUserTimezone(config.timezone || 'America/New_York');
      });
    }
  }, [user?.id]);
  
  // Ring tone audio ref
  const ringAudioRef = useRef<HTMLAudioElement | null>(null);
  
  const [activeTab, setActiveTab] = useState<string>('keypad');
  const [dialedDigits, setDialedDigits] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaker, setIsSpeaker] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [recentCalls] = useState<RecentCall[]>([
    // Mock data - would come from call_sessions table
    {
      id: '1',
      assistantName: 'Iris Chase',
      assistantColor: '#3B82F6',
      timestamp: new Date(Date.now() - 3600000),
      duration: 245,
      type: 'outgoing',
    },
  ]);

  // Initialize ring audio on mount
  useEffect(() => {
    ringAudioRef.current = new Audio('/sounds/ring-tone.mp3');
    ringAudioRef.current.loop = true;
    return () => {
      ringAudioRef.current?.pause();
      ringAudioRef.current = null;
    };
  }, []);

  // Watch connection state to stop ring and transition to connected
  useEffect(() => {
    if (isConnected && callState === 'dialing') {
      ringAudioRef.current?.pause();
      if (ringAudioRef.current) ringAudioRef.current.currentTime = 0;
      onCallStateChange('connected');
    }
  }, [isConnected, callState, onCallStateChange]);

  // Call duration timer
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (callState === 'connected') {
      interval = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    } else {
      setCallDuration(0);
    }
    return () => clearInterval(interval);
  }, [callState]);

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleDigitPress = (digit: string) => {
    if (isInCall) {
      // DTMF tone during call
      console.log('DTMF:', digit);
    } else {
      setDialedDigits((prev) => prev + digit);
    }
  };

  const handleBackspace = () => {
    if (!isInCall) {
      setDialedDigits((prev) => prev.slice(0, -1));
    }
  };

  const initiateCall = async () => {
    if (!user?.id) {
      toast({
        title: 'Not Signed In',
        description: 'Please sign in to make calls.',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);
    onCallStateChange('dialing');

    // Start playing ring sound immediately for feedback
    try {
      await ringAudioRef.current?.play();
    } catch (e) {
      // Autoplay may be blocked by browser - call still proceeds
      console.log('Ring audio autoplay blocked:', e);
    }

    try {
      // Use WebRTC voice connection (fast ~2s) instead of Twilio REST API callback
      await connectVoice();
      // The useEffect above handles stopping ring and transitioning to 'connected'
    } catch (err) {
      console.error('Failed to initiate call:', err);
      ringAudioRef.current?.pause();
      if (ringAudioRef.current) ringAudioRef.current.currentTime = 0;
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

  // Native dialer fallback for car Bluetooth, lock screen controls, etc.
  const callFromPhone = () => {
    window.location.href = 'tel:+18665854827';
  };

const endCall = () => {
    // Stop ring audio if still playing
    ringAudioRef.current?.pause();
    if (ringAudioRef.current) ringAudioRef.current.currentTime = 0;
    
    // IMMEDIATE disconnect - like a real phone hang-up
    // No AI farewell needed - if user said goodbye verbally, AI already responded
    disconnectVoice();
    
    onCallStateChange('ended');
    setIsMuted(false);
    setIsSpeaker(false);
    toast({
      title: 'Call Ended',
      description: `Duration: ${formatDuration(callDuration)}`,
    });

    setTimeout(() => {
      onCallStateChange('idle');
    }, 2000);
  };

  const isInCall = callState === 'dialing' || callState === 'ringing' || callState === 'connected';
  const orbColor = currentAssistant?.orb_color || '#3B82F6';

  return (
    <div className={cn('flex flex-col h-full bg-background', className)}>
      {/* Agent Header - Always visible */}
      <div className="flex flex-col items-center pt-6 pb-4 border-b">
        <AssistantAvatar
          name={currentAssistant?.name || 'Iris'}
          avatarUrl={currentAssistant?.avatar_url}
          avatarInitial={currentAssistant?.avatar_initial}
          orbColor={orbColor}
          size="lg"
          className="mb-3"
        />
        <h2 className="text-xl font-semibold">{currentAssistant?.name || 'Iris Chase'}</h2>
        <p className="text-sm text-muted-foreground">{TWILIO_NUMBER}</p>
        
        {/* Call Status */}
        {callState !== 'idle' && (
          <div className="mt-2 text-sm font-medium" style={{ color: orbColor }}>
            {callState === 'dialing' && 'Dialing...'}
            {callState === 'ringing' && 'Ringing...'}
            {callState === 'connected' && formatDuration(callDuration)}
            {callState === 'ended' && 'Call ended'}
          </div>
        )}
        
        {/* Connection indicator - shows when voice is still connected after call "ends" */}
        {callState === 'ended' && isConnected && (
          <div className="mt-2 text-sm text-muted-foreground">
            Disconnecting...
          </div>
        )}
        
        {/* Connection indicator - shows when voice is still connected in idle state */}
        {callState === 'idle' && isConnected && (
          <div className="mt-2 flex items-center gap-2 text-xs text-amber-500">
            <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            Voice session active
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden">
        {isInCall ? (
          /* In-Call UI */
          <div className="flex flex-col items-center justify-center h-full gap-8 p-6">
            {/* In-call controls */}
            <div className="flex gap-6">
              <Button
                variant={isMuted ? 'default' : 'outline'}
                size="icon"
                className="w-14 h-14 rounded-full"
                onClick={() => setIsMuted(!isMuted)}
              >
                {isMuted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
              </Button>
              
              <Button
                variant={isSpeaker ? 'default' : 'outline'}
                size="icon"
                className="w-14 h-14 rounded-full"
                onClick={() => setIsSpeaker(!isSpeaker)}
              >
                {isSpeaker ? <Volume2 className="h-6 w-6" /> : <VolumeX className="h-6 w-6" />}
              </Button>
            </div>

            {/* Keypad (for DTMF during call) */}
            <div className="grid grid-cols-3 gap-3">
              {DIAL_PAD.flat().map((digit) => (
                <Button
                  key={digit}
                  variant="ghost"
                  className="w-16 h-16 text-xl font-semibold rounded-full flex flex-col"
                  onClick={() => handleDigitPress(digit)}
                >
                  <span>{digit}</span>
                  {DIAL_PAD_LETTERS[digit] && (
                    <span className="text-[10px] text-muted-foreground tracking-widest">
                      {DIAL_PAD_LETTERS[digit]}
                    </span>
                  )}
                </Button>
              ))}
            </div>

            {/* End Call */}
            <Button
              variant="destructive"
              size="icon"
              className="w-16 h-16 rounded-full"
              onClick={endCall}
            >
              <PhoneOff className="h-7 w-7" />
            </Button>
            
            {/* Live Transcription Panel - visible during call */}
            <div className="w-full max-w-sm">
              <LiveTranscriptPanel
                liveTranscript={liveTranscript}
                isConnected={isConnected}
                userTimezone={userTimezone}
              />
            </div>
          </div>
        ) : (
          /* Pre-Call Tabs UI */
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col h-full">
            <TabsContent value="keypad" className="flex-1 flex flex-col items-center justify-center p-4 m-0">
              {/* Dialed digits display */}
              {dialedDigits && (
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-2xl font-mono tracking-wider">{dialedDigits}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={handleBackspace}
                  >
                    <Delete className="h-4 w-4" />
                  </Button>
                </div>
              )}

              {/* Dial pad */}
              <div className="grid grid-cols-3 gap-3">
                {DIAL_PAD.flat().map((digit) => (
                  <Button
                    key={digit}
                    variant="outline"
                    className="w-16 h-16 text-xl font-semibold rounded-full flex flex-col hover:bg-accent active:scale-95 transition-transform"
                    onClick={() => handleDigitPress(digit)}
                  >
                    <span>{digit}</span>
                    {DIAL_PAD_LETTERS[digit] && (
                      <span className="text-[10px] text-muted-foreground tracking-widest">
                        {DIAL_PAD_LETTERS[digit]}
                      </span>
                    )}
                  </Button>
                ))}
              </div>

              {/* Call button */}
              <Button
                variant="default"
                size="icon"
                className="w-16 h-16 rounded-full bg-green-600 hover:bg-green-700 mt-6"
                onClick={initiateCall}
                disabled={isLoading}
              >
                <Phone className="h-7 w-7" />
              </Button>

              {/* Native dialer fallback */}
              <button
                onClick={callFromPhone}
                className="text-sm text-muted-foreground mt-4 flex items-center gap-1.5 hover:text-foreground transition-colors"
              >
                <Smartphone className="h-4 w-4" />
                Call from my phone
              </button>
            </TabsContent>

            <TabsContent value="recents" className="flex-1 overflow-auto p-4 m-0">
              {recentCalls.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                  <Clock className="h-12 w-12 mb-2 opacity-50" />
                  <p>No recent calls</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {recentCalls.map((call) => (
                    <div
                      key={call.id}
                      className="flex items-center gap-3 p-3 rounded-lg hover:bg-accent cursor-pointer"
                      onClick={initiateCall}
                    >
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-white font-medium"
                        style={{ backgroundColor: call.assistantColor }}
                      >
                        {call.assistantName.charAt(0)}
                      </div>
                      <div className="flex-1">
                        <p className="font-medium">{call.assistantName}</p>
                        <p className="text-sm text-muted-foreground">
                          {call.type === 'missed' && '📵 Missed • '}
                          {call.type === 'incoming' && '📲 Incoming • '}
                          {call.type === 'outgoing' && '📞 Outgoing • '}
                          {call.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          {call.duration && ` • ${formatDuration(call.duration)}`}
                        </p>
                      </div>
                      <Phone className="h-5 w-5 text-green-600" />
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="contacts" className="flex-1 overflow-auto p-4 m-0">
              <p className="text-sm text-muted-foreground mb-4">Select an assistant to call:</p>
              <div className="space-y-2">
                {assistants.map((assistant) => (
                  <div
                    key={assistant.id}
                    className={cn(
                      'flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors',
                      currentAssistant?.id === assistant.id
                        ? 'bg-accent ring-2 ring-primary'
                        : 'hover:bg-accent'
                    )}
                    onClick={() => selectAssistant(assistant)}
                  >
                    <AssistantAvatar
                      name={assistant.name}
                      avatarUrl={assistant.avatar_url}
                      avatarInitial={assistant.avatar_initial}
                      orbColor={assistant.orb_color}
                      size="md"
                    />
                    <div className="flex-1">
                      <p className="font-medium">{assistant.name}</p>
                      {assistant.description && (
                        <p className="text-sm text-muted-foreground truncate">
                          {assistant.description}
                        </p>
                      )}
                    </div>
                    {currentAssistant?.id === assistant.id && (
                      <div className="w-2 h-2 rounded-full bg-green-500" />
                    )}
                  </div>
                ))}
              </div>
            </TabsContent>

            {/* Tab Bar at bottom */}
            <TabsList className="grid w-full grid-cols-3 h-14 rounded-none border-t bg-background">
              <TabsTrigger value="keypad" className="flex flex-col gap-0.5 h-full data-[state=active]:bg-accent">
                <Grid3X3 className="h-5 w-5" />
                <span className="text-xs">Keypad</span>
              </TabsTrigger>
              <TabsTrigger value="recents" className="flex flex-col gap-0.5 h-full data-[state=active]:bg-accent">
                <Clock className="h-5 w-5" />
                <span className="text-xs">Recents</span>
              </TabsTrigger>
              <TabsTrigger value="contacts" className="flex flex-col gap-0.5 h-full data-[state=active]:bg-accent">
                <Users className="h-5 w-5" />
                <span className="text-xs">Contacts</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}
      </div>
    </div>
  );
};

export default PhoneDialer;
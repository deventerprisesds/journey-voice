import React, { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Phone, PhoneOff, Mic, MicOff, Volume2, VolumeX, Clock, Users, Grid3X3, Delete, Smartphone, MessageSquareText, ChevronDown, Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useCommsConsole } from '@/contexts/CommsConsoleContext';
import { useVoiceAssistant } from '@/contexts/VoiceAssistantContext';
import { loadUserSchedulingConfig } from '@/services/schedulingService';
import { supabase } from '@/integrations/supabase/client';
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

interface CallHistoryItem {
  id: string;
  sessionId: string;
  activityType: 'phone_inbound' | 'phone_outbound' | 'voice_webrtc';
  assistantName: string;
  assistantColor: string;
  startedAt: Date;
  duration: number | null;
  status: string;
}

interface TranscriptMessage {
  id: string;
  role: string;
  content: string;
  created_at: string;
}

const PhoneDialer: React.FC<PhoneDialerProps> = ({
  callState,
  onCallStateChange,
  className,
}) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const { currentAssistant, assistants, selectAssistant, connectVoice, disconnectVoice, sendVoiceTextMessage, isConnected } = useCommsConsole();
  const { liveTranscript, voiceTranscripts } = useVoiceAssistant();
  
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
  
  // Call history state - fetched from database
  const [callHistory, setCallHistory] = useState<CallHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [expandedCallId, setExpandedCallId] = useState<string | null>(null);
  const [callTranscripts, setCallTranscripts] = useState<Record<string, TranscriptMessage[]>>({});
  const [transcriptLoading, setTranscriptLoading] = useState<string | null>(null);

  // Fetch call history from database
  useEffect(() => {
    const fetchCallHistory = async () => {
      const userId = user?.id || '00000000-0000-0000-0000-000000000001';
      setHistoryLoading(true);
      
      try {
        const { data: activityData, error } = await supabase
          .from('activity_log')
          .select('*')
          .eq('user_id', userId)
          .in('activity_type', ['phone_inbound', 'phone_outbound', 'voice_webrtc'])
          .in('status', ['completed', 'ended', 'connected'])
          .order('started_at', { ascending: false })
          .limit(20);
        
        if (error) {
          console.error('Failed to fetch call history:', error);
          return;
        }
        
        const history: CallHistoryItem[] = (activityData || []).map(activity => ({
          id: activity.id,
          sessionId: activity.session_id || '',
          activityType: activity.activity_type as CallHistoryItem['activityType'],
          assistantName: currentAssistant?.name || 'Iris',
          assistantColor: currentAssistant?.orb_color || '#3B82F6',
          startedAt: new Date(activity.started_at || activity.created_at),
          duration: activity.duration_seconds,
          status: activity.status,
        }));
        
        setCallHistory(history);
      } catch (err) {
        console.error('Error fetching call history:', err);
      } finally {
        setHistoryLoading(false);
      }
    };
    
    fetchCallHistory();
  }, [user?.id, currentAssistant]);

  // Load transcript for a specific call when expanded
  const loadCallTranscript = async (sessionId: string) => {
    if (callTranscripts[sessionId] || !sessionId) return;
    
    setTranscriptLoading(sessionId);
    
    try {
      const { data: messages, error } = await supabase
        .from('conversation_messages')
        .select('id, role, content, created_at')
        .eq('voice_session_id', sessionId)
        .order('created_at', { ascending: true });
      
      if (error) {
        console.error('Failed to load transcript:', error);
        setCallTranscripts(prev => ({ ...prev, [sessionId]: [] }));
        return;
      }
      
      setCallTranscripts(prev => ({
        ...prev,
        [sessionId]: (messages || []) as TranscriptMessage[]
      }));
    } catch (err) {
      console.error('Error loading transcript:', err);
      setCallTranscripts(prev => ({ ...prev, [sessionId]: [] }));
    } finally {
      setTranscriptLoading(null);
    }
  };

  const handleCallExpand = (call: CallHistoryItem) => {
    if (expandedCallId === call.id) {
      setExpandedCallId(null);
    } else {
      setExpandedCallId(call.id);
      loadCallTranscript(call.sessionId);
    }
  };

  const formatRelativeTime = (date: Date): string => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const getCallTypeIcon = (activityType: string) => {
    switch (activityType) {
      case 'voice_webrtc': return '🎧';
      case 'phone_inbound': return '📲';
      case 'phone_outbound': return '📞';
      default: return '📞';
    }
  };

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

  // Format timestamp for transcript display
  const formatTimestamp = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: userTimezone,
    });
  };

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

              {/* Call mode buttons - Phone (Private) and Speaker (Fast) */}
              <div className="flex flex-col items-center gap-3 mt-6">
                <div className="flex gap-4">
                  {/* Phone mode - Twilio via native dialer (earpiece) */}
                  <Button
                    variant="outline"
                    className="flex flex-col items-center gap-1 h-auto py-4 px-6 rounded-2xl border-2 hover:border-green-600 hover:bg-green-50 dark:hover:bg-green-950"
                    onClick={callFromPhone}
                  >
                    <div className="w-12 h-12 rounded-full bg-green-600 flex items-center justify-center">
                      <Smartphone className="h-6 w-6 text-white" />
                    </div>
                    <span className="font-medium">Phone</span>
                    <span className="text-xs text-muted-foreground">Private</span>
                  </Button>

                  {/* Speaker mode - In-app WebRTC */}
                  <Button
                    variant="outline"
                    className="flex flex-col items-center gap-1 h-auto py-4 px-6 rounded-2xl border-2 hover:border-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950"
                    onClick={initiateCall}
                    disabled={isLoading}
                  >
                    <div className="w-12 h-12 rounded-full bg-blue-600 flex items-center justify-center">
                      <Volume2 className="h-6 w-6 text-white" />
                    </div>
                    <span className="font-medium">Speaker</span>
                    <span className="text-xs text-muted-foreground">Fast</span>
                  </Button>
                </div>
                
                <p className="text-xs text-muted-foreground text-center max-w-[200px]">
                  Phone uses earpiece • Speaker uses loudspeaker
                </p>
              </div>
            </TabsContent>

            {/* Transcript History Tab */}
            <TabsContent value="transcript" className="flex-1 overflow-hidden p-4 m-0">
              {voiceTranscripts.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                  <MessageSquareText className="h-12 w-12 mb-2 opacity-50" />
                  <p>No conversation history</p>
                  <p className="text-xs mt-1">Start a call to see transcripts</p>
                </div>
              ) : (
                <ScrollArea className="h-full pr-2">
                  <div className="space-y-3">
                    {voiceTranscripts.map((message) => (
                      <div
                        key={message.id}
                        className={cn(
                          'flex flex-col max-w-[85%] rounded-xl px-3 py-2',
                          message.role === 'user'
                            ? 'ml-auto bg-primary text-primary-foreground'
                            : 'mr-auto bg-muted'
                        )}
                      >
                        <p className="text-sm">{message.content}</p>
                        <span
                          className={cn(
                            'text-[10px] mt-1',
                            message.role === 'user'
                              ? 'text-primary-foreground/70'
                              : 'text-muted-foreground'
                          )}
                        >
                          {message.role === 'user' ? 'You' : 'Assistant'} • {formatTimestamp(message.created_at)}
                        </span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </TabsContent>

            <TabsContent value="recents" className="flex-1 overflow-auto p-0 m-0">
              {historyLoading ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : callHistory.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-4">
                  <Clock className="h-12 w-12 mb-2 opacity-50" />
                  <p>No recent calls</p>
                  <p className="text-xs mt-1">Start a voice session to see history</p>
                </div>
              ) : (
                <ScrollArea className="h-full">
                  {callHistory.map((call) => (
                    <div key={call.id} className="border-b last:border-b-0">
                      {/* Call header - clickable to expand */}
                      <div 
                        className="flex items-center gap-3 p-3 hover:bg-accent cursor-pointer"
                        onClick={() => handleCallExpand(call)}
                      >
                        <div
                          className="w-10 h-10 rounded-full flex items-center justify-center text-lg"
                          style={{ backgroundColor: call.assistantColor + '20' }}
                        >
                          {getCallTypeIcon(call.activityType)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-medium truncate">{call.assistantName}</p>
                            <span className="text-xs text-muted-foreground capitalize px-1.5 py-0.5 bg-muted rounded">
                              {call.activityType.replace('voice_', '').replace('phone_', '')}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {formatRelativeTime(call.startedAt)}
                            {call.duration && ` • ${formatDuration(call.duration)}`}
                          </p>
                        </div>
                        <ChevronDown className={cn(
                          "h-4 w-4 text-muted-foreground transition-transform",
                          expandedCallId === call.id && "rotate-180"
                        )} />
                      </div>
                      
                      {/* Expanded transcript section */}
                      {expandedCallId === call.id && (
                        <div className="px-3 pb-3 space-y-2 bg-muted/30">
                          {transcriptLoading === call.sessionId ? (
                            <div className="flex justify-center py-4">
                              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                            </div>
                          ) : !callTranscripts[call.sessionId] || callTranscripts[call.sessionId].length === 0 ? (
                            <p className="text-xs text-muted-foreground text-center py-3">
                              No transcript available
                            </p>
                          ) : (
                            <div className="space-y-2 pt-2">
                              {callTranscripts[call.sessionId].map((msg) => (
                                <div
                                  key={msg.id}
                                  className={cn(
                                    'text-xs px-2.5 py-1.5 rounded-lg max-w-[90%]',
                                    msg.role === 'user' 
                                      ? 'ml-auto bg-primary text-primary-foreground' 
                                      : 'mr-auto bg-background border'
                                  )}
                                >
                                  <span className="font-medium text-[10px] opacity-70 block mb-0.5">
                                    {msg.role === 'user' ? 'You' : 'Assistant'}
                                  </span>
                                  {msg.content}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </ScrollArea>
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

            {/* Tab Bar at bottom - 4 columns now */}
            <TabsList className="grid w-full grid-cols-4 h-14 rounded-none border-t bg-background">
              <TabsTrigger value="keypad" className="flex flex-col gap-0.5 h-full data-[state=active]:bg-accent">
                <Grid3X3 className="h-5 w-5" />
                <span className="text-xs">Keypad</span>
              </TabsTrigger>
              <TabsTrigger value="transcript" className="flex flex-col gap-0.5 h-full data-[state=active]:bg-accent">
                <MessageSquareText className="h-5 w-5" />
                <span className="text-xs">Transcript</span>
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
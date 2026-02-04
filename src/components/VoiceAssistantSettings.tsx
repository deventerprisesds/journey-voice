import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { loadUserSchedulingConfig, saveUserSchedulingConfig, type SchedulingConfigWithInstructions, type CustomVoice, type ScheduledCall, type PhoneCallMode, type CommsMode } from '@/services/schedulingService';
import { Loader2, RotateCcw, Save, Plus, Trash2, Volume2, Phone, Clock, AlertCircle, Radio, Copy, Check, MessageSquare, Mail, Hash } from 'lucide-react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Alert, AlertDescription } from '@/components/ui/alert';

const DEFAULT_CORE_INSTRUCTIONS = `You are Iris, a knowledgeable and proactive executive assistant.

HONESTY - ABSOLUTE RULE (NEVER VIOLATE):
- NEVER fabricate, invent, or assume factual data (scores, weather, news, prices, dates, statistics)
- If a web_search fails or returns no results, say "I couldn't find that information"
- If uncertain about real-world facts, explicitly state uncertainty
- ALWAYS report exactly what web_search returns - do not embellish or add information
- When asked about current events and search is unavailable, respond: "I need to search for that but couldn't access real-time data right now"
- If no sources returned from search, say "I found this but couldn't verify the source"

PERSONALITY:
- Warm, efficient, and naturally conversational
- Action-first: Execute tasks immediately with brief confirmations
- Proactive: Offer helpful follow-up suggestions after completing tasks
- Time-aware: Use appropriate greetings based on time of day

TOOL USAGE - CRITICAL:
- ALWAYS use tools to get current data (get_tasks, get_today_tasks, web_search)
- Never rely on pre-loaded context for dynamic information
- For weather, sports, news, stocks, current events - use web_search immediately

Available functions:
- get_tasks: Search/retrieve tasks with time/keyword filtering
- get_today_tasks: Get today's scheduled tasks
- create_task: Create new tasks (only when explicitly requested)
- update_task: Modify existing tasks
- reschedule_task: Move tasks to different date/time
- schedule_task: Auto-schedule unscheduled tasks
- unschedule_task: Remove from calendar
- web_search: Real-time internet search for weather, news, sports, facts
- send_email: Send emails
- send_slack_message: Send Slack messages
- create_outlook_event: Create Outlook calendar events
- create_google_event: Create Google calendar events

IMPORTANT:
- Only create tasks when explicitly requested
- Use web_search for any real-time information
- Keep responses concise and conversational
- When user says goodbye, end the conversation gracefully`;

// Preset ElevenLabs voices
const PRESET_ELEVENLABS_VOICES = [
  { name: 'Sarah', id: 'EXAVITQu4vr4xnSDxMaL', description: 'Female, warm (Default)' },
  { name: 'George', id: 'JBFqnCBsd6RMkjVDRZzb', description: 'Male, professional' },
  { name: 'Roger', id: 'CwhRBWXzGAHq8TQ4Fs17', description: 'Male, clear' },
  { name: 'Lily', id: 'pFZP5JQG7iQjIQuC4Bku', description: 'Female, friendly' },
];

// OpenAI Realtime voices
const OPENAI_VOICES = [
  { name: 'Alloy', id: 'alloy', description: 'Neutral, balanced' },
  { name: 'Ash', id: 'ash', description: 'Warm, conversational' },
  { name: 'Ballad', id: 'ballad', description: 'Soft, gentle' },
  { name: 'Coral', id: 'coral', description: 'Clear, professional' },
  { name: 'Echo', id: 'echo', description: 'Smooth, engaging' },
  { name: 'Fable', id: 'fable', description: 'Storytelling, expressive' },
  { name: 'Onyx', id: 'onyx', description: 'Deep, authoritative' },
  { name: 'Nova', id: 'nova', description: 'Warm, friendly' },
  { name: 'Sage', id: 'sage', description: 'Calm, measured' },
  { name: 'Shimmer', id: 'shimmer', description: 'Bright, energetic' },
  { name: 'Verse', id: 'verse', description: 'Dynamic, versatile' },
];

// Default scheduled calls
const DEFAULT_SCHEDULED_CALLS: ScheduledCall[] = [
  {
    id: 'morning_standup',
    name: 'Morning Stand-up',
    time: '11:00',
    enabled: true,
    callType: 'morning_standup',
    context: "Today's agenda review. Share what's scheduled for today, check on priorities, and see if any tasks need to be added."
  },
  {
    id: 'midday_checkin',
    name: 'Midday Check-in',
    time: '12:30',
    enabled: true,
    callType: 'midday_checkin',
    context: "Progress check. See how the day is going, ask if there's anything blocking progress, and if any help or rescheduling is needed."
  },
  {
    id: 'eod_wrapup',
    name: 'End of Day Wrap-up',
    time: '19:00',
    enabled: true,
    callType: 'eod_wrapup',
    context: "Daily summary. Summarize what was completed, what still needs to be done, priorities for tomorrow, and ask about evening focus areas."
  }
];

const VoiceAssistantSettings: React.FC = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  const [coreInstructions, setCoreInstructions] = useState('');
  const [schedulingPhilosophy, setSchedulingPhilosophy] = useState('');
  const [realtimeExtensions, setRealtimeExtensions] = useState('');
  const [assistantExtensions, setAssistantExtensions] = useState('');
  const [autoGreetingTimeout, setAutoGreetingTimeout] = useState('5');
  
  // TTS settings
  const [ttsProvider, setTtsProvider] = useState<'openai' | 'elevenlabs'>('openai');
  const [elevenlabsVoiceId, setElevenlabsVoiceId] = useState('EXAVITQu4vr4xnSDxMaL');
  const [openaiVoice, setOpenaiVoice] = useState('alloy');
  const [customVoices, setCustomVoices] = useState<CustomVoice[]>([]);
  const [newVoiceName, setNewVoiceName] = useState('');
  const [newVoiceId, setNewVoiceId] = useState('');
  const [copiedVoiceId, setCopiedVoiceId] = useState<string | null>(null);

  // Scheduled calls
  const [scheduledCalls, setScheduledCalls] = useState<ScheduledCall[]>(DEFAULT_SCHEDULED_CALLS);
  const [recurringCallsEnabled, setRecurringCallsEnabled] = useState(true);
  const [newCallName, setNewCallName] = useState('');
  const [newCallTime, setNewCallTime] = useState('09:00');
  
  // Phone call infrastructure
  const [phoneCallMode, setPhoneCallMode] = useState<PhoneCallMode>('media_streams');

  useEffect(() => {
    if (user?.id) {
      loadConfig();
    }
  }, [user?.id]);

  const loadConfig = async () => {
    if (!user?.id) return;
    
    setLoading(true);
    try {
      const config = await loadUserSchedulingConfig(user.id);
      setCoreInstructions(config.core_instructions || DEFAULT_CORE_INSTRUCTIONS);
      setSchedulingPhilosophy(config.customAIInstructions || '');
      setRealtimeExtensions(config.realtime_extensions || '');
      setAssistantExtensions(config.assistant_extensions || '');
      setAutoGreetingTimeout(config.auto_greeting_timeout?.toString() || '5');
      setTtsProvider(config.tts_provider || 'openai');
      setElevenlabsVoiceId(config.elevenlabs_voice_id || 'EXAVITQu4vr4xnSDxMaL');
      setOpenaiVoice(config.openai_voice || 'alloy');
      setCustomVoices(config.custom_voices || []);
      setScheduledCalls(config.scheduled_calls && config.scheduled_calls.length > 0 
        ? config.scheduled_calls 
        : DEFAULT_SCHEDULED_CALLS);
      setRecurringCallsEnabled(config.recurring_calls_enabled ?? true);
      setPhoneCallMode(config.phone_call_mode || 'media_streams');
    } catch (error) {
      console.error('Failed to load AI instructions:', error);
      toast({
        title: "Error",
        description: "Failed to load AI instructions",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!user?.id) return;
    
    setSaving(true);
    try {
      const success = await saveUserSchedulingConfig(user.id, {
        core_instructions: coreInstructions,
        customAIInstructions: schedulingPhilosophy,
        realtime_extensions: realtimeExtensions,
        assistant_extensions: assistantExtensions,
        auto_greeting_timeout: parseInt(autoGreetingTimeout) || 5,
        tts_provider: ttsProvider,
        elevenlabs_voice_id: elevenlabsVoiceId,
        openai_voice: openaiVoice,
        custom_voices: customVoices,
        scheduled_calls: scheduledCalls,
        recurring_calls_enabled: recurringCallsEnabled,
        phone_call_mode: phoneCallMode,
      } as any);

      if (success) {
        toast({
          title: "Saved",
          description: "AI instruction settings updated successfully",
        });
      } else {
        throw new Error('Save failed');
      }
    } catch (error) {
      console.error('Failed to save AI instructions:', error);
      toast({
        title: "Error",
        description: "Failed to save AI instructions",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setCoreInstructions(DEFAULT_CORE_INSTRUCTIONS);
    setSchedulingPhilosophy('');
    setRealtimeExtensions('');
    setAssistantExtensions('');
    setAutoGreetingTimeout('5');
    setTtsProvider('openai');
    setElevenlabsVoiceId('EXAVITQu4vr4xnSDxMaL');
    setOpenaiVoice('alloy');
    setCustomVoices([]);
    setScheduledCalls(DEFAULT_SCHEDULED_CALLS);
    setRecurringCallsEnabled(true);
    setPhoneCallMode('media_streams');
    toast({
      title: "Reset",
      description: "All instructions reset to defaults",
    });
  };

  const handleAddCustomVoice = () => {
    if (!newVoiceName.trim() || !newVoiceId.trim()) {
      toast({
        title: "Error",
        description: "Please provide both voice name and ID",
        variant: "destructive",
      });
      return;
    }

    if (customVoices.some(v => v.id === newVoiceId)) {
      toast({
        title: "Error",
        description: "A voice with this ID already exists",
        variant: "destructive",
      });
      return;
    }

    setCustomVoices([...customVoices, { name: newVoiceName.trim(), id: newVoiceId.trim() }]);
    setNewVoiceName('');
    setNewVoiceId('');
    toast({
      title: "Voice Added",
      description: `Added "${newVoiceName}" to your custom voices`,
    });
  };

  const handleRemoveCustomVoice = (voiceId: string) => {
    setCustomVoices(customVoices.filter(v => v.id !== voiceId));
    if (elevenlabsVoiceId === voiceId) {
      setElevenlabsVoiceId('EXAVITQu4vr4xnSDxMaL');
    }
  };

  const handleCopyVoiceId = async (voiceId: string) => {
    await navigator.clipboard.writeText(voiceId);
    setCopiedVoiceId(voiceId);
    setTimeout(() => setCopiedVoiceId(null), 2000);
  };

  const getAllElevenlabsVoices = () => {
    return [...PRESET_ELEVENLABS_VOICES, ...customVoices.map(v => ({ ...v, description: 'Custom' }))];
  };

  const getSelectedElevenlabsVoiceName = () => {
    const voice = getAllElevenlabsVoices().find(v => v.id === elevenlabsVoiceId);
    return voice?.name || 'Unknown';
  };

  const getSelectedOpenaiVoiceName = () => {
    const voice = OPENAI_VOICES.find(v => v.id === openaiVoice);
    return voice?.name || 'Alloy';
  };

  // Scheduled calls handlers
  const handleToggleCall = (callId: string) => {
    setScheduledCalls(calls =>
      calls.map(call =>
        call.id === callId ? { ...call, enabled: !call.enabled } : call
      )
    );
  };

  const handleUpdateCallTime = (callId: string, time: string) => {
    setScheduledCalls(calls =>
      calls.map(call =>
        call.id === callId ? { ...call, time } : call
      )
    );
  };

  const handleUpdateCallName = (callId: string, name: string) => {
    setScheduledCalls(calls =>
      calls.map(call =>
        call.id === callId ? { ...call, name } : call
      )
    );
  };

  const handleUpdateCallContext = (callId: string, context: string) => {
    setScheduledCalls(calls =>
      calls.map(call =>
        call.id === callId ? { ...call, context } : call
      )
    );
  };

  const handleUpdateCallCommsMode = (callId: string, commsMode: CommsMode) => {
    setScheduledCalls(calls =>
      calls.map(call =>
        call.id === callId ? { ...call, commsMode } : call
      )
    );
  };
  const handleAddCustomCall = () => {
    if (!newCallName.trim()) {
      toast({
        title: "Error",
        description: "Please provide a name for the call",
        variant: "destructive",
      });
      return;
    }

    const newCall: ScheduledCall = {
      id: `custom_${Date.now()}`,
      name: newCallName.trim(),
      time: newCallTime,
      enabled: true,
      callType: 'custom',
      context: 'Custom check-in call.',
    };

    setScheduledCalls([...scheduledCalls, newCall]);
    setNewCallName('');
    setNewCallTime('09:00');
    toast({
      title: "Call Added",
      description: `Added "${newCall.name}" to your recurring calls`,
    });
  };

  const handleRemoveCall = (callId: string) => {
    setScheduledCalls(calls => calls.filter(call => call.id !== callId));
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>AI Instructions</CardTitle>
          <CardDescription>Loading...</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI Instructions</CardTitle>
        <CardDescription>
          Customize how your AI assistants behave across voice, text, and scheduling
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="core" className="w-full">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="core">Core</TabsTrigger>
            <TabsTrigger value="scheduling">Scheduling</TabsTrigger>
            <TabsTrigger value="voice">Voice</TabsTrigger>
            <TabsTrigger value="recurring">Recurring Calls</TabsTrigger>
            <TabsTrigger value="assistant">Assistant</TabsTrigger>
          </TabsList>

          <TabsContent value="core" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="core-instructions">Core Instructions</Label>
              <p className="text-sm text-muted-foreground">
                Shared instructions used by all AI systems (voice assistant, text assistant, and scheduler)
              </p>
              <Textarea
                id="core-instructions"
                value={coreInstructions}
                onChange={(e) => setCoreInstructions(e.target.value)}
                className="min-h-[400px] font-mono text-sm"
                placeholder="Enter core AI instructions..."
              />
            </div>
          </TabsContent>

          <TabsContent value="scheduling" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="scheduling-philosophy">Scheduling Philosophy</Label>
              <p className="text-sm text-muted-foreground">
                Custom scheduling preferences and philosophy used by the smart scheduler
              </p>
              <Textarea
                id="scheduling-philosophy"
                value={schedulingPhilosophy}
                onChange={(e) => setSchedulingPhilosophy(e.target.value)}
                className="min-h-[400px] font-mono text-sm"
                placeholder="E.g., 'Prioritize deep work in the morning, schedule meetings in the afternoon...'"
              />
            </div>
          </TabsContent>

          <TabsContent value="voice" className="space-y-6">
            {/* Phone Call Engine Selection */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Radio className="h-5 w-5 text-primary" />
                <Label className="text-base font-medium">Phone Call Engine</Label>
              </div>
              <p className="text-sm text-muted-foreground">
                Choose the infrastructure for phone calls. This affects call duration limits and available voices.
              </p>
              
              <RadioGroup
                value={phoneCallMode}
                onValueChange={(value) => setPhoneCallMode(value as PhoneCallMode)}
                className="grid gap-3"
              >
                <div className="flex items-center space-x-3 rounded-lg border p-4">
                  <RadioGroupItem value="media_streams" id="media_streams" />
                  <Label htmlFor="media_streams" className="flex-1 cursor-pointer">
                    <div className="font-medium">90 sec OpenAI Media Streams (Recommended)</div>
                    <div className="text-sm text-muted-foreground">
                      OpenAI/ElevenLabs voices • ~90 sec call limit • Best voice quality
                    </div>
                  </Label>
                </div>
                <div className="flex items-center space-x-3 rounded-lg border p-4">
                  <RadioGroupItem value="conversation_relay" id="conversation_relay" />
                  <Label htmlFor="conversation_relay" className="flex-1 cursor-pointer">
                    <div className="font-medium">Conversation Relay</div>
                    <div className="text-sm text-muted-foreground">
                      Twilio voices only • 4 hour call limit • Text-based processing
                    </div>
                  </Label>
                </div>
                <div className="flex items-center space-x-3 rounded-lg border p-4">
                  <RadioGroupItem value="cloudflare" id="cloudflare" />
                  <Label htmlFor="cloudflare" className="flex-1 cursor-pointer">
                    <div className="font-medium">Cloudflare Workers</div>
                    <div className="text-sm text-muted-foreground">
                      OpenAI/ElevenLabs voices • Unlimited duration • Best of both
                    </div>
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {/* TTS Provider Selection */}
            <div className="space-y-4 border-t pt-4">
              <div>
                <Label className="text-base font-medium">Voice Provider</Label>
                <p className="text-sm text-muted-foreground mb-3">
                  Choose the text-to-speech engine for both in-app and phone calls
                </p>
              </div>
              
              <RadioGroup
                value={ttsProvider}
                onValueChange={(value) => setTtsProvider(value as 'openai' | 'elevenlabs')}
                className="grid gap-3"
              >
                <div className="flex items-center space-x-3 rounded-lg border p-4">
                  <RadioGroupItem value="openai" id="openai" />
                  <Label htmlFor="openai" className="flex-1 cursor-pointer">
                    <div className="font-medium">OpenAI (Standard)</div>
                    <div className="text-sm text-muted-foreground">Built-in voice with fast response</div>
                  </Label>
                </div>
                <div className="flex items-center space-x-3 rounded-lg border p-4">
                  <RadioGroupItem value="elevenlabs" id="elevenlabs" />
                  <Label htmlFor="elevenlabs" className="flex-1 cursor-pointer">
                    <div className="font-medium flex items-center gap-2">
                      ElevenLabs (Natural Voice)
                      <Volume2 className="h-4 w-4 text-primary" />
                    </div>
                    <div className="text-sm text-muted-foreground">Premium natural-sounding voices</div>
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {/* OpenAI Voice Selection (shown when OpenAI is selected) */}
            {ttsProvider === 'openai' && (
              <div className="space-y-4 border-t pt-4">
                <div>
                  <Label className="text-base font-medium">OpenAI Voice</Label>
                  <p className="text-sm text-muted-foreground mb-3">
                    Select a voice for the AI assistant (currently: {getSelectedOpenaiVoiceName()})
                  </p>
                </div>

                <Select value={openaiVoice} onValueChange={setOpenaiVoice}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a voice" />
                  </SelectTrigger>
                  <SelectContent>
                    {OPENAI_VOICES.map((voice) => (
                      <SelectItem key={voice.id} value={voice.id}>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{voice.name}</span>
                          <span className="text-muted-foreground text-sm">- {voice.description}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* ElevenLabs Voice Selection (shown when ElevenLabs is selected) */}
            {ttsProvider === 'elevenlabs' && (
              <div className="space-y-4 border-t pt-4">
                <div>
                  <Label className="text-base font-medium">ElevenLabs Voice</Label>
                  <p className="text-sm text-muted-foreground mb-3">
                    Select a voice for the AI assistant (currently: {getSelectedElevenlabsVoiceName()})
                  </p>
                </div>

                <Select value={elevenlabsVoiceId} onValueChange={setElevenlabsVoiceId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a voice" />
                  </SelectTrigger>
                  <SelectContent>
                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Preset Voices</div>
                    {PRESET_ELEVENLABS_VOICES.map((voice) => (
                      <SelectItem key={voice.id} value={voice.id}>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{voice.name}</span>
                          <span className="text-muted-foreground text-sm">- {voice.description}</span>
                        </div>
                      </SelectItem>
                    ))}
                    {customVoices.length > 0 && (
                      <>
                        <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground mt-2">Custom Voices</div>
                        {customVoices.map((voice) => (
                          <SelectItem key={voice.id} value={voice.id}>
                            <span className="font-medium">{voice.name}</span>
                          </SelectItem>
                        ))}
                      </>
                    )}
                  </SelectContent>
                </Select>

                {/* Add Custom Voice */}
                <div className="space-y-3 pt-2">
                  <Label className="text-sm font-medium">Add Custom Voice</Label>
                  <p className="text-xs text-muted-foreground">
                    Add voices from your ElevenLabs library using the voice ID
                  </p>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Voice name"
                      value={newVoiceName}
                      onChange={(e) => setNewVoiceName(e.target.value)}
                      className="flex-1"
                    />
                    <Input
                      placeholder="Voice ID"
                      value={newVoiceId}
                      onChange={(e) => setNewVoiceId(e.target.value)}
                      className="flex-1"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={handleAddCustomVoice}
                      disabled={!newVoiceName.trim() || !newVoiceId.trim()}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>

                  {/* Custom Voice List */}
                  {customVoices.length > 0 && (
                    <div className="space-y-2 pt-2">
                      {customVoices.map((voice) => (
                        <div
                          key={voice.id}
                          className="flex items-center justify-between rounded-md border px-3 py-2"
                        >
                          <div className="flex-1 min-w-0">
                            <span className="font-medium">{voice.name}</span>
                            <div className="flex items-center gap-1 mt-0.5">
                              <code className="text-xs text-muted-foreground font-mono break-all">
                                {voice.id}
                              </code>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-5 w-5 shrink-0"
                                onClick={() => handleCopyVoiceId(voice.id)}
                                title="Copy voice ID"
                              >
                                {copiedVoiceId === voice.id ? (
                                  <Check className="h-3 w-3 text-green-500" />
                                ) : (
                                  <Copy className="h-3 w-3" />
                                )}
                              </Button>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => handleRemoveCustomVoice(voice.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Auto-Greeting Timeout */}
            <div className="space-y-2 border-t pt-4">
              <Label htmlFor="auto-greeting-timeout">Auto-Greeting Timeout (seconds)</Label>
              <p className="text-sm text-muted-foreground">
                If no speech is detected within this time after connecting, the assistant will greet you
              </p>
              <Input
                id="auto-greeting-timeout"
                type="number"
                min="1"
                max="30"
                value={autoGreetingTimeout}
                onChange={(e) => setAutoGreetingTimeout(e.target.value)}
                className="max-w-xs"
              />
            </div>
            
            {/* Voice-Specific Extensions */}
            <div className="space-y-2 border-t pt-4">
              <Label htmlFor="realtime-extensions">Voice-Specific Extensions</Label>
              <p className="text-sm text-muted-foreground">
                Additional instructions specific to the realtime voice assistant (WebRTC)
              </p>
              <Textarea
                id="realtime-extensions"
                value={realtimeExtensions}
                onChange={(e) => setRealtimeExtensions(e.target.value)}
                className="min-h-[200px] font-mono text-sm"
                placeholder="E.g., 'Use casual language when responding to voice commands...'"
              />
            </div>
          </TabsContent>

          {/* Recurring Calls Tab */}
          <TabsContent value="recurring" className="space-y-6">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Phone className="h-5 w-5 text-primary" />
                <Label className="text-base font-medium">Recurring Voice Calls</Label>
              </div>
              <p className="text-sm text-muted-foreground">
                Schedule automated phone calls for daily stand-ups, check-ins, and wrap-ups. 
                The AI will call you at the specified times with context-aware briefings.
              </p>
            </div>

            {/* Master Toggle */}
            <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg border">
              <div className="space-y-0.5">
                <Label className="text-base font-medium">Enable Recurring Calls</Label>
                <p className="text-sm text-muted-foreground">
                  Turn off to pause all scheduled calls during testing
                </p>
              </div>
              <Switch
                checked={recurringCallsEnabled}
                onCheckedChange={setRecurringCallsEnabled}
              />
            </div>

            {/* Alert when paused */}
            {!recurringCallsEnabled && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  All recurring calls are paused. Individual settings are preserved.
                </AlertDescription>
              </Alert>
            )}

            {/* Scheduled Calls List */}
            <div className={`space-y-4 ${!recurringCallsEnabled ? 'opacity-50' : ''}`}>
              {scheduledCalls.map((call) => (
                <Collapsible key={call.id} className="border rounded-lg">
                  <div className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-4 flex-1">
                      <Switch
                        checked={call.enabled}
                        onCheckedChange={() => handleToggleCall(call.id)}
                      />
                      <div className="flex-1">
                        <Input
                          value={call.name}
                          onChange={(e) => handleUpdateCallName(call.id, e.target.value)}
                          className="font-medium border-none p-0 h-auto focus-visible:ring-0 bg-transparent"
                        />
                        <div className="flex items-center gap-2 mt-1">
                          <Clock className="h-3 w-3 text-muted-foreground" />
                          <Input
                            type="time"
                            value={call.time}
                            onChange={(e) => handleUpdateCallTime(call.id, e.target.value)}
                            className="w-24 h-6 text-xs border-none p-0 focus-visible:ring-0 bg-transparent text-muted-foreground"
                          />
                          <span className="text-muted-foreground">•</span>
                          <Select
                            value={call.commsMode || 'phone'}
                            onValueChange={(value) => handleUpdateCallCommsMode(call.id, value as CommsMode)}
                          >
                            <SelectTrigger className="h-6 w-28 text-xs border-none p-0 focus:ring-0 bg-transparent">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="phone">
                                <div className="flex items-center gap-1.5">
                                  <Phone className="h-3 w-3" />
                                  <span>Phone Call</span>
                                </div>
                              </SelectItem>
                              <SelectItem value="app_message">
                                <div className="flex items-center gap-1.5">
                                  <MessageSquare className="h-3 w-3" />
                                  <span>In-App Chat</span>
                                </div>
                              </SelectItem>
                              <SelectItem value="slack">
                                <div className="flex items-center gap-1.5">
                                  <Hash className="h-3 w-3" />
                                  <span>Slack</span>
                                </div>
                              </SelectItem>
                              <SelectItem value="email">
                                <div className="flex items-center gap-1.5">
                                  <Mail className="h-3 w-3" />
                                  <span>Email</span>
                                </div>
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" size="sm">
                          Edit Context
                        </Button>
                      </CollapsibleTrigger>
                      {call.callType === 'custom' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => handleRemoveCall(call.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                  <CollapsibleContent className="px-4 pb-4">
                    <Textarea
                      value={call.context}
                      onChange={(e) => handleUpdateCallContext(call.id, e.target.value)}
                      className="min-h-[100px] text-sm"
                      placeholder="Describe what the AI should focus on during this call..."
                    />
                  </CollapsibleContent>
                </Collapsible>
              ))}
            </div>

            {/* Add Custom Call */}
            <div className="space-y-3 pt-4 border-t">
              <Label className="text-sm font-medium">Add Custom Call</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="Call name (e.g., 'Weekly Review')"
                  value={newCallName}
                  onChange={(e) => setNewCallName(e.target.value)}
                  className="flex-1"
                />
                <Input
                  type="time"
                  value={newCallTime}
                  onChange={(e) => setNewCallTime(e.target.value)}
                  className="w-32"
                />
                <Button
                  variant="outline"
                  onClick={handleAddCustomCall}
                  disabled={!newCallName.trim()}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Call
                </Button>
              </div>
            </div>

            {/* Info Note */}
            <div className="bg-muted/50 rounded-lg p-4 text-sm text-muted-foreground">
              <p className="font-medium text-foreground mb-1">How it works:</p>
              <ul className="list-disc list-inside space-y-1">
                <li>Calls are made to your phone number saved in your profile</li>
                <li>The AI uses the context you provide to personalize each call</li>
                <li>Morning calls include your daily agenda, EOD calls summarize your progress</li>
                <li>You can add, remove, and customize calls as needed</li>
              </ul>
            </div>
          </TabsContent>

          <TabsContent value="assistant" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="assistant-extensions">Text Assistant Extensions</Label>
              <p className="text-sm text-muted-foreground">
                Additional instructions for the text-based assistant (used for complex reasoning)
              </p>
              <Textarea
                id="assistant-extensions"
                value={assistantExtensions}
                onChange={(e) => setAssistantExtensions(e.target.value)}
                className="min-h-[400px] font-mono text-sm"
                placeholder="E.g., 'When analyzing tasks, provide detailed breakdowns...'"
              />
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex items-center gap-3 mt-6 pt-6 border-t">
          <Button
            variant="outline"
            onClick={handleReset}
            disabled={saving}
            className="flex items-center gap-2"
          >
            <RotateCcw className="h-4 w-4" />
            Reset to Defaults
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                Save Preferences
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default VoiceAssistantSettings;

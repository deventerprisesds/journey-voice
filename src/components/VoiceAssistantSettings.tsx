import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { loadUserSchedulingConfig, saveUserSchedulingConfig, type SchedulingConfigWithInstructions, type CustomVoice } from '@/services/schedulingService';
import { Loader2, RotateCcw, Save, Plus, Trash2, Volume2 } from 'lucide-react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

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
const PRESET_VOICES = [
  { name: 'Sarah', id: 'EXAVITQu4vr4xnSDxMaL', description: 'Female, warm (Default)' },
  { name: 'George', id: 'JBFqnCBsd6RMkjVDRZzb', description: 'Male, professional' },
  { name: 'Roger', id: 'CwhRBWXzGAHq8TQ4Fs17', description: 'Male, clear' },
  { name: 'Lily', id: 'pFZP5JQG7iQjIQuC4Bku', description: 'Female, friendly' },
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
  const [customVoices, setCustomVoices] = useState<CustomVoice[]>([]);
  const [newVoiceName, setNewVoiceName] = useState('');
  const [newVoiceId, setNewVoiceId] = useState('');

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
      setCustomVoices(config.custom_voices || []);
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
        custom_voices: customVoices,
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
    setCustomVoices([]);
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

    // Check for duplicates
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
    // If the removed voice was selected, switch to default
    if (elevenlabsVoiceId === voiceId) {
      setElevenlabsVoiceId('EXAVITQu4vr4xnSDxMaL');
    }
  };

  const getAllVoices = () => {
    return [...PRESET_VOICES, ...customVoices.map(v => ({ ...v, description: 'Custom' }))];
  };

  const getSelectedVoiceName = () => {
    const voice = getAllVoices().find(v => v.id === elevenlabsVoiceId);
    return voice?.name || 'Unknown';
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
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="core">Core</TabsTrigger>
            <TabsTrigger value="scheduling">Scheduling</TabsTrigger>
            <TabsTrigger value="voice">Voice</TabsTrigger>
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
            {/* TTS Provider Selection */}
            <div className="space-y-4">
              <div>
                <Label className="text-base font-medium">Voice Provider</Label>
                <p className="text-sm text-muted-foreground mb-3">
                  Choose the text-to-speech engine for phone calls
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

            {/* ElevenLabs Voice Selection (shown when ElevenLabs is selected) */}
            {ttsProvider === 'elevenlabs' && (
              <div className="space-y-4 border-t pt-4">
                <div>
                  <Label className="text-base font-medium">ElevenLabs Voice</Label>
                  <p className="text-sm text-muted-foreground mb-3">
                    Select a voice for phone calls (currently: {getSelectedVoiceName()})
                  </p>
                </div>

                <Select value={elevenlabsVoiceId} onValueChange={setElevenlabsVoiceId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a voice" />
                  </SelectTrigger>
                  <SelectContent>
                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Preset Voices</div>
                    {PRESET_VOICES.map((voice) => (
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
                          <div>
                            <span className="font-medium">{voice.name}</span>
                            <span className="text-xs text-muted-foreground ml-2">({voice.id.substring(0, 12)}...)</span>
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

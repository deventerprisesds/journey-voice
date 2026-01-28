import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useVoiceAssistant } from '@/contexts/VoiceAssistantContext';
import { useUnifiedThread } from '@/hooks/useUnifiedThread';
import type {
  Assistant,
  ConversationMessage,
  CommunicationMode,
  VoiceState,
  PhoneCallState,
  CommsConsoleState,
} from '@/components/CommsConsole/types';

// Extended state to include allMessages for unified display
interface ExtendedCommsConsoleState extends CommsConsoleState {
  allMessages: ConversationMessage[];
}

interface CommsConsoleContextValue extends ExtendedCommsConsoleState {
  togglePanel: () => void;
  toggleSidebar: () => void;
  selectAssistant: (assistant: Assistant) => void;
  setMode: (mode: CommunicationMode) => void;
  sendMessage: (content: string) => Promise<void>;
  connectVoice: () => Promise<void>;
  disconnectVoice: () => void;
  sendVoiceTextMessage: (text: string) => void;
  setPhoneCallState: (state: PhoneCallState) => void;
  isMobileSidebarOpen: boolean;
  setMobileSidebarOpen: (open: boolean) => void;
}

const CommsConsoleContext = createContext<CommsConsoleContextValue | null>(null);

// Demo user ID for preview mode
const DEMO_USER_ID = '00000000-0000-0000-0000-000000000001';

// Dev user ID - demo mode shares dev's assistants
const DEV_USER_ID = 'a3378f93-d655-4913-b2fa-ca5b1d8020f1';

// Supabase edge function URL
const SUPABASE_URL = 'https://wwxgajrtmslzklnyplah.supabase.co';

// Default Iris assistant
const DEFAULT_IRIS: Omit<Assistant, 'id' | 'user_id' | 'created_at' | 'updated_at'> = {
  name: 'Iris',
  description: 'Personal AI assistant for tasks, calendar, and communications',
  avatar_url: null,
  avatar_initial: 'I',
  orb_color: '#3B82F6',
  orb_animation: 'pulse',
  openai_assistant_id: null,
  voice_id: null,
  persona_prompt: null,
  tools_enabled: [],
  is_default: true,
  is_active: true,
};

// ============================================================
// SSE Streaming Helpers
// ============================================================
function parseSSEDelta(chunk: string): { type: string; content?: string; threadId?: string } | null {
  const lines = chunk.split('\n');
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const data = line.slice(6);
    if (data === '[DONE]') return { type: 'done' };
    try {
      return JSON.parse(data);
    } catch {
      // Skip malformed JSON
    }
  }
  return null;
}

export const CommsConsoleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isDemoMode, session } = useAuth();
  const voiceAssistant = useVoiceAssistant();

  // Panel state
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(() => {
    const stored = localStorage.getItem('comms-sidebar-expanded');
    return stored ? JSON.parse(stored) : true;
  });
  const [isMobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Assistant state
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [currentAssistant, setCurrentAssistant] = useState<Assistant | null>(null);

  // Communication state
  const [currentMode, setCurrentMode] = useState<CommunicationMode>('chat');
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // Phone state
  const [phoneCallState, setPhoneCallState] = useState<PhoneCallState>('idle');

  const userId = user?.id || (isDemoMode ? DEMO_USER_ID : null);

  // Feature flags
  const USE_UNIFIED_THREADS = true;
  const USE_STREAMING = true; // Enable SSE streaming

  // Unified thread management (parallel to existing threadId state)
  const { 
    dbThreadId, 
    updateOpenaiThreadId,
  } = useUnifiedThread({
    userId,
    assistantId: currentAssistant?.id || null,
    enabled: USE_UNIFIED_THREADS
  });

  // Derive voice state from voice assistant context
  const voiceState: VoiceState = useMemo(() => {
    if (voiceAssistant.isProcessing) return 'processing';
    if (voiceAssistant.isSpeaking) return 'speaking';
    if (voiceAssistant.isListening) return 'listening';
    return 'idle';
  }, [voiceAssistant.isProcessing, voiceAssistant.isSpeaking, voiceAssistant.isListening]);

  
  // Merge voice transcripts with chat messages based on current mode
  const allMessages = useMemo(() => {
    if (currentMode === 'voice') {
      return voiceAssistant.voiceTranscripts || [];
    }
    return messages; // Chat/phone messages
  }, [currentMode, messages, voiceAssistant.voiceTranscripts]);

  // Persist sidebar state
  useEffect(() => {
    localStorage.setItem('comms-sidebar-expanded', JSON.stringify(isSidebarExpanded));
  }, [isSidebarExpanded]);

  // Fetch assistants on mount
  useEffect(() => {
    if (!userId) return;

    const fetchAssistants = async () => {
      try {
        // For demo mode, fetch dev user's assistants (shared Iris approach)
        const targetUserId = isDemoMode ? DEV_USER_ID : userId;
        
        const { data, error } = await supabase
          .from('assistants')
          .select('*')
          .eq('user_id', targetUserId)
          .eq('is_active', true)
          .order('is_default', { ascending: false })
          .order('created_at', { ascending: true });

        if (error) throw error;

        if (data && data.length > 0) {
          // Map to proper Assistant type
          const mapped: Assistant[] = data.map((a: Record<string, unknown>) => ({
            id: a.id as string,
            user_id: a.user_id as string,
            name: a.name as string,
            description: a.description as string | null,
            avatar_url: a.avatar_url as string | null,
            avatar_initial: a.avatar_initial as string | null,
            orb_color: (a.orb_color as string) || '#3B82F6',
            orb_animation: (a.orb_animation as string) || 'pulse',
            openai_assistant_id: a.openai_assistant_id as string | null,
            voice_id: a.voice_id as string | null,
            persona_prompt: a.persona_prompt as string | null,
            tools_enabled: (a.tools_enabled as string[]) || [],
            is_default: a.is_default as boolean,
            is_active: a.is_active as boolean,
            created_at: a.created_at as string,
            updated_at: a.updated_at as string,
          }));
          setAssistants(mapped);
          setCurrentAssistant(mapped[0]);
        } else {
          // In demo mode, don't create a new assistant - dev's Iris should exist
          if (isDemoMode) {
            console.error('Demo mode: Dev Iris assistant not found. Expected it to exist.');
            const mockIris: Assistant = {
              id: 'mock-iris-id',
              user_id: userId,
              ...DEFAULT_IRIS,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            setAssistants([mockIris]);
            setCurrentAssistant(mockIris);
            return;
          }
          
          // Create default Iris assistant for authenticated users
          const { data: newAssistant, error: createError } = await supabase
            .from('assistants')
            .insert({ ...DEFAULT_IRIS, user_id: userId })
            .select()
            .single();

          if (createError) {
            console.error('Failed to create default assistant:', createError);
            // Use a mock assistant as fallback
            const mockIris: Assistant = {
              id: 'mock-iris-id',
              user_id: userId,
              ...DEFAULT_IRIS,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            setAssistants([mockIris]);
            setCurrentAssistant(mockIris);
          } else if (newAssistant) {
            const mapped: Assistant = {
              id: newAssistant.id,
              user_id: newAssistant.user_id,
              name: newAssistant.name,
              description: newAssistant.description,
              avatar_url: newAssistant.avatar_url,
              avatar_initial: newAssistant.avatar_initial,
              orb_color: newAssistant.orb_color || '#3B82F6',
              orb_animation: newAssistant.orb_animation || 'pulse',
              openai_assistant_id: newAssistant.openai_assistant_id,
              voice_id: newAssistant.voice_id,
              persona_prompt: newAssistant.persona_prompt,
              tools_enabled: newAssistant.tools_enabled as string[] || [],
              is_default: newAssistant.is_default,
              is_active: newAssistant.is_active,
              created_at: newAssistant.created_at,
              updated_at: newAssistant.updated_at,
            };
            setAssistants([mapped]);
            setCurrentAssistant(mapped);
          }
        }
      } catch (err) {
        console.error('Error fetching assistants:', err);
        // Fallback to mock for demo
        const mockIris: Assistant = {
          id: 'mock-iris-id',
          user_id: userId,
          ...DEFAULT_IRIS,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        setAssistants([mockIris]);
        setCurrentAssistant(mockIris);
      }
    };

    fetchAssistants();
  }, [userId]);

  const togglePanel = useCallback(() => {
    setIsPanelOpen((prev) => !prev);
  }, []);

  const toggleSidebar = useCallback(() => {
    setIsSidebarExpanded((prev: boolean) => !prev);
  }, []);

  const selectAssistant = useCallback((assistant: Assistant) => {
    setCurrentAssistant(assistant);
  }, []);

  const setMode = useCallback((mode: CommunicationMode) => {
    setCurrentMode(mode);
    
    // Disconnect voice when leaving voice mode
    if (mode !== 'voice' && voiceAssistant.isConnected) {
      voiceAssistant.disconnectAssistant();
    }
  }, [voiceAssistant]);

  // ============================================================
  // PHASE 2 & 3: Streaming sendMessage with Latency Metrics
  // ============================================================
  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || !userId) return;

    // Guard: In unified mode, wait for dbThreadId to be ready
    if (USE_UNIFIED_THREADS && !dbThreadId) {
      console.log('[CommsConsole] Waiting for thread initialization...');
      const systemMessage: ConversationMessage = {
        id: `system-${Date.now()}`,
        role: 'system',
        content: 'Initializing conversation... Please wait a moment.',
        source: currentMode,
        assistant_id: null,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, systemMessage]);
      return;
    }

    const userMessage: ConversationMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content,
      source: currentMode,
      assistant_id: currentAssistant?.id || null,
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    // Latency metrics
    const requestStartTime = Date.now();
    let timeToFirstToken: number | null = null;

    // Use unified thread if enabled
    const effectiveThreadId = USE_UNIFIED_THREADS ? dbThreadId : threadId;
    
    console.log('[CommsConsole] Sending message with threadId:', effectiveThreadId, 'streaming:', USE_STREAMING);

    try {
      if (USE_STREAMING && session?.access_token) {
        // ============================================================
        // STREAMING MODE: SSE with incremental updates
        // ============================================================
        const assistantMessageId = `assistant-${Date.now()}`;
        
        // Add placeholder assistant message
        setMessages((prev) => [...prev, {
          id: assistantMessageId,
          role: 'assistant',
          content: '',
          source: currentMode,
          assistant_id: currentAssistant?.id || null,
          created_at: new Date().toISOString(),
        }]);

        const response = await fetch(`${SUPABASE_URL}/functions/v1/hybrid-assistant-api`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
            'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3eGdhanJ0bXNsemtsbnlwbGFoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg0MDI3MzIsImV4cCI6MjA3Mzk3ODczMn0._M_B3093_wjfFe4vwXmKXVCcw-QG5UhRAT4-H-aGoHE'
          },
          body: JSON.stringify({
            userInput: content,
            userId,
            threadId: effectiveThreadId,
            assistantId: currentAssistant?.openai_assistant_id || undefined,
            dbAssistantId: currentAssistant?.id || undefined,
            stream: true
          })
        });

        // Check if we got a streaming response or JSON fallback
        const contentType = response.headers.get('content-type') || '';
        
        if (contentType.includes('text/event-stream')) {
          // Handle SSE stream
          const reader = response.body?.getReader();
          const decoder = new TextDecoder();
          let fullContent = '';
          let receivedThreadId: string | null = null;

          while (reader) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const parsed = parseSSEDelta(chunk);

            if (parsed) {
              if (parsed.type === 'delta' && parsed.content) {
                if (!timeToFirstToken) {
                  timeToFirstToken = Date.now() - requestStartTime;
                  console.log(`[CommsConsole] Time to first token: ${timeToFirstToken}ms`);
                }
                fullContent += parsed.content;
                setMessages((prev) => prev.map(m =>
                  m.id === assistantMessageId
                    ? { ...m, content: fullContent }
                    : m
                ));
              } else if (parsed.type === 'done') {
                receivedThreadId = parsed.threadId || null;
              } else if (parsed.type === 'tool_call') {
                // Show tool call indicator
                setMessages((prev) => prev.map(m =>
                  m.id === assistantMessageId
                    ? { ...m, content: fullContent + `\n\n_Using ${parsed.content || 'tools'}..._` }
                    : m
                ));
              }
            }
          }

          // Update OpenAI thread ID if returned
          if (receivedThreadId && USE_UNIFIED_THREADS && updateOpenaiThreadId) {
            updateOpenaiThreadId(receivedThreadId);
          }

          // Final cleanup - remove tool indicator if present
          setMessages((prev) => prev.map(m =>
            m.id === assistantMessageId
              ? { ...m, content: fullContent }
              : m
          ));

          // Persist messages with latency metrics
          const responseTimeMs = Date.now() - requestStartTime;
          const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
          
          persistMessagesWithMetrics(
            content,
            fullContent,
            effectiveThreadId || '',
            {
              response_time_ms: responseTimeMs,
              time_to_first_token: timeToFirstToken,
              word_count: fullContent.split(/\s+/).filter(Boolean).length,
              content_length: fullContent.length,
              user_timezone: userTimezone,
              request_timestamp: new Date(requestStartTime).toISOString(),
              streamed: true
            }
          );

        } else {
          // JSON response (fast path or fallback)
          const data = await response.json();
          
          if (!response.ok) {
            throw new Error(data.error || 'Request failed');
          }

          const assistantContent = data.response || 'Sorry, I could not process your request.';
          
          setMessages((prev) => prev.map(m =>
            m.id === assistantMessageId
              ? { ...m, content: assistantContent }
              : m
          ));

          if (data.threadId && USE_UNIFIED_THREADS && updateOpenaiThreadId) {
            updateOpenaiThreadId(data.threadId);
          }

          // Persist with metrics
          const responseTimeMs = Date.now() - requestStartTime;
          persistMessagesWithMetrics(
            content,
            assistantContent,
            effectiveThreadId || '',
            {
              response_time_ms: responseTimeMs,
              time_to_first_token: responseTimeMs, // For non-streaming, TTFT = total time
              word_count: assistantContent.split(/\s+/).filter(Boolean).length,
              content_length: assistantContent.length,
              user_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              request_timestamp: new Date(requestStartTime).toISOString(),
              streamed: false,
              fast_path: data.fastPath || false
            }
          );
        }

      } else {
        // ============================================================
        // FALLBACK: Original non-streaming mode (via supabase.functions.invoke)
        // ============================================================
        const { data, error } = await supabase.functions.invoke('hybrid-assistant-api', {
          body: {
            userInput: content,
            userId,
            threadId: effectiveThreadId,
            assistantId: currentAssistant?.openai_assistant_id || undefined,
            dbAssistantId: currentAssistant?.id || undefined,
          },
        });

        if (error) throw error;

        const assistantMessage: ConversationMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: data?.response || 'Sorry, I could not process your request.',
          source: currentMode,
          assistant_id: currentAssistant?.id || null,
          created_at: new Date().toISOString(),
        };

        setMessages((prev) => [...prev, assistantMessage]);

        if (data?.threadId && !USE_UNIFIED_THREADS) {
          setThreadId(data.threadId);
        }
        
        if (data?.threadId && USE_UNIFIED_THREADS && updateOpenaiThreadId) {
          updateOpenaiThreadId(data.threadId);
        }

        // Persist messages with metrics
        const responseTimeMs = Date.now() - requestStartTime;
        persistMessagesWithMetrics(
          content,
          data?.response || '',
          effectiveThreadId || '',
          {
            response_time_ms: responseTimeMs,
            time_to_first_token: responseTimeMs,
            word_count: (data?.response || '').split(/\s+/).filter(Boolean).length,
            content_length: (data?.response || '').length,
            user_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            request_timestamp: new Date(requestStartTime).toISOString(),
            streamed: false
          }
        );
      }

    } catch (err) {
      console.error('Error sending message:', err);
      const errorMessage: ConversationMessage = {
        id: `error-${Date.now()}`,
        role: 'system',
        content: 'Failed to send message. Please try again.',
        source: currentMode,
        assistant_id: null,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  }, [userId, threadId, currentAssistant, currentMode, dbThreadId, updateOpenaiThreadId, session]);

  // ============================================================
  // PHASE 3: Persist Messages with Latency Metrics
  // ============================================================
  const persistMessagesWithMetrics = useCallback((
    userContent: string,
    assistantContent: string,
    threadIdForPersistence: string,
    metrics: {
      response_time_ms: number;
      time_to_first_token: number | null;
      word_count: number;
      content_length: number;
      user_timezone: string;
      request_timestamp: string;
      streamed: boolean;
      fast_path?: boolean;
    }
  ) => {
    if (!threadIdForPersistence || !userId) return;

    // Persist user message
    supabase.functions.invoke('generate-embeddings', {
      body: {
        action: 'store_conversation',
        userId,
        threadId: threadIdForPersistence,
        assistantId: currentAssistant?.id || null,
        source: 'chat',
        role: 'user',
        content: userContent,
        messageType: 'user',
        metadata: { mode: 'comms_console' }
      }
    }).catch(err => console.error('[CommsConsole] Failed to persist user message:', err));

    // Persist assistant message with latency metrics
    supabase.functions.invoke('generate-embeddings', {
      body: {
        action: 'store_conversation',
        userId,
        threadId: threadIdForPersistence,
        assistantId: currentAssistant?.id || null,
        source: 'chat',
        role: 'assistant',
        content: assistantContent,
        messageType: 'assistant',
        metadata: {
          mode: 'comms_console',
          ...metrics
        }
      }
    }).catch(err => console.error('[CommsConsole] Failed to persist assistant message:', err));

    console.log(`[CommsConsole] Persisted with metrics: response_time=${metrics.response_time_ms}ms, ttft=${metrics.time_to_first_token}ms, streamed=${metrics.streamed}`);
  }, [userId, currentAssistant?.id]);

  // Connect voice with unified thread and assistant ID for cross-mode memory
  const connectVoice = useCallback(async () => {
    await voiceAssistant.connectToAssistant(dbThreadId || undefined, currentAssistant?.id || undefined);
  }, [voiceAssistant, dbThreadId, currentAssistant?.id]);

  const disconnectVoice = useCallback(() => {
    voiceAssistant.disconnectAssistant();
  }, [voiceAssistant]);

  const sendVoiceTextMessage = useCallback((text: string) => {
    voiceAssistant.sendTextMessage(text);
  }, [voiceAssistant]);

  const value: CommsConsoleContextValue = {
    isPanelOpen,
    isSidebarExpanded,
    currentAssistant,
    assistants,
    currentMode,
    messages,
    allMessages,
    threadId,
    isLoading,
    voiceState,
    isConnected: voiceAssistant.isConnected,
    phoneCallState,
    connectionError,
    togglePanel,
    toggleSidebar,
    selectAssistant,
    setMode,
    sendMessage,
    connectVoice,
    disconnectVoice,
    sendVoiceTextMessage,
    setPhoneCallState,
    isMobileSidebarOpen,
    setMobileSidebarOpen,
  };

  return (
    <CommsConsoleContext.Provider value={value}>
      {children}
    </CommsConsoleContext.Provider>
  );
};

export const useCommsConsole = (): CommsConsoleContextValue => {
  const context = useContext(CommsConsoleContext);
  if (!context) {
    throw new Error('useCommsConsole must be used within a CommsConsoleProvider');
  }
  return context;
};

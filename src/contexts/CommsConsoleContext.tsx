import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useVoiceAssistant } from '@/contexts/VoiceAssistantContext';
import { useUnifiedThread } from '@/hooks/useUnifiedThread';
import { usePresenceTracking } from '@/hooks/usePresenceTracking';
import { logRealtime, logChat } from '@/utils/activityLogger';
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
  retryLastMessage: () => Promise<void>;
  startNewConversation: () => void;
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
function parseSSEEvents(chunk: string): Array<{ type: string; content?: string; threadId?: string; message?: string }> {
  const events: Array<{ type: string; content?: string; threadId?: string; message?: string }> = [];
  const lines = chunk.split('\n');
  
  for (const line of lines) {
    // Skip heartbeat comments (SSE keep-alive)
    if (line.startsWith(':')) continue;
    
    if (!line.startsWith('data: ')) continue;
    const data = line.slice(6).trim();
    if (!data) continue;
    if (data === '[DONE]') {
      events.push({ type: 'done' });
      continue;
    }
    try {
      events.push(JSON.parse(data));
    } catch {
      // Skip malformed JSON (may be split across chunks)
    }
  }
  
  return events;
}

export const CommsConsoleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isDemoMode, session } = useAuth();
  const voiceAssistant = useVoiceAssistant();
  const [searchParams, setSearchParams] = useSearchParams();

  // Panel state - default to open on desktop
  const [isPanelOpen, setIsPanelOpen] = useState(() => {
    const stored = localStorage.getItem('comms-panel-open');
    return stored ? JSON.parse(stored) : true;
  });
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
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [lastUserMessage, setLastUserMessage] = useState<string | null>(null);
  // Phone state
  const [phoneCallState, setPhoneCallState] = useState<PhoneCallState>('idle');
  
  // Realtime subscription state for logging
  const [realtimeStatus, setRealtimeStatus] = useState<string>('idle');
  const subscribeStartTimeRef = useRef<number | null>(null);
  const bridgePendingRef = useRef(false);

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

  // Persist sidebar and panel state
  useEffect(() => {
    localStorage.setItem('comms-sidebar-expanded', JSON.stringify(isSidebarExpanded));
  }, [isSidebarExpanded]);

  useEffect(() => {
    localStorage.setItem('comms-panel-open', JSON.stringify(isPanelOpen));
  }, [isPanelOpen]);

  // Fetch assistants when userId becomes available
  useEffect(() => {
    console.log('[CommsConsole] Assistants effect triggered, userId:', userId, 'isDemoMode:', isDemoMode);
    
    if (!userId) {
      console.log('[CommsConsole] No userId yet, skipping assistant fetch');
      return;
    }

    const fetchAssistants = async () => {
      console.log('[CommsConsole] Fetching assistants for userId:', userId);
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

        console.log('[CommsConsole] Fetched assistants:', data?.length || 0, 'assistants');

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
          console.log('[CommsConsole] Set current assistant:', mapped[0].name);
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
          console.log('[CommsConsole] No assistants found, creating default Iris');
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
            console.log('[CommsConsole] Created and set default assistant:', mapped.name);
          }
        }
      } catch (err) {
        console.error('[CommsConsole] Error fetching assistants:', err);
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
  }, [userId, isDemoMode]);

  // ============================================================
  // Load chat history from database on mount
  // ============================================================
  useEffect(() => {
    if (!dbThreadId || !userId || historyLoaded) return;

    const loadChatHistory = async () => {
      try {
        console.log('[CommsConsole] Loading chat history for thread:', dbThreadId);
        const { data, error } = await supabase
          .from('conversation_messages')
          .select('id, role, content, source, created_at, assistant_id')
          .eq('thread_id', dbThreadId)
          .eq('user_id', userId)
          .eq('source', 'chat')
          // IMPORTANT: load most recent messages first, then reverse for chronological display.
          // If we order ascending + limit, we'd only ever see the *oldest* 50 messages.
          .order('created_at', { ascending: false })
          .limit(50);

        if (error) throw error;

        if (data && data.length > 0) {
          console.log(`[CommsConsole] Loaded ${data.length} messages from history`);
          const chronological = [...data].reverse();
          setMessages(chronological.map(msg => ({
            id: msg.id,
            role: msg.role as 'user' | 'assistant' | 'system',
            content: msg.content,
            source: (msg.source || 'chat') as CommunicationMode,
            assistant_id: msg.assistant_id,
            created_at: msg.created_at,
          })));
        }
        setHistoryLoaded(true);
      } catch (err) {
        console.error('[CommsConsole] Failed to load chat history:', err);
        setHistoryLoaded(true); // Mark as loaded to prevent retry loop
      }
    };

    loadChatHistory();
  }, [dbThreadId, userId, historyLoaded]);

  // ============================================================
  // Realtime subscription for new messages (instant delivery)
  // With comprehensive logging and watchdog
  // ============================================================
  useEffect(() => {
    // Enhanced logging to debug subscription initialization
    if (!userId) {
      console.log('[CommsConsole] Realtime: No userId, skipping subscription');
      return;
    }
    if (!dbThreadId) {
      console.log('[CommsConsole] Realtime: No dbThreadId yet, waiting for thread initialization. currentAssistant:', currentAssistant?.id);
      logRealtime(userId, 'waiting_for_thread', 'started', {
        hasAssistant: !!currentAssistant?.id,
        assistantId: currentAssistant?.id
      });
      return;
    }
    
    console.log('[CommsConsole] Realtime: Setting up subscription for thread:', dbThreadId);
    
    // Log subscription attempt
    subscribeStartTimeRef.current = Date.now();
    setRealtimeStatus('subscribing');
    logRealtime(userId, 'setup', 'started', {
      threadId: dbThreadId,
      assistantId: currentAssistant?.id
    });
    
    const channel = supabase
      .channel(`chat-messages-${dbThreadId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'conversation_messages',
          filter: `thread_id=eq.${dbThreadId}`,
        },
        (payload) => {
          const newMessage = payload.new as any;
          console.log('[CommsConsole] Realtime message received:', newMessage.id, 'content:', newMessage.content?.substring(0, 50));
          
          // Log message receipt
          logChat(userId, 'realtime_received', 'completed', {
            messageId: newMessage.id,
            role: newMessage.role,
            contentPreview: newMessage.content?.substring(0, 50),
            source: newMessage.source,
            threadId: dbThreadId
          });
          
          // Deduplicate - skip if already in state
          setMessages(prev => {
            if (prev.some(m => m.id === newMessage.id)) {
              console.log('[CommsConsole] Realtime: Skipping duplicate message:', newMessage.id);
              logChat(userId, 'realtime_duplicate_skipped', 'completed', {
                messageId: newMessage.id
              });
              return prev;
            }
            
            // Replace temporary local message with DB version
            const tempIndex = prev.findIndex(m =>
              m.role === newMessage.role &&
              m.content === newMessage.content &&
              (m.id.startsWith('assistant-') || m.id.startsWith('user-'))
            );
            
            if (tempIndex !== -1) {
              console.log('[CommsConsole] Realtime: Replacing temp message', prev[tempIndex].id, '→', newMessage.id);
              const updated = [...prev];
              updated[tempIndex] = {
                id: newMessage.id,
                role: newMessage.role as 'user' | 'assistant' | 'system',
                content: newMessage.content,
                source: (newMessage.source || 'chat') as CommunicationMode,
                assistant_id: newMessage.assistant_id,
                created_at: newMessage.created_at,
              };
              return updated;
            }
            
            return [...prev, {
              id: newMessage.id,
              role: newMessage.role as 'user' | 'assistant' | 'system',
              content: newMessage.content,
              source: (newMessage.source || 'chat') as CommunicationMode,
              assistant_id: newMessage.assistant_id,
              created_at: newMessage.created_at,
            }];
          });
        }
      )
      .subscribe((status) => {
        const elapsedMs = subscribeStartTimeRef.current 
          ? Date.now() - subscribeStartTimeRef.current 
          : null;
          
        console.log('[CommsConsole] Realtime subscription status:', status);
        setRealtimeStatus(status);
        
        logRealtime(
          userId, 
          status === 'SUBSCRIBED' ? 'subscribed' : `status_${status}`,
          status === 'SUBSCRIBED' ? 'completed' : 'started',
          {
            status,
            threadId: dbThreadId,
            elapsedMs
          },
          status === 'CHANNEL_ERROR' ? `Subscription failed with status: ${status}` : undefined
        );
      });
    
    return () => {
      console.log('[CommsConsole] Realtime: Cleaning up subscription for thread:', dbThreadId);
      logRealtime(userId, 'cleanup', 'completed', { threadId: dbThreadId });
      supabase.removeChannel(channel);
      setRealtimeStatus('idle');
    };
  }, [dbThreadId, userId, currentAssistant?.id]);

  // ============================================================
  // Realtime subscription watchdog - log if not subscribed within 5s
  // ============================================================
  useEffect(() => {
    if (realtimeStatus !== 'subscribing') return;
    
    const timeout = setTimeout(() => {
      if (realtimeStatus === 'subscribing') {
        logRealtime(userId, 'timeout', 'error', {
          threadId: dbThreadId,
          elapsedMs: subscribeStartTimeRef.current 
            ? Date.now() - subscribeStartTimeRef.current 
            : null,
          status: realtimeStatus
        }, 'Subscription not SUBSCRIBED after 5 seconds');
        
        console.warn('[CommsConsole] Realtime: Subscription timeout - not SUBSCRIBED after 5 seconds');
      }
    }, 5000);
    
    return () => clearTimeout(timeout);
  }, [realtimeStatus, userId, dbThreadId]);

  // ============================================================
  // User presence tracking for conditional push notifications
  // ============================================================
  usePresenceTracking({
    userId,
    isPanelOpen,
    currentMode,
    enabled: true
  });

  // ============================================================
  // Handle service worker messages: notification clicks AND new chat messages
  // Implements Slack/SMS model for instant message display
  // ============================================================
  useEffect(() => {
    const handleServiceWorkerMessage = (event: MessageEvent) => {
      // Handle notification clicks
      if (event.data?.type === 'NOTIFICATION_CLICKED') {
        const notificationData = event.data.data || {};
        console.log('[CommsConsole] Notification clicked:', notificationData);
        
        if (notificationData.openCommsConsole || 
            notificationData.type === 'chat_message' || 
            notificationData.type === 'scheduled_checkin') {
          setIsPanelOpen(true);
          setCurrentMode('chat');
          
          // Reload messages to include the new system-initiated message
          setHistoryLoaded(false);
        }
      }
      
      // Handle new chat messages from push notification (Slack/SMS model)
      if (event.data?.type === 'NEW_CHAT_MESSAGE') {
        const message = event.data.message;
        console.log('[CommsConsole] Message received from SW:', message?.id);
        
        if (userId) {
          logChat(userId, 'sw_message_received', 'completed', {
            messageId: message?.id,
            threadId: message?.thread_id,
            hasDbThread: !!dbThreadId
          });
        }
        
        // Only add if message is valid and matches current thread
        if (message?.id && message?.thread_id) {
          // If we're viewing a different thread, just reload history when we switch
          if (dbThreadId && message.thread_id !== dbThreadId) {
            console.log('[CommsConsole] SW message is for different thread, skipping');
            return;
          }
          
          // Add to messages if not already present (dedupe)
          setMessages(prev => {
            if (prev.some(m => m.id === message.id)) {
              console.log('[CommsConsole] SW message already in state, skipping:', message.id);
              return prev;
            }
            
            console.log('[CommsConsole] Adding SW message to state:', message.id);
            return [...prev, {
              id: message.id,
              role: message.role as 'user' | 'assistant' | 'system',
              content: message.content,
              source: (message.source || 'chat') as CommunicationMode,
              assistant_id: message.assistant_id,
              created_at: message.created_at,
            }];
          });
        }
      }
    };
    
    navigator.serviceWorker?.addEventListener('message', handleServiceWorkerMessage);

    // Android bridge equivalent: BridgeFirebaseService dispatches window events
    // instead of service worker postMessage (no SW in WebView).
    const handleBridgeMessage = (event: Event) => {
      handleServiceWorkerMessage({ data: (event as CustomEvent).detail } as MessageEvent);
    };
    window.addEventListener('bridgeMessage', handleBridgeMessage);

    return () => {
      navigator.serviceWorker?.removeEventListener('message', handleServiceWorkerMessage);
      window.removeEventListener('bridgeMessage', handleBridgeMessage);
    };
  }, [userId, dbThreadId]);
  
  // ============================================================
  // Track last message timestamp for smart visibility reload
  // ============================================================
  const lastMessageTimestampRef = useRef<string | null>(null);
  
  useEffect(() => {
    if (messages.length > 0) {
      // Update to the latest message timestamp
      const latestTimestamp = messages
        .map(m => m.created_at)
        .filter(Boolean)
        .sort()
        .pop();
      if (latestTimestamp) {
        lastMessageTimestampRef.current = latestTimestamp;
      }
    }
  }, [messages]);
  
  // ============================================================
  // Smart visibility reload: only fetch if there are newer messages
  // ============================================================
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState !== 'visible' || !dbThreadId || !userId) return;
      
      logChat(userId, 'visibility_check', 'started', { 
        threadId: dbThreadId,
        lastSeen: lastMessageTimestampRef.current 
      });
      
      // Quick query: any messages newer than our last seen?
      const lastSeen = lastMessageTimestampRef.current || new Date(0).toISOString();
      
      try {
        const { data, error } = await supabase
          .from('conversation_messages')
          .select('id')
          .eq('thread_id', dbThreadId)
          .eq('user_id', userId)
          .gt('created_at', lastSeen)
          .limit(1);
        
        if (error) {
          logChat(userId, 'visibility_check', 'error', { error: error.message }, error.message);
          return;
        }
        
        if (data && data.length > 0) {
          // There are newer messages, reload history
          console.log('[CommsConsole] Visibility check found newer messages, reloading');
          logChat(userId, 'visibility_reload', 'started', { 
            threadId: dbThreadId, 
            lastSeen,
            foundNew: true 
          });
          setHistoryLoaded(false);
        } else {
          // No new messages, skip reload
          logChat(userId, 'visibility_check', 'completed', { 
            result: 'no_new_messages',
            lastSeen 
          });
        }
      } catch (err) {
        console.error('[CommsConsole] Visibility check error:', err);
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [dbThreadId, userId]);

  // ============================================================
  // Check URL params on mount for fresh app opens
  // ============================================================
  useEffect(() => {
    if (searchParams.get('openComms') === 'true') {
      console.log('[CommsConsole] Opening panel from URL parameter');
      setIsPanelOpen(true);
      setCurrentMode('chat');
      
      // Reload messages to show latest
      setHistoryLoaded(false);
      
      // Clean up URL without triggering navigation
      searchParams.delete('openComms');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);
  
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
    setLastUserMessage(content); // Store for retry functionality
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
            const events = parseSSEEvents(chunk);  // Get ALL events from chunk

            for (const parsed of events) {  // Process each event
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
              } else if (parsed.type === 'error') {
                // Handle server-sent error events
                throw new Error(parsed.message || 'Server error occurred');
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

          // Check if streaming produced no content (tool call scenario) - fallback to polling
          if (!fullContent) {
            console.log('[CommsConsole] Streaming produced no content, falling back to polling...');
            // Remove the empty placeholder
            setMessages((prev) => prev.filter(m => m.id !== assistantMessageId));
            
            // Call again without streaming
            const fallbackResponse = await supabase.functions.invoke('hybrid-assistant-api', {
              body: {
                userInput: content,
                userId,
                threadId: effectiveThreadId,
                assistantId: currentAssistant?.openai_assistant_id || undefined,
                dbAssistantId: currentAssistant?.id || undefined,
                stream: false
              },
            });
            
            if (fallbackResponse.error) {
              throw fallbackResponse.error;
            }
            
            const fallbackContent = fallbackResponse.data?.response || 'Sorry, I could not process your request.';
            
            setMessages((prev) => [...prev, {
              id: `assistant-${Date.now()}`,
              role: 'assistant',
              content: fallbackContent,
              source: currentMode,
              assistant_id: currentAssistant?.id || null,
              created_at: new Date().toISOString(),
            }]);
            
            if (fallbackResponse.data?.threadId && USE_UNIFIED_THREADS && updateOpenaiThreadId) {
              updateOpenaiThreadId(fallbackResponse.data.threadId);
              receivedThreadId = fallbackResponse.data.threadId;
            }
            
            // Persist fallback response
            const responseTimeMs = Date.now() - requestStartTime;
            persistMessagesWithMetrics(
              content,
              fallbackContent,
              effectiveThreadId || '',
              {
                response_time_ms: responseTimeMs,
                time_to_first_token: null,
                word_count: fallbackContent.split(/\s+/).filter(Boolean).length,
                content_length: fallbackContent.length,
                user_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                request_timestamp: new Date(requestStartTime).toISOString(),
                streamed: false
              }
            );
          } else {
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
          }

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
      const errorText = err instanceof Error ? err.message : 'Unknown error';
      const isConnectionError = errorText.includes('connection') || errorText.includes('network') || errorText.includes('fetch');
      
      const errorMessage: ConversationMessage = {
        id: `error-${Date.now()}`,
        role: 'system',
        content: isConnectionError 
          ? 'Connection interrupted. Please try again.'
          : `Request failed: ${errorText}. Please try again.`,
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
    // Optimistic: signal connecting state immediately before async resolves
    try {
      await voiceAssistant.connectToAssistant(dbThreadId || undefined, currentAssistant?.id || undefined);
    } catch (err) {
      console.error('[CommsConsole] Voice connect failed:', err);
      throw err;
    }
  }, [voiceAssistant, dbThreadId, currentAssistant?.id]);

  const disconnectVoice = useCallback(() => {
    voiceAssistant.disconnectAssistant();
  }, [voiceAssistant]);

  const sendVoiceTextMessage = useCallback((text: string) => {
    voiceAssistant.sendTextMessage(text);
  }, [voiceAssistant]);

  // Retry last failed message
  const retryLastMessage = useCallback(async () => {
    if (lastUserMessage) {
      // Remove the error message first
      setMessages((prev) => prev.filter(m => 
        !(m.role === 'system' && m.content?.includes('Connection interrupted'))
      ));
      await sendMessage(lastUserMessage);
    }
  }, [lastUserMessage, sendMessage]);

  // Android widget relay bar: routes transcript to chat thread via bridgeVoiceResult event.
  useEffect(() => {
    const handler = (event: Event) => {
      const transcript = (event as CustomEvent).detail?.transcript;
      if (transcript) {
        console.log('[Bridge] bridgeVoiceResult received:', transcript.substring(0, 80));
        bridgePendingRef.current = true;
        sendMessage(transcript);
      }
    };
    window.addEventListener('bridgeVoiceResult', handler);
    return () => window.removeEventListener('bridgeVoiceResult', handler);
  }, [sendMessage]);

  // Fires postAiResponse back to the widget overlay once the AI finishes responding.
  useEffect(() => {
    const bridge = (window as any).AndroidBridge;
    console.log('[Bridge] response watcher: pending=', bridgePendingRef.current, 'loading=', isLoading, 'msgs=', messages.length, 'bridgeExists=', !!bridge, 'postAiResponseExists=', !!bridge?.postAiResponse);
    if (!bridgePendingRef.current || isLoading) return;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.role === 'assistant' && lastMsg.content) {
      bridgePendingRef.current = false;
      const text = lastMsg.content.substring(0, 500);
      console.log('[Bridge] calling postAiResponse:', text.substring(0, 80));
      bridge?.postAiResponse?.(text);
    }
  }, [messages, isLoading]);


  // Start a new conversation (clear messages but keep thread for history)
  const startNewConversation = useCallback(() => {
    setMessages([]);
    setLastUserMessage(null);
    setHistoryLoaded(false); // Will reload if user navigates back
    console.log('[CommsConsole] Started new conversation');
  }, []);

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
    retryLastMessage,
    startNewConversation,
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

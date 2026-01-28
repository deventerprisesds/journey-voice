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

export const CommsConsoleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isDemoMode } = useAuth();
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

  // Feature flag for unified threads per assistant
  const USE_UNIFIED_THREADS = true;

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
    // Clear messages when switching assistants (or keep for continuity - design choice)
    // setMessages([]);
    // setThreadId(null);
  }, []);

  const setMode = useCallback((mode: CommunicationMode) => {
    setCurrentMode(mode);
    
    // Disconnect voice when leaving voice mode
    // Connection is handled explicitly by VoiceOrb click
    if (mode !== 'voice' && voiceAssistant.isConnected) {
      voiceAssistant.disconnectAssistant();
    }
  }, [voiceAssistant]);

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

    try {
      // Use unified thread if enabled, otherwise fall back to existing behavior
      const effectiveThreadId = USE_UNIFIED_THREADS ? dbThreadId : threadId;
      
      console.log('[CommsConsole] Sending message with threadId:', effectiveThreadId);
      
      const { data, error } = await supabase.functions.invoke('hybrid-assistant-api', {
        body: {
          userInput: content,
          userId,
          threadId: effectiveThreadId,
          assistantId: currentAssistant?.openai_assistant_id || undefined,
          dbAssistantId: currentAssistant?.id || undefined,  // For RAG scoping
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

      // In unified mode, don't overwrite threadId with OpenAI thread ID
      // The dbThreadId from useUnifiedThread is our source of truth
      if (data?.threadId && !USE_UNIFIED_THREADS) {
        setThreadId(data.threadId);
      }
      
      // Update OpenAI thread ID in database if returned
      if (data?.threadId && USE_UNIFIED_THREADS && updateOpenaiThreadId) {
        updateOpenaiThreadId(data.threadId);
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
  }, [userId, threadId, currentAssistant, currentMode, dbThreadId, updateOpenaiThreadId]);

  // Connect voice with unified thread and assistant ID for cross-mode memory
  const connectVoice = useCallback(async () => {
    // Pass unified thread ID and assistant ID to voice assistant for memory persistence
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

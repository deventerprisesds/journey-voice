export interface Assistant {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  avatar_initial: string | null;
  orb_color: string;
  orb_animation: string;
  openai_assistant_id: string | null;
  voice_id: string | null;
  persona_prompt: string | null;
  tools_enabled: string[];
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  source: 'voice' | 'phone' | 'chat';
  assistant_id: string | null;
  created_at: string;
  metadata?: Record<string, unknown>;
}

export interface Huddle {
  id: string;
  user_id: string;
  name: string;
  assistant_ids: string[];
  created_at: string;
  updated_at: string;
}

export type CommunicationMode = 'voice' | 'phone' | 'chat';

export type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking';

export type PhoneCallState = 'idle' | 'dialing' | 'ringing' | 'connected' | 'ended';

export interface CommsConsoleState {
  isPanelOpen: boolean;
  isSidebarExpanded: boolean;
  currentAssistant: Assistant | null;
  assistants: Assistant[];
  currentMode: CommunicationMode;
  messages: ConversationMessage[];
  threadId: string | null;
  isLoading: boolean;
  voiceState: VoiceState;
  isConnected: boolean;
  phoneCallState: PhoneCallState;
  connectionError: string | null;
}

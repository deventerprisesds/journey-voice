import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Assistant } from '@/components/CommsConsole/types';

const DEV_USER_ID = 'a3378f93-d655-4913-b2fa-ca5b1d8020f1';

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

function mapAssistantRow(a: Record<string, unknown>, fallbackUserId: string): Assistant {
  return {
    id: a.id as string,
    user_id: (a.user_id as string) ?? fallbackUserId,
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
  };
}

function mockIris(userId: string): Assistant {
  return {
    id: 'mock-iris-id',
    user_id: userId,
    ...DEFAULT_IRIS,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

async function fetchAssistants(userId: string, isDemoMode: boolean): Promise<Assistant[]> {
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
    return data.map((a: Record<string, unknown>) => mapAssistantRow(a, userId));
  }

  // Demo mode: dev's Iris not found — return mock so the app still works
  if (isDemoMode) {
    console.error('[useAssistants] Demo mode: dev Iris assistant not found, using mock');
    return [mockIris(userId)];
  }

  // Authenticated user with no assistants — create default Iris
  const { data: newAssistant, error: createError } = await supabase
    .from('assistants')
    .insert({ ...DEFAULT_IRIS, user_id: userId })
    .select()
    .single();

  if (createError || !newAssistant) {
    console.error('[useAssistants] Failed to create default assistant, using mock:', createError);
    return [mockIris(userId)];
  }

  return [mapAssistantRow(newAssistant as Record<string, unknown>, userId)];
}

export function useAssistants(userId: string | null, isDemoMode: boolean) {
  return useQuery({
    queryKey: ['assistants', userId],
    queryFn: () => fetchAssistants(userId!, isDemoMode),
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { ConversationMessage, CommunicationMode } from '@/components/CommsConsole/types';

async function loadChatHistory(threadId: string, userId: string): Promise<ConversationMessage[]> {
  const { data, error } = await supabase
    .from('conversation_messages')
    .select('id, role, content, source, created_at, assistant_id')
    .eq('thread_id', threadId)
    .eq('user_id', userId)
    .eq('source', 'chat')
    // Fetch newest first so the LIMIT keeps the most recent 50, then reverse for display
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) throw error;
  if (!data || data.length === 0) return [];

  return [...data].reverse().map(msg => ({
    id: msg.id,
    role: msg.role as 'user' | 'assistant' | 'system',
    content: msg.content,
    source: (msg.source || 'chat') as CommunicationMode,
    assistant_id: msg.assistant_id,
    created_at: msg.created_at,
  }));
}

export const chatHistoryQueryKey = (threadId: string | null) =>
  ['chat-history', threadId] as const;

export function useChatHistory(threadId: string | null, userId: string | null) {
  return useQuery({
    queryKey: chatHistoryQueryKey(threadId),
    queryFn: () => loadChatHistory(threadId!, userId!),
    enabled: !!threadId && !!userId,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    // Realtime subscription handles live updates — no need to refetch on focus
    refetchOnWindowFocus: false,
  });
}

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isLoading?: boolean;
}

interface UseChatAssistantReturn {
  messages: ChatMessage[];
  isLoading: boolean;
  threadId: string | null;
  sendMessage: (content: string) => Promise<void>;
  createNewThread: () => Promise<void>;
  loadThread: (threadId: string) => Promise<void>;
}

export function useChatAssistant(): UseChatAssistantReturn {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);

  // Load or create thread on mount
  useEffect(() => {
    if (user) {
      loadOrCreateThread();
    }
  }, [user]);

  const loadOrCreateThread = async () => {
    if (!user) return;

    try {
      // Get user's default assistant
      const { data: defaultAssistant } = await supabase
        .from('assistants')
        .select('id')
        .eq('user_id', user.id)
        .eq('is_default', true)
        .maybeSingle();
      
      const assistantId = defaultAssistant?.id || null;

      // Try to find existing thread for this assistant
      const { data: existingThread } = await supabase
        .from('ai_threads')
        .select('id, openai_thread_id')
        .eq('user_id', user.id)
        .eq('assistant_id', assistantId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingThread) {
        setThreadId(existingThread.id);
        await loadMessages(existingThread.id);
      } else {
        await createNewThread(assistantId);
      }
    } catch (error) {
      console.error('Error loading thread:', error);
    }
  };

  const loadMessages = async (threadIdToLoad: string) => {
    try {
      const { data: storedMessages } = await supabase
        .from('conversation_messages')
        .select('*')
        .eq('thread_id', threadIdToLoad)
        .order('created_at', { ascending: true });

      if (storedMessages) {
        setMessages(storedMessages.map(msg => ({
          id: msg.id,
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
          timestamp: new Date(msg.created_at)
        })));
      }
    } catch (error) {
      console.error('Error loading messages:', error);
    }
  };

  const createNewThread = useCallback(async (assistantId?: string | null) => {
    if (!user) return;

    try {
      // Get assistant ID if not provided
      let finalAssistantId = assistantId;
      if (finalAssistantId === undefined) {
        const { data: defaultAssistant } = await supabase
          .from('assistants')
          .select('id')
          .eq('user_id', user.id)
          .eq('is_default', true)
          .maybeSingle();
        finalAssistantId = defaultAssistant?.id || null;
      }

      const { data: newThread, error } = await supabase
        .from('ai_threads')
        .insert({
          user_id: user.id,
          assistant_id: finalAssistantId,
          openai_thread_id: '' // Will be set by the API
        })
        .select()
        .single();

      if (error) throw error;

      setThreadId(newThread.id);
      setMessages([]);
    } catch (error) {
      console.error('Error creating thread:', error);
    }
  }, [user]);

  const loadThread = useCallback(async (id: string) => {
    setThreadId(id);
    await loadMessages(id);
  }, []);

  const sendMessage = useCallback(async (content: string) => {
    if (!user || !threadId || !content.trim()) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: content.trim(),
      timestamp: new Date()
    };

    // Add user message optimistically
    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);

    // Add loading placeholder for assistant
    const loadingId = crypto.randomUUID();
    setMessages(prev => [...prev, {
      id: loadingId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isLoading: true
    }]);

    try {
      // Store user message
      await supabase.from('conversation_messages').insert({
        thread_id: threadId,
        user_id: user.id,
        role: 'user',
        content: userMessage.content
      });

      // Call the hybrid assistant API (uses OPENAI_ASSISTANT_ID secret on server)
      const { data, error } = await supabase.functions.invoke('hybrid-assistant-api', {
        body: {
          userInput: content.trim(),
          userId: user.id,
          threadId: threadId
        }
      });

      if (error) throw error;

      const assistantContent = data?.response || 'I apologize, but I couldn\'t process your request.';

      // Store assistant message
      const { data: savedMessage } = await supabase.from('conversation_messages').insert({
        thread_id: threadId,
        user_id: user.id,
        role: 'assistant',
        content: assistantContent
      }).select().single();

      // Replace loading message with actual response
      setMessages(prev => prev.map(msg => 
        msg.id === loadingId 
          ? { 
              id: savedMessage?.id || loadingId, 
              role: 'assistant' as const, 
              content: assistantContent, 
              timestamp: new Date(),
              isLoading: false 
            }
          : msg
      ));

      // Update thread timestamp
      await supabase
        .from('ai_threads')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', threadId);

    } catch (error) {
      console.error('Error sending message:', error);
      
      // Remove loading message and show error
      setMessages(prev => prev.filter(msg => msg.id !== loadingId));
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'Sorry, I encountered an error processing your request. Please try again.',
        timestamp: new Date()
      }]);
    } finally {
      setIsLoading(false);
    }
  }, [user, threadId]);

  return {
    messages,
    isLoading,
    threadId,
    sendMessage,
    createNewThread,
    loadThread
  };
}

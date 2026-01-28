import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface UseUnifiedThreadOptions {
  userId: string | null;
  assistantId: string | null;
  enabled?: boolean;
}

interface UseUnifiedThreadResult {
  dbThreadId: string | null;
  openaiThreadId: string | null;
  isLoading: boolean;
  error: string | null;
  updateOpenaiThreadId: (newOpenaiThreadId: string) => Promise<void>;
}

/**
 * Hook for managing unified threads per assistant.
 * 
 * This hook ensures that each user+assistant combination has a single thread
 * that persists across all communication modes (voice, chat, phone).
 * 
 * @param userId - The current user's ID
 * @param assistantId - The current assistant's database ID (not OpenAI ID)
 * @param enabled - Feature flag to enable/disable unified threads
 */
export function useUnifiedThread({ 
  userId, 
  assistantId, 
  enabled = true 
}: UseUnifiedThreadOptions): UseUnifiedThreadResult {
  const [dbThreadId, setDbThreadId] = useState<string | null>(null);
  const [openaiThreadId, setOpenaiThreadId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !userId || !assistantId) {
      setDbThreadId(null);
      setOpenaiThreadId(null);
      return;
    }

    const initializeThread = async () => {
      setIsLoading(true);
      setError(null);

      try {
        // Find existing thread for this user + assistant combination
        const { data: existingThread, error: fetchError } = await supabase
          .from('ai_threads')
          .select('id, openai_thread_id')
          .eq('user_id', userId)
          .eq('assistant_id', assistantId)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (fetchError) throw fetchError;

        if (existingThread) {
          setDbThreadId(existingThread.id);
          setOpenaiThreadId(existingThread.openai_thread_id || null);
          console.log('[UNIFIED_THREAD] Using existing thread:', existingThread.id, 'for assistant:', assistantId);
        } else {
          // Create new thread for this user + assistant
          const { data: newThread, error: createError } = await supabase
            .from('ai_threads')
            .insert({
              user_id: userId,
              assistant_id: assistantId,
              openai_thread_id: '',
              mode: 'unified'
            })
            .select('id')
            .single();

          if (createError) throw createError;

          if (newThread) {
            setDbThreadId(newThread.id);
            setOpenaiThreadId(null);
            console.log('[UNIFIED_THREAD] Created new thread:', newThread.id, 'for assistant:', assistantId);
          }
        }
      } catch (err) {
        console.error('[UNIFIED_THREAD] Error initializing thread:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setIsLoading(false);
      }
    };

    initializeThread();
  }, [userId, assistantId, enabled]);

  // Update OpenAI thread ID when received from API
  const updateOpenaiThreadId = useCallback(async (newOpenaiThreadId: string) => {
    if (!dbThreadId) return;

    setOpenaiThreadId(newOpenaiThreadId);

    try {
      // Persist to database
      await supabase
        .from('ai_threads')
        .update({
          openai_thread_id: newOpenaiThreadId,
          updated_at: new Date().toISOString()
        })
        .eq('id', dbThreadId);
      
      console.log('[UNIFIED_THREAD] Updated OpenAI thread ID:', newOpenaiThreadId);
    } catch (err) {
      console.error('[UNIFIED_THREAD] Failed to persist OpenAI thread ID:', err);
    }
  }, [dbThreadId]);

  return {
    dbThreadId,
    openaiThreadId,
    isLoading,
    error,
    updateOpenaiThreadId
  };
}

import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface UsePresenceTrackingOptions {
  userId: string | null;
  isPanelOpen: boolean;
  currentMode: 'voice' | 'phone' | 'chat';
  enabled?: boolean;
}

/**
 * Hook for tracking user presence in the chat.
 * Updates the user_presence table based on visibility and panel state.
 * Used for conditional push notifications (skip if user is active in chat).
 */
export function usePresenceTracking({
  userId,
  isPanelOpen,
  currentMode,
  enabled = true
}: UsePresenceTrackingOptions) {
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastStateRef = useRef<{ isActive: boolean; context: string } | null>(null);

  const updatePresence = useCallback(async (isActive: boolean, context: string) => {
    if (!userId || !enabled) return;

    // Debounce rapid changes
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(async () => {
      // Skip if state hasn't changed
      if (
        lastStateRef.current?.isActive === isActive &&
        lastStateRef.current?.context === context
      ) {
        return;
      }

      lastStateRef.current = { isActive, context };

      try {
        const { error } = await supabase
          .from('user_presence')
          .upsert({
            user_id: userId,
            is_active: isActive,
            active_context: context,
            last_seen_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }, { onConflict: 'user_id' });

        if (error) {
          console.error('[PresenceTracking] Failed to update presence:', error);
          // Debug: verify user_id matches auth.uid()
          const { data: authData } = await supabase.auth.getUser();
          console.error('[PresenceTracking] user_id:', userId, 'auth.uid():', authData?.user?.id);
        } else {
          console.log(`[PresenceTracking] Updated: isActive=${isActive}, context=${context}`);
        }
      } catch (err) {
        console.error('[PresenceTracking] Error:', err);
      }
    }, 500); // 500ms debounce
  }, [userId, enabled]);

  useEffect(() => {
    if (!userId || !enabled) return;

    const computePresence = () => {
      const isVisible = document.visibilityState === 'visible';
      const isActiveInChat = isVisible && isPanelOpen && currentMode === 'chat';
      const context = isActiveInChat ? 'chat' : isPanelOpen ? currentMode : 'away';
      
      updatePresence(isActiveInChat, context);
    };

    // Update on visibility change
    const handleVisibilityChange = () => {
      computePresence();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // Initial update
    computePresence();

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [userId, isPanelOpen, currentMode, enabled, updatePresence]);

  // Mark as inactive when unmounting
  useEffect(() => {
    return () => {
      if (userId && enabled) {
        // Fire and forget - mark as inactive on unmount
        supabase
          .from('user_presence')
          .upsert({
            user_id: userId,
            is_active: false,
            active_context: 'away',
            updated_at: new Date().toISOString()
          }, { onConflict: 'user_id' })
          .then(() => {
            console.log('[PresenceTracking] Marked inactive on unmount');
          });
      }
    };
  }, [userId, enabled]);
}

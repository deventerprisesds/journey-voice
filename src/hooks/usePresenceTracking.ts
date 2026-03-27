import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { logPresence } from '@/utils/activityLogger';

interface UsePresenceTrackingOptions {
  userId: string | null;
  isPanelOpen: boolean;
  currentMode: 'voice' | 'phone' | 'chat';
  enabled?: boolean;
}

// Heartbeat interval in milliseconds (30 seconds)
const HEARTBEAT_INTERVAL = 30000;

// Debounce time for presence updates
const DEBOUNCE_MS = 500;

// Demo user ID — skip presence writes to avoid RLS errors in preview
const DEMO_USER_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Hook for tracking user presence in the chat.
 * Updates the user_presence table based on visibility and panel state.
 * Used for conditional push notifications (skip if user is active in chat).
 * 
 * Features:
 * - Heartbeat every 30s to keep presence fresh
 * - pagehide listener for iOS/mobile background detection
 * - focus/blur listeners for more reliable visibility tracking
 * - Comprehensive activity logging for debugging
 */
export function usePresenceTracking({
  userId,
  isPanelOpen,
  currentMode,
  enabled = true
}: UsePresenceTrackingOptions) {
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastStateRef = useRef<{ isActive: boolean; context: string } | null>(null);

  const updatePresence = useCallback(async (isActive: boolean, context: string, trigger: string = 'update') => {
    if (!userId || !enabled || userId === DEMO_USER_ID) return;

    // Debounce rapid changes
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(async () => {
      // Skip if state hasn't changed (except for heartbeat)
      if (
        trigger !== 'heartbeat' &&
        lastStateRef.current?.isActive === isActive &&
        lastStateRef.current?.context === context
      ) {
        return;
      }

      lastStateRef.current = { isActive, context };

      // Log the attempt
      logPresence(userId, 'compute', 'started', {
        isActive,
        context,
        trigger,
        isPanelOpen,
        currentMode,
        visibilityState: document.visibilityState
      });

      try {
        const payload = {
          user_id: userId,
          is_active: isActive,
          active_context: context,
          last_seen_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        logPresence(userId, 'upsert_start', 'started', payload);

        const { error } = await supabase
          .from('user_presence')
          .upsert(payload, { onConflict: 'user_id' });

        if (error) {
          // Log the full error details
          logPresence(userId, 'upsert_error', 'error', {
            isActive,
            context,
            trigger,
            errorDetails: {
              message: error.message,
              code: error.code,
              details: error.details,
              hint: error.hint
            }
          }, error.message, error.code);
          
          console.error('[PresenceTracking] Failed to update presence:', error);
        } else {
          logPresence(userId, 'upsert_success', 'completed', {
            isActive,
            context,
            trigger
          });
          
          console.log(`[PresenceTracking] Updated: isActive=${isActive}, context=${context}, trigger=${trigger}`);
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        logPresence(userId, 'exception', 'error', {
          isActive,
          context,
          trigger
        }, errorMessage);
        
        console.error('[PresenceTracking] Error:', err);
      }
    }, DEBOUNCE_MS);
  }, [userId, enabled, isPanelOpen, currentMode]);

  // Compute and update presence based on current state
  const computePresence = useCallback((trigger: string = 'compute') => {
    if (!userId || !enabled) return;
    
    const isVisible = document.visibilityState === 'visible';
    const isActiveInChat = isVisible && isPanelOpen && currentMode === 'chat';
    const context = isActiveInChat ? 'chat' : isPanelOpen ? currentMode : 'away';
    
    updatePresence(isActiveInChat, context, trigger);
  }, [userId, enabled, isPanelOpen, currentMode, updatePresence]);

  // Main effect for visibility tracking
  useEffect(() => {
    if (!userId || !enabled) return;

    const handleVisibilityChange = () => {
      computePresence('visibilitychange');
    };

    const handleFocus = () => {
      computePresence('focus');
    };

    const handleBlur = () => {
      // On blur, mark as inactive after a short delay
      // This helps with tab switching false positives
      setTimeout(() => {
        if (!document.hasFocus()) {
          updatePresence(false, 'away', 'blur');
        }
      }, 100);
    };

    const handlePageHide = () => {
      // Critical for iOS: pagehide fires when app goes to background
      // Use sendBeacon for reliable delivery
      updatePresence(false, 'away', 'pagehide');
      
      // Also try sendBeacon as a backup for more reliable delivery on mobile
      if (navigator.sendBeacon) {
        try {
          const payload = JSON.stringify({
            user_id: userId,
            is_active: false,
            active_context: 'away',
            last_seen_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });
          
          // sendBeacon won't work with RLS since we can't include auth headers
          // But at least try to log that we attempted
          console.log('[PresenceTracking] pagehide triggered, marking away');
        } catch {
          // Ignore sendBeacon errors
        }
      }
    };

    // Register all event listeners
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('pagehide', handlePageHide);
    
    // Initial presence update
    computePresence('mount');

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('pagehide', handlePageHide);
      
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [userId, enabled, computePresence, updatePresence]);

  // Heartbeat effect - refresh presence every 30s while active
  useEffect(() => {
    if (!userId || !enabled) return;

    heartbeatIntervalRef.current = setInterval(() => {
      if (document.visibilityState === 'visible') {
        computePresence('heartbeat');
      }
    }, HEARTBEAT_INTERVAL);

    return () => {
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }
    };
  }, [userId, enabled, computePresence]);

  // Re-compute presence when panel/mode changes
  useEffect(() => {
    if (!userId || !enabled) return;
    computePresence('state_change');
  }, [isPanelOpen, currentMode, userId, enabled, computePresence]);

  // Mark as inactive when unmounting
  useEffect(() => {
    return () => {
      if (userId && enabled) {
        logPresence(userId, 'unmount', 'started', { action: 'marking_away' });
        
        // Fire and forget - mark as inactive on unmount
        supabase
          .from('user_presence')
          .upsert({
            user_id: userId,
            is_active: false,
            active_context: 'away',
            updated_at: new Date().toISOString()
          }, { onConflict: 'user_id' })
          .then(({ error }) => {
            if (error) {
              logPresence(userId, 'unmount_error', 'error', {}, error.message, error.code);
              console.error('[PresenceTracking] Failed to mark inactive on unmount:', error);
            } else {
              logPresence(userId, 'unmount_success', 'completed', {});
              console.log('[PresenceTracking] Marked inactive on unmount');
            }
          });
      }
    };
  }, [userId, enabled]);
}

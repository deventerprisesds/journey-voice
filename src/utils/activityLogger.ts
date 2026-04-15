/**
 * Activity Logger - Direct REST-based logging to activity_log table
 * 
 * This utility bypasses supabase-js to ensure logging never fails silently.
 * It only logs for the dev user (dev@enterpriseds.io) to avoid spam.
 * 
 * Fire-and-forget: never blocks UI or throws exceptions.
 */

import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, STORAGE_KEY } from '@/integrations/supabase/client';

// Dev user ID - only log for this user
const DEV_USER_ID = 'a3378f93-d655-4913-b2fa-ca5b1d8020f1';

// Session boot ID for correlating events within a single page session
let bootId: string | null = null;

function getBootId(): string {
  if (!bootId) {
    bootId = `FE-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
  return bootId;
}

// Try to get auth token from localStorage for authenticated requests
function getAuthToken(): string | null {
  try {
    const storedData = localStorage.getItem(STORAGE_KEY);
    if (storedData) {
      const parsed = JSON.parse(storedData);
      return parsed?.access_token || null;
    }
  } catch {
    // Ignore parse errors
  }
  return null;
}

export interface ActivityLogParams {
  userId: string | null;
  activityType: string;
  status: 'started' | 'completed' | 'error';
  stage?: string;
  errorMessage?: string;
  errorCode?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Log an activity event to the activity_log table.
 * Only logs for the dev user (a3378f93-d655-4913-b2fa-ca5b1d8020f1).
 * Fire-and-forget: never throws.
 */
export async function logActivity(params: ActivityLogParams): Promise<void> {
  // Log for all users on pipeline activity types; dev-only for everything else
  const PIPELINE_TYPES = ['daily_review_reasoning'];
  if (!params.userId) return;
  if (!PIPELINE_TYPES.includes(params.activityType) && params.userId !== DEV_USER_ID) {
    return;
  }

  const body = {
    user_id: params.userId,
    activity_type: params.activityType,
    status: params.status,
    stage: params.stage || null,
    error_message: params.errorMessage || null,
    error_code: params.errorCode || null,
    session_id: getBootId(),
    metadata: {
      ...params.metadata,
      timestamp: new Date().toISOString(),
      pathname: typeof window !== 'undefined' ? window.location.pathname : 'unknown',
      source: 'frontend'
    }
  };

  // Use auth token if available, otherwise anon key
  const authToken = getAuthToken() || SUPABASE_PUBLISHABLE_KEY;

  // Fire-and-forget POST to activity_log via REST
  fetch(`${SUPABASE_URL}/rest/v1/activity_log`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_PUBLISHABLE_KEY,
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(body)
  }).catch(() => {
    // Silent failure - this is intentional
    // We don't want logging failures to affect the app
  });
}

/**
 * Convenience function to log presence-related events
 */
export function logPresence(
  userId: string | null,
  stage: string,
  status: 'started' | 'completed' | 'error',
  metadata?: Record<string, unknown>,
  errorMessage?: string,
  errorCode?: string
): void {
  logActivity({
    userId,
    activityType: 'presence_update',
    status,
    stage,
    metadata,
    errorMessage,
    errorCode
  });
}

/**
 * Convenience function to log realtime subscription events
 */
export function logRealtime(
  userId: string | null,
  stage: string,
  status: 'started' | 'completed' | 'error',
  metadata?: Record<string, unknown>,
  errorMessage?: string
): void {
  logActivity({
    userId,
    activityType: 'realtime_subscribe',
    status,
    stage,
    metadata,
    errorMessage
  });
}

/**
 * Convenience function to log chat events
 */
export function logChat(
  userId: string | null,
  stage: string,
  status: 'started' | 'completed' | 'error',
  metadata?: Record<string, unknown>,
  errorMessage?: string
): void {
  logActivity({
    userId,
    activityType: 'chat_receive',
    status,
    stage,
    metadata,
    errorMessage
  });
}

/**
 * Get the current boot ID for debugging purposes
 */
export function getCurrentBootId(): string {
  return getBootId();
}

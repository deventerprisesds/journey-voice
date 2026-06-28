/**
 * Direct Auth Utility - Bypasses supabase-js for session validation
 * 
 * This module provides a "fast path" for auth initialization by reading
 * session tokens directly from localStorage and validating them via
 * the Supabase REST API. This bypasses potential deadlocks in the
 * supabase-js library's internal state machine.
 */

import { Session, User } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, STORAGE_KEY } from '@/integrations/supabase/client';
import { bootTrace } from '@/utils/bootTrace';

interface StoredSession {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  expires_in?: number;
  token_type?: string;
  user?: User;
}

/**
 * Read stored session tokens directly from localStorage
 * Returns null if no valid session data is found
 */
export function getStoredSession(): StoredSession | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      bootTrace.mark('fast_path_no_stored_session');
      return null;
    }

    const parsed = JSON.parse(stored);
    
    // Handle both old and new session storage formats
    // supabase-js stores as { currentSession: { ... } } or directly as session
    const session = parsed.currentSession || parsed;
    
    if (!session.access_token) {
      bootTrace.mark('fast_path_no_access_token');
      return null;
    }

    bootTrace.mark('fast_path_found_stored_session', { 
      hasRefreshToken: !!session.refresh_token,
      expiresAt: session.expires_at 
    });

    return session;
  } catch (error) {
    console.warn('[DirectAuth] Failed to read stored session:', error);
    bootTrace.mark('fast_path_storage_read_error', { error: String(error) });
    return null;
  }
}

/**
 * Validate an access token by calling the Supabase REST API directly
 * Returns user data if valid, null if invalid/expired
 */
export async function validateTokenDirect(accessToken: string): Promise<User | null> {
  const startTime = Date.now();
  bootTrace.mark('fast_path_validate_start');

  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'apikey': SUPABASE_PUBLISHABLE_KEY,
        'Content-Type': 'application/json'
      }
    });

    const latencyMs = Date.now() - startTime;

    if (!response.ok) {
      bootTrace.mark('fast_path_validate_failed', { status: response.status, latencyMs });
      return null;
    }

    const user = await response.json() as User;
    bootTrace.mark('fast_path_validate_success', { 
      userId: user.id?.substring(0, 8), 
      email: user.email,
      latencyMs 
    });

    return user;
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    console.warn('[DirectAuth] Token validation failed:', error);
    bootTrace.mark('fast_path_validate_error', { error: String(error), latencyMs });
    return null;
  }
}

/**
 * Refresh an expired token using the refresh token
 * Returns new session data if successful, null if failed
 */
export async function refreshTokenDirect(refreshToken: string): Promise<StoredSession | null> {
  const startTime = Date.now();
  bootTrace.mark('fast_path_refresh_start');

  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_PUBLISHABLE_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ refresh_token: refreshToken })
    });

    const latencyMs = Date.now() - startTime;

    if (!response.ok) {
      bootTrace.mark('fast_path_refresh_failed', { status: response.status, latencyMs });
      return null;
    }

    const data = await response.json();
    bootTrace.mark('fast_path_refresh_success', { latencyMs });

    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at,
      expires_in: data.expires_in,
      token_type: data.token_type,
      user: data.user
    };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    console.warn('[DirectAuth] Token refresh failed:', error);
    bootTrace.mark('fast_path_refresh_error', { error: String(error), latencyMs });
    return null;
  }
}

/**
 * Check if a session is expired (with 60-second buffer)
 */
function isSessionExpired(session: StoredSession): boolean {
  if (!session.expires_at) return false;
  
  // Add 60-second buffer to avoid edge cases
  const bufferSeconds = 60;
  const nowSeconds = Math.floor(Date.now() / 1000);
  
  return session.expires_at < (nowSeconds + bufferSeconds);
}

/**
 * Fast-path session validation
 * 
 * Attempts to validate the cached session without using supabase-js.
 * Returns a Session-like object if valid, null if no valid session.
 * 
 * This is designed to race against supabase.auth.getSession() to provide
 * instant auth for users with valid cached sessions.
 * 
 * IMPORTANT: When the token is expired, this function returns null immediately
 * and yields entirely to supabase.auth.getSession(). Attempting to refresh
 * here concurrently causes HTTP 409 (Supabase rejects double refresh-token
 * consumption) which triggers a SIGNED_OUT event and clears localStorage.
 */
export async function fastPathGetSession(): Promise<Session | null> {
  const startTime = Date.now();
  bootTrace.mark('fast_path_start');

  try {
    // Step 1: Read stored session
    const stored = getStoredSession();
    if (!stored) {
      bootTrace.mark('fast_path_no_session');
      return null;
    }

    // Step 2: If token is expired, yield to supabase.auth.getSession().
    // Do NOT call refreshTokenDirect() here — supabase.auth.getSession() also
    // refreshes expired tokens internally. Concurrent calls with the same
    // refresh token cause HTTP 409 + SIGNED_OUT, clearing the session entirely.
    if (isSessionExpired(stored)) {
      bootTrace.mark('fast_path_token_expired');
      bootTrace.mark('fast_path_yield_to_slow_path');
      return null;
    }

    // Step 3: Token is not expired — return from cache if user data is present.
    // Skip the validateTokenDirect() network call: on slow connections it was
    // timing out and causing the fast path to return null, forcing 2-3 retries.
    if (stored.user) {
      const latencyMs = Date.now() - startTime;
      bootTrace.mark('fast_path_complete_cached', { latencyMs });
      return {
        access_token: stored.access_token,
        refresh_token: stored.refresh_token,
        expires_in: stored.expires_in || 3600,
        expires_at: stored.expires_at || Math.floor(Date.now() / 1000) + 3600,
        token_type: (stored.token_type || 'bearer') as 'bearer',
        user: stored.user
      };
    }

    // Fallback: no cached user — validate via network
    const user = await validateTokenDirect(stored.access_token);
    if (!user) {
      bootTrace.mark('fast_path_token_invalid');
      return null;
    }

    // Step 4: Construct and return session
    const latencyMs = Date.now() - startTime;
    bootTrace.mark('fast_path_complete', { latencyMs });

    return {
      access_token: stored.access_token,
      refresh_token: stored.refresh_token,
      expires_in: stored.expires_in || 3600,
      expires_at: stored.expires_at || Math.floor(Date.now() / 1000) + 3600,
      token_type: (stored.token_type || 'bearer') as 'bearer',
      user: user
    };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    console.error('[DirectAuth] Fast path failed:', error);
    bootTrace.mark('fast_path_error', { error: String(error), latencyMs });
    return null;
  }
}

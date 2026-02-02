import { createContext, useContext, useEffect, useState, useCallback, useMemo, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { bootTrace } from '@/utils/bootTrace';
import { logToErrorLog } from '@/utils/directLog';
import { fastPathGetSession } from '@/utils/directAuth';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
  isAdmin: boolean;
  isDemoMode: boolean;
  initError: string | null;
  retryAuth: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// ============================================================================
// FEATURE FLAG: Toggle between V1 (original) and V2 (listener-first) auth flow
// Set to false to immediately revert to original behavior if V2 causes issues
// ============================================================================
const USE_V2_AUTH = true;

// Check if running in Lovable iframe preview or preview URL
const isDevelopmentMode = () => {
  const hostname = window.location.hostname;
  return window !== window.top || 
         hostname.includes('lovableproject.com') ||
         hostname.includes('lovable.app') && hostname.includes('preview') ||
         hostname === 'localhost';
};

// Create consistent mock user for preview mode
const createMockUser = (): User => ({
  id: '00000000-0000-0000-0000-000000000001',
  app_metadata: {},
  user_metadata: {
    email: 'demo@example.com',
    full_name: 'Demo User'
  },
  aud: 'authenticated',
  confirmation_sent_at: '',
  email: 'demo@example.com',
  email_confirmed_at: new Date().toISOString(),
  confirmed_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  phone: '',
  role: 'authenticated'
});

const createMockSession = (mockUser: User): Session => ({
  access_token: 'mock-token',
  refresh_token: 'mock-refresh',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  token_type: 'bearer',
  user: mockUser
});

// Helper to log auth errors to the database (best-effort, never blocks UI)
// Uses direct REST logger to bypass supabase-js if it's hung
const logAuthError = async (errorType: string, message: string, metadata?: Record<string, unknown>) => {
  try {
    await logToErrorLog({
      component: 'AuthProvider',
      error_type: errorType,
      error_message: message,
      context: metadata
    });
  } catch (e) {
    console.error('[Auth] Failed to log error to database:', e);
  }
};

// Timeout wrapper for async operations
const withTimeout = <T,>(promise: Promise<T>, ms: number, errorMessage: string): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => 
      setTimeout(() => reject(new Error(errorMessage)), ms)
    )
  ]);
};

const AUTH_TIMEOUT_MS = 10000; // 10 seconds

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  
  // Memoize environment check to prevent unnecessary recalculations
  const isPreviewEnvironment = useMemo(() => isDevelopmentMode(), []);
  
  // Diagnostic logging for production debugging
  console.log('[Auth] Environment:', {
    hostname: window.location.hostname,
    isPreviewEnvironment,
    useV2Auth: USE_V2_AUTH,
    bootId: bootTrace.getBootId(),
    timestamp: new Date().toISOString()
  });

  // Admin check - moved to separate effect to avoid callback issues
  const checkAdminStatus = useCallback(async (userId: string) => {
    bootTrace.mark('admin_check_start', { userId: userId.substring(0, 8) });
    try {
      const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .eq('role', 'admin')
        .maybeSingle();
      
      if (!error) {
        setIsAdmin(!!data);
        bootTrace.mark('admin_check_done', { isAdmin: !!data });
      }
    } catch (error) {
      console.error('Error checking admin status:', error);
      bootTrace.mark('admin_check_error');
    }
  }, []);

  // ============================================================================
  // V1: ORIGINAL AUTH INITIALIZATION (preserved as backup)
  // ============================================================================
  const initAuthV1 = useCallback(async () => {
    console.log('[Auth] Starting V1 auth initialization...');
    bootTrace.mark('v1_init_start');
    setLoading(true);
    setInitError(null);
    
    let subscription: { unsubscribe: () => void } | null = null;

    try {
      // Fetch session with timeout to prevent infinite hang
      bootTrace.mark('v1_getSession_start');
      const { data: { session: existingSession }, error: sessionError } = await withTimeout(
        supabase.auth.getSession(),
        AUTH_TIMEOUT_MS,
        'Authentication service timed out'
      );
      bootTrace.mark('v1_getSession_done', { hasSession: !!existingSession });

      if (sessionError) {
        throw sessionError;
      }
      
      if (existingSession?.user) {
        // Real session exists - use it even in preview environment
        console.log('[Auth] Found existing session for user:', existingSession.user.email);
        setSession(existingSession);
        setUser(existingSession.user);
        setIsDemoMode(false);
        bootTrace.mark('v1_user_set', { email: existingSession.user.email });
        
        // Check admin status asynchronously (don't block)
        setTimeout(() => checkAdminStatus(existingSession.user.id), 0);
        
        // Set up auth state listener to handle sign out/in
        const { data: { subscription: sub } } = supabase.auth.onAuthStateChange(
          (event, session) => {
            console.log('[Auth] Auth state changed:', event);
            bootTrace.mark(`auth_event:${event}`);
            if (session?.user) {
              setSession(session);
              setUser(session.user);
              setIsDemoMode(false);
              setTimeout(() => checkAdminStatus(session.user.id), 0);
            } else if (isPreviewEnvironment) {
              // User signed out in preview - fall back to demo mode
              const mockUser = createMockUser();
              const mockSession = createMockSession(mockUser);
              setUser(mockUser);
              setSession(mockSession);
              setIsDemoMode(true);
              setIsAdmin(true);
            } else {
              setSession(null);
              setUser(null);
              setIsAdmin(false);
            }
          }
        );
        subscription = sub;
      } else if (isPreviewEnvironment) {
        // No real session and we're in preview - use demo mode
        console.log('[Auth] No session found, using demo mode for preview environment');
        const mockUser = createMockUser();
        const mockSession = createMockSession(mockUser);
        setUser(mockUser);
        setSession(mockSession);
        setIsDemoMode(true);
        setIsAdmin(true);
        bootTrace.mark('v1_demo_mode_set');
      } else {
        // No session and not in preview - just set loading to false
        console.log('[Auth] No session found in production, user needs to sign in');
        setSession(null);
        setUser(null);
        bootTrace.mark('v1_no_session');
        
        // Set up auth state listener for future sign-ins
        const { data: { subscription: sub } } = supabase.auth.onAuthStateChange(
          (event, session) => {
            bootTrace.mark(`auth_event:${event}`);
            setSession(session);
            setUser(session?.user ?? null);
            
            if (session?.user) {
              setTimeout(() => checkAdminStatus(session.user.id), 0);
            } else {
              setIsAdmin(false);
            }
          }
        );
        subscription = sub;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown authentication error';
      const isTimeout = errorMessage.includes('timed out');
      
      console.error('[Auth] V1 Initialization failed:', errorMessage);
      bootTrace.mark('v1_init_error', { error: errorMessage, isTimeout });
      
      // Log to database for visibility
      logAuthError(
        isTimeout ? 'auth_init_timeout' : 'auth_init_failed',
        errorMessage,
        { isPreviewEnvironment, version: 'v1' }
      );
      
      // Set user-facing error
      setInitError(
        isTimeout 
          ? 'Connection to authentication service timed out. Please check your network and try again.'
          : `Authentication failed: ${errorMessage}`
      );
      
      // Reset to safe defaults
      setSession(null);
      setUser(null);
      setIsAdmin(false);
      setIsDemoMode(false);
    } finally {
      // ALWAYS set loading to false to prevent infinite loading screen
      setLoading(false);
      bootTrace.mark('v1_init_complete');
      console.log('[Auth] V1 Initialization complete, loading set to false');
    }

    // Return cleanup function
    return () => {
      if (subscription) {
        subscription.unsubscribe();
      }
    };
  }, [isPreviewEnvironment, checkAdminStatus]);

  // ============================================================================
  // V2: PARALLEL AUTH INITIALIZATION WITH FAST-PATH
  // This version races a direct REST validation against supabase.getSession()
  // to bypass potential library deadlocks and provide instant auth for cached sessions
  // ============================================================================
  const initAuthV2 = useCallback(async () => {
    console.log('[Auth] Starting V2 auth initialization (parallel fast-path)...');
    bootTrace.mark('v2_init_start');
    setLoading(true);
    setInitError(null);
    
    let subscription: { unsubscribe: () => void } | null = null;
    let hasReceivedSession = false;
    let fastPathWon = false;

    try {
      // STEP 1: Attach listener FIRST (before any getSession)
      // This ensures we capture SIGNED_IN events from OAuth code exchange
      bootTrace.mark('v2_listener_attaching');
      
      const { data: { subscription: sub } } = supabase.auth.onAuthStateChange(
        (event, session) => {
          console.log('[Auth V2] Auth state changed:', event, session?.user?.email);
          bootTrace.mark(`auth_event:${event}`, { hasUser: !!session?.user });
          
          if (session?.user) {
            hasReceivedSession = true;
            setSession(session);
            setUser(session.user);
            setIsDemoMode(false);
            setLoading(false);
            bootTrace.mark('v2_user_set_from_event', { email: session.user.email });
            
            // Check admin status asynchronously (don't block)
            setTimeout(() => checkAdminStatus(session.user.id), 0);
          } else if (event === 'SIGNED_OUT') {
            if (isPreviewEnvironment) {
              // User signed out in preview - fall back to demo mode
              const mockUser = createMockUser();
              const mockSession = createMockSession(mockUser);
              setUser(mockUser);
              setSession(mockSession);
              setIsDemoMode(true);
              setIsAdmin(true);
              bootTrace.mark('v2_demo_mode_fallback');
            } else {
              setSession(null);
              setUser(null);
              setIsAdmin(false);
            }
            setLoading(false);
          }
        }
      );
      subscription = sub;
      bootTrace.mark('v2_listener_attached');

      // STEP 2: RACE - Fast path (direct REST) vs Slow path (supabase-js)
      // First one to succeed wins and sets the session
      bootTrace.mark('v2_race_start');

      // Create the slow path promise (supabase-js getSession with timeout)
      const slowPath = async (): Promise<{ session: Session | null; source: 'slow' }> => {
        bootTrace.mark('slow_path_start');
        const { data: { session }, error } = await withTimeout(
          supabase.auth.getSession(),
          AUTH_TIMEOUT_MS,
          'Authentication service timed out'
        );
        if (error) throw error;
        bootTrace.mark('slow_path_done', { hasSession: !!session });
        return { session, source: 'slow' as const };
      };

      // Create the fast path promise (direct REST validation)
      const fastPath = async (): Promise<{ session: Session | null; source: 'fast' } | null> => {
        bootTrace.mark('fast_path_attempt');
        const session = await fastPathGetSession();
        if (session) {
          bootTrace.mark('fast_path_won', { userId: session.user?.id?.substring(0, 8) });
          return { session, source: 'fast' as const };
        }
        // Fast path failed (no cached session or invalid) - return null to let slow path win
        return null;
      };

      // Race implementation compatible with ES2020
      // Fast path returns null if no session, slow path throws on timeout
      let raceResult: { session: Session | null; source: 'fast' | 'slow' };
      
      const [fastResult, slowResult] = await Promise.allSettled([
        fastPath(),
        slowPath()
      ]);

      // Check if fast path succeeded with a valid session
      if (fastResult.status === 'fulfilled' && fastResult.value?.session) {
        raceResult = fastResult.value;
        fastPathWon = true;
      } else if (slowResult.status === 'fulfilled') {
        // Slow path succeeded (even if session is null - that's valid)
        raceResult = slowResult.value;
      } else {
        // Both failed - throw the slow path error (more informative, likely timeout)
        const slowError = slowResult.status === 'rejected' ? slowResult.reason : new Error('Auth failed');
        throw slowError;
      }

      bootTrace.mark('v2_race_complete', { 
        winner: raceResult.source, 
        hasSession: !!raceResult.session 
      });
      console.log(`[Auth V2] Race won by: ${raceResult.source} path`);
      fastPathWon = raceResult.source === 'fast';

      // If we already got a session from the listener, don't override
      if (hasReceivedSession) {
        console.log('[Auth V2] Session already set from listener event');
        bootTrace.mark('v2_session_from_listener');
        return () => subscription?.unsubscribe();
      }
      
      const existingSession = raceResult.session;
      
      if (existingSession?.user) {
        // Real session exists - set it
        console.log('[Auth V2] Found session via', raceResult.source, 'path for:', existingSession.user.email);
        setSession(existingSession);
        setUser(existingSession.user);
        setIsDemoMode(false);
        bootTrace.mark('v2_user_set', { 
          email: existingSession.user.email, 
          source: raceResult.source,
          fastPathWon 
        });
        
        // Check admin status asynchronously
        setTimeout(() => checkAdminStatus(existingSession.user.id), 0);
      } else if (isPreviewEnvironment) {
        // No real session and we're in preview - use demo mode
        console.log('[Auth V2] No session found, using demo mode for preview environment');
        const mockUser = createMockUser();
        const mockSession = createMockSession(mockUser);
        setUser(mockUser);
        setSession(mockSession);
        setIsDemoMode(true);
        setIsAdmin(true);
        bootTrace.mark('v2_demo_mode_set');
      } else {
        // No session and not in preview - user needs to sign in
        console.log('[Auth V2] No session found in production, user needs to sign in');
        setSession(null);
        setUser(null);
        bootTrace.mark('v2_no_session');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown authentication error';
      const isTimeout = errorMessage.includes('timed out');
      
      console.error('[Auth V2] Initialization failed:', errorMessage);
      bootTrace.mark('v2_init_error', { error: errorMessage, isTimeout, fastPathWon });
      
      // Log to database for visibility
      logAuthError(
        isTimeout ? 'auth_init_timeout' : 'auth_init_failed',
        errorMessage,
        { isPreviewEnvironment, version: 'v2', fastPathWon }
      );
      
      // Set user-facing error
      setInitError(
        isTimeout 
          ? 'Connection to authentication service timed out. Please check your network and try again.'
          : `Authentication failed: ${errorMessage}`
      );
      
      // Reset to safe defaults
      setSession(null);
      setUser(null);
      setIsAdmin(false);
      setIsDemoMode(false);
    } finally {
      // ALWAYS set loading to false to prevent infinite loading screen
      setLoading(false);
      bootTrace.mark('v2_init_complete', { fastPathWon });
      console.log('[Auth V2] Initialization complete, loading set to false');
    }

    // Return cleanup function
    return () => {
      if (subscription) {
        subscription.unsubscribe();
      }
    };
  }, [isPreviewEnvironment, checkAdminStatus]);

  // Retry function for user-triggered retry
  const retryAuth = useCallback(() => {
    console.log('[Auth] User triggered retry');
    bootTrace.mark('auth_retry_triggered');
    if (USE_V2_AUTH) {
      initAuthV2();
    } else {
      initAuthV1();
    }
  }, [initAuthV1, initAuthV2]);

  // Main initialization effect - uses feature flag to choose V1 or V2
  // BYPASS: Skip auth init entirely on /debug route so debug page always loads
  useEffect(() => {
    // Check if we're on the debug route - if so, skip auth init entirely
    if (window.location.pathname.startsWith('/debug')) {
      console.log('[Auth] Debug route detected - bypassing auth initialization');
      bootTrace.mark('debug_bypass_active');
      setLoading(false);
      setSession(null);
      setUser(null);
      setIsDemoMode(false);
      setIsAdmin(false);
      return;
    }
    
    let cleanup: (() => void) | undefined;
    
    bootTrace.mark('auth_init_start', { version: USE_V2_AUTH ? 'v2' : 'v1' });
    
    const initFn = USE_V2_AUTH ? initAuthV2 : initAuthV1;
    
    initFn().then(cleanupFn => {
      cleanup = cleanupFn;
    });

    return () => {
      if (cleanup) {
        cleanup();
      }
    };
  }, [initAuthV1, initAuthV2]);

  const signOut = async () => {
    bootTrace.mark('sign_out_start');
    if (isDemoMode) {
      // In demo mode, just clear the mock session
      setUser(null);
      setSession(null);
      setIsAdmin(false);
      bootTrace.mark('sign_out_demo_mode');
      return;
    }
    await supabase.auth.signOut();
    bootTrace.mark('sign_out_complete');
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      session, 
      loading, 
      signOut, 
      isAdmin, 
      isDemoMode,
      initError,
      retryAuth
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
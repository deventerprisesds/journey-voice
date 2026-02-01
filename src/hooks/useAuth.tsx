import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

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
const logAuthError = async (errorType: string, message: string, metadata?: Record<string, unknown>) => {
  try {
    await supabase.from('error_log').insert({
      source: 'frontend',
      component: 'AuthProvider',
      error_type: errorType,
      error_message: message,
      context: {
        origin: window.location.origin,
        hostname: window.location.hostname,
        pathname: window.location.pathname,
        userAgent: navigator.userAgent,
        ...metadata
      }
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
  const isPreviewEnvironment = isDevelopmentMode();

  const checkAdminStatus = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .eq('role', 'admin')
        .maybeSingle();
      
      if (!error) {
        setIsAdmin(!!data);
      }
    } catch (error) {
      console.error('Error checking admin status:', error);
    }
  };

  const initAuth = useCallback(async () => {
    console.log('[Auth] Starting auth initialization...');
    setLoading(true);
    setInitError(null);
    
    let subscription: { unsubscribe: () => void } | null = null;

    try {
      // Fetch session with timeout to prevent infinite hang
      const { data: { session: existingSession }, error: sessionError } = await withTimeout(
        supabase.auth.getSession(),
        AUTH_TIMEOUT_MS,
        'Authentication service timed out'
      );

      if (sessionError) {
        throw sessionError;
      }
      
      if (existingSession?.user) {
        // Real session exists - use it even in preview environment
        console.log('[Auth] Found existing session for user:', existingSession.user.email);
        setSession(existingSession);
        setUser(existingSession.user);
        setIsDemoMode(false);
        checkAdminStatus(existingSession.user.id);
        
        // Set up auth state listener to handle sign out/in
        const { data: { subscription: sub } } = supabase.auth.onAuthStateChange(
          (event, session) => {
            console.log('[Auth] Auth state changed:', event);
            if (session?.user) {
              setSession(session);
              setUser(session.user);
              setIsDemoMode(false);
              checkAdminStatus(session.user.id);
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
      } else {
        // No session and not in preview - just set loading to false
        console.log('[Auth] No session found in production, user needs to sign in');
        setSession(null);
        setUser(null);
        
        // Set up auth state listener for future sign-ins
        const { data: { subscription: sub } } = supabase.auth.onAuthStateChange(
          (event, session) => {
            setSession(session);
            setUser(session?.user ?? null);
            
            if (session?.user) {
              checkAdminStatus(session.user.id);
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
      
      console.error('[Auth] Initialization failed:', errorMessage);
      
      // Log to database for visibility
      logAuthError(
        isTimeout ? 'auth_init_timeout' : 'auth_init_failed',
        errorMessage,
        { isPreviewEnvironment }
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
      console.log('[Auth] Initialization complete, loading set to false');
    }

    // Return cleanup function
    return () => {
      if (subscription) {
        subscription.unsubscribe();
      }
    };
  }, [isPreviewEnvironment]);

  // Retry function for user-triggered retry
  const retryAuth = useCallback(() => {
    console.log('[Auth] User triggered retry');
    initAuth();
  }, [initAuth]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    
    initAuth().then(cleanupFn => {
      cleanup = cleanupFn;
    });

    return () => {
      if (cleanup) {
        cleanup();
      }
    };
  }, [initAuth]);

  const signOut = async () => {
    if (isDemoMode) {
      // In demo mode, just clear the mock session
      setUser(null);
      setSession(null);
      setIsAdmin(false);
      return;
    }
    await supabase.auth.signOut();
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

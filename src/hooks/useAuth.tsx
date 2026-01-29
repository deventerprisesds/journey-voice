import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
  isAdmin: boolean;
  isDemoMode: boolean;
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isDemoMode] = useState(isDevelopmentMode());

  useEffect(() => {
    if (isDemoMode) {
      // Use mock authentication for preview mode
      const mockUser = createMockUser();
      const mockSession = createMockSession(mockUser);
      setUser(mockUser);
      setSession(mockSession);
      setIsAdmin(true); // Demo user has admin access
      setLoading(false);
      return;
    }

    // Set up auth state listener for production
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
        
        // Check admin status when user changes
        if (session?.user) {
          setTimeout(() => {
            checkAdminStatus(session.user.id);
          }, 0);
        } else {
          setIsAdmin(false);
        }
      }
    );

    // Check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
      
      if (session?.user) {
        checkAdminStatus(session.user.id);
      }
    });

    return () => subscription.unsubscribe();
  }, [isDemoMode]);

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
    <AuthContext.Provider value={{ user, session, loading, signOut, isAdmin, isDemoMode }}>
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
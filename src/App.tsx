// Build trigger: 2026-03-27T16:45
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { AssignmentSelectionProvider } from "@/contexts/AssignmentSelectionContext";
import { VoiceAssistantProvider } from "@/contexts/VoiceAssistantContext";
import { CommsConsoleProvider } from "@/contexts/CommsConsoleContext";
import MainLayout from "./components/MainLayout";
import ProtectedRoute from "./components/ProtectedRoute";
import TasksPage from "./pages/TasksPage";
import DailyPriorities from "./pages/DailyPriorities";
import Auth from "./pages/Auth";
import Admin from "./pages/Admin";
import Settings from "./pages/Settings";
import Calendar from "./pages/Calendar";
import Priorities from "./pages/Priorities";
import Assignments from "./pages/Assignments";
import Debug from "./pages/Debug";
import CommsHome from "./pages/CommsHome";
import NotFound from "./pages/NotFound";
import DemoModeBadge from "./components/DemoModeBadge";
import QuotaAlertBanner from "./components/QuotaAlertBanner";
import ErrorBoundary from "./components/ErrorBoundary";
import { supabase, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "@/integrations/supabase/client";
import { useEffect } from "react";
import { bootTrace } from "@/utils/bootTrace";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5 * 60 * 1000,
      gcTime: 24 * 60 * 60 * 1000,   // 24 hours — persisted cache survives page reloads
      refetchOnWindowFocus: false,    // Realtime subscriptions handle live updates
      refetchOnReconnect: true,       // Do re-sync after network reconnects
    },
  },
});

// Persist the React Query cache to localStorage so data survives WebView kills
// and page reloads. maxAge matches gcTime so stale entries are evicted together.
const localStoragePersister = createSyncStoragePersister({
  storage: window.localStorage,
  key: 'jv-rq-cache-v1',
  throttleTime: 1000,
});

const App = () => {
  useEffect(() => {
    // Mark app component mount
    bootTrace.mark('app_component_mount');
    
    // Log production info for debugging
    console.log('App Environment:', {
      origin: window.location.origin,
      supabaseUrl: "https://wwxgajrtmslzklnyplah.supabase.co",
      isProduction: window.location.origin.includes('journey-voice.lovable.app'),
      bootId: bootTrace.getBootId()
    });

    // test-external-db removed — invoke manually from Debug page if needed
  }, []);

  // Bridge Supabase auth tokens to native EncryptedPrefs so widget can make direct API calls
  useEffect(() => {
    const bridge = (window as any).AndroidBridge;
    if (!bridge?.secureStore) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        bridge.secureStore('supabase_url', SUPABASE_URL);
        bridge.secureStore('supabase_anon_key', SUPABASE_PUBLISHABLE_KEY);
        bridge.secureStore('supabase_access_token', session.access_token);
        bridge.secureStore('supabase_refresh_token', session.refresh_token ?? '');
        bridge.secureStore('supabase_user_id', session.user.id);
      } else {
        bridge.secureStore('supabase_access_token', '');
        bridge.secureStore('supabase_refresh_token', '');
        bridge.secureStore('supabase_user_id', '');
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: localStoragePersister,
        maxAge: 24 * 60 * 60 * 1000,
        dehydrateOptions: {
          // Only persist queries that have successfully returned data
          shouldDehydrateQuery: (query) => query.state.status === 'success',
        },
      }}
    >
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <VoiceAssistantProvider>
              <CommsConsoleProvider>
                <AssignmentSelectionProvider>
                  <DemoModeBadge />
                  <QuotaAlertBanner />
                  <ErrorBoundary>
                    <Routes>
                      <Route path="/auth" element={<Auth />} />
                      <Route path="/debug" element={<Debug />} />
                      <Route path="/comms" element={<CommsHome />} />
                      <Route path="/comms/active" element={<CommsHome autoConnect />} />
                      {/* All authenticated routes wrapped in MainLayout */}
                      <Route path="/*" element={
                        <ProtectedRoute>
                          <MainLayout>
                            <Routes>
                              <Route path="/" element={<Navigate to="/tasks?view=focus" replace />} />
                              <Route path="/tasks" element={<TasksPage />} />
                              <Route path="/agenda" element={<DailyPriorities />} />
                              <Route path="/admin" element={<ProtectedRoute requireAdmin><Admin /></ProtectedRoute>} />
                              <Route path="/settings" element={<Settings />} />
                              <Route path="/calendar" element={<Calendar />} />
                              <Route path="/priorities" element={<Priorities />} />
                              <Route path="/assignments" element={<Assignments />} />
                              <Route path="*" element={<NotFound />} />
                            </Routes>
                          </MainLayout>
                        </ProtectedRoute>
                      } />
                    </Routes>
                  </ErrorBoundary>
                </AssignmentSelectionProvider>
              </CommsConsoleProvider>
            </VoiceAssistantProvider>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </PersistQueryClientProvider>
  );
};

export default App;

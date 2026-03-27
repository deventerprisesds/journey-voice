// Build trigger: 2026-03-27
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import Debug from "./pages/Debug";
import NotFound from "./pages/NotFound";
import DemoModeBadge from "./components/DemoModeBadge";
import QuotaAlertBanner from "./components/QuotaAlertBanner";
import ErrorBoundary from "./components/ErrorBoundary";
import { supabase } from "@/integrations/supabase/client";
import { useEffect } from "react";
import { bootTrace } from "@/utils/bootTrace";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1 } },
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

    // Only run test-external-db in preview/development
    if (!window.location.origin.includes('journey-voice.lovable.app')) {
      const testExternalDb = async () => {
        try {
          console.log('Testing external database connection...');
          const { data, error } = await supabase.functions.invoke('test-external-db');
          
          if (error) {
            console.error('Test function error:', error);
          } else {
            console.log('External DB Test Results:', data);
            console.log(`Overall Status: ${data?.overall_status}`);
            console.log(`Summary: ${data?.summary}`);
            
            // Log individual test results
            data?.tests?.forEach((test: any) => {
              console.log(`${test.status === 'PASS' ? '✅' : '❌'} ${test.test}: ${test.message}`);
              if (test.data) {
                console.log('  Data:', test.data);
              }
              if (test.error) {
                console.log('  Error:', test.error);
              }
            });
          }
        } catch (err) {
          console.error('Failed to test external database:', err);
        }
      };

      testExternalDb();
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
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
    </QueryClientProvider>
  );
};

export default App;

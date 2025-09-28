import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import Dashboard from "./pages/Dashboard";
import Auth from "./pages/Auth";
import Admin from "./pages/Admin";
import Settings from "./pages/Settings";
import Calendar from "./pages/Calendar";
import NotFound from "./pages/NotFound";
import DemoModeBadge from "./components/DemoModeBadge";
import { supabase } from "@/integrations/supabase/client";
import { useEffect } from "react";

const queryClient = new QueryClient();

const App = () => {
  useEffect(() => {
    // Test the external database function
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
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <DemoModeBadge />
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/calendar" element={<Calendar />} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
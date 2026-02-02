/**
 * Direct REST Logger - Supabase-js independent logging utility
 * 
 * This utility sends logs directly to the Supabase REST API using fetch(),
 * bypassing the supabase-js library entirely. This ensures logs reach the
 * database even if supabase-js is hung (auth deadlock, storage lock, etc.)
 * 
 * IMPORTANT: This is a best-effort fire-and-forget logger - it never throws
 * and never blocks the main application flow.
 */

const SUPABASE_URL = 'https://wwxgajrtmslzklnyplah.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3eGdhanJ0bXNsemtsbnlwbGFoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg0MDI3MzIsImV4cCI6MjA3Mzk3ODczMn0._M_B3093_wjfFe4vwXmKXVCcw-QG5UhRAT4-H-aGoHE';

// Timeout for log requests (don't block forever)
const LOG_TIMEOUT_MS = 5000;

// Get boot ID from window if available (set by bootTrace)
const getBootId = (): string => {
  try {
    return (window as any).__bootTrace?.bootId || 'unknown';
  } catch {
    return 'unknown';
  }
};

// Collect standard context automatically
const getStandardContext = () => {
  try {
    const connection = (navigator as any).connection;
    return {
      boot_id: getBootId(),
      origin: window.location.origin,
      hostname: window.location.hostname,
      pathname: window.location.pathname,
      userAgent: navigator.userAgent,
      timestamp: new Date().toISOString(),
      online: navigator.onLine,
      effectiveType: connection?.effectiveType || null,
      downlink: connection?.downlink || null
    };
  } catch {
    return {
      boot_id: getBootId(),
      timestamp: new Date().toISOString()
    };
  }
};

export interface DirectLogParams {
  component: string;
  error_type: string;
  error_message: string;
  context?: Record<string, unknown>;
  stack_trace?: string;
}

/**
 * Send a log entry directly to error_log table via REST API
 * This function NEVER throws and returns quickly (fire-and-forget)
 */
export const logToErrorLog = async (params: DirectLogParams): Promise<boolean> => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), LOG_TIMEOUT_MS);

    const body = {
      source: 'frontend',
      component: params.component,
      error_type: params.error_type,
      error_message: params.error_message,
      stack_trace: params.stack_trace || null,
      context: {
        ...getStandardContext(),
        ...params.context
      }
    };

    const response = await fetch(`${SUPABASE_URL}/rest/v1/error_log`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    
    return response.ok;
  } catch (e) {
    // Never throw - this is best-effort logging
    console.warn('[DirectLog] Failed to send log:', e);
    return false;
  }
};

/**
 * Send an immediate "app_start" beacon when the module loads
 * This ensures we get at least one log entry per page load
 */
export const sendStartupBeacon = (): void => {
  // Use setTimeout to ensure bootTrace has initialized
  setTimeout(() => {
    logToErrorLog({
      component: 'DirectLog',
      error_type: 'startup_beacon',
      error_message: 'app_start',
      context: {
        beacon_type: 'startup'
      }
    });
  }, 100);
};

/**
 * Test if we can reach the Supabase REST API
 * Returns latency in ms, or error message
 */
export const probeRestApi = async (): Promise<{ ok: boolean; latencyMs?: number; error?: string }> => {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    // Use a simple GET to the health endpoint or tables list
    const response = await fetch(`${SUPABASE_URL}/rest/v1/`, {
      method: 'HEAD',
      headers: {
        'apikey': SUPABASE_ANON_KEY
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    const latencyMs = Date.now() - start;

    if (response.ok || response.status === 400) {
      // 400 is expected (no table specified), but it means REST is reachable
      return { ok: true, latencyMs };
    } else {
      return { ok: false, latencyMs, error: `HTTP ${response.status}` };
    }
  } catch (e) {
    return { 
      ok: false, 
      latencyMs: Date.now() - start,
      error: e instanceof Error ? e.message : 'Unknown error'
    };
  }
};

/**
 * Test if we can reach the Supabase Auth API
 */
export const probeAuthApi = async (): Promise<{ ok: boolean; latencyMs?: number; error?: string }> => {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    // Use the auth health endpoint
    const response = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
      method: 'GET',
      headers: {
        'apikey': SUPABASE_ANON_KEY
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    const latencyMs = Date.now() - start;

    if (response.ok) {
      return { ok: true, latencyMs };
    } else {
      return { ok: false, latencyMs, error: `HTTP ${response.status}` };
    }
  } catch (e) {
    return { 
      ok: false, 
      latencyMs: Date.now() - start,
      error: e instanceof Error ? e.message : 'Unknown error'
    };
  }
};

/**
 * Test if we can reach an edge function
 */
export const probeEdgeFunction = async (functionName: string = 'ping'): Promise<{ ok: boolean; latencyMs?: number; error?: string; response?: any }> => {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ probe: true, boot_id: getBootId() }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    const latencyMs = Date.now() - start;

    if (response.ok) {
      const data = await response.json();
      return { ok: true, latencyMs, response: data };
    } else {
      return { ok: false, latencyMs, error: `HTTP ${response.status}` };
    }
  } catch (e) {
    return { 
      ok: false, 
      latencyMs: Date.now() - start,
      error: e instanceof Error ? e.message : 'Unknown error'
    };
  }
};

/**
 * Setup global error handlers that log via direct REST
 */
export const setupGlobalErrorHandlers = (): void => {
  // Capture uncaught errors
  window.onerror = (message, source, lineno, colno, error) => {
    logToErrorLog({
      component: 'GlobalErrorHandler',
      error_type: 'uncaught_error',
      error_message: String(message),
      stack_trace: error?.stack?.substring(0, 2000),
      context: {
        source,
        lineno,
        colno
      }
    });
    return false; // Don't prevent default handling
  };

  // Capture unhandled promise rejections
  window.onunhandledrejection = (event) => {
    const reason = event.reason;
    logToErrorLog({
      component: 'GlobalErrorHandler',
      error_type: 'unhandled_rejection',
      error_message: reason?.message || String(reason),
      stack_trace: reason?.stack?.substring(0, 2000),
      context: {
        type: typeof reason
      }
    });
  };
};

// Auto-initialize: send startup beacon and setup global handlers
if (typeof window !== 'undefined') {
  sendStartupBeacon();
  setupGlobalErrorHandlers();
}

export default {
  logToErrorLog,
  sendStartupBeacon,
  probeRestApi,
  probeAuthApi,
  probeEdgeFunction,
  setupGlobalErrorHandlers
};

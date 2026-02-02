/**
 * Boot Trace System - Diagnostic logging for auth initialization
 * 
 * This system provides:
 * - Unique boot_id per app load for correlation
 * - Timestamped step markers for debugging hangs
 * - In-memory storage for UI display
 * - Best-effort logging to error_log table
 * - One-click diagnostics copy for sharing
 */

import { supabase } from '@/integrations/supabase/client';

interface TraceEntry {
  step: string;
  timestamp: number;
  elapsedMs: number;
  metadata?: Record<string, unknown>;
}

interface BootTraceState {
  bootId: string;
  bootTime: number;
  entries: TraceEntry[];
  environment: {
    hostname: string;
    pathname: string;
    origin: string;
    userAgent: string;
    isProduction: boolean;
    isPreview: boolean;
  };
}

// Generate a short unique ID
const generateBootId = (): string => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${random}`.toUpperCase();
};

// Detect environment
const detectEnvironment = () => {
  const hostname = window.location.hostname;
  return {
    hostname,
    pathname: window.location.pathname,
    origin: window.location.origin,
    userAgent: navigator.userAgent,
    isProduction: hostname === 'journey-voice.lovable.app',
    isPreview: hostname.includes('preview') || 
               hostname.includes('lovableproject.com') ||
               (hostname.includes('lovable.app') && hostname.includes('preview')) ||
               hostname === 'localhost'
  };
};

// Initialize state
const state: BootTraceState = {
  bootId: generateBootId(),
  bootTime: Date.now(),
  entries: [],
  environment: detectEnvironment()
};

// Expose on window for debugging
if (typeof window !== 'undefined') {
  (window as any).__bootTrace = state;
}

/**
 * Mark a step in the boot trace
 */
export const mark = (step: string, metadata?: Record<string, unknown>): void => {
  const now = Date.now();
  const entry: TraceEntry = {
    step,
    timestamp: now,
    elapsedMs: now - state.bootTime,
    metadata
  };
  
  state.entries.push(entry);
  
  // Console log for immediate visibility
  console.log(`[BootTrace] ${entry.elapsedMs}ms - ${step}`, metadata || '');
  
  // Best-effort log to database (never blocks)
  logToDatabase(entry).catch(() => {
    // Silently ignore - this is best-effort
  });
};

/**
 * Get the current boot ID
 */
export const getBootId = (): string => state.bootId;

/**
 * Get all trace entries
 */
export const getEntries = (): TraceEntry[] => [...state.entries];

/**
 * Get the last trace step
 */
export const getLastStep = (): string | null => {
  const last = state.entries[state.entries.length - 1];
  return last?.step ?? null;
};

/**
 * Get environment info
 */
export const getEnvironment = () => ({ ...state.environment });

/**
 * Get full diagnostics as a copyable string
 */
export const getDiagnostics = (): string => {
  const lines = [
    `=== Boot Diagnostics ===`,
    `Boot ID: ${state.bootId}`,
    `Boot Time: ${new Date(state.bootTime).toISOString()}`,
    ``,
    `Environment:`,
    `  Hostname: ${state.environment.hostname}`,
    `  Origin: ${state.environment.origin}`,
    `  Path: ${state.environment.pathname}`,
    `  Is Production: ${state.environment.isProduction}`,
    `  Is Preview: ${state.environment.isPreview}`,
    `  User Agent: ${state.environment.userAgent}`,
    ``,
    `Trace Timeline (${state.entries.length} entries):`,
    ...state.entries.map((e, i) => 
      `  ${i + 1}. [${e.elapsedMs}ms] ${e.step}${e.metadata ? ` ${JSON.stringify(e.metadata)}` : ''}`
    ),
    ``,
    `Last Step: ${getLastStep() || 'none'}`,
    `Total Elapsed: ${Date.now() - state.bootTime}ms`
  ];
  
  return lines.join('\n');
};

/**
 * Copy diagnostics to clipboard
 */
export const copyDiagnostics = async (): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(getDiagnostics());
    return true;
  } catch (e) {
    console.error('[BootTrace] Failed to copy to clipboard:', e);
    return false;
  }
};

/**
 * Best-effort log to database
 */
const logToDatabase = async (entry: TraceEntry): Promise<void> => {
  // Only log significant steps to avoid noise
  const significantSteps = [
    'app_start',
    'auth_init_start',
    'v2_init_start',
    'v2_listener_attached',
    'v2_getSession_done',
    'v2_user_set',
    'v2_init_complete',
    'auth_event:SIGNED_IN',
    'auth_event:SIGNED_OUT',
    'auth_event:TOKEN_REFRESHED',
    'auth_init_error',
    'auth_init_timeout'
  ];
  
  if (!significantSteps.some(s => entry.step.includes(s))) {
    return;
  }
  
  try {
    await supabase.from('error_log').insert([{
      source: 'frontend',
      component: 'BootTrace',
      error_type: 'trace_step',
      error_message: entry.step,
      context: JSON.parse(JSON.stringify({
        boot_id: state.bootId,
        elapsed_ms: entry.elapsedMs,
        environment: state.environment,
        metadata: entry.metadata || null
      }))
    }]);
  } catch (e) {
    // Silently ignore - best effort only
  }
};

/**
 * Reset trace (for testing)
 */
export const reset = (): void => {
  state.bootId = generateBootId();
  state.bootTime = Date.now();
  state.entries = [];
  state.environment = detectEnvironment();
};

// Export the bootTrace object for convenient access
export const bootTrace = {
  mark,
  getBootId,
  getEntries,
  getLastStep,
  getEnvironment,
  getDiagnostics,
  copyDiagnostics,
  reset
};

// Mark app start
mark('app_start');

export default bootTrace;

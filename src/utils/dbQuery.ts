/**
 * Database Query Utility with Error Visibility
 * 
 * Provides explicit distinction between:
 * - Query failure (network error, permission denied, etc.)
 * - Empty result (query succeeded but found no data)
 * 
 * This prevents false confidence during debugging where empty results
 * could indicate either "no data exists" or "query silently failed".
 */

export interface QueryResult<T> {
  data: T[] | null;
  error: Error | null;
  isEmpty: boolean;
  isError: boolean;
  metadata?: {
    queryTime?: number;
    rowCount?: number;
  };
}

export interface SingleQueryResult<T> {
  data: T | null;
  error: Error | null;
  notFound: boolean;
  isError: boolean;
}

/**
 * Safely execute a database query that returns multiple rows.
 * Distinguishes between query failures and empty results.
 * 
 * @example
 * const result = await safeQuery(() => 
 *   supabase.from('tasks').select('*').eq('user_id', userId)
 * );
 * 
 * if (result.isError) {
 *   console.error('Query failed:', result.error);
 * } else if (result.isEmpty) {
 *   console.log('No tasks found');
 * } else {
 *   console.log(`Found ${result.data.length} tasks`);
 * }
 */
export async function safeQuery<T>(
  queryFn: () => Promise<{ data: T[] | null; error: any }>
): Promise<QueryResult<T>> {
  const startTime = Date.now();
  
  try {
    const { data, error } = await queryFn();
    const queryTime = Date.now() - startTime;
    
    if (error) {
      console.error('[DB_QUERY] Query failed:', {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        queryTime
      });
      
      return {
        data: null,
        error: new Error(error.message || 'Database query failed'),
        isEmpty: false,
        isError: true,
        metadata: { queryTime }
      };
    }
    
    const rowCount = data?.length ?? 0;
    
    return {
      data: data,
      error: null,
      isEmpty: rowCount === 0,
      isError: false,
      metadata: { queryTime, rowCount }
    };
  } catch (err) {
    const queryTime = Date.now() - startTime;
    console.error('[DB_QUERY] Exception during query:', err);
    
    return {
      data: null,
      error: err as Error,
      isEmpty: false,
      isError: true,
      metadata: { queryTime }
    };
  }
}

/**
 * Safely execute a database query that returns a single row.
 * Distinguishes between query failures and "not found".
 * 
 * @example
 * const result = await safeSingleQuery(() => 
 *   supabase.from('profiles').select('*').eq('user_id', userId).maybeSingle()
 * );
 * 
 * if (result.isError) {
 *   console.error('Query failed:', result.error);
 * } else if (result.notFound) {
 *   console.log('Profile not found');
 * } else {
 *   console.log('Found profile:', result.data);
 * }
 */
export async function safeSingleQuery<T>(
  queryFn: () => Promise<{ data: T | null; error: any }>
): Promise<SingleQueryResult<T>> {
  try {
    const { data, error } = await queryFn();
    
    if (error) {
      console.error('[DB_QUERY] Single query failed:', {
        message: error.message,
        code: error.code,
        details: error.details
      });
      
      return {
        data: null,
        error: new Error(error.message || 'Database query failed'),
        notFound: false,
        isError: true
      };
    }
    
    return {
      data: data,
      error: null,
      notFound: data === null,
      isError: false
    };
  } catch (err) {
    console.error('[DB_QUERY] Exception during single query:', err);
    
    return {
      data: null,
      error: err as Error,
      notFound: false,
      isError: true
    };
  }
}

/**
 * Log an activity event to the unified activity_log table.
 * Captures all communication attempts across modes (phone, voice, chat).
 * 
 * @param supabase - Supabase client
 * @param params - Activity parameters
 */
export async function logActivity(
  supabase: any,
  params: {
    userId: string;
    activityType: 'phone_inbound' | 'phone_outbound' | 'voice_webrtc' | 'chat';
    sessionId: string;
    status: 'started' | 'connected' | 'completed' | 'failed' | 'error';
    stage?: string;
    errorMessage?: string;
    errorCode?: string;
    durationSeconds?: number;
    messageCount?: number;
    metadata?: Record<string, any>;
    startedAt?: string;
    endedAt?: string;
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase.from('activity_log').upsert({
      user_id: params.userId,
      activity_type: params.activityType,
      session_id: params.sessionId,
      status: params.status,
      stage: params.stage,
      error_message: params.errorMessage,
      error_code: params.errorCode,
      duration_seconds: params.durationSeconds,
      message_count: params.messageCount,
      metadata: params.metadata || {},
      started_at: params.startedAt || new Date().toISOString(),
      ended_at: params.endedAt
    }, {
      onConflict: 'session_id'
    });
    
    if (error) {
      console.error('[ACTIVITY_LOG] Failed to log activity:', error);
      return { success: false, error: error.message };
    }
    
    console.log(`[ACTIVITY_LOG] ✅ ${params.activityType} ${params.status} (${params.sessionId})`);
    return { success: true };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[ACTIVITY_LOG] Exception logging activity:', err);
    return { success: false, error: errorMsg };
  }
}

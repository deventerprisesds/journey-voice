/**
 * Demo Mode Data Utilities
 * 
 * Provides Supabase-backed data access for demo mode with localStorage fallback.
 * Demo user ID: 00000000-0000-0000-0000-000000000001
 */

import { supabase } from '@/integrations/supabase/client';
import { Task, Board } from '@/types/task';

export const DEMO_USER_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Get or create the default board for a user (demo or authenticated).
 * Uses Supabase as primary source, with safe error handling.
 * 
 * @param userId - The user ID to get/create board for
 * @returns Promise<string> - The board UUID
 */
export async function getOrCreateDefaultBoardId(userId: string): Promise<string> {
  // First, try to find an existing default board
  const { data: existingBoard, error: fetchError } = await supabase
    .from('boards')
    .select('*')
    .eq('user_id', userId)
    .eq('is_default', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fetchError) {
    console.error('[DEMO_DATA] Error fetching default board:', fetchError);
    // Fall back to localStorage for demo mode
    const demoBoard = localStorage.getItem('kanban-demo-board');
    if (demoBoard) {
      try {
        return JSON.parse(demoBoard).id;
      } catch {
        // Continue to create new board
      }
    }
  }

  if (existingBoard) {
    console.log('[DEMO_DATA] Found existing default board:', existingBoard.id);
    return existingBoard.id;
  }

  // No board found - create one
  console.log('[DEMO_DATA] No default board found, creating one for user:', userId);
  
  const { data: newBoard, error: createError } = await supabase
    .from('boards')
    .insert({
      name: 'Personal Tasks',
      description: 'Your main task board',
      user_id: userId,
      is_default: true,
      position: 0,
      color: '#3B82F6'
    })
    .select()
    .single();

  if (createError) {
    console.error('[DEMO_DATA] Error creating default board:', createError);
    throw new Error(`Failed to create default board: ${createError.message}`);
  }

  console.log('[DEMO_DATA] Created new default board:', newBoard.id);
  return newBoard.id;
}

/**
 * Load tasks from Supabase for demo mode.
 * Falls back to localStorage if Supabase query fails.
 * 
 * @param userId - The user ID to load tasks for
 * @returns Promise<{ tasks: Task[]; fromCache: boolean }>
 */
export async function loadDemoTasks(userId: string): Promise<{ tasks: Task[]; fromCache: boolean }> {
  console.log('[DEMO_DATA] Loading demo tasks from Supabase for user:', userId);
  
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('user_id', userId)
    .order('created_at');

  if (error) {
    console.warn('[DEMO_DATA] Supabase query failed, falling back to localStorage:', error);
    const localTasks = localStorage.getItem('kanban-demo-tasks');
    if (localTasks) {
      try {
        return { tasks: JSON.parse(localTasks), fromCache: true };
      } catch {
        return { tasks: [], fromCache: true };
      }
    }
    return { tasks: [], fromCache: true };
  }

  const tasks = (data as Task[]) || [];
  console.log(`[DEMO_DATA] Loaded ${tasks.length} tasks from Supabase`);
  
  // Cache to localStorage as fallback
  if (tasks.length > 0) {
    try {
      localStorage.setItem('kanban-demo-tasks', JSON.stringify(tasks));
    } catch (e) {
      console.warn('[DEMO_DATA] Could not cache tasks to localStorage:', e);
    }
  }
  
  return { tasks, fromCache: false };
}

/**
 * Insert demo tasks into Supabase.
 * 
 * @param tasks - Array of task data to insert (without IDs - DB will generate)
 * @returns Promise<Task[]> - Created tasks with IDs
 */
export async function insertDemoTasks(tasks: Record<string, any>[]): Promise<Task[]> {
  console.log('[DEMO_DATA] Inserting', tasks.length, 'tasks into Supabase');
  
  const { data, error } = await supabase
    .from('tasks')
    .insert(tasks as any)
    .select();

  if (error) {
    console.error('[DEMO_DATA] Error inserting tasks:', error);
    throw new Error(`Failed to insert tasks: ${error.message}`);
  }

  console.log('[DEMO_DATA] Successfully inserted', data?.length || 0, 'tasks');
  
  // Update localStorage cache
  try {
    const existing = localStorage.getItem('kanban-demo-tasks');
    const existingTasks = existing ? JSON.parse(existing) : [];
    localStorage.setItem('kanban-demo-tasks', JSON.stringify([...existingTasks, ...(data || [])]));
  } catch (e) {
    console.warn('[DEMO_DATA] Could not update localStorage cache:', e);
  }
  
  return (data as Task[]) || [];
}

/**
 * Load existing tasks for AI parsing context.
 * Uses Supabase as primary source with localStorage fallback.
 * 
 * @param userId - User ID to load tasks for
 * @returns Promise<Task[]> - Existing tasks for context
 */
export async function loadExistingTasksForContext(userId: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('user_id', userId);

  if (error) {
    console.warn('[DEMO_DATA] Failed to load tasks from Supabase, trying localStorage:', error);
    const localTasks = localStorage.getItem('kanban-demo-tasks');
    if (localTasks) {
      try {
        return JSON.parse(localTasks);
      } catch {
        return [];
      }
    }
    return [];
  }

  return (data as Task[]) || [];
}

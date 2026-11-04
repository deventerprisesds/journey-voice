import type { TaskCategory } from '../../supabase/functions/_shared/categories.ts';

// The category list lives in the shared module (screens + edge functions read the same one).
// Re-exported so screens can `import type { TaskCategory } from '@/types/task'`.
export type { TaskCategory };

export interface ChecklistItem {
  id: string;
  task_id: string;
  title: string;
  is_completed: boolean;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: 'BLOCKED' | 'LIFE' | 'CAREER' | 'PROF_EDUCATION' | 'VENTURES' | 'PLANNING' | 'READY' | 'UP_NEXT' | 'DOING' | 'IN_REVIEW' | 'DONE' | 'BACKLOG' | 'TODO';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  category: TaskCategory;
  due_date?: string;
  start_time?: string;
  end_time?: string;
  estimate_minutes?: number;
  blocked_by?: string[];
  board_id: string;
  user_id: string;
  completed_at?: string;
  created_at: string;
  updated_at: string;
  external_event_id?: string;
  is_scheduled?: boolean;
  reminder_minutes?: number;
  checklist_items?: ChecklistItem[];
  scheduling_context?: any;
  assignment_url?: string;
  assignment_id?: string;
  pushed_count?: number;
  is_priority?: boolean;
  priority_rank?: number | null;
}

export interface CalendarConnection {
  id: string;
  user_id: string;
  provider: 'google' | 'outlook' | 'office365';
  provider_account_id: string;
  provider_account_email: string;
  access_token: string;
  refresh_token?: string;
  expires_at?: string;
  scope?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ExternalCalendarEvent {
  id: string;
  user_id: string;
  connection_id: string;
  external_event_id: string;
  title: string;
  description?: string;
  start_time: string;
  end_time: string;
  is_all_day: boolean;
  location?: string;
  calendar_id: string;
  last_synced_at: string;
  created_at: string;
  updated_at: string;
  calendar_connections?: {
    provider: string;
    provider_account_email?: string;
  };
}

export interface Board {
  id: string;
  name: string;
  description?: string;
  color: string;
  user_id: string;
  position: number;
  is_default: boolean;
}

export interface Column {
  id: string;
  name: string;
  board_id: string;
  position: number;
  status: 'BLOCKED' | 'LIFE' | 'CAREER' | 'PROF_EDUCATION' | 'VENTURES' | 'PLANNING' | 'READY' | 'UP_NEXT' | 'DOING' | 'IN_REVIEW' | 'DONE' | 'BACKLOG' | 'TODO';
}
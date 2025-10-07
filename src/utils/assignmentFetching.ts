import { supabase } from '@/integrations/supabase/client';
import { Task } from '@/types/task';

export async function fetchPendingAssignments(
  userId: string,
  includeEmba: boolean = true,
  includeMit: boolean = true
): Promise<Task[]> {
  const assignments: Task[] = [];

  try {
    // Fetch EMBA assignments (through next class)
    if (includeEmba) {
      // Get next class date
      const { data: nextClass } = await supabase
        .from('class_schedules')
        .select('date')
        .eq('user_id', userId)
        .gte('date', new Date().toISOString())
        .order('date', { ascending: true })
        .limit(1)
        .single();

      if (nextClass) {
        const { data: embaAssignments } = await supabase
          .from('assignments')
          .select('*')
          .eq('user_id', userId)
          .lte('due_date', nextClass.date)
          .in('status', ['active', 'pending'])
          .order('due_date', { ascending: true });

        if (embaAssignments) {
          assignments.push(
            ...embaAssignments.map((assignment) => ({
              id: assignment.id,
              title: assignment.title,
              description: assignment.description || '',
              status: 'PROF_EDUCATION' as const,
              category: 'EDUCATION' as const,
              priority: assignment.priority as 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT',
              due_date: assignment.due_date,
              estimate_minutes: 90,
              user_id: assignment.user_id,
              board_id: '', // Will be set by scheduler
              created_at: assignment.created_at,
              updated_at: assignment.updated_at,
              is_scheduled: false,
              position: 0
            }))
          );
        }
      }
    }

    // Fetch MIT assignments (next 2 weeks)
    if (includeMit) {
      const twoWeeksFromNow = new Date();
      twoWeeksFromNow.setDate(twoWeeksFromNow.getDate() + 14);

      const { data: mitAssignments } = await supabase
        .from('assignments_mit')
        .select('*')
        .eq('user_id', userId)
        .lte('due_date', twoWeeksFromNow.toISOString())
        .in('status', ['active', 'pending'])
        .order('due_date', { ascending: true });

      if (mitAssignments) {
        assignments.push(
          ...mitAssignments.map((assignment) => ({
            id: assignment.id,
            title: assignment.title,
            description: assignment.description || '',
            status: 'PROF_EDUCATION' as const,
            category: 'EDUCATION' as const,
            priority: assignment.priority as 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT',
            due_date: assignment.due_date,
            estimate_minutes: 90,
            user_id: assignment.user_id,
            board_id: '', // Will be set by scheduler
            created_at: assignment.created_at,
            updated_at: assignment.updated_at,
            is_scheduled: false,
            position: 0
          }))
        );
      }
    }
  } catch (error) {
    console.error('Error fetching pending assignments:', error);
  }

  return assignments;
}

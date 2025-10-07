import { supabase } from '@/integrations/supabase/client';
import { Task } from '@/types/task';

export async function fetchPendingAssignments(
  userId: string,
  includeEmba: boolean = true,
  includeMit: boolean = true
): Promise<Task[]> {
  const assignments: Task[] = [];

  try {
    // Fetch EMBA assignments (between last weekend end and next weekend end)
    if (includeEmba) {
      // Get last completed weekend's end time
      const { data: lastWeekend } = await supabase
        .from('class_schedules')
        .select('end_time')
        .eq('user_id', userId)
        .lt('date', new Date().toISOString())
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle();

      // Get next weekend's class dates
      const { data: nextWeekendDates } = await supabase
        .from('class_schedules')
        .select('date, end_time')
        .eq('user_id', userId)
        .gte('date', new Date().toISOString())
        .order('date', { ascending: true })
        .limit(5);

      if (nextWeekendDates && nextWeekendDates.length > 0) {
        // Group dates within 3 days as same weekend, take the last date's end time
        const weekendGroups: Array<typeof nextWeekendDates> = [];
        let currentGroup: typeof nextWeekendDates = [];
        
        nextWeekendDates.forEach((curr, idx) => {
          if (idx === 0 || Math.abs(new Date(curr.date).getTime() - new Date(nextWeekendDates[idx-1].date).getTime()) <= 3 * 24 * 60 * 60 * 1000) {
            currentGroup.push(curr);
          } else {
            weekendGroups.push(currentGroup);
            currentGroup = [curr];
          }
        });
        if (currentGroup.length > 0) weekendGroups.push(currentGroup);
        
        const nextWeekendEnd = weekendGroups[0]
          .sort((a, b) => new Date(b.end_time).getTime() - new Date(a.end_time).getTime())[0];

        const { data: embaAssignments } = await supabase
          .from('assignments')
          .select('*')
          .eq('user_id', userId)
          .gte('due_date', lastWeekend?.end_time || new Date().toISOString())
          .lte('due_date', nextWeekendEnd.end_time)
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

    // Fetch MIT assignments (next 2 weeks, exclude office hours)
    if (includeMit) {
      const twoWeeksFromNow = new Date();
      twoWeeksFromNow.setDate(twoWeeksFromNow.getDate() + 14);

      const { data: mitAssignments } = await supabase
        .from('assignments_mit')
        .select('*')
        .eq('user_id', userId)
        .lte('due_date', twoWeeksFromNow.toISOString())
        .in('status', ['active', 'pending'])
        .not('title', 'ilike', '%office hour%')
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

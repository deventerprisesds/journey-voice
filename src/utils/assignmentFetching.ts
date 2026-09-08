import { supabase } from '@/integrations/supabase/client';
import { Task } from '@/types/task';
import { MIT_PROGRAM_ID } from '@/utils/programIds';
import { fetchNexusAssignmentsSafe, inProgram, notInProgram, dueBetween, titleNotLike } from '@/utils/nexusAssignments';

/** Mirrors the old `.order('due_date', { ascending: true })` — undated rows sort last. */
const byDueDateAsc = (a: { due_date?: string | null }, b: { due_date?: string | null }) => {
  if (!a.due_date) return 1;
  if (!b.due_date) return -1;
  return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
};

// Demo user IDs that share class schedules
const DEMO_EMBA_USER_IDS = [
  '00000000-0000-0000-0000-000000000001', // Demo user
  'a3378f93-d655-4913-b2fa-ca5b1d8020f1'  // dev@enterpriseds.io
];

export async function fetchPendingAssignments(
  userId: string,
  includeEmba: boolean = true,
  includeMit: boolean = true,
  importMode: 'upcoming' | 'full' = 'upcoming'
): Promise<Task[]> {
  const assignments: Task[] = [];

  try {
    // Fetch EMBA assignments (program_id IS NULL or != MIT_PROGRAM_ID)
    if (includeEmba) {
      if (importMode === 'full') {
        // Full import: get all EMBA assignments, no date filtering
        // NEXUS (Azure) is the source of truth; Supabase `assignments` is a dead
        // 2026-04-06 snapshot. Owner-scoped fetch then filter in memory — see
        // nexusAssignments.ts for why fetch-all-then-filter rather than server-side
        // predicates (the d1 filter grammar has no IN, and callers need id/title/range).
        const isDemo = DEMO_EMBA_USER_IDS.includes(userId);
        const embaOwners = isDemo ? DEMO_EMBA_USER_IDS : [userId];
        const embaAssignments = (
          await Promise.all(embaOwners.map((o) => fetchNexusAssignmentsSafe(o)))
        ).flat()
          .filter((a) => notInProgram(a, MIT_PROGRAM_ID))
          .sort(byDueDateAsc);

        if (embaAssignments) {
          assignments.push(
            ...embaAssignments.map((assignment) => ({
              id: assignment.id,
              title: assignment.title,
              description: assignment.description || '',
              status: 'PROF_EDUCATION' as const,
              category: 'PROF_EDUCATION' as const,
              priority: assignment.priority as 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT',
              due_date: assignment.due_date,
              estimate_minutes: 90,
              user_id: assignment.user_id,
              board_id: '',
              created_at: assignment.created_at,
              updated_at: assignment.updated_at,
              is_scheduled: false,
              position: 0,
              assignment_url: assignment.assignment_url || undefined,
            }))
          );
        }
      } else {
      // Upcoming mode: between last weekend end and next weekend end
      const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
      const isDemo = DEMO_EMBA_USER_IDS.includes(userId);

      // Get last completed weekend's end time
      let lastWeekendQuery = supabase
        .from('class_schedules')
        .select('end_time')
        .lt('date', todayStr);

      lastWeekendQuery = isDemo
        ? lastWeekendQuery.in('user_id', DEMO_EMBA_USER_IDS)
        : lastWeekendQuery.eq('user_id', userId);

      const { data: lastWeekend } = await lastWeekendQuery
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle();

      // Get next weekend's class dates
      let nextWeekendQuery = supabase
        .from('class_schedules')
        .select('date, end_time')
        .gte('date', todayStr);

      nextWeekendQuery = isDemo
        ? nextWeekendQuery.in('user_id', DEMO_EMBA_USER_IDS)
        : nextWeekendQuery.eq('user_id', userId);

      const { data: nextWeekendDates } = await nextWeekendQuery
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

        const embaOwners2 = isDemo ? DEMO_EMBA_USER_IDS : [userId];
        const fromISO = lastWeekend?.end_time || new Date().toISOString();
        const embaAssignments = (
          await Promise.all(embaOwners2.map((o) => fetchNexusAssignmentsSafe(o)))
        ).flat()
          .filter((a) => notInProgram(a, MIT_PROGRAM_ID))
          .filter((a) => dueBetween(a, fromISO, nextWeekendEnd.end_time))
          .sort(byDueDateAsc);

        if (embaAssignments) {
          assignments.push(
            ...embaAssignments.map((assignment) => ({
              id: assignment.id,
              title: assignment.title,
              description: assignment.description || '',
              status: 'PROF_EDUCATION' as const,
              category: 'PROF_EDUCATION' as const,
              priority: assignment.priority as 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT',
              due_date: assignment.due_date,
              estimate_minutes: 90,
              user_id: assignment.user_id,
              board_id: '', // Will be set by scheduler
              created_at: assignment.created_at,
              updated_at: assignment.updated_at,
              is_scheduled: false,
              position: 0,
              assignment_url: assignment.assignment_url || undefined,
            }))
          );
        }
      }
      }
    }

    // Fetch MIT assignments (program_id = MIT_PROGRAM_ID, exclude office hours)
    if (includeMit) {
      let mitAssignments = (await fetchNexusAssignmentsSafe(userId))
        .filter((a) => inProgram(a, MIT_PROGRAM_ID))
        .filter((a) => titleNotLike(a, 'office hour'))
        .sort(byDueDateAsc);

      if (importMode === 'upcoming') {
        const twoWeeksFromNow = new Date();
        twoWeeksFromNow.setDate(twoWeeksFromNow.getDate() + 14);
        mitAssignments = mitAssignments.filter((a) => dueBetween(a, null, twoWeeksFromNow.toISOString()));
      }

      if (mitAssignments) {
        assignments.push(
          ...mitAssignments.map((assignment) => ({
            id: assignment.id,
            title: assignment.title,
            description: assignment.description || '',
            status: 'PROF_EDUCATION' as const,
            category: 'PROF_EDUCATION' as const,
            priority: assignment.priority as 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT',
            due_date: assignment.due_date,
            estimate_minutes: 90,
            user_id: assignment.user_id,
            board_id: '', // Will be set by scheduler
            created_at: assignment.created_at,
            updated_at: assignment.updated_at,
            is_scheduled: false,
            position: 0,
            assignment_url: assignment.assignment_url || undefined,
          }))
        );
      }
    }
  } catch (error) {
    console.error('Error fetching pending assignments:', error);
  }

  return assignments;
}

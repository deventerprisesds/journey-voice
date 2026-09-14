import { supabase } from "@/integrations/supabase/client";
import { scheduleNewTask } from "@/utils/taskScheduling";
import { MIT_PROGRAM_ID } from "@/utils/programIds";
import { fetchNexusAssignmentsSafe, byIds, inProgram } from '@/utils/nexusAssignments';

// Helper to map assignment priority to task priority enum
function mapPriority(priority: string | null | undefined): 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' {
  if (!priority) return 'MEDIUM';
  const upper = priority.toUpperCase();
  if (upper === 'LOW' || upper === 'MEDIUM' || upper === 'HIGH' || upper === 'URGENT') {
    return upper as 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  }
  return 'MEDIUM';
}

/**
 * Converts EMBA assignments into scheduled tasks.
 * Always populates tasks.assignment_id for direct relational linkage.
 */
export async function createTasksFromAssignments(
  assignmentIds: string[], 
  userId: string,
  importMode: 'upcoming' | 'full' = 'upcoming'
): Promise<void> {
  try {
    // NEXUS (Azure) is the source of truth — Supabase `assignments` is a dead
    // 2026-04-06 snapshot. d1's filter grammar has no IN, so fetch the owner's rows
    // and select the requested ids in memory (see nexusAssignments.ts).
    const assignments = byIds(await fetchNexusAssignmentsSafe(userId), assignmentIds);

    if (!assignments || assignments.length === 0) {
      console.log('No assignments to convert');
      return;
    }

    const { data: defaultBoard } = await supabase
      .from('boards')
      .select('id')
      .eq('user_id', userId)
      .eq('is_default', true)
      .single();

    if (!defaultBoard) {
      console.error('No default board found for user');
      return;
    }

    for (const assignment of assignments) {
      // Check if task already exists by assignment_id (primary dedup)
      const { data: existingByLink } = await supabase
        .from('tasks')
        .select('id')
        .eq('user_id', userId)
        .eq('assignment_id', assignment.id)
        .maybeSingle();

      if (existingByLink) {
        console.log(`Task already exists for assignment ${assignment.id} (by assignment_id), skipping`);
        continue;
      }

      const now = new Date();
      const dueDate = assignment.due_date ? new Date(assignment.due_date) : null;
      let taskStatus: string;
      if (importMode === 'full') {
        taskStatus = (dueDate && dueDate < now) ? 'READY' : 'UP_NEXT';
      } else {
        taskStatus = 'UP_NEXT';
      }

      const taskData: any = {
        title: assignment.title,
        description: assignment.description || '',
        category: 'EDUCATION' as const,
        priority: mapPriority(assignment.priority),
        due_date: assignment.due_date,
        board_id: defaultBoard.id,
        user_id: userId,
        status: taskStatus,
        assignment_id: assignment.id,
        assignment_url: assignment.assignment_url || null,
        scheduling_context: {
          source: 'EMBA',
          course_id: assignment.course_id || null,
          sheet_row: assignment.sheet_row_number || null,
          points: assignment.points || null,
        }
      };

      const { data: insertedTasks, error: insertError } = await supabase
        .from('tasks')
        .insert([taskData])
        .select();
      
      const insertedTask = insertedTasks?.[0];

      if (insertError) {
        console.error(`Failed to create task for assignment ${assignment.id}:`, insertError);
        throw new Error(`Failed to create task for assignment ${assignment.title}: ${insertError.message}`);
      }

      if (!insertedTask) {
        throw new Error(`No task was created for assignment ${assignment.title}`);
      }

      try {
        let targetScheduleDate = new Date();
        if (assignment.due_date) {
          const dueDate = new Date(assignment.due_date);
          const oneWeekBefore = new Date(dueDate.getTime() - 7 * 24 * 60 * 60 * 1000);
          targetScheduleDate = oneWeekBefore < new Date() ? new Date() : oneWeekBefore;
        }

        const taskToSchedule = {
          ...insertedTask,
          board_id: insertedTask.board_id!,
          user_id: insertedTask.user_id!,
          scheduling_context: undefined as any,
          id: insertedTask.id
        };
        
        await scheduleNewTask(taskToSchedule, []);
        console.log(`Task created and scheduled for EMBA assignment: ${assignment.title}`);
      } catch (scheduleError) {
        console.error(`Failed to schedule task for assignment ${assignment.id}:`, scheduleError);
      }
    }

  } catch (error) {
    console.error('Error creating tasks from assignments:', error);
    throw error;
  }
}

/**
 * Converts MIT assignments into scheduled tasks.
 * Always populates tasks.assignment_id for direct relational linkage.
 */
export async function createTasksFromMitAssignments(
  assignmentIds: string[], 
  userId: string,
  importMode: 'upcoming' | 'full' = 'upcoming'
): Promise<void> {
  try {
    const assignments = byIds(await fetchNexusAssignmentsSafe(userId), assignmentIds)
      .filter((a) => inProgram(a, MIT_PROGRAM_ID));

    if (!assignments || assignments.length === 0) {
      console.log('No MIT assignments to convert');
      return;
    }

    const { data: defaultBoard } = await supabase
      .from('boards')
      .select('id')
      .eq('user_id', userId)
      .eq('is_default', true)
      .single();

    if (!defaultBoard) {
      console.error('No default board found for user');
      return;
    }

    for (const assignment of assignments) {
      // Check if task already exists by assignment_id (primary dedup)
      const { data: existingByLink } = await supabase
        .from('tasks')
        .select('id')
        .eq('user_id', userId)
        .eq('assignment_id', assignment.id)
        .maybeSingle();

      if (existingByLink) {
        console.log(`Task already exists for MIT assignment ${assignment.id} (by assignment_id), skipping`);
        continue;
      }

      const now = new Date();
      const dueDate = assignment.due_date ? new Date(assignment.due_date) : null;
      let taskStatus: string;
      if (importMode === 'full') {
        taskStatus = (dueDate && dueDate < now) ? 'READY' : 'UP_NEXT';
      } else {
        taskStatus = 'UP_NEXT';
      }

      const taskData: any = {
        title: assignment.title,
        description: assignment.description || '',
        category: 'EDUCATION' as const,
        priority: mapPriority(assignment.priority),
        due_date: assignment.due_date,
        board_id: defaultBoard.id,
        user_id: userId,
        status: taskStatus,
        assignment_id: assignment.id,
        assignment_url: assignment.assignment_url || null,
        scheduling_context: {
          source: 'MIT',
          course_id: assignment.course_id || null,
          sheet_row: assignment.sheet_row_number || null,
          points: assignment.points || null,
        }
      };

      const { data: insertedTasks, error: insertError } = await supabase
        .from('tasks')
        .insert([taskData])
        .select();
      
      const insertedTask = insertedTasks?.[0];

      if (insertError) {
        console.error(`Failed to create task for MIT assignment ${assignment.id}:`, insertError);
        throw new Error(`Failed to create task for MIT assignment ${assignment.title}: ${insertError.message}`);
      }

      if (!insertedTask) {
        throw new Error(`No task was created for MIT assignment ${assignment.title}`);
      }

      try {
        let targetScheduleDate = new Date();
        if (assignment.due_date) {
          const dueDate = new Date(assignment.due_date);
          const oneWeekBefore = new Date(dueDate.getTime() - 7 * 24 * 60 * 60 * 1000);
          targetScheduleDate = oneWeekBefore < new Date() ? new Date() : oneWeekBefore;
        }

        const taskToSchedule = {
          ...insertedTask,
          board_id: insertedTask.board_id!,
          user_id: insertedTask.user_id!,
          scheduling_context: undefined as any,
          id: insertedTask.id
        };
        
        await scheduleNewTask(taskToSchedule, []);
        console.log(`Task created and scheduled for MIT assignment: ${assignment.title}`);
      } catch (scheduleError) {
        console.error(`Failed to schedule task for MIT assignment ${assignment.id}:`, scheduleError);
      }
    }

  } catch (error) {
    console.error('Error creating tasks from MIT assignments:', error);
    throw error;
  }
}

/**
 * Repair existing tasks that have null assignment_id but were created from assignments.
 * Recovers linkage from scheduling_context metadata.
 */
export async function repairAssignmentLinkage(userId: string): Promise<{ repaired: number; errors: number }> {
  let repaired = 0;
  let errors = 0;

  // Find tasks with null assignment_id that have assignment metadata in scheduling_context
  const { data: orphanTasks, error } = await supabase
    .from('tasks')
    .select('id, title, due_date, scheduling_context')
    .eq('user_id', userId)
    .in('category', ['EDUCATION', 'PROF_EDUCATION'])
    .is('assignment_id', null);

  if (error || !orphanTasks) {
    console.error('Error fetching orphan tasks:', error);
    return { repaired: 0, errors: 1 };
  }

  for (const task of orphanTasks) {
    const ctx = task.scheduling_context;
    let assignmentId: string | null = null;
    let source: string | null = null;

    // Try to extract assignment_id from array-style scheduling_context
    if (Array.isArray(ctx)) {
      for (const entry of ctx) {
        if (typeof entry === 'string') {
          if (entry.startsWith('assignment_id:')) {
            assignmentId = entry.split(':')[1];
            source = 'EMBA';
          } else if (entry.startsWith('mit_assignment_id:')) {
            assignmentId = entry.split(':')[1];
            source = 'MIT';
          }
        }
      }
    }
    // Try object-style scheduling_context
    else if (ctx && typeof ctx === 'object') {
      if (ctx.source === 'EMBA' || ctx.source === 'imported_assignment') {
        source = 'EMBA';
      } else if (ctx.source === 'MIT' || ctx.source === 'imported_mit_assignment') {
        source = 'MIT';
      }
    }

    if (!assignmentId) {
      // Fallback: try title + due_date match against assignments tables
      const cleanTitle = task.title?.replace(/^📚\s*/, '') || '';
      
      if (cleanTitle) {
        // One Nexus fetch serves both the EMBA and the MIT title lookup.
        const owned = await fetchNexusAssignmentsSafe(userId);
        const embaMatch = owned.find((a) => a.title === cleanTitle);

        if (embaMatch) {
          assignmentId = embaMatch.id;
          source = 'EMBA';
        } else {
          const mitMatch = owned.find(
            (a) => a.title === cleanTitle && inProgram(a, MIT_PROGRAM_ID),
          );

          if (mitMatch) {
            assignmentId = mitMatch.id;
            source = 'MIT';
          }
        }
      }
    }

    if (assignmentId && source) {
      const { error: updateError } = await supabase
        .from('tasks')
        .update({
          assignment_id: assignmentId,
          scheduling_context: {
            source,
            ...(typeof ctx === 'object' && !Array.isArray(ctx) ? ctx : {}),
            repaired_at: new Date().toISOString(),
          },
        })
        .eq('id', task.id);

      if (updateError) {
        console.error(`Failed to repair task ${task.id}:`, updateError);
        errors++;
      } else {
        repaired++;
        console.log(`Repaired task "${task.title}" → assignment_id=${assignmentId} (${source})`);
      }
    }
  }

  // Also repair tasks that were falsely auto-completed by nightly sync
  const { data: falseCompleted } = await supabase
    .from('tasks')
    .select('id, title, scheduling_context')
    .eq('user_id', userId)
    .in('category', ['EDUCATION', 'PROF_EDUCATION'])
    .eq('status', 'DONE')
    .not('assignment_id', 'is', null);

  if (falseCompleted) {
    for (const task of falseCompleted) {
      const ctx = task.scheduling_context;
      const archivedReason = typeof ctx === 'object' && !Array.isArray(ctx) 
        ? ctx?.archived_reason 
        : null;

      // Only revert if it was auto-archived, not user-completed
      if (archivedReason === 'overdue_assignment' || archivedReason === 'stale_education' || archivedReason === 'legacy_stale_assignment') {
        const { error: revertError } = await supabase
          .from('tasks')
          .update({
            status: 'TODO',
            completed_at: null,
            scheduling_context: {
              ...(typeof ctx === 'object' && !Array.isArray(ctx) ? ctx : {}),
              archived_reason: null,
              repair_reverted_at: new Date().toISOString(),
            },
          })
          .eq('id', task.id);

        if (!revertError) {
          repaired++;
          console.log(`Reverted false completion: "${task.title}"`);
        } else {
          errors++;
        }
      }
    }
  }

  return { repaired, errors };
}

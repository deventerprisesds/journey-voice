import { supabase } from "@/integrations/supabase/client";
import { scheduleNewTask } from "@/utils/taskScheduling";

// Helper to map assignment priority to task priority enum
function mapPriority(priority: string | null | undefined): 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' {
  if (!priority) return 'MEDIUM';
  const upper = priority.toUpperCase();
  if (upper === 'LOW' || upper === 'MEDIUM' || upper === 'HIGH' || upper === 'URGENT') {
    return upper as 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  }
  return 'MEDIUM';
}

// Helper to map category to appropriate board lane status
function statusForCategory(category: string): 'BACKLOG' | 'TODO' | 'LIFE' | 'CAREER' | 'PROF_EDUCATION' | 'VENTURES' {
  if (category === 'EDUCATION') return 'PROF_EDUCATION';
  if (category === 'CAREER') return 'CAREER';
  if (category === 'VENTURES') return 'VENTURES';
  if (category === 'LIFE') return 'LIFE';
  return 'BACKLOG';
}

/**
 * Converts assignments from Google Sheets sync into scheduled tasks
 * Prevents duplicates by checking if tasks already exist for each assignment
 */
export async function createTasksFromAssignments(
  assignmentIds: string[], 
  userId: string
): Promise<void> {
  try {
    // Fetch all the assignments
    const { data: assignments, error: fetchError } = await supabase
      .from('assignments')
      .select('*')
      .in('id', assignmentIds);

    if (fetchError) {
      console.error('Error fetching assignments:', fetchError);
      return;
    }

    if (!assignments || assignments.length === 0) {
      console.log('No assignments to convert');
      return;
    }

    // Get user's default board
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
      // Check if task already exists for this assignment (multi-strategy)
      const { data: existingTasks } = await supabase
        .from('tasks')
        .select('id, scheduling_context, title, due_date')
        .eq('user_id', userId)
        .eq('board_id', defaultBoard.id);

      // Check if assignment is already converted
      const existingTask = existingTasks?.find(task => {
        // Strategy 1: Check scheduling_context array for assignment_id
        const contextArray = Array.isArray(task.scheduling_context) ? task.scheduling_context : [];
        const hasAssignmentId = contextArray.some((ctx: any) => 
          typeof ctx === 'string' && ctx.includes(`assignment_id:${assignment.id}`)
        );
        
        // Strategy 2: Exact title + due_date match with imported flag (fallback)
        const titleDueDateMatch = 
          task.title === assignment.title && 
          task.due_date === assignment.due_date &&
          contextArray.some((ctx: any) => typeof ctx === 'string' && ctx.includes('source:imported_assignment'));
        
        return hasAssignmentId || titleDueDateMatch;
      });

      if (existingTask) {
        console.log(`Task already exists for assignment ${assignment.id}, skipping`);
        continue;
      }

      // Create new task from assignment with proper enums
      const taskData: any = {
        title: assignment.title,
        description: assignment.description || '',
        category: 'EDUCATION' as const,
        priority: mapPriority(assignment.priority),
        due_date: assignment.due_date,
        board_id: defaultBoard.id,
        user_id: userId,
        status: statusForCategory('EDUCATION'),
        scheduling_context: [
          'source:imported_assignment',
          `assignment_id:${assignment.id}`,
          ...(assignment.course_id ? [`course_id:${assignment.course_id}`] : []),
          ...(assignment.sheet_row_number ? [`sheet_row:${assignment.sheet_row_number}`] : []),
          ...(assignment.points ? [`points:${assignment.points}`] : [])
        ]
      };

      // First insert the task
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

      // Then schedule it using the smart calendar scheduler
      try {
        // Calculate target schedule date: 1 week before due date (or ASAP if due date is close)
        let targetScheduleDate = new Date();
        if (assignment.due_date) {
          const dueDate = new Date(assignment.due_date);
          const oneWeekBefore = new Date(dueDate.getTime() - 7 * 24 * 60 * 60 * 1000);
          
          // If due date is less than 7 days away, schedule ASAP
          // Otherwise schedule 7 days before
          targetScheduleDate = oneWeekBefore < new Date() 
            ? new Date() 
            : oneWeekBefore;
        }

        const taskToSchedule = {
          ...insertedTask,
          board_id: insertedTask.board_id!,
          user_id: insertedTask.user_id!,
          scheduling_context: [
            ...taskData.scheduling_context,
            `target_schedule_date:${targetScheduleDate.toISOString()}`,
            `buffer_days:7`,
            `is_assignment:true`,
            `assignment_due:${assignment.due_date}`
          ],
          id: insertedTask.id
        };
        
        await scheduleNewTask(taskToSchedule, []);
        console.log(`Task created and scheduled for assignment: ${assignment.title}`);
      } catch (scheduleError) {
        console.error(`Failed to schedule task for assignment ${assignment.id}:`, scheduleError);
        // Task is created but not scheduled - user can schedule manually
      }
    }

  } catch (error) {
    console.error('Error creating tasks from assignments:', error);
    throw error;
  }
}

/**
 * Converts MIT assignments from Google Sheets sync into scheduled tasks
 * Prevents duplicates by checking if tasks already exist for each MIT assignment
 */
export async function createTasksFromMitAssignments(
  assignmentIds: string[], 
  userId: string
): Promise<void> {
  try {
    // Fetch all the MIT assignments
    const { data: assignments, error: fetchError } = await supabase
      .from('assignments_mit')
      .select('*')
      .in('id', assignmentIds);

    if (fetchError) {
      console.error('Error fetching MIT assignments:', fetchError);
      return;
    }

    if (!assignments || assignments.length === 0) {
      console.log('No MIT assignments to convert');
      return;
    }

    // Get user's default board
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
      // Check if task already exists for this MIT assignment (multi-strategy)
      const { data: existingTasks } = await supabase
        .from('tasks')
        .select('id, scheduling_context, title, due_date')
        .eq('user_id', userId)
        .eq('board_id', defaultBoard.id);

      // Check if assignment is already converted
      const existingTask = existingTasks?.find(task => {
        // Strategy 1: Check scheduling_context array for mit_assignment_id
        const contextArray = Array.isArray(task.scheduling_context) ? task.scheduling_context : [];
        const hasAssignmentId = contextArray.some((ctx: any) => 
          typeof ctx === 'string' && ctx.includes(`mit_assignment_id:${assignment.id}`)
        );
        
        // Strategy 2: Exact title + due_date match with imported flag (fallback)
        const titleDueDateMatch = 
          task.title === assignment.title && 
          task.due_date === assignment.due_date &&
          contextArray.some((ctx: any) => typeof ctx === 'string' && ctx.includes('source:imported_assignment'));
        
        return hasAssignmentId || titleDueDateMatch;
      });

      if (existingTask) {
        console.log(`Task already exists for MIT assignment ${assignment.id}, skipping`);
        continue;
      }

      // Create new task from MIT assignment with proper enums
      const taskData: any = {
        title: assignment.title,
        description: assignment.description || '',
        category: 'EDUCATION' as const,
        priority: mapPriority(assignment.priority),
        due_date: assignment.due_date,
        board_id: defaultBoard.id,
        user_id: userId,
        status: statusForCategory('EDUCATION'),
        scheduling_context: [
          'source:imported_mit_assignment',
          `mit_assignment_id:${assignment.id}`,
          ...(assignment.course_id ? [`course_id:${assignment.course_id}`] : []),
          ...(assignment.sheet_row_number ? [`sheet_row:${assignment.sheet_row_number}`] : []),
          ...(assignment.points ? [`points:${assignment.points}`] : [])
        ]
      };

      // First insert the task
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

      // Then schedule it using the smart calendar scheduler
      try {
        // Calculate target schedule date: 1 week before due date (or ASAP if due date is close)
        let targetScheduleDate = new Date();
        if (assignment.due_date) {
          const dueDate = new Date(assignment.due_date);
          const oneWeekBefore = new Date(dueDate.getTime() - 7 * 24 * 60 * 60 * 1000);
          
          // If due date is less than 7 days away, schedule ASAP
          // Otherwise schedule 7 days before
          targetScheduleDate = oneWeekBefore < new Date() 
            ? new Date() 
            : oneWeekBefore;
        }

        const taskToSchedule = {
          ...insertedTask,
          board_id: insertedTask.board_id!,
          user_id: insertedTask.user_id!,
          scheduling_context: [
            ...taskData.scheduling_context,
            `target_schedule_date:${targetScheduleDate.toISOString()}`,
            `buffer_days:7`,
            `is_assignment:true`,
            `assignment_due:${assignment.due_date}`
          ],
          id: insertedTask.id
        };
        
        await scheduleNewTask(taskToSchedule, []);
        console.log(`Task created and scheduled for MIT assignment: ${assignment.title}`);
      } catch (scheduleError) {
        console.error(`Failed to schedule task for MIT assignment ${assignment.id}:`, scheduleError);
        // Task is created but not scheduled - user can schedule manually
      }
    }

  } catch (error) {
    console.error('Error creating tasks from MIT assignments:', error);
    throw error;
  }
}

import { supabase } from "@/integrations/supabase/client";
import { scheduleNewTask } from "@/utils/taskScheduling";

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
      // Check if task already exists for this assignment
      const { data: existingTask } = await supabase
        .from('tasks')
        .select('id')
        .eq('user_id', userId)
        .filter('scheduling_context', 'cs', `{"assignment_id":"${assignment.id}"}`)
        .maybeSingle();

      if (existingTask) {
        console.log(`Task already exists for assignment ${assignment.id}, skipping`);
        continue;
      }

      // Create new task from assignment
      const taskData: any = {
        title: assignment.title,
        description: assignment.description || '',
        category: 'EDUCATION' as const,
        priority: (assignment.priority || 'MEDIUM') as any,
        due_date: assignment.due_date,
        board_id: defaultBoard.id,
        user_id: userId,
        status: 'TODO' as any,
        scheduling_context: [
          `source:imported_assignment`,
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
        continue;
      }

      // Then schedule it using the smart calendar scheduler
      try {
        const taskToSchedule = {
          ...insertedTask,
          board_id: insertedTask.board_id!,
          user_id: insertedTask.user_id!,
          scheduling_context: taskData.scheduling_context,
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
      // Check if task already exists for this MIT assignment
      const { data: existingTask } = await supabase
        .from('tasks')
        .select('id')
        .eq('user_id', userId)
        .filter('scheduling_context', 'cs', `{"mit_assignment_id":"${assignment.id}"}`)
        .maybeSingle();

      if (existingTask) {
        console.log(`Task already exists for MIT assignment ${assignment.id}, skipping`);
        continue;
      }

      // Create new task from MIT assignment
      const taskData: any = {
        title: assignment.title,
        description: assignment.description || '',
        category: 'EDUCATION' as const,
        priority: (assignment.priority || 'MEDIUM') as any,
        due_date: assignment.due_date,
        board_id: defaultBoard.id,
        user_id: userId,
        status: 'TODO' as any,
        scheduling_context: [
          `source:imported_mit_assignment`,
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
        continue;
      }

      // Then schedule it using the smart calendar scheduler
      try {
        const taskToSchedule = {
          ...insertedTask,
          board_id: insertedTask.board_id!,
          user_id: insertedTask.user_id!,
          scheduling_context: taskData.scheduling_context,
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

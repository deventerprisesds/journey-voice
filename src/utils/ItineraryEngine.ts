import { supabase } from '@/integrations/supabase/client';
import { Task } from '@/types/task';

interface ScheduledTask {
  task: Task;
  scheduledStart: Date;
  scheduledEnd: Date;
  canStart: boolean;
  blockedByTasks: string[];
}

interface ItinerarySchedule {
  date: string;
  tasks: ScheduledTask[];
  totalMinutes: number;
  availableMinutes: number;
}

export class ItineraryEngine {
  private priorityWeights = {
    URGENT: 4,
    HIGH: 3,
    MEDIUM: 2,
    LOW: 1
  };

  private workingHours = {
    start: 9, // 9 AM
    end: 17,  // 5 PM
    breakMinutes: 60 // 1 hour break
  };

  /**
   * Generate a smart schedule for tasks based on priorities, dependencies, and due dates
   */
  async generateSchedule(
    startDate: Date, 
    endDate: Date, 
    tasks: Task[], 
    dailyWorkingMinutes: number = 420 // 7 hours default
  ): Promise<ItinerarySchedule[]> {
    // Filter out completed tasks and sort by priority/due date
    const pendingTasks = tasks.filter(task => task.status !== 'DONE');
    const sortedTasks = this.sortTasksByPriority(pendingTasks);
    
    const schedule: ItinerarySchedule[] = [];
    const scheduledTaskIds = new Set<string>();
    
    // Create schedule for each day
    let currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      const daySchedule = this.scheduleDayTasks(
        currentDate,
        sortedTasks,
        scheduledTaskIds,
        dailyWorkingMinutes
      );
      
      schedule.push(daySchedule);
      
      // Move to next day
      currentDate = new Date(currentDate);
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    return schedule;
  }

  /**
   * Generate a quick daily schedule for today/tomorrow
   */
  async generateDailySchedule(tasks: Task[], targetDate?: Date): Promise<ScheduledTask[]> {
    const date = targetDate || new Date();
    const pendingTasks = tasks.filter(task => task.status !== 'DONE');
    const sortedTasks = this.sortTasksByPriority(pendingTasks);
    
    const daySchedule = this.scheduleDayTasks(
      date,
      sortedTasks,
      new Set(),
      420 // 7 hours
    );
    
    return daySchedule.tasks;
  }

  /**
   * Schedule tasks for a specific day
   */
  private scheduleDayTasks(
    date: Date,
    tasks: Task[],
    alreadyScheduled: Set<string>,
    availableMinutes: number
  ): ItinerarySchedule {
    const scheduledTasks: ScheduledTask[] = [];
    let usedMinutes = 0;
    let currentTime = new Date(date);
    currentTime.setHours(this.workingHours.start, 0, 0, 0);
    
    // Filter tasks that can be scheduled today
    const candidateTasks = tasks.filter(task => {
      // Skip if already scheduled
      if (alreadyScheduled.has(task.id)) return false;
      
      // Check if due date allows scheduling today
      if (task.due_date) {
        const dueDate = new Date(task.due_date);
        if (dueDate < date) return true; // Overdue tasks get priority
      }
      
      return true;
    });

    for (const task of candidateTasks) {
      // Check if we have enough time left
      const taskMinutes = task.estimate_minutes || 60; // Default 1 hour
      if (usedMinutes + taskMinutes > availableMinutes) continue;
      
      // Check dependencies
      const blockedByTasks = this.getBlockingTasks(task, tasks);
      const canStart = blockedByTasks.every(depId => 
        alreadyScheduled.has(depId) || 
        tasks.find(t => t.id === depId)?.status === 'DONE'
      );
      
      // Only schedule if dependencies are met
      if (!canStart) continue;
      
      // Calculate schedule times
      const scheduledStart = new Date(currentTime);
      const scheduledEnd = new Date(currentTime);
      scheduledEnd.setMinutes(scheduledEnd.getMinutes() + taskMinutes);
      
      scheduledTasks.push({
        task,
        scheduledStart,
        scheduledEnd,
        canStart,
        blockedByTasks: blockedByTasks.filter(depId => 
          !alreadyScheduled.has(depId) && 
          tasks.find(t => t.id === depId)?.status !== 'DONE'
        )
      });
      
      alreadyScheduled.add(task.id);
      usedMinutes += taskMinutes;
      currentTime = new Date(scheduledEnd);
      
      // Add small buffer between tasks
      currentTime.setMinutes(currentTime.getMinutes() + 5);
    }
    
    return {
      date: date.toISOString().split('T')[0],
      tasks: scheduledTasks,
      totalMinutes: usedMinutes,
      availableMinutes
    };
  }

  /**
   * Sort tasks by priority, due date, and dependencies
   */
  private sortTasksByPriority(tasks: Task[]): Task[] {
    return [...tasks].sort((a, b) => {
      // Priority weight
      const priorityDiff = this.priorityWeights[b.priority] - this.priorityWeights[a.priority];
      if (priorityDiff !== 0) return priorityDiff;
      
      // Due date (earlier first)
      if (a.due_date && b.due_date) {
        return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
      }
      if (a.due_date) return -1;
      if (b.due_date) return 1;
      
      // Created date (older first)
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
  }

  /**
   * Get tasks that are blocking this task
   */
  private getBlockingTasks(task: Task, allTasks: Task[]): string[] {
    return task.blocked_by || [];
  }

  /**
   * Save schedule to database as itinerary items
   */
  async saveScheduleAsItinerary(
    schedule: ItinerarySchedule[],
    itineraryTitle: string = 'Auto-Generated Schedule'
  ): Promise<void> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      // Create itinerary
      const { data: itinerary, error: itineraryError } = await supabase
        .from('itineraries')
        .insert({
          title: itineraryTitle,
          description: `Auto-generated task schedule for ${schedule.length} days`,
          start_date: schedule[0]?.date,
          end_date: schedule[schedule.length - 1]?.date,
          user_id: user.id
        })
        .select()
        .single();

      if (itineraryError) throw itineraryError;

      // Create itinerary items for each scheduled task
      const itineraryItems = schedule.flatMap(day =>
        day.tasks.map(scheduledTask => ({
          itinerary_id: itinerary.id,
          title: scheduledTask.task.title,
          description: scheduledTask.task.description || '',
          start_time: scheduledTask.scheduledStart.toISOString(),
          end_time: scheduledTask.scheduledEnd.toISOString(),
          category: 'task',
          notes: `Priority: ${scheduledTask.task.priority}, Category: ${scheduledTask.task.category}`
        }))
      );

      if (itineraryItems.length > 0) {
        const { error: itemsError } = await supabase
          .from('itinerary_items')
          .insert(itineraryItems);

        if (itemsError) throw itemsError;
      }

    } catch (error) {
      console.error('Error saving schedule as itinerary:', error);
      throw error;
    }
  }

  /**
   * Get productivity insights from task completion data
   */
  async getProductivityInsights(tasks: Task[]): Promise<{
    completionRate: number;
    averageCompletionTime: number;
    priorityDistribution: Record<string, number>;
    categoryDistribution: Record<string, number>;
  }> {
    const completedTasks = tasks.filter(t => t.status === 'DONE');
    const totalTasks = tasks.length;
    
    const completionRate = totalTasks > 0 ? (completedTasks.length / totalTasks) * 100 : 0;
    
    // Calculate average completion time (for tasks with estimates)
    const tasksWithEstimates = completedTasks.filter(t => t.estimate_minutes);
    const averageCompletionTime = tasksWithEstimates.length > 0
      ? tasksWithEstimates.reduce((sum, t) => sum + (t.estimate_minutes || 0), 0) / tasksWithEstimates.length
      : 0;
    
    // Priority distribution
    const priorityDistribution = tasks.reduce((acc, task) => {
      acc[task.priority] = (acc[task.priority] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    // Category distribution
    const categoryDistribution = tasks.reduce((acc, task) => {
      acc[task.category] = (acc[task.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    return {
      completionRate,
      averageCompletionTime,
      priorityDistribution,
      categoryDistribution
    };
  }
}

export const itineraryEngine = new ItineraryEngine();
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

  private workloadBalance = {
    projectToTaskRatio: 0.6, // 60% ongoing projects, 25% one-off tasks, 15% buffer
    oneOffTaskRatio: 0.25,
    bufferRatio: 0.15
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
   * Smart task placement using AI scheduling with real calendar integration
   */
  async findOptimalTimeSlot(
    taskText: string,
    targetDate?: Date,
    existingTasks: Task[] = []
  ): Promise<{
    parsedTask: any;
    scheduledSlot: any;
    aiReasoning: string;
    busySlots: Array<{start: string; end: string; title: string; type: string}>;
  }> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      // Get real calendar availability
      const startDate = targetDate || new Date();
      const endDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days ahead
      
      const { data: calendarConnections } = await supabase
        .from('calendar_connections')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_active', true);

      let busySlots: any[] = [];
      
      // Get external calendar busy slots
      if (calendarConnections && calendarConnections.length > 0) {
        for (const connection of calendarConnections) {
          try {
            const { data: availability } = await supabase.functions.invoke(
              'calendar-integration-manager',
              {
                body: {
                  action: 'get_availability',
                  connection_id: connection.id,
                  start_date: startDate.toISOString(),
                  end_date: endDate.toISOString()
                }
              }
            );
            
            if (availability?.busy_slots) {
              busySlots.push(...availability.busy_slots);
            }
          } catch (error) {
            console.warn('Failed to get availability from calendar connection:', connection.id, error);
          }
        }
      }

      // Get existing scheduled tasks as busy slots
      const scheduledTasks = existingTasks
        .filter(task => task.is_scheduled && task.start_time && task.end_time)
        .map(task => ({
          start: task.start_time,
          end: task.end_time,
          title: task.title,
          type: 'task'
        }));
      
      busySlots.push(...scheduledTasks);

      const { data, error } = await supabase.functions.invoke('smart-calendar-scheduler', {
        body: {
          taskText,
          targetDate: targetDate?.toISOString() || new Date().toISOString(),
          existingTasks,
          workingMinutes: 420, // 7 hours default
          busySlots,
          scheduling_context: this.extractSchedulingContext(taskText)
        }
      });

      if (error) {
        console.error('Smart scheduler error:', error);
        throw error;
      }

      return {
        ...data,
        busySlots // Include busy slots for UI visualization
      };
    } catch (error) {
      console.error('Failed to find optimal time slot:', error);
      throw error;
    }
  }

  private extractSchedulingContext(taskText: string): string[] {
    const context: string[] = [];
    const lowerText = taskText.toLowerCase();
    
    if (lowerText.includes('bank') || lowerText.includes('office hours')) {
      context.push('business_hours');
    }
    if (lowerText.includes('commute') || lowerText.includes('way to')) {
      context.push('commute_time');
    }
    if (lowerText.includes('read') || lowerText.includes('study')) {
      context.push('quiet_time');
    }
    if (lowerText.includes('gym') || lowerText.includes('exercise')) {
      context.push('morning_evening');
    }
    if (lowerText.includes('flexible') || lowerText.includes('anytime')) {
      context.push('flexible_hours');
    }
    if (lowerText.includes('weekday') || lowerText.includes('monday to friday')) {
      context.push('weekdays_only');
    }
    if (lowerText.includes('weekend') || lowerText.includes('saturday') || lowerText.includes('sunday')) {
      context.push('weekend_ok');
    }
    
    return context;
  }

  /**
   * Analyze current workload balance
   */
  analyzeWorkloadBalance(tasks: Task[], date: Date = new Date()): {
    ongoingProjectTime: number;
    oneOffTaskTime: number;
    bufferTime: number;
    isBalanced: boolean;
    recommendations: string[];
  } {
    const dayTasks = tasks.filter(task => {
      if (!task.due_date) return false;
      const taskDate = new Date(task.due_date);
      return taskDate.toDateString() === date.toDateString();
    });

    // Categorize tasks by duration (project vs one-off)
    const projectTasks = dayTasks.filter(task => 
      task.estimate_minutes && task.estimate_minutes > 120 // >2 hours = project work
    );
    
    const oneOffTasks = dayTasks.filter(task => 
      !task.estimate_minutes || task.estimate_minutes <= 120
    );

    const ongoingProjectTime = projectTasks.reduce((sum, task) => 
      sum + (task.estimate_minutes || 0), 0
    );
    
    const oneOffTaskTime = oneOffTasks.reduce((sum, task) => 
      sum + (task.estimate_minutes || 60), 0
    );

    const totalScheduledTime = ongoingProjectTime + oneOffTaskTime;
    const bufferTime = Math.max(0, 420 - totalScheduledTime); // 7 hours working day

    const recommendations: string[] = [];
    
    // Check balance ratios
    const projectRatio = ongoingProjectTime / 420;
    const oneOffRatio = oneOffTaskTime / 420;
    
    if (projectRatio > this.workloadBalance.projectToTaskRatio + 0.1) {
      recommendations.push('Consider breaking large project tasks into smaller chunks');
    }
    
    if (oneOffRatio > this.workloadBalance.oneOffTaskRatio + 0.1) {
      recommendations.push('Too many small tasks scheduled - try batching similar activities');
    }
    
    if (bufferTime < 420 * this.workloadBalance.bufferRatio) {
      recommendations.push('Schedule is too packed - consider moving some tasks to another day');
    }

    const isBalanced = 
      projectRatio <= this.workloadBalance.projectToTaskRatio + 0.1 &&
      oneOffRatio <= this.workloadBalance.oneOffTaskRatio + 0.1 &&
      bufferTime >= 420 * this.workloadBalance.bufferRatio;

    return {
      ongoingProjectTime,
      oneOffTaskTime,
      bufferTime,
      isBalanced,
      recommendations
    };
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
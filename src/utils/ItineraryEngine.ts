import { supabase } from '@/integrations/supabase/client';
import { Task } from '@/types/task';
import {
  loadUserSchedulingConfig,
  getWorkingHoursConfig,
  getWorkloadBalanceConfig,
  extractSchedulingContext,
  type SchedulingConfig,
} from '@/services/schedulingService';

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

  private config: SchedulingConfig | null = null;

  // Load user config or use defaults
  private async loadConfig(userId?: string): Promise<void> {
    if (!this.config && userId) {
      this.config = await loadUserSchedulingConfig(userId);
    }
  }

  private getWorkingHours() {
    return this.config ? getWorkingHoursConfig(this.config) : getWorkingHoursConfig();
  }

  private getWorkloadBalance() {
    return this.config ? getWorkloadBalanceConfig(this.config) : getWorkloadBalanceConfig();
  }

  /**
   * Generate a smart schedule for tasks based on priorities, dependencies, and due dates
   */
  async generateSchedule(
    startDate: Date, 
    endDate: Date, 
    tasks: Task[],
    userId?: string,
    dailyWorkingMinutes?: number
  ): Promise<ItinerarySchedule[]> {
    // Load user config
    await this.loadConfig(userId);
    
    // Use config working hours if dailyWorkingMinutes not specified
    const workingHours = this.getWorkingHours();
    const effectiveWorkingMinutes = dailyWorkingMinutes || 
      (workingHours.maxDailyHours * 60);
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
        effectiveWorkingMinutes
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
  async generateDailySchedule(tasks: Task[], targetDate?: Date, userId?: string): Promise<ScheduledTask[]> {
    // Load user config
    await this.loadConfig(userId);
    
    const date = targetDate || new Date();
    const pendingTasks = tasks.filter(task => task.status !== 'DONE');
    const sortedTasks = this.sortTasksByPriority(pendingTasks);
    
    const workingHours = this.getWorkingHours();
    const dailyWorkingMinutes = workingHours.maxDailyHours * 60;
    
    const daySchedule = this.scheduleDayTasks(
      date,
      sortedTasks,
      new Set(),
      dailyWorkingMinutes
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
    const workingHours = this.getWorkingHours();
    currentTime.setHours(workingHours.defaultStart, 0, 0, 0);
    
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

      // Use ai-task-parser (which uses OPENAI_API_KEY) instead of smart-calendar-scheduler
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const { data: parsed, error: parseError } = await supabase.functions.invoke('ai-task-parser', {
        body: {
          text: taskText,
          timezone,
          userId: user.id,
          targetDate: targetDate?.toISOString() || new Date().toISOString()
        }
      });

      if (parseError) {
        console.error('AI task parser error:', parseError);
        throw parseError;
      }

      // Extract parsed task from response
      const parsedTask = parsed?.tasks?.[0] || parsed;
      
      // Calculate optimal slot based on parsed data and busy slots
      const scheduledSlot = this.calculateOptimalSlot(
        parsedTask,
        busySlots,
        targetDate || new Date()
      );

      return {
        parsedTask,
        scheduledSlot,
        aiReasoning: `Scheduled based on task type "${parsedTask?.category || 'general'}" and available time slots`,
        busySlots
      };
    } catch (error) {
      console.error('Failed to find optimal time slot:', error);
      throw error;
    }
  }

  /**
   * Calculate optimal time slot avoiding busy periods
   */
  private calculateOptimalSlot(
    parsedTask: any,
    busySlots: Array<{start: string; end: string; title: string; type: string}>,
    targetDate: Date
  ): { start: string; end: string; confidence: number } {
    const workingHours = this.getWorkingHours();
    const duration = parsedTask?.estimate_minutes || 60;
    
    // If task already has a specific time, use it
    if (parsedTask?.start_time) {
      const start = new Date(parsedTask.start_time);
      const end = new Date(start.getTime() + duration * 60 * 1000);
      return {
        start: start.toISOString(),
        end: end.toISOString(),
        confidence: 0.9
      };
    }
    
    // Find first available slot on target date
    const dayStart = new Date(targetDate);
    dayStart.setHours(workingHours.defaultStart, 0, 0, 0);
    
    const dayEnd = new Date(targetDate);
    dayEnd.setHours(workingHours.defaultEnd, 0, 0, 0);
    
    // Sort busy slots by start time
    const sortedBusy = busySlots
      .filter(slot => {
        const slotDate = new Date(slot.start);
        return slotDate.toDateString() === targetDate.toDateString();
      })
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
    
    let candidateStart = new Date(dayStart);
    
    for (const busy of sortedBusy) {
      const busyStart = new Date(busy.start);
      const busyEnd = new Date(busy.end);
      
      // Check if there's enough time before this busy slot
      const gapMinutes = (busyStart.getTime() - candidateStart.getTime()) / (60 * 1000);
      if (gapMinutes >= duration) {
        // Found a slot
        const end = new Date(candidateStart.getTime() + duration * 60 * 1000);
        return {
          start: candidateStart.toISOString(),
          end: end.toISOString(),
          confidence: 0.8
        };
      }
      
      // Move candidate start to after this busy slot
      candidateStart = new Date(Math.max(candidateStart.getTime(), busyEnd.getTime()));
    }
    
    // Check if there's time at the end of the day
    const remainingMinutes = (dayEnd.getTime() - candidateStart.getTime()) / (60 * 1000);
    if (remainingMinutes >= duration) {
      const end = new Date(candidateStart.getTime() + duration * 60 * 1000);
      return {
        start: candidateStart.toISOString(),
        end: end.toISOString(),
        confidence: 0.7
      };
    }
    
    // Fallback: suggest next day morning
    const nextDay = new Date(targetDate);
    nextDay.setDate(nextDay.getDate() + 1);
    nextDay.setHours(workingHours.defaultStart, 0, 0, 0);
    const nextEnd = new Date(nextDay.getTime() + duration * 60 * 1000);
    
    return {
      start: nextDay.toISOString(),
      end: nextEnd.toISOString(),
      confidence: 0.5
    };
  }

  extractSchedulingContext(taskText: string, category?: string): string[] {
    const context: string[] = [];
    const lowerText = taskText.toLowerCase();
    
    // Category-based context
    if (category === 'VENTURES' || lowerText.includes('business') || lowerText.includes('venture') || 
        lowerText.includes('startup') || lowerText.includes('investment') || lowerText.includes('pitch')) {
      context.push('business_hours');
      context.push('weekdays_only');
    }
    
    // Business hours context
    if (lowerText.includes('bank') || lowerText.includes('office') || lowerText.includes('appointment') ||
        lowerText.includes('meeting') || lowerText.includes('call')) {
      context.push('business_hours');
    }
    
    // Weekend context
    if (lowerText.includes('weekend') || lowerText.includes('saturday') || lowerText.includes('sunday')) {
      context.push('weekend_preferred');
    }
    
    // Weekday context
    if (lowerText.includes('weekday') || lowerText.includes('monday') || lowerText.includes('tuesday') || 
        lowerText.includes('wednesday') || lowerText.includes('thursday') || lowerText.includes('friday')) {
      context.push('weekdays_only');
    }
    
    // Time-specific context
    if (lowerText.includes('morning') || lowerText.includes('am')) {
      context.push('morning_preferred');
    }
    if (lowerText.includes('afternoon') || lowerText.includes('pm')) {
      context.push('afternoon_preferred');
    }
    if (lowerText.includes('evening') || lowerText.includes('night')) {
      context.push('evening_preferred');
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
    
    const workloadBalance = this.getWorkloadBalance();
    
    // Check balance ratios
    const projectRatio = ongoingProjectTime / 420;
    const oneOffRatio = oneOffTaskTime / 420;
    
    if (projectRatio > workloadBalance.projectToTaskRatio + 0.1) {
      recommendations.push('Consider breaking large project tasks into smaller chunks');
    }
    
    if (oneOffRatio > workloadBalance.oneOffTaskRatio + 0.1) {
      recommendations.push('Too many small tasks scheduled - try batching similar activities');
    }
    
    if (bufferTime < 420 * workloadBalance.bufferRatio) {
      recommendations.push('Schedule is too packed - consider moving some tasks to another day');
    }

    const isBalanced = 
      projectRatio <= workloadBalance.projectToTaskRatio + 0.1 &&
      oneOffRatio <= workloadBalance.oneOffTaskRatio + 0.1 &&
      bufferTime >= 420 * workloadBalance.bufferRatio;

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
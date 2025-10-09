import React from 'react';
import { format, parseISO, isSameDay, addMinutes, differenceInMinutes } from 'date-fns';
import { cn } from '@/lib/utils';
import { Task, ExternalCalendarEvent } from '@/types/task';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Plus, Clock, Calendar } from 'lucide-react';

interface TimeSlotGridProps {
  dates: Date[];
  tasks: Task[];
  externalEvents?: ExternalCalendarEvent[];
  onTimeSlotClick?: (date: Date, hour: number) => void;
  onTaskClick?: (task: Task) => void;
  className?: string;
}

const TimeSlotGrid: React.FC<TimeSlotGridProps> = ({
  dates,
  tasks,
  externalEvents = [],
  onTimeSlotClick,
  onTaskClick,
  className
}) => {
  const timeSlots = Array.from({ length: 17 }, (_, i) => i + 6); // 6 AM to 11 PM

  const getTasksForTimeSlot = (date: Date, hour: number) => {
    return tasks.filter(task => {
      if (!task.start_time || !task.end_time) return false;
      
      const taskStart = parseISO(task.start_time);
      const taskEnd = parseISO(task.end_time);
      
      if (!isSameDay(taskStart, date)) return false;
      
      const slotStart = new Date(date);
      slotStart.setHours(hour, 0, 0, 0);
      const slotEnd = new Date(date);
      slotEnd.setHours(hour + 1, 0, 0, 0);
      
      return taskStart < slotEnd && taskEnd > slotStart;
    });
  };

  const getEventsForTimeSlot = (date: Date, hour: number) => {
    return externalEvents.filter(event => {
      const eventStart = parseISO(event.start_time);
      const eventEnd = parseISO(event.end_time);
      
      if (!isSameDay(eventStart, date)) return false;
      
      const slotStart = new Date(date);
      slotStart.setHours(hour, 0, 0, 0);
      const slotEnd = new Date(date);
      slotEnd.setHours(hour + 1, 0, 0, 0);
      
      return eventStart < slotEnd && eventEnd > slotStart;
    });
  };

  const getTaskPosition = (task: Task, hour: number) => {
    if (!task.start_time || !task.end_time) return { top: 0, height: 60 };
    
    const taskStart = parseISO(task.start_time);
    const taskEnd = parseISO(task.end_time);
    
    const slotStart = new Date(taskStart);
    slotStart.setHours(hour, 0, 0, 0);
    
    const startMinutesFromHour = Math.max(0, differenceInMinutes(taskStart, slotStart));
    const durationMinutes = Math.min(60 - startMinutesFromHour, differenceInMinutes(taskEnd, addMinutes(slotStart, startMinutesFromHour)));
    
    return {
      top: (startMinutesFromHour / 60) * 60, // 60px per hour
      height: Math.max(20, (durationMinutes / 60) * 60)
    };
  };

  const priorityColors = {
    URGENT: 'bg-destructive text-destructive-foreground',
    HIGH: 'bg-orange-500 text-white',
    MEDIUM: 'bg-yellow-500 text-white',
    LOW: 'bg-blue-500 text-white',
  };

  return (
    <div className={cn("bg-background", className)}>
      {/* Header with dates */}
      <div className="grid gap-0 border-b" style={{gridTemplateColumns: `80px repeat(${dates.length}, 1fr)`}}>
        <div className="p-3 border-r bg-muted/30">
          <span className="text-xs text-muted-foreground">Time</span>
        </div>
        {dates.map((date, index) => (
          <div key={index} className="p-3 text-center border-r bg-muted/30">
            <div className="text-sm font-medium">{format(date, 'EEE')}</div>
            <div className="text-xs text-muted-foreground">{format(date, 'MMM d')}</div>
          </div>
        ))}
      </div>

      {/* Time slots grid */}
      <div className="relative">
        {timeSlots.map(hour => (
          <div key={hour} className="grid gap-0 border-b border-border/50" style={{gridTemplateColumns: `80px repeat(${dates.length}, 1fr)`}}>
            {/* Time label */}
            <div className="p-2 border-r bg-muted/10 flex items-start justify-end">
              <span className="text-xs text-muted-foreground">
                {format(new Date().setHours(hour, 0), 'h a')}
              </span>
            </div>
            
            {/* Date columns */}
            {dates.map((date, dateIndex) => {
              const slotTasks = getTasksForTimeSlot(date, hour);
              const slotEvents = getEventsForTimeSlot(date, hour);
              
              return (
                <div
                  key={`${hour}-${dateIndex}`}
                  className="relative border-r h-16 hover:bg-muted/30 transition-colors group cursor-pointer"
                  onClick={() => onTimeSlotClick?.(date, hour)}
                >
                  {/* Add task button */}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity h-6 w-6 p-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      onTimeSlotClick?.(date, hour);
                    }}
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                  
                  {/* External events */}
                  {slotEvents.map((event, eventIndex) => (
                    <div
                      key={`event-${eventIndex}`}
                      className="absolute left-0 right-0 bg-purple-100 border-l-4 border-purple-500 rounded px-2 py-1 text-xs z-10 shadow-sm"
                      style={{ top: 2, height: 'calc(100% - 4px)' }}
                      title={`External Event: ${event.title}`}
                    >
                      <div className="flex items-center gap-1 mb-0.5">
                        <Calendar className="h-3 w-3 text-purple-600" />
                        <span className="truncate font-medium text-purple-900">{event.title}</span>
                      </div>
                      <div className="text-purple-700 text-xs flex items-center gap-1">
                        <Clock className="h-2 w-2" />
                        {format(parseISO(event.start_time), 'h:mm a')} - {format(parseISO(event.end_time), 'h:mm a')}
                      </div>
                      {event.location && (
                        <div className="text-purple-600 text-xs truncate mt-0.5">
                          📍 {event.location}
                        </div>
                      )}
                    </div>
                  ))}
                  
                  {/* Tasks */}
                  {slotTasks.map((task, taskIndex) => {
                    const position = getTaskPosition(task, hour);
                    
                    return (
                      <div
                        key={`task-${taskIndex}`}
                        className={cn(
                          "absolute left-0 right-0 rounded px-1 py-0.5 text-xs cursor-pointer hover:opacity-90 transition-opacity z-20",
                          priorityColors[task.priority]
                        )}
                        style={{
                          top: position.top + 2,
                          height: Math.max(20, position.height - 4)
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onTaskClick?.(task);
                        }}
                      >
                        <div className="truncate font-medium">{task.title}</div>
                        {task.start_time && task.end_time && (
                          <div className="text-xs opacity-90 flex items-center gap-1">
                            <Clock className="h-2 w-2" />
                            {format(parseISO(task.start_time), 'h:mm')} - {format(parseISO(task.end_time), 'h:mm')}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};

export default TimeSlotGrid;
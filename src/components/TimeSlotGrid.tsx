import React from 'react';
import { format, parseISO, isSameDay, addMinutes, differenceInMinutes } from 'date-fns';
import { cn } from '@/lib/utils';
import { Task, ExternalCalendarEvent } from '@/types/task';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, Clock, Calendar } from 'lucide-react';

interface TimeSlotGridProps {
  dates: Date[];
  tasks: Task[];
  externalEvents?: ExternalCalendarEvent[];
  onTimeSlotClick?: (date: Date, hour: number, minute: number) => void;
  onTaskClick?: (task: Task) => void;
  onStatusChange?: (taskId: string, newStatus: Task['status']) => void;
  className?: string;
}

const TimeSlotGrid: React.FC<TimeSlotGridProps> = ({
  dates,
  tasks,
  externalEvents = [],
  onTimeSlotClick,
  onTaskClick,
  onStatusChange,
  className
}) => {
  // Generate 15-minute interval time slots from 6 AM to 11 PM
  const timeSlots: { hour: number; minute: number; label: string }[] = [];
  for (let hour = 6; hour <= 22; hour++) {
    for (let minute of [0, 15, 30, 45]) {
      timeSlots.push({ 
        hour, 
        minute, 
        label: `${hour}:${minute.toString().padStart(2, '0')}` 
      });
    }
  }

  const getTasksForTimeSlot = (date: Date, hour: number, minute: number) => {
    return tasks.filter(task => {
      if (!task.start_time || !task.end_time) return false;
      
      const taskStart = parseISO(task.start_time);
      const taskEnd = parseISO(task.end_time);
      
      if (!isSameDay(taskStart, date)) return false;
      
      // Only show task in the slot where it actually starts
      const taskStartHour = taskStart.getHours();
      const taskStartMinute = taskStart.getMinutes();
      
      return taskStartHour === hour && Math.floor(taskStartMinute / 15) * 15 === minute;
    });
  };

  const getEventsForTimeSlot = (date: Date, hour: number, minute: number) => {
    return externalEvents.filter(event => {
      const eventStart = parseISO(event.start_time);
      const eventEnd = parseISO(event.end_time);
      
      if (!isSameDay(eventStart, date)) return false;
      
      const slotStart = new Date(date);
      slotStart.setHours(hour, minute, 0, 0);
      const slotEnd = new Date(date);
      slotEnd.setHours(hour, minute + 15, 0, 0);
      
      return eventStart < slotEnd && eventEnd > slotStart;
    });
  };

  const handleCheckboxChange = (taskId: string, checked: boolean) => {
    if (!onStatusChange) return;
    
    if (checked) {
      onStatusChange(taskId, 'DONE');
    } else {
      onStatusChange(taskId, 'DOING');
    }
  };

  const getTaskPosition = (task: Task, slot: { hour: number; minute: number }, date: Date) => {
    if (!task.start_time || !task.end_time) return { top: 0, height: 60 };
    
    const taskStart = parseISO(task.start_time);
    const taskEnd = parseISO(task.end_time);
    
    const durationMinutes = differenceInMinutes(taskEnd, taskStart);
    const durationIn15MinSlots = Math.ceil(durationMinutes / 15);
    
    return {
      top: 2,
      height: Math.max(48, durationIn15MinSlots * 64 - 4) // 64px per 15-min slot, subtract spacing
    };
  };

  const priorityColors = {
    URGENT: 'bg-destructive text-destructive-foreground',
    HIGH: 'bg-orange-500 text-white',
    MEDIUM: 'bg-yellow-500 text-white',
    LOW: 'bg-blue-500 text-white',
  };

  // Layout constants for full-day overlay rendering
  const DAY_START_HOUR = 6; // 6 AM
  const DAY_END_HOUR = 22;  // 10 PM
  const MINUTES_PER_DAY = (DAY_END_HOUR - DAY_START_HOUR) * 60;
  const PX_PER_MINUTE = 64 / 15; // Matches h-16 per 15-min slot

  // Build laid out items for a given date (side-by-side without overlap)
  type LaidOutItem = {
    id: string;
    title: string;
    startMin: number;
    endMin: number;
    column: number;
    columnsInGroup: number;
    raw: Task | ExternalCalendarEvent;
    type: 'task' | 'event';
  };

  const clampToDay = (minutesFromMidnight: number) => {
    const start = DAY_START_HOUR * 60;
    const end = DAY_END_HOUR * 60;
    return Math.max(0, Math.min(minutesFromMidnight - start, end - start));
  };

  function layoutItemsForDate(date: Date) {
    // Collect tasks for this date
    const dayTasks = tasks.filter(t => t.start_time && isSameDay(parseISO(t.start_time), date));
    const dayEvents = externalEvents.filter(e => isSameDay(parseISO(e.start_time), date));

    const items: LaidOutItem[] = [
      ...dayTasks.map(t => {
        const s = parseISO(t.start_time!);
        const e = parseISO(t.end_time!);
        return {
          id: t.id,
          title: t.title,
          startMin: clampToDay(s.getHours() * 60 + s.getMinutes()),
          endMin: clampToDay(e.getHours() * 60 + e.getMinutes()),
          column: 0,
          columnsInGroup: 1,
          raw: t,
          type: 'task' as const,
        };
      }),
      ...dayEvents.map(ev => {
        const s = parseISO(ev.start_time);
        const e = parseISO(ev.end_time);
        return {
          id: ev.id,
          title: ev.title,
          startMin: clampToDay(s.getHours() * 60 + s.getMinutes()),
          endMin: clampToDay(e.getHours() * 60 + e.getMinutes()),
          column: 0,
          columnsInGroup: 1,
          raw: ev,
          type: 'event' as const,
        };
      })
    ]
      // Remove items that sit completely outside the display window
      .filter(it => it.endMin > 0 && it.startMin < MINUTES_PER_DAY)
      // Ensure minimum height of 15 minutes
      .map(it => ({ ...it, endMin: Math.max(it.endMin, it.startMin + 15) }));

    // Sort by start, then by longer duration first
    items.sort((a, b) => (a.startMin - b.startMin) || ((b.endMin - b.startMin) - (a.endMin - a.startMin)));

    // Sweep-line to assign columns within overlapping groups
    let active: Array<{ end: number; column: number }> = [];
    let groupStartIndex = 0;
    let groupMaxCols = 0;

    const finalizeGroup = (endIndex: number) => {
      const cols = Math.max(1, groupMaxCols);
      for (let i = groupStartIndex; i < endIndex; i++) {
        items[i].columnsInGroup = cols;
      }
      groupStartIndex = endIndex;
      groupMaxCols = 0;
    };

    for (let i = 0; i < items.length; i++) {
      const cur = items[i];
      // Remove non-overlapping actives
      active = active.filter(a => a.end > cur.startMin);
      // Find first free column
      const used = new Set(active.map(a => a.column));
      let col = 0; while (used.has(col)) col++;
      cur.column = col;
      active.push({ end: cur.endMin, column: col });
      groupMaxCols = Math.max(groupMaxCols, col + 1);

      // If next item starts after all actives end, finalize group
      const next = items[i + 1];
      const groupContinues = next && active.some(a => a.end > next.startMin);
      if (!groupContinues) finalizeGroup(i + 1);
    }

    return items;
  }

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

      {/* Time slots grid (background and click targets) */}
      <div className="relative">
        {timeSlots.map(slot => (
          <div key={`${slot.hour}-${slot.minute}`} className="grid gap-0 border-b border-border/50" style={{gridTemplateColumns: `80px repeat(${dates.length}, 1fr)`}}>
            {/* Time label */}
            <div className="p-2 border-r bg-muted/10 flex items-start justify-end">
              <span className="text-xs text-muted-foreground">
                {slot.label}
              </span>
            </div>
            
            {/* Date columns with click and quick-add only (tasks are rendered in overlay) */}
            {dates.map((date, dateIndex) => (
              <div
                key={`${slot.hour}-${slot.minute}-${dateIndex}`}
                className="relative border-r h-16 hover:bg-muted/30 transition-colors group cursor-pointer"
                onClick={() => onTimeSlotClick?.(date, slot.hour, slot.minute)}
              >
                {/* Add task button */}
                <Button
                  size="sm"
                  variant="ghost"
                  className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity h-6 w-6 p-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    onTimeSlotClick?.(date, slot.hour, slot.minute);
                  }}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        ))}

        {/* Overlay: render tasks/events across the full day to avoid overlap issues */}
        <div
          className="absolute inset-0 z-30 pointer-events-none"
          style={{
            height: `${timeSlots.length * 64}px`,
            display: 'grid',
            gridTemplateColumns: `80px repeat(${dates.length}, 1fr)`
          }}
        >
          {/* Empty time column */}
          <div />
          {dates.map((date, dateIndex) => {
            const items = layoutItemsForDate(date);
            return (
              <div key={`overlay-${dateIndex}`} className="relative border-r">
                {items.map((item, idx) => {
                  const top = item.startMin * PX_PER_MINUTE + 2;
                  const height = Math.max(48, (item.endMin - item.startMin) * PX_PER_MINUTE - 4);
                  const width = 100 / item.columnsInGroup;
                  const left = item.column * width;

                  if (item.type === 'event') {
                    const ev = item.raw as ExternalCalendarEvent;
                    return (
                      <div
                        key={`ev-${idx}`}
                        className="absolute rounded bg-purple-100 border-l-4 border-purple-500 px-2 py-1 text-xs shadow-sm pointer-events-auto"
                        style={{ top, height, left: `${left}%`, width: `calc(${width}% - 2px)` }}
                        title={`External Event: ${ev.title}`}
                      >
                        <div className="flex items-center gap-1 mb-0.5">
                          <Calendar className="h-3 w-3 text-purple-600" />
                          <span className="truncate font-medium text-purple-900">{ev.title}</span>
                        </div>
                        <div className="text-purple-700 text-xs flex items-center gap-1">
                          <Clock className="h-2 w-2" />
                          {format(parseISO(ev.start_time), 'h:mm a')} - {format(parseISO(ev.end_time), 'h:mm a')}
                        </div>
                      </div>
                    );
                  }

                  const t = item.raw as Task;
                  return (
                    <div
                      key={`task-${t.id}-${idx}`}
                      className={cn(
                        "absolute rounded text-xs group cursor-pointer hover:opacity-90 transition-opacity z-20 flex flex-col pointer-events-auto",
                        priorityColors[t.priority as keyof typeof priorityColors]
                      )}
                      style={{ top, height, left: `${left}%`, width: `calc(${width}% - 2px)`, padding: '4px' }}
                      onClick={(e) => { e.stopPropagation(); onTaskClick?.(t); }}
                      title={t.title}
                    >
                      {/* Checkbox overlay - visible on hover */}
                      {onStatusChange && (
                        <div 
                          className="absolute left-1 top-1 opacity-0 group-hover:opacity-100 transition-opacity z-30"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Checkbox
                            checked={t.status === 'DONE'}
                            onCheckedChange={(checked) => handleCheckboxChange(t.id, !!checked)}
                            className="h-3 w-3 bg-white border-2"
                          />
                        </div>
                      )}

                      <div className={cn(
                        "font-medium leading-tight break-words",
                        t.status === 'DONE' && "line-through opacity-60"
                      )}>
                        {t.title}
                      </div>
                      {t.start_time && t.end_time && (
                        <div className="text-xs opacity-90 flex items-center gap-1">
                          <Clock className="h-2 w-2" />
                          {format(parseISO(t.start_time), 'h:mm')} - {format(parseISO(t.end_time), 'h:mm')}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default TimeSlotGrid;
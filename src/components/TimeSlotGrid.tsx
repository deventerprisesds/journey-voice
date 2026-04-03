import React, { useState, useCallback } from 'react';
import { format, parseISO, differenceInMinutes } from 'date-fns';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { cn } from '@/lib/utils';
import { Task, ExternalCalendarEvent } from '@/types/task';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, Clock, Calendar, Sunrise, Sun, Sunset, Moon, Coffee, GripVertical } from 'lucide-react';
import { SchedulingConfig, DEFAULT_SCHEDULING_CONFIG } from '@/config/schedulingRules';
import { getTimePartsInTimezone, formatTimeInTimezone, getDateInTimezone, localTimeToUtcISO, getDefaultTimezone, dateToKeyInTimezone } from '@/lib/date';

interface TimeSlotGridProps {
  dates: Date[];
  tasks: Task[];
  externalEvents?: ExternalCalendarEvent[];
  onTimeSlotClick?: (date: Date, hour: number, minute: number) => void;
  onTaskClick?: (task: Task) => void;
  onStatusChange?: (taskId: string, newStatus: Task['status']) => void;
  onTaskReschedule?: (taskId: string, newStartTime: string, newEndTime: string) => Promise<void>;
  schedulingConfig?: SchedulingConfig;
  userTimezone?: string;
  className?: string;
}

const TimeSlotGrid: React.FC<TimeSlotGridProps> = ({
  dates,
  tasks,
  externalEvents = [],
  onTimeSlotClick,
  onTaskClick,
  onStatusChange,
  onTaskReschedule,
  schedulingConfig = DEFAULT_SCHEDULING_CONFIG,
  userTimezone,
  className
}) => {
  const timezone = userTimezone || getDefaultTimezone();
  const [isDragging, setIsDragging] = useState(false);
  // Time window visual config
  const timeWindowStyles: Record<string, { icon: React.ReactNode; label: string; bgClass: string; borderClass: string }> = {
    morning: { 
      icon: <Sunrise className="h-3 w-3" />, 
      label: 'Morning', 
      bgClass: 'bg-amber-50 dark:bg-amber-950/20',
      borderClass: 'border-l-4 border-l-amber-400'
    },
    business_hours: { 
      icon: <Coffee className="h-3 w-3" />, 
      label: 'Business Hours', 
      bgClass: 'bg-blue-50 dark:bg-blue-950/20',
      borderClass: 'border-l-4 border-l-blue-400'
    },
    after_work: { 
      icon: <Sunset className="h-3 w-3" />, 
      label: 'After Work', 
      bgClass: 'bg-orange-50 dark:bg-orange-950/20',
      borderClass: 'border-l-4 border-l-orange-400'
    },
    evening: { 
      icon: <Moon className="h-3 w-3" />, 
      label: 'Evening', 
      bgClass: 'bg-purple-50 dark:bg-purple-950/20',
      borderClass: 'border-l-4 border-l-purple-400'
    },
    weekends: { 
      icon: <Sun className="h-3 w-3" />, 
      label: 'Weekend', 
      bgClass: 'bg-green-50 dark:bg-green-950/20',
      borderClass: 'border-l-4 border-l-green-400'
    },
    flexible: { 
      icon: <Clock className="h-3 w-3" />, 
      label: 'Flexible', 
      bgClass: 'bg-gray-50 dark:bg-gray-950/20',
      borderClass: 'border-l-4 border-l-gray-400'
    },
  };

  // Determine which time window an hour falls into
  const getTimeWindowForHour = (hour: number, dayOfWeek: number): string | null => {
    const windows = schedulingConfig.timeWindows;
    
    // Check each window in priority order (more specific first)
    const windowPriority = ['morning', 'business_hours', 'after_work', 'evening', 'weekends', 'flexible'] as const;
    
    for (const windowName of windowPriority) {
      const window = windows[windowName];
      if (window.days.includes(dayOfWeek) && hour >= window.start && hour < window.end) {
        // Skip 'flexible' as it's too broad - only show if nothing else matches
        if (windowName === 'flexible') continue;
        return windowName;
      }
    }
    
    return null;
  };

  // Check if this hour is the start of a new time window
  const isTimeWindowStart = (hour: number, dayOfWeek: number): string | null => {
    const windows = schedulingConfig.timeWindows;
    
    for (const [windowName, window] of Object.entries(windows)) {
      if (windowName === 'flexible') continue; // Skip flexible
      if (window.days.includes(dayOfWeek) && window.start === hour) {
        return windowName;
      }
    }
    return null;
  };
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
    const dateStr = format(date, 'yyyy-MM-dd');
    return tasks.filter(task => {
      if (!task.start_time || !task.end_time) return false;
      
      // Use timezone-aware date check
      const taskDateStr = getDateInTimezone(task.start_time, timezone);
      if (taskDateStr !== dateStr) return false;
      
      // Use timezone-aware time extraction
      const { hour: taskStartHour, minute: taskStartMinute } = getTimePartsInTimezone(task.start_time, timezone);
      
      return taskStartHour === hour && Math.floor(taskStartMinute / 15) * 15 === minute;
    });
  };

  const getEventsForTimeSlot = (date: Date, hour: number, minute: number) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    return externalEvents.filter(event => {
      const eventStart = parseISO(event.start_time);
      const eventEnd = parseISO(event.end_time);
      
      // Use timezone-aware date check
      const eventDateStr = getDateInTimezone(event.start_time, timezone);
      if (eventDateStr !== dateStr) return false;
      
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
      top: 1,
      height: Math.max(12, durationIn15MinSlots * 16 - 2) // 16px per 15-min slot (75% reduction)
    };
  };

  const priorityColors = {
    URGENT: 'bg-destructive text-destructive-foreground',
    HIGH: 'bg-orange-500 text-white',
    MEDIUM: 'bg-yellow-500 text-white',
    LOW: 'bg-blue-500 text-white',
  };

  // Category colors using semantic tokens from design system
  const categoryColors: Record<string, string> = {
    LIFE: 'bg-[hsl(var(--category-life))] text-white',
    CAREER: 'bg-[hsl(var(--category-career))] text-white',
    VENTURES: 'bg-[hsl(var(--category-ventures))] text-white',
    EDUCATION: 'bg-[hsl(var(--category-education))] text-white',
    PROF_EDUCATION: 'bg-[hsl(var(--category-education))] text-white',
  };

  const categoryBorderColors: Record<string, string> = {
    LIFE: 'border-l-[hsl(var(--category-life))]',
    CAREER: 'border-l-[hsl(var(--category-career))]',
    VENTURES: 'border-l-[hsl(var(--category-ventures))]',
    EDUCATION: 'border-l-[hsl(var(--category-education))]',
    PROF_EDUCATION: 'border-l-[hsl(var(--category-education))]',
  };

  // Layout constants for full-day overlay rendering
  const DAY_START_HOUR = 6; // 6 AM
  const DAY_END_HOUR = 22;  // 10 PM
  const MINUTES_PER_DAY = (DAY_END_HOUR - DAY_START_HOUR) * 60;
  const PX_PER_MINUTE = 16 / 15; // Reduced from 64px to 16px per 15-min slot (75% reduction)

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
    const dateStr = format(date, 'yyyy-MM-dd');
    
    // Collect tasks for this date using timezone-aware filtering
    const dayTasks = tasks.filter(t => {
      if (!t.start_time) return false;
      return getDateInTimezone(t.start_time, timezone) === dateStr;
    });
    const dayEvents = externalEvents.filter(e => {
      return getDateInTimezone(e.start_time, timezone) === dateStr;
    });

    const items: LaidOutItem[] = [
      ...dayTasks.map(t => {
        // Use timezone-aware time extraction
        const { hour: startHour, minute: startMinute } = getTimePartsInTimezone(t.start_time!, timezone);
        const { hour: endHour, minute: endMinute } = getTimePartsInTimezone(t.end_time!, timezone);
        return {
          id: t.id,
          title: t.title,
          startMin: clampToDay(startHour * 60 + startMinute),
          endMin: clampToDay(endHour * 60 + endMinute),
          column: 0,
          columnsInGroup: 1,
          raw: t,
          type: 'task' as const,
        };
      }),
      ...dayEvents.map(ev => {
        // Use timezone-aware time extraction for events too
        const { hour: startHour, minute: startMinute } = getTimePartsInTimezone(ev.start_time, timezone);
        const { hour: endHour, minute: endMinute } = getTimePartsInTimezone(ev.end_time, timezone);
        return {
          id: ev.id,
          title: ev.title,
          startMin: clampToDay(startHour * 60 + startMinute),
          endMin: clampToDay(endHour * 60 + endMinute),
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

  // Handle drag end for task rescheduling
  const handleDragEnd = useCallback(async (result: DropResult) => {
    setIsDragging(false);
    if (!result.destination || !onTaskReschedule) return;
    
    const { draggableId, destination } = result;
    const task = tasks.find(t => t.id === draggableId);
    if (!task || !task.start_time || !task.end_time) return;
    
    // Parse the drop target ID: "slot-{dateIndex}-{hour}-{minute}"
    const parts = destination.droppableId.split('-');
    if (parts[0] !== 'slot' || parts.length !== 4) return;
    
    const [, dateIndexStr, hourStr, minuteStr] = parts;
    const dateIndex = parseInt(dateIndexStr);
    const newHour = parseInt(hourStr);
    const newMinute = parseInt(minuteStr);
    
    const targetDate = dates[dateIndex];
    if (!targetDate) return;
    
    // Calculate task duration
    const durationMs = new Date(task.end_time).getTime() - new Date(task.start_time).getTime();
    
    // Create new start and end times in UTC using the user's timezone
    const dateStr = format(targetDate, 'yyyy-MM-dd');
    const newStartTime = localTimeToUtcISO(dateStr, `${newHour.toString().padStart(2, '0')}:${newMinute.toString().padStart(2, '0')}`, timezone);
    const newEndDate = new Date(new Date(newStartTime).getTime() + durationMs);
    const newEndTime = newEndDate.toISOString();
    
    await onTaskReschedule(task.id, newStartTime, newEndTime);
  }, [tasks, dates, timezone, onTaskReschedule]);

  const handleDragStart = useCallback(() => {
    setIsDragging(true);
  }, []);

  return (
    <DragDropContext onDragEnd={handleDragEnd} onDragStart={handleDragStart}>
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
        {timeSlots.map((slot, slotIndex) => {
          // Check if this is a :00 minute slot (for time window headers)
          const isHourStart = slot.minute === 0;
          const dayOfWeek = dates[0]?.getDay() ?? 1;
          const windowStart = isHourStart ? isTimeWindowStart(slot.hour, dayOfWeek) : null;
          const currentWindow = getTimeWindowForHour(slot.hour, dayOfWeek);
          const windowStyle = currentWindow ? timeWindowStyles[currentWindow] : null;
          
          return (
            <React.Fragment key={`${slot.hour}-${slot.minute}`}>
              {/* Time Window Header - show at start of each window */}
              {windowStart && timeWindowStyles[windowStart] && (
                <div 
                  className={cn(
                    "grid gap-0 border-b-2",
                    timeWindowStyles[windowStart].borderClass.replace('border-l-4', 'border-b')
                  )} 
                  style={{gridTemplateColumns: `80px repeat(${dates.length}, 1fr)`}}
                >
                  <div className={cn(
                    "p-2 border-r flex items-center gap-2",
                    timeWindowStyles[windowStart].bgClass
                  )}>
                    {timeWindowStyles[windowStart].icon}
                    <span className="text-xs font-medium text-foreground">
                      {timeWindowStyles[windowStart].label}
                    </span>
                  </div>
                  {dates.map((_, dateIndex) => (
                    <div 
                      key={`window-header-${windowStart}-${dateIndex}`} 
                      className={cn(
                        "p-1 border-r text-xs text-muted-foreground",
                        timeWindowStyles[windowStart].bgClass
                      )}
                    >
                      <span className="text-[10px]">
                        {schedulingConfig.timeWindows[windowStart as keyof typeof schedulingConfig.timeWindows]?.start}:00 - {schedulingConfig.timeWindows[windowStart as keyof typeof schedulingConfig.timeWindows]?.end}:00
                      </span>
                    </div>
                  ))}
                </div>
              )}
              
              {/* Regular time slot row */}
              <div className="grid gap-0 border-b border-border/50" style={{gridTemplateColumns: `80px repeat(${dates.length}, 1fr)`}}>
                {/* Time label with window indicator */}
                <div className={cn(
                  "p-2 border-r flex items-start justify-end",
                  windowStyle ? windowStyle.bgClass : 'bg-muted/10',
                  windowStyle ? windowStyle.borderClass : ''
                )}>
                  <span className="text-xs text-muted-foreground">
                    {slot.label}
                  </span>
                </div>
                
                {/* Date columns with droppable zones for rescheduling */}
                {dates.map((date, dateIndex) => (
                  <Droppable 
                    droppableId={`slot-${dateIndex}-${slot.hour}-${slot.minute}`} 
                    key={`${slot.hour}-${slot.minute}-${dateIndex}`}
                  >
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        className={cn(
                          "relative border-r h-4 transition-colors group cursor-pointer",
                          windowStyle ? windowStyle.bgClass : '',
                          snapshot.isDraggingOver ? 'bg-primary/20' : 'hover:bg-muted/30'
                        )}
                        onClick={() => !isDragging && onTimeSlotClick?.(date, slot.hour, slot.minute)}
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
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                ))}
              </div>
            </React.Fragment>
          );
        })}

        {/* Overlay: render tasks/events across the full day to avoid overlap issues */}
        {(() => {
          // Pre-compute cumulative header heights for offset correction
          const dayOfWeek = dates[0]?.getDay() ?? 1;
          const headerPositions: { minFromDayStart: number; heightPx: number }[] = [];
          for (let hour = DAY_START_HOUR; hour <= DAY_END_HOUR; hour++) {
            const windowStart = isTimeWindowStart(hour, dayOfWeek);
            if (windowStart && timeWindowStyles[windowStart]) {
              headerPositions.push({
                minFromDayStart: (hour - DAY_START_HOUR) * 60,
                heightPx: 32, // approximate height of window header row
              });
            }
          }
          
          const getHeaderOffset = (minutesFromDayStart: number) => {
            let offset = 0;
            for (const hp of headerPositions) {
              if (hp.minFromDayStart <= minutesFromDayStart) {
                offset += hp.heightPx;
              }
            }
            return offset;
          };
          
          const totalHeaderHeight = headerPositions.reduce((sum, hp) => sum + hp.heightPx, 0);
          
          return (
        <div
          className="absolute inset-0 z-30 pointer-events-none"
          style={{
            height: `${timeSlots.length * 16 + totalHeaderHeight}px`,
            display: 'grid',
            gridTemplateColumns: `80px repeat(${dates.length}, 1fr)`
          }}
        >
          {/* Empty time column */}
          <div />
          {dates.map((date, dateIndex) => {
            const items = layoutItemsForDate(date);
            return (
              <Droppable droppableId={`overlay-${dateIndex}`} isDropDisabled>
                {(provided) => (
                  <div ref={provided.innerRef} {...provided.droppableProps} className="relative border-r">
                    {items.map((item, idx) => {
                      const top = item.startMin * PX_PER_MINUTE + getHeaderOffset(item.startMin) + 1;
                      const height = Math.max(12, (item.endMin - item.startMin) * PX_PER_MINUTE - 2);
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
                              {formatTimeInTimezone(ev.start_time, timezone)} - {formatTimeInTimezone(ev.end_time, timezone)}
                            </div>
                          </div>
                        );
                      }

                      const t = item.raw as Task;
                      const categoryBorder = t.category ? categoryBorderColors[t.category] : '';
                      
                      return (
                        <Draggable key={t.id} draggableId={t.id} index={idx}>
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              className={cn(
                                "absolute rounded text-xs group cursor-pointer transition-opacity z-20 flex flex-col pointer-events-auto border-l-4",
                                priorityColors[t.priority as keyof typeof priorityColors],
                                categoryBorder,
                                snapshot.isDragging ? 'opacity-70 shadow-lg' : 'hover:opacity-90'
                              )}
                              style={{ 
                                top: snapshot.isDragging ? undefined : top, 
                                height, 
                                left: snapshot.isDragging ? undefined : `${left}%`, 
                                width: `calc(${width}% - 2px)`, 
                                padding: '4px',
                                ...provided.draggableProps.style
                              }}
                              onClick={(e) => { e.stopPropagation(); if (!snapshot.isDragging) onTaskClick?.(t); }}
                              title={t.title}
                            >
                              {onTaskReschedule && (
                                <div 
                                  {...provided.dragHandleProps}
                                  className="absolute right-1 top-1 opacity-0 group-hover:opacity-100 transition-opacity z-30 cursor-grab active:cursor-grabbing touch-none"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <GripVertical className="h-3 w-3 text-white/70" />
                                </div>
                              )}
                              
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

                              {t.category && (
                                <Badge 
                                  className={cn(
                                    "absolute top-0.5 right-4 text-[9px] px-1 py-0 h-4 font-medium",
                                    categoryColors[t.category]
                                  )}
                                >
                                  {t.category}
                                </Badge>
                              )}

                              <div className={cn(
                                "font-medium leading-tight break-words pr-12",
                                t.status === 'DONE' && "line-through opacity-60"
                              )}>
                                {t.title}
                              </div>
                              {t.start_time && t.end_time && (
                                <div className="text-xs opacity-90 flex items-center gap-1 mt-auto">
                                  <Clock className="h-2 w-2" />
                                  {formatTimeInTimezone(t.start_time, timezone, { hour: 'numeric', minute: '2-digit' })} - {formatTimeInTimezone(t.end_time, timezone, { hour: 'numeric', minute: '2-digit' })}
                                </div>
                              )}
                            </div>
                          )}
                        </Draggable>
                      );
                    })}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            );
          })}
        </div>
          );
        })()}
      </div>
    </div>
    </DragDropContext>
  );
};

export default TimeSlotGrid;
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { 
  Calendar as CalendarIcon, 
  Clock, 
  Zap, 
  CheckCircle2,
  AlertTriangle,
  Loader2
} from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { Task } from '@/types/task';
import { itineraryEngine } from '@/utils/ItineraryEngine';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { getWorkingHoursConfig } from '@/services/schedulingService';

interface ScheduleGeneratorProps {
  tasks: Task[];
  onScheduleGenerated?: (schedule: any[]) => void;
}

interface ScheduledTask {
  task: Task;
  scheduledStart: Date;
  scheduledEnd: Date;
  canStart: boolean;
  blockedByTasks: string[];
}

const ScheduleGenerator: React.FC<ScheduleGeneratorProps> = ({ 
  tasks, 
  onScheduleGenerated 
}) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [isGenerating, setIsGenerating] = useState(false);
  const [targetDate, setTargetDate] = useState<Date>(new Date());
  
  // Use config from service for initial value
  const defaultWorkingHours = getWorkingHoursConfig();
  const [workingHours, setWorkingHours] = useState(defaultWorkingHours.maxDailyHours);
  const [generatedSchedule, setGeneratedSchedule] = useState<ScheduledTask[]>([]);

  const handleGenerateSchedule = async () => {
    if (tasks.length === 0) {
      toast({
        title: "No tasks available",
        description: "Please add some tasks before generating a schedule",
        variant: "destructive",
      });
      return;
    }

    setIsGenerating(true);
    try {
      const schedule = await itineraryEngine.generateDailySchedule(tasks, targetDate, user?.id);
      setGeneratedSchedule(schedule);
      onScheduleGenerated?.(schedule);
      
      toast({
        title: "Schedule generated",
        description: `Generated schedule with ${schedule.length} tasks`,
      });
    } catch (error) {
      console.error('Error generating schedule:', error);
      toast({
        title: "Error",
        description: "Failed to generate schedule",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveAsItinerary = async () => {
    if (generatedSchedule.length === 0) {
      toast({
        title: "No schedule to save",
        description: "Please generate a schedule first",
        variant: "destructive",
      });
      return;
    }

    try {
      const scheduleData = [{
        date: targetDate.toISOString().split('T')[0],
        tasks: generatedSchedule,
        totalMinutes: generatedSchedule.reduce((sum, st) => 
          sum + (st.task.estimate_minutes || 60), 0
        ),
        availableMinutes: workingHours * 60
      }];

      await itineraryEngine.saveScheduleAsItinerary(
        scheduleData,
        `Daily Schedule - ${format(targetDate, 'MMM d, yyyy')}`
      );

      toast({
        title: "Schedule saved",
        description: "Schedule has been saved as an itinerary",
      });
    } catch (error) {
      console.error('Error saving schedule:', error);
      toast({
        title: "Error",
        description: "Failed to save schedule as itinerary",
        variant: "destructive",
      });
    }
  };

  const formatTime = (date: Date): string => {
    return format(date, 'HH:mm');
  };

  const formatDuration = (minutes?: number): string => {
    if (!minutes) return '1h';
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  const getPriorityColor = (priority: Task['priority']) => {
    switch (priority) {
      case 'URGENT':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'HIGH':
        return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'MEDIUM':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'LOW':
        return 'bg-gray-100 text-gray-800 border-gray-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const availableTasks = tasks.filter(t => t.status !== 'DONE');
  const totalEstimatedTime = availableTasks.reduce((sum, task) => 
    sum + (task.estimate_minutes || 60), 0
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Zap className="h-5 w-5" />
            Smart Schedule Generator
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Generate an optimized daily schedule based on task priorities and dependencies
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Configuration */}
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Target Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !targetDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {targetDate ? format(targetDate, "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={targetDate}
                    onSelect={(date) => date && setTargetDate(date)}
                    initialFocus
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label htmlFor="working-hours">Working Hours</Label>
              <Input
                id="working-hours"
                type="number"
                min="1"
                max="16"
                value={workingHours}
                onChange={(e) => setWorkingHours(parseInt(e.target.value) || 7)}
                className="w-full"
              />
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-4 p-4 bg-muted/50 rounded-lg">
            <div className="text-center">
              <div className="text-lg font-bold">{availableTasks.length}</div>
              <div className="text-xs text-muted-foreground">Available Tasks</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold">{Math.ceil(totalEstimatedTime / 60)}h</div>
              <div className="text-xs text-muted-foreground">Est. Total Time</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold">{workingHours}h</div>
              <div className="text-xs text-muted-foreground">Available Time</div>
            </div>
          </div>

          {/* Generate Button */}
          <Button 
            onClick={handleGenerateSchedule} 
            disabled={isGenerating || availableTasks.length === 0}
            className="w-full"
          >
            {isGenerating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating Schedule...
              </>
            ) : (
              <>
                <Zap className="mr-2 h-4 w-4" />
                Generate Smart Schedule
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Generated Schedule */}
      {generatedSchedule.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Generated Schedule for {format(targetDate, 'MMM d, yyyy')}
              </CardTitle>
              <Button onClick={handleSaveAsItinerary} variant="outline" size="sm">
                Save as Itinerary
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {generatedSchedule.map((scheduledTask, index) => (
                <div
                  key={scheduledTask.task.id}
                  className={`p-4 rounded-lg border transition-all ${
                    !scheduledTask.canStart 
                      ? 'bg-yellow-50 border-yellow-200' 
                      : 'bg-card border-border hover:shadow-sm'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="text-sm font-mono text-muted-foreground">
                          {formatTime(scheduledTask.scheduledStart)} - {formatTime(scheduledTask.scheduledEnd)}
                        </div>
                        <Badge variant="outline" className="text-xs">
                          {formatDuration(scheduledTask.task.estimate_minutes)}
                        </Badge>
                      </div>
                      
                      <h4 className="font-medium text-sm mb-1 truncate">
                        {scheduledTask.task.title}
                      </h4>
                      
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge 
                          variant="outline" 
                          className={`text-xs ${getPriorityColor(scheduledTask.task.priority)}`}
                        >
                          {scheduledTask.task.priority.toLowerCase()}
                        </Badge>
                        
                        <Badge variant="outline" className="text-xs">
                          {scheduledTask.task.category.toLowerCase()}
                        </Badge>

                        {!scheduledTask.canStart && (
                          <Badge variant="destructive" className="text-xs">
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            Blocked
                          </Badge>
                        )}

                        {scheduledTask.canStart && (
                          <Badge variant="default" className="text-xs bg-green-100 text-green-800 border-green-200">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Ready
                          </Badge>
                        )}
                      </div>

                      {scheduledTask.blockedByTasks.length > 0 && (
                        <div className="mt-2 text-xs text-muted-foreground">
                          Waiting for: {scheduledTask.blockedByTasks.length} task(s)
                        </div>
                      )}
                    </div>

                    <div className="text-lg font-mono text-muted-foreground">
                      #{(index + 1).toString().padStart(2, '0')}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {generatedSchedule.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                No tasks could be scheduled for the selected date.
                This might be due to dependencies or time constraints.
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default ScheduleGenerator;
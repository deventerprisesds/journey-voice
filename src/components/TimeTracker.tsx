import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Play, Pause, Square, Clock, Timer } from 'lucide-react';
import { Task } from '@/types/task';
import { useToast } from '@/hooks/use-toast';

interface TimeTrackerProps {
  task: Task;
  onTimeUpdate?: (taskId: string, timeSpent: number) => void;
}

interface TimeSession {
  startTime: Date;
  endTime?: Date;
  duration: number; // in seconds
}

const TimeTracker: React.FC<TimeTrackerProps> = ({ task, onTimeUpdate }) => {
  const { toast } = useToast();
  const [isRunning, setIsRunning] = useState(false);
  const [currentSession, setCurrentSession] = useState<TimeSession | null>(null);
  const [totalTimeSpent, setTotalTimeSpent] = useState(0); // in seconds
  const [displayTime, setDisplayTime] = useState(0);

  // Load saved time data from localStorage
  useEffect(() => {
    const savedData = localStorage.getItem(`timeTracker_${task.id}`);
    if (savedData) {
      const { totalTime, sessions } = JSON.parse(savedData);
      setTotalTimeSpent(totalTime || 0);
    }
  }, [task.id]);

  // Update display time every second when running
  useEffect(() => {
    let interval: NodeJS.Timeout;
    
    if (isRunning && currentSession) {
      interval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - currentSession.startTime.getTime()) / 1000);
        setDisplayTime(totalTimeSpent + elapsed);
      }, 1000);
    } else {
      setDisplayTime(totalTimeSpent);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRunning, currentSession, totalTimeSpent]);

  const startTimer = () => {
    const session: TimeSession = {
      startTime: new Date(),
      duration: 0
    };
    setCurrentSession(session);
    setIsRunning(true);
    
    toast({
      title: "Timer started",
      description: `Started tracking time for "${task.title}"`,
    });
  };

  const pauseTimer = () => {
    if (!currentSession) return;

    const endTime = new Date();
    const sessionDuration = Math.floor((endTime.getTime() - currentSession.startTime.getTime()) / 1000);
    
    const completedSession: TimeSession = {
      ...currentSession,
      endTime,
      duration: sessionDuration
    };

    const newTotalTime = totalTimeSpent + sessionDuration;
    setTotalTimeSpent(newTotalTime);
    setCurrentSession(null);
    setIsRunning(false);

    // Save to localStorage
    const savedData = localStorage.getItem(`timeTracker_${task.id}`);
    const existingData = savedData ? JSON.parse(savedData) : { totalTime: 0, sessions: [] };
    const updatedData = {
      totalTime: newTotalTime,
      sessions: [...existingData.sessions, completedSession]
    };
    localStorage.setItem(`timeTracker_${task.id}`, JSON.stringify(updatedData));

    // Notify parent component
    onTimeUpdate?.(task.id, newTotalTime);

    toast({
      title: "Timer paused",
      description: `Session saved: ${formatDuration(sessionDuration)}`,
    });
  };

  const stopTimer = () => {
    if (currentSession) {
      pauseTimer(); // This will save the current session
    } else {
      setIsRunning(false);
    }
  };

  const resetTimer = () => {
    setIsRunning(false);
    setCurrentSession(null);
    setTotalTimeSpent(0);
    setDisplayTime(0);
    
    // Clear localStorage
    localStorage.removeItem(`timeTracker_${task.id}`);
    
    onTimeUpdate?.(task.id, 0);
    
    toast({
      title: "Timer reset",
      description: "All time data cleared for this task",
    });
  };

  const formatDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes.toString().padStart(2, '0')}m ${secs.toString().padStart(2, '0')}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs.toString().padStart(2, '0')}s`;
    } else {
      return `${secs}s`;
    }
  };

  const formatShortDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
      return `${minutes}m`;
    } else {
      return `${seconds}s`;
    }
  };

  const getProgressPercentage = (): number => {
    if (!task.estimate_minutes) return 0;
    const estimateSeconds = task.estimate_minutes * 60;
    return Math.min((displayTime / estimateSeconds) * 100, 100);
  };

  const isOverEstimate = (): boolean => {
    if (!task.estimate_minutes) return false;
    return displayTime > (task.estimate_minutes * 60);
  };

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Timer className="h-4 w-4" />
          Time Tracker
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Main Timer Display */}
        <div className="text-center">
          <div className={`text-2xl font-mono font-bold ${isRunning ? 'text-primary' : 'text-foreground'}`}>
            {formatDuration(displayTime)}
          </div>
          {task.estimate_minutes && (
            <div className="text-xs text-muted-foreground mt-1">
              Estimated: {formatShortDuration(task.estimate_minutes * 60)}
              {isOverEstimate() && (
                <Badge variant="destructive" className="ml-2 text-xs">
                  Over estimate
                </Badge>
              )}
            </div>
          )}
        </div>

        {/* Progress Bar */}
        {task.estimate_minutes && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Progress</span>
              <span>{Math.round(getProgressPercentage())}%</span>
            </div>
            <div className="w-full bg-secondary rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all duration-300 ${
                  isOverEstimate() ? 'bg-destructive' : 'bg-primary'
                }`}
                style={{ width: `${Math.min(getProgressPercentage(), 100)}%` }}
              />
            </div>
          </div>
        )}

        {/* Control Buttons */}
        <div className="flex justify-center gap-2">
          {!isRunning ? (
            <Button onClick={startTimer} size="sm" className="flex items-center gap-2">
              <Play className="h-4 w-4" />
              Start
            </Button>
          ) : (
            <Button onClick={pauseTimer} size="sm" variant="outline" className="flex items-center gap-2">
              <Pause className="h-4 w-4" />
              Pause
            </Button>
          )}
          
          <Button 
            onClick={stopTimer} 
            size="sm" 
            variant="outline"
            className="flex items-center gap-2"
            disabled={!isRunning && totalTimeSpent === 0}
          >
            <Square className="h-4 w-4" />
            Stop
          </Button>
          
          <Button 
            onClick={resetTimer} 
            size="sm" 
            variant="ghost"
            className="flex items-center gap-2"
            disabled={totalTimeSpent === 0 && !isRunning}
          >
            Reset
          </Button>
        </div>

        {/* Status Badge */}
        <div className="flex justify-center">
          {isRunning && (
            <Badge className="flex items-center gap-1">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              Timer Running
            </Badge>
          )}
        </div>

        {/* Summary Stats */}
        {totalTimeSpent > 0 && (
          <div className="pt-2 border-t space-y-2">
            <div className="text-xs text-muted-foreground text-center">
              Total time tracked: {formatShortDuration(totalTimeSpent)}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default TimeTracker;
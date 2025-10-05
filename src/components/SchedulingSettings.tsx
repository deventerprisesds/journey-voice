import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import {
  loadUserSchedulingConfig,
  saveUserSchedulingConfig,
} from '@/services/schedulingService';
import { DEFAULT_SCHEDULING_CONFIG, type SchedulingConfig } from '@/config/schedulingRules';
import { Clock, Calendar, TrendingUp } from 'lucide-react';

const SchedulingSettings: React.FC = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<SchedulingConfig>(DEFAULT_SCHEDULING_CONFIG);

  useEffect(() => {
    if (user?.id) {
      loadConfig();
    }
  }, [user?.id]);

  const loadConfig = async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const loadedConfig = await loadUserSchedulingConfig(user.id);
      setConfig(loadedConfig);
    } catch (error) {
      console.error('Failed to load scheduling config:', error);
      toast({
        title: 'Error',
        description: 'Failed to load scheduling preferences',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!user?.id) return;
    setSaving(true);
    try {
      const success = await saveUserSchedulingConfig(user.id, config);
      if (success) {
        toast({
          title: 'Saved',
          description: 'Scheduling preferences updated successfully',
        });
      } else {
        throw new Error('Save failed');
      }
    } catch (error) {
      console.error('Failed to save scheduling config:', error);
      toast({
        title: 'Error',
        description: 'Failed to save scheduling preferences',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setConfig(DEFAULT_SCHEDULING_CONFIG);
    toast({
      title: 'Reset',
      description: 'Scheduling preferences reset to defaults',
    });
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-muted-foreground">Loading preferences...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Working Hours */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            <CardTitle>Working Hours</CardTitle>
          </div>
          <CardDescription>
            Configure your default working hours and break times
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="start-hour">Start Hour (24h)</Label>
              <Input
                id="start-hour"
                type="number"
                min="0"
                max="23"
                value={config.workingHours.defaultStart}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    workingHours: {
                      ...config.workingHours,
                      defaultStart: parseInt(e.target.value) || 9,
                    },
                  })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end-hour">End Hour (24h)</Label>
              <Input
                id="end-hour"
                type="number"
                min="0"
                max="23"
                value={config.workingHours.defaultEnd}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    workingHours: {
                      ...config.workingHours,
                      defaultEnd: parseInt(e.target.value) || 17,
                    },
                  })
                }
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="break-minutes">Break Time (minutes)</Label>
              <Input
                id="break-minutes"
                type="number"
                min="0"
                max="240"
                value={config.workingHours.breakMinutes}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    workingHours: {
                      ...config.workingHours,
                      breakMinutes: parseInt(e.target.value) || 60,
                    },
                  })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="max-hours">Max Daily Hours</Label>
              <Input
                id="max-hours"
                type="number"
                min="1"
                max="16"
                value={config.workingHours.maxDailyHours}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    workingHours: {
                      ...config.workingHours,
                      maxDailyHours: parseInt(e.target.value) || 7,
                    },
                  })
                }
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Time Windows */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            <CardTitle>Time Windows</CardTitle>
          </div>
          <CardDescription>
            Define when different types of tasks should be scheduled
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {Object.entries(config.timeWindows).map(([windowName, window]) => (
            <div key={windowName} className="space-y-2 p-4 border rounded-lg">
              <Label className="text-base font-medium capitalize">
                {windowName.replace('_', ' ')}
              </Label>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor={`${windowName}-start`} className="text-sm">
                    Start Hour
                  </Label>
                  <Input
                    id={`${windowName}-start`}
                    type="number"
                    min="0"
                    max="23"
                    value={window.start}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        timeWindows: {
                          ...config.timeWindows,
                          [windowName]: {
                            ...window,
                            start: parseInt(e.target.value) || 0,
                          },
                        },
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`${windowName}-end`} className="text-sm">
                    End Hour
                  </Label>
                  <Input
                    id={`${windowName}-end`}
                    type="number"
                    min="0"
                    max="23"
                    value={window.end}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        timeWindows: {
                          ...config.timeWindows,
                          [windowName]: {
                            ...window,
                            end: parseInt(e.target.value) || 0,
                          },
                        },
                      })
                    }
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-sm">Days</Label>
                <div className="flex gap-2">
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, index) => (
                    <Button
                      key={day}
                      type="button"
                      size="sm"
                      variant={window.days.includes(index) ? 'default' : 'outline'}
                      onClick={() => {
                        const newDays = window.days.includes(index)
                          ? window.days.filter((d) => d !== index)
                          : [...window.days, index].sort();
                        setConfig({
                          ...config,
                          timeWindows: {
                            ...config.timeWindows,
                            [windowName]: { ...window, days: newDays },
                          },
                        });
                      }}
                    >
                      {day}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Workload Balance */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            <CardTitle>Workload Balance</CardTitle>
          </div>
          <CardDescription>
            Configure how your time is distributed between projects, tasks, and buffer time
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <div className="flex justify-between">
              <Label>Project Work</Label>
              <span className="text-sm text-muted-foreground">
                {Math.round(config.workloadBalance.projectToTaskRatio * 100)}%
              </span>
            </div>
            <Slider
              value={[config.workloadBalance.projectToTaskRatio * 100]}
              onValueChange={(value) =>
                setConfig({
                  ...config,
                  workloadBalance: {
                    ...config.workloadBalance,
                    projectToTaskRatio: value[0] / 100,
                  },
                })
              }
              max={100}
              step={5}
            />
          </div>
          <div className="space-y-2">
            <div className="flex justify-between">
              <Label>One-off Tasks</Label>
              <span className="text-sm text-muted-foreground">
                {Math.round(config.workloadBalance.oneOffTaskRatio * 100)}%
              </span>
            </div>
            <Slider
              value={[config.workloadBalance.oneOffTaskRatio * 100]}
              onValueChange={(value) =>
                setConfig({
                  ...config,
                  workloadBalance: {
                    ...config.workloadBalance,
                    oneOffTaskRatio: value[0] / 100,
                  },
                })
              }
              max={100}
              step={5}
            />
          </div>
          <div className="space-y-2">
            <div className="flex justify-between">
              <Label>Buffer Time</Label>
              <span className="text-sm text-muted-foreground">
                {Math.round(config.workloadBalance.bufferRatio * 100)}%
              </span>
            </div>
            <Slider
              value={[config.workloadBalance.bufferRatio * 100]}
              onValueChange={(value) =>
                setConfig({
                  ...config,
                  workloadBalance: {
                    ...config.workloadBalance,
                    bufferRatio: value[0] / 100,
                  },
                })
              }
              max={100}
              step={5}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            Total:{' '}
            {Math.round(
              (config.workloadBalance.projectToTaskRatio +
                config.workloadBalance.oneOffTaskRatio +
                config.workloadBalance.bufferRatio) *
                100
            )}
            % {config.workloadBalance.projectToTaskRatio + config.workloadBalance.oneOffTaskRatio + config.workloadBalance.bufferRatio !== 1 && '(Should total 100%)'}
          </p>
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex justify-between">
        <Button variant="outline" onClick={handleReset}>
          Reset to Defaults
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save Preferences'}
        </Button>
      </div>
    </div>
  );
};

export default SchedulingSettings;

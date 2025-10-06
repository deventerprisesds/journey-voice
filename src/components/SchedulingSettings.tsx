import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import {
  loadUserSchedulingConfig,
  saveUserSchedulingConfig,
} from '@/services/schedulingService';
import { DEFAULT_SCHEDULING_CONFIG, type SchedulingConfig } from '@/config/schedulingRules';
import { Clock, Calendar, TrendingUp, Tag, Key, Target, Plus, X, FileText, Globe } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { TIMEZONE_OPTIONS, getBrowserTimezone, formatTimezoneWithOffset } from '@/lib/timezone';

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
      {/* Timezone Settings - FIRST */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            <CardTitle>Timezone</CardTitle>
          </div>
          <CardDescription>
            Your timezone affects all task scheduling and reminders. Times will be displayed in this timezone.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Your Timezone</Label>
            <Select
              value={config.timezone}
              onValueChange={(value) => setConfig({ ...config, timezone: value })}
            >
              <SelectTrigger>
                <SelectValue>
                  {formatTimezoneWithOffset(config.timezone)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="max-h-[300px]">
                {TIMEZONE_OPTIONS.map((group) => (
                  <React.Fragment key={group.region}>
                    <div className="px-2 py-1.5 text-sm font-semibold text-muted-foreground">
                      {group.region}
                    </div>
                    {group.zones.map((zone) => (
                      <SelectItem key={zone} value={zone}>
                        {formatTimezoneWithOffset(zone)}
                      </SelectItem>
                    ))}
                  </React.Fragment>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const detected = getBrowserTimezone();
                setConfig({ ...config, timezone: detected });
                toast({
                  title: 'Timezone Detected',
                  description: `Set to ${detected}`,
                });
              }}
            >
              <Globe className="h-4 w-4 mr-2" />
              Detect Automatically
            </Button>
          </div>
        </CardContent>
      </Card>

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

      {/* Category Mappings */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Tag className="h-5 w-5" />
            <CardTitle>Category Mappings</CardTitle>
          </div>
          <CardDescription>
            Configure which time window, board lane, and duration each category uses
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {Object.entries(config.categoryMappings).map(([category, mapping]) => (
            <div key={category} className="space-y-3 p-4 border rounded-lg">
              <Label className="text-base font-medium">{category}</Label>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label className="text-sm">Time Window</Label>
                  <Select
                    value={mapping.defaultTimeWindow}
                    onValueChange={(value) =>
                      setConfig({
                        ...config,
                        categoryMappings: {
                          ...config.categoryMappings,
                          [category]: {
                            ...mapping,
                            defaultTimeWindow: value as keyof SchedulingConfig['timeWindows'],
                          },
                        },
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="morning">Morning</SelectItem>
                      <SelectItem value="business_hours">Business Hours</SelectItem>
                      <SelectItem value="after_work">After Work</SelectItem>
                      <SelectItem value="evening">Evening</SelectItem>
                      <SelectItem value="flexible">Flexible</SelectItem>
                      <SelectItem value="weekends">Weekends</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm">Board Lane</Label>
                  <Input
                    value={mapping.defaultStatus}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        categoryMappings: {
                          ...config.categoryMappings,
                          [category]: {
                            ...mapping,
                            defaultStatus: e.target.value,
                          },
                        },
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm">Duration (min)</Label>
                  <Input
                    type="number"
                    min="15"
                    max="480"
                    value={mapping.estimatedDuration}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        categoryMappings: {
                          ...config.categoryMappings,
                          [category]: {
                            ...mapping,
                            estimatedDuration: parseInt(e.target.value) || 60,
                          },
                        },
                      })
                    }
                  />
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Keyword Rules */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            <CardTitle>Keyword Detection Rules</CardTitle>
          </div>
          <CardDescription>
            Configure keywords that trigger specific time windows and board lanes
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            {Object.entries(config.contextRules.keywords).map(([keyword, [timeWindow, status]]) => (
              <div key={keyword} className="flex items-center gap-3 p-3 border rounded-lg">
                <Input
                  value={keyword}
                  onChange={(e) => {
                    const newKeywords = { ...config.contextRules.keywords };
                    delete newKeywords[keyword];
                    newKeywords[e.target.value] = [timeWindow, status];
                    setConfig({
                      ...config,
                      contextRules: {
                        ...config.contextRules,
                        keywords: newKeywords,
                      },
                    });
                  }}
                  className="flex-1"
                  placeholder="Keyword"
                />
                <Select
                  value={timeWindow}
                  onValueChange={(value) =>
                    setConfig({
                      ...config,
                      contextRules: {
                        ...config.contextRules,
                        keywords: {
                          ...config.contextRules.keywords,
                          [keyword]: [value, status],
                        },
                      },
                    })
                  }
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="morning">Morning</SelectItem>
                    <SelectItem value="business_hours">Business Hours</SelectItem>
                    <SelectItem value="after_work">After Work</SelectItem>
                    <SelectItem value="evening">Evening</SelectItem>
                    <SelectItem value="flexible">Flexible</SelectItem>
                    <SelectItem value="weekends">Weekends</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  value={status}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      contextRules: {
                        ...config.contextRules,
                        keywords: {
                          ...config.contextRules.keywords,
                          [keyword]: [timeWindow, e.target.value],
                        },
                      },
                    })
                  }
                  className="w-[140px]"
                  placeholder="Status"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    const newKeywords = { ...config.contextRules.keywords };
                    delete newKeywords[keyword];
                    setConfig({
                      ...config,
                      contextRules: {
                        ...config.contextRules,
                        keywords: newKeywords,
                      },
                    });
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setConfig({
                ...config,
                contextRules: {
                  ...config.contextRules,
                  keywords: {
                    ...config.contextRules.keywords,
                    [`new_keyword_${Date.now()}`]: ['flexible', 'LIFE'],
                  },
                },
              });
            }}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Keyword
          </Button>
        </CardContent>
      </Card>

      {/* Priority Mappings */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            <CardTitle>Priority Weight Multipliers</CardTitle>
          </div>
          <CardDescription>
            Configure how priority levels affect task scheduling weight
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {Object.entries(config.contextRules.priorityMappings).map(([priority, weight]) => (
            <div key={priority} className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="capitalize">{priority} Priority</Label>
                <span className="text-sm text-muted-foreground">×{weight}</span>
              </div>
              <Input
                type="number"
                min="0.1"
                max="10"
                step="0.1"
                value={weight}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    contextRules: {
                      ...config.contextRules,
                      priorityMappings: {
                        ...config.contextRules.priorityMappings,
                        [priority]: parseFloat(e.target.value) || 1,
                      },
                    },
                  })
                }
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Custom AI Instructions */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            <CardTitle>Custom AI Instructions</CardTitle>
          </div>
          <CardDescription>
            Add free-form instructions that will be sent to the AI scheduler.
            Example: "Schedule all education assignments after 5pm" or "Never schedule meetings before 10am"
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            value={config.customAIInstructions || ''}
            onChange={(e) => setConfig({ ...config, customAIInstructions: e.target.value })}
            placeholder="Enter custom scheduling rules here..."
            className="min-h-[150px] font-mono text-sm"
          />
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

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { format } from 'date-fns';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import {
  Sunrise, Coffee, Sunset, Moon, Calendar, Send, Sparkles,
  CheckCircle2, Clock, AlertTriangle, ArrowRight, SkipForward,
  Loader2, Info, BookOpen
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Task, ExternalCalendarEvent } from '@/types/task';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useChatAssistant } from '@/hooks/useChatAssistant';
import { getDefaultTimezone, getTodayInTimezone, formatTimeInTimezone } from '@/lib/date';
import { toast } from 'sonner';
import { buildDailyReviewReasoning } from '@/utils/dailyReviewPipeline';

interface DailyReviewModalProps {
  open: boolean;
  onClose: () => void;
  tasks: Task[];
  externalEvents: ExternalCalendarEvent[];
  onTaskUpdate: () => void;
}

const windowIcons: Record<string, React.ReactNode> = {
  morning: <Sunrise className="h-4 w-4" />,
  business_hours: <Coffee className="h-4 w-4" />,
  after_work: <Sunset className="h-4 w-4" />,
  evening: <Moon className="h-4 w-4" />,
  weekends: <Calendar className="h-4 w-4" />,
};

const priorityColors: Record<string, string> = {
  LOW: 'bg-primary/10 text-primary border-primary/20',
  MEDIUM: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  HIGH: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
  URGENT: 'bg-destructive/10 text-destructive border-destructive/20',
};

const DailyReviewModal: React.FC<DailyReviewModalProps> = ({
  open, onClose, tasks, externalEvents, onTaskUpdate
}) => {
  const { user } = useAuth();
  const { sendMessage, messages, isLoading: chatLoading } = useChatAssistant();
  const [chatInput, setChatInput] = useState('');
  const [isConfirming, setIsConfirming] = useState(false);
  const [builderLog, setBuilderLog] = useState<any>(null);

  const tz = getDefaultTimezone();
  const todayStr = getTodayInTimezone(tz);
  const isWeekend = new Date().getDay() === 0 || new Date().getDay() === 6;

  // Load latest nightly builder log from activity_log
  useEffect(() => {
    if (!open || !user?.id) return;
    (async () => {
      const { data } = await supabase
        .from('activity_log')
        .select('metadata')
        .eq('user_id', user.id)
        .eq('activity_type', 'nightly_schedule_built')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data?.metadata) setBuilderLog(data.metadata);
    })();
  }, [open, user?.id]);

  // Build reasoning via structured pipeline
  const reasoning = useMemo(() =>
    buildDailyReviewReasoning(tasks, externalEvents, builderLog, tz, todayStr, isWeekend, user?.id ?? null),
    [tasks, externalEvents, builderLog, todayStr, tz, isWeekend, user?.id]
  );

  // Today's scheduled tasks sorted by time
  const scheduledToday = useMemo(() =>
    tasks
      .filter(t => t.start_time && new Date(t.start_time).toLocaleDateString('en-CA', { timeZone: tz }) === todayStr)
      .sort((a, b) => new Date(a.start_time!).getTime() - new Date(b.start_time!).getTime()),
    [tasks, todayStr, tz]
  );

  // Handle confirm & fill gaps
  const handleConfirm = async () => {
    if (!user?.id) return;
    setIsConfirming(true);
    try {
      const { error } = await supabase.functions.invoke('nightly-schedule-builder', {
        body: { userId: user.id, singleDay: true }
      });
      if (error) throw error;
      await supabase
        .from('notification_prefs')
        .update({ schedule_confirmed_date: todayStr } as any)
        .eq('user_id', user.id);
      toast.success('Schedule confirmed — gaps filled');
      onTaskUpdate();
      onClose();
    } catch (e) {
      console.error('Confirm failed:', e);
      toast.error('Failed to confirm schedule');
    } finally {
      setIsConfirming(false);
    }
  };

  const handleSkip = async () => {
    if (!user?.id) return;
    await supabase
      .from('notification_prefs')
      .update({ schedule_confirmed_date: todayStr } as any)
      .eq('user_id', user.id);
    onClose();
  };

  const handleSendChat = async () => {
    if (!chatInput.trim()) return;
    const msg = chatInput.trim();
    setChatInput('');
    const contextPrefix = `[MORNING REVIEW CONTEXT]\nThe user is reviewing today's schedule (${todayStr}). Currently scheduled tasks: ${scheduledToday.map(t => `"${t.title}" at ${t.start_time ? formatTimeInTimezone(t.start_time, tz) : 'unset'}`).join(', ') || 'none'}. External events: ${externalEvents.map(e => `"${e.title}" ${formatTimeInTimezone(e.start_time, tz)}-${formatTimeInTimezone(e.end_time, tz)}`).join(', ') || 'none'}. Apply changes the user requests.\n\nUser message: `;
    await sendMessage(contextPrefix + msg);
    setTimeout(() => onTaskUpdate(), 2000);
  };

  // Track message count at modal open to filter out stale chat history
  const messageCountAtOpen = useRef(messages.length);
  useEffect(() => {
    if (open) {
      messageCountAtOpen.current = messages.length;
    }
  }, [open]);

  const recentAssistantMessages = messages
    .slice(messageCountAtOpen.current)
    .filter(m => m.role === 'assistant' && !m.isLoading);

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="bottom" className="h-[92vh] p-0 flex flex-col rounded-t-2xl">
        <SheetHeader className="px-4 pt-4 pb-2 border-b border-border shrink-0">
          <SheetTitle className="text-lg font-bold text-foreground">
            {reasoning.greeting}
          </SheetTitle>
          <p className="text-sm text-muted-foreground">
            {format(new Date(), 'EEEE, MMMM d')}
          </p>
        </SheetHeader>

        <ScrollArea className="flex-1 min-h-0">
          <div className="px-4 py-3 space-y-4">

            {/* Stats Row */}
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-card border border-border rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-foreground">{reasoning.stats.scheduledCount}</div>
                <div className="text-xs text-muted-foreground">Scheduled Today</div>
              </div>
              <div className="bg-card border border-border rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-foreground">{reasoning.stats.externalEventCount}</div>
                <div className="text-xs text-muted-foreground">Calendar Events</div>
              </div>
              {reasoning.stats.overdueCount > 0 && (
                <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-destructive">{reasoning.stats.overdueCount}</div>
                  <div className="text-xs text-destructive/80">Overdue Today</div>
                </div>
              )}
              {reasoning.stats.rolledOverCount > 0 && (
                <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-amber-600">{reasoning.stats.rolledOverCount}</div>
                  <div className="text-xs text-amber-600/80">Rolled Over Today</div>
                </div>
              )}
              {reasoning.stats.pendingAssignmentCount > 0 && (
                <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-primary">
                    {reasoning.stats.assignmentsScheduledToday}
                    <span className="text-sm font-normal text-muted-foreground">/{reasoning.stats.pendingAssignmentCount}</span>
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                    <BookOpen className="h-3 w-3" />
                    Assignments
                  </div>
                </div>
              )}
            </div>
            {reasoning.stats.backlogOverdue > 0 && (
              <p className="text-xs text-muted-foreground px-1">
                + {reasoning.stats.backlogOverdue} overdue task{reasoning.stats.backlogOverdue > 1 ? 's' : ''} in backlog (not scheduled today)
              </p>
            )}

            {/* Schedule Reasoning */}
            {(reasoning.explanations.length > 0 || reasoning.missingExplanations.length > 0) && (
              <div className="bg-muted/50 rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <Info className="h-4 w-4 text-primary" />
                  How we built today
                </div>
                {reasoning.explanations.map((exp, i) => (
                  <p key={i} className="text-xs text-muted-foreground pl-5">• {exp}</p>
                ))}
                {reasoning.missingExplanations.map((exp, i) => (
                  <p key={`m-${i}`} className="text-xs text-amber-600 dark:text-amber-400 pl-5">• {exp}</p>
                ))}
              </div>
            )}

            {/* Window Summaries */}
            <div className="space-y-1">
              <div className="text-sm font-medium text-foreground mb-2">Time Windows</div>
              {reasoning.windowSummaries.map(ws => (
                <div key={ws.window} className="py-1.5 px-2 rounded-md bg-card border border-border space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm text-foreground">
                      {windowIcons[ws.window]}
                      {ws.label}
                    </div>
                    <span className={cn(
                      "text-xs",
                      ws.taskCount > 0 ? "text-foreground" : "text-muted-foreground"
                    )}>
                      {ws.capacityNote}
                    </span>
                  </div>
                  {ws.taskCount > 0 && Object.keys(ws.categoryBreakdown).length > 0 && (
                    <div className="pl-6 text-xs text-muted-foreground">
                      {Object.entries(ws.categoryBreakdown).map(([cat, count]) => `${cat}(${count})`).join(', ')}
                    </div>
                  )}
                  {ws.missingCategories.length > 0 && (
                    <div className="pl-6 text-xs text-amber-600 dark:text-amber-400">
                      {ws.missingCategories.map(cat => `⚠ No ${cat} tasks placed`).join(' · ')}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* External Events */}
            {externalEvents.length > 0 && (
              <div className="space-y-1">
                <div className="text-sm font-medium text-foreground mb-2 flex items-center gap-1.5">
                  <Calendar className="h-4 w-4 text-primary" />
                  Calendar Events
                </div>
                {externalEvents.map(event => (
                  <div key={event.id} className="flex items-center gap-2 py-1.5 px-2 rounded-md bg-primary/5 border border-primary/10">
                    <div className="w-1 h-8 rounded-full bg-primary shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">{event.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatTimeInTimezone(event.start_time, tz)} – {formatTimeInTimezone(event.end_time, tz)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Today's Plan */}
            <div className="space-y-1">
              <div className="text-sm font-medium text-foreground mb-2">Today's Plan</div>
              {scheduledToday.length === 0 ? (
                <p className="text-sm text-muted-foreground italic px-2">No tasks scheduled yet</p>
              ) : (
                scheduledToday.map(task => {
                  const isAuto = !!(task.scheduling_context as any)?.pre_schedule_status;
                  return (
                    <div key={task.id} className="flex items-center gap-2 py-2 px-2 rounded-md bg-card border border-border">
                      <div className="shrink-0">
                        {task.status === 'DONE' ? (
                          <CheckCircle2 className="h-4 w-4 text-accent" />
                        ) : (
                          <Clock className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate">{task.title}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-xs text-muted-foreground">
                            {task.start_time ? formatTimeInTimezone(task.start_time, tz) : '—'}
                          </span>
                          {task.estimate_minutes && (
                            <span className="text-xs text-muted-foreground">· {task.estimate_minutes}m</span>
                          )}
                          <Badge variant="outline" className={cn("text-[10px] px-1 py-0 h-4", priorityColors[task.priority])}>
                            {task.priority}
                          </Badge>
                          {isAuto && (
                            <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 bg-primary/5 text-primary border-primary/20">
                              <Sparkles className="h-2.5 w-2.5 mr-0.5" />auto
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* AI Response Area */}
            {recentAssistantMessages.length > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-medium text-foreground">AI Response</div>
                {recentAssistantMessages.map(msg => (
                  <div key={msg.id} className="bg-primary/5 border border-primary/10 rounded-lg p-3">
                    <p className="text-sm text-foreground whitespace-pre-wrap">{msg.content}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Chat Input + Actions */}
        <div className="border-t border-border p-3 space-y-2 shrink-0 bg-background">
          <div className="flex gap-2">
            <Input
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSendChat()}
              placeholder="Tell me what to change..."
              className="flex-1 text-sm"
              disabled={chatLoading}
            />
            <Button size="icon" variant="ghost" onClick={handleSendChat} disabled={chatLoading || !chatInput.trim()}>
              {chatLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
          <div className="flex gap-2">
            <Button
              className="flex-1"
              onClick={handleConfirm}
              disabled={isConfirming}
            >
              {isConfirming ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Sparkles className="h-4 w-4 mr-1" />
              )}
              Confirm & Fill Gaps
            </Button>
            <Button variant="outline" onClick={handleSkip}>
              <SkipForward className="h-4 w-4 mr-1" />
              Skip
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default DailyReviewModal;

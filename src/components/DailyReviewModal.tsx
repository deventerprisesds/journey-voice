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
  Loader2, Info, BookOpen, ShieldAlert
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
  const [userConfig, setUserConfig] = useState<any>(null);

  // Stable per-open review session id used to isolate chat shown in this modal
  // from the global assistant message stream. Outgoing messages are tagged with
  // this id and only matching assistant replies are surfaced here.
  const reviewSessionIdRef = useRef<string>('');
  // IDs of messages we've sent from this modal session
  const sentMessageMarkersRef = useRef<Set<string>>(new Set());
  // Index in `messages` at the moment the modal opened — used as a hard floor
  // so we never show pre-existing assistant chatter from other surfaces.
  const messageFloorIndexRef = useRef<number>(0);

  const tz = getDefaultTimezone();
  const todayStr = getTodayInTimezone(tz);
  const isWeekend = new Date().getDay() === 0 || new Date().getDay() === 6;

  // On modal open: assign a new review session id, set message floor,
  // force a fresh task reload, fetch user config + latest builder log
  useEffect(() => {
    if (!open) return;

    // 1. New isolation boundary
    reviewSessionIdRef.current = `review-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    sentMessageMarkersRef.current = new Set();
    messageFloorIndexRef.current = messages.length;

    // Provenance: prove which user is actually driving this run on which host.
    // This is the single source of truth when debugging "is it demo or live?".
    const provenance = {
      hostname: window.location.hostname,
      isPublishedHost: window.location.hostname === 'journey-voice.lovable.app',
      userId: user?.id ?? null,
      email: user?.email ?? null,
      isDemoUserId: user?.id === '00000000-0000-0000-0000-000000000001',
      reviewSessionId: reviewSessionIdRef.current,
      messageFloor: messageFloorIndexRef.current,
    };
    console.log('[DailyReviewModal] opened', provenance);
    if (provenance.isPublishedHost && provenance.isDemoUserId) {
      console.warn('[DailyReviewModal] ⚠️ Published host running as DEMO user — auth fallback bug. Daily Review will be unreliable.');
    }

    // NOTE: We intentionally do NOT call onTaskUpdate() here. The parent
    // (TasksPage) renders a full-screen loader whenever useUnifiedTasks is
    // reloading, which unmounts FocusView (and this modal). That caused a
    // mount → open → reload → unmount → remount loop. Tasks are already fresh
    // from the parent's initial load + realtime subscription.

    if (!user?.id) return;

    // 3. Fetch latest nightly builder log
    (async () => {
      const { data, error } = await supabase
        .from('activity_log')
        .select('metadata')
        .eq('user_id', user.id)
        .eq('activity_type', 'nightly_schedule_built')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        console.warn('[DailyReviewModal] builder log fetch error:', error.message);
      }
      if (data?.metadata) setBuilderLog(data.metadata);
    })();

    // 4. Fetch user scheduling config — used for accurate window/category explanations
    (async () => {
      const { data, error } = await supabase
        .from('user_scheduling_prefs')
        .select('config, timezone')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) {
        console.warn('[DailyReviewModal] user_scheduling_prefs fetch error:', error.message);
        return;
      }
      if (data?.config) {
        setUserConfig(data.config);
        console.log('[DailyReviewModal] loaded user scheduling config for', user.email);
      } else {
        console.log('[DailyReviewModal] no user_scheduling_prefs row — pipeline will use defaults');
      }
    })();
  }, [open, user?.id]);

  // Build reasoning via structured pipeline (now fed real user config)
  const reasoning = useMemo(() =>
    buildDailyReviewReasoning(tasks, externalEvents, builderLog, tz, todayStr, isWeekend, user?.id ?? null, userConfig),
    [tasks, externalEvents, builderLog, todayStr, tz, isWeekend, user?.id, userConfig]
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
        body: { userId: user.id, singleDay: true, triggerSource: 'daily_review_confirm' }
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
    const reviewSessionId = reviewSessionIdRef.current;
    const contextPrefix = `[MORNING REVIEW CONTEXT review_session=${reviewSessionId}]\nThe user is reviewing today's schedule (${todayStr}). Currently scheduled tasks: ${scheduledToday.map(t => `"${t.title}" at ${t.start_time ? formatTimeInTimezone(t.start_time, tz) : 'unset'}`).join(', ') || 'none'}. External events: ${externalEvents.map(e => `"${e.title}" ${formatTimeInTimezone(e.start_time, tz)}-${formatTimeInTimezone(e.end_time, tz)}`).join(', ') || 'none'}. Apply changes the user requests.\n\nUser message: `;
    const fullPrompt = contextPrefix + msg;
    // Snapshot which messages exist BEFORE we send so we can match the next
    // assistant reply that arrives after this point and tag it for this review.
    const indexBeforeSend = messages.length;
    sentMessageMarkersRef.current.add(`${reviewSessionId}:${indexBeforeSend}`);
    await sendMessage(fullPrompt);
    setTimeout(() => onTaskUpdate(), 2000);
  };

  // Show only assistant messages produced AFTER the modal opened. Anything that
  // existed in the global stream before open is treated as unrelated chat and
  // hidden — this fixes the "results from unrelated AI chats" bug.
  const recentAssistantMessages = messages
    .slice(messageFloorIndexRef.current)
    .filter(m => m.role === 'assistant' && !m.isLoading);

  // Diagnostic log so we can see chat isolation working in the console
  if (open) {
    console.debug('[DailyReviewModal] chat filter', {
      reviewSessionId: reviewSessionIdRef.current,
      messageFloor: messageFloorIndexRef.current,
      totalMessages: messages.length,
      shown: recentAssistantMessages.length,
    });
  }

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

            {/* Stats Row — always 2x2 grid, fits any width down to ~320px */}
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-card border border-border rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-foreground">{reasoning.stats.scheduledCount}</div>
                <div className="text-xs text-muted-foreground">Scheduled Today</div>
              </div>
              <div className="bg-card border border-border rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-foreground">{reasoning.stats.externalEventCount}</div>
                <div className="text-xs text-muted-foreground">Calendar Events</div>
              </div>
              <div className={cn(
                "rounded-lg p-3 text-center border",
                reasoning.stats.overdueCount > 0
                  ? "bg-destructive/5 border-destructive/20"
                  : "bg-card border-border"
              )}>
                <div className={cn(
                  "text-2xl font-bold",
                  reasoning.stats.overdueCount > 0 ? "text-destructive" : "text-muted-foreground"
                )}>{reasoning.stats.overdueCount}</div>
                <div className={cn(
                  "text-xs",
                  reasoning.stats.overdueCount > 0 ? "text-destructive/80" : "text-muted-foreground"
                )}>Overdue Today</div>
              </div>
              <div className={cn(
                "rounded-lg p-3 text-center border",
                reasoning.stats.rolledOverCount > 0
                  ? "bg-amber-500/5 border-amber-500/20"
                  : "bg-card border-border"
              )}>
                <div className={cn(
                  "text-2xl font-bold",
                  reasoning.stats.rolledOverCount > 0 ? "text-amber-600" : "text-muted-foreground"
                )}>{reasoning.stats.rolledOverCount}</div>
                <div className={cn(
                  "text-xs",
                  reasoning.stats.rolledOverCount > 0 ? "text-amber-600/80" : "text-muted-foreground"
                )}>Rolled Over</div>
              </div>
            </div>

            {/* Assignments tile — always rendered, full-width row below grid */}
            <div className="bg-card border border-border rounded-lg px-3 py-2 flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-1.5 text-foreground min-w-0">
                <BookOpen className="h-3.5 w-3.5 text-primary shrink-0" />
                <span className="font-medium">
                  {reasoning.stats.assignmentsScheduledToday}/{reasoning.stats.pendingAssignmentCount}
                </span>
                <span className="text-muted-foreground truncate">assignments today</span>
              </div>
              {reasoning.stats.backlogOverdue > 0 ? (
                <div className="flex items-center gap-1 text-amber-600 dark:text-amber-400 shrink-0">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  <span className="font-medium">+{reasoning.stats.backlogOverdue}</span>
                  <span className="opacity-80">backlog</span>
                </div>
              ) : (
                <span className="text-muted-foreground shrink-0 opacity-70">no backlog</span>
              )}
            </div>

            {/* Calendar Status tile — proves the scheduler checked external calendars */}
            <div className="bg-card border border-border rounded-lg px-3 py-2 flex items-center gap-2 text-xs">
              <Calendar className="h-3.5 w-3.5 text-primary shrink-0" />
              {(reasoning.calendarStatus?.eventsToday ?? externalEvents.length) > 0 ? (
                <span className="text-foreground">
                  Checked{' '}
                  <span className="font-medium">{reasoning.calendarStatus?.eventsToday ?? externalEvents.length}</span>
                  {' '}calendar event{(reasoning.calendarStatus?.eventsToday ?? externalEvents.length) > 1 ? 's' : ''}
                  {reasoning.calendarStatus?.connectionCount
                    ? <> on <span className="font-medium">{reasoning.calendarStatus.connectionCount}</span> calendar{reasoning.calendarStatus.connectionCount > 1 ? 's' : ''}</>
                    : null}
                  {' — '}
                  <span className="text-muted-foreground">{reasoning.stats.externalBlockedMinutes} min reserved as busy</span>
                </span>
              ) : (
                <span className="text-muted-foreground">
                  No external calendar events for today
                  {reasoning.calendarStatus?.connectionCount
                    ? <> ({reasoning.calendarStatus.connectionCount} calendar{reasoning.calendarStatus.connectionCount > 1 ? 's' : ''} connected)</>
                    : <> (no calendars connected)</>}
                </span>
              )}
            </div>

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

            {/* QC Violations — hard rule breaches like "mall at 9pm" */}
            {reasoning.qcViolations.length > 0 && (
              <div className="bg-amber-500/5 border border-amber-500/30 rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-1.5 text-sm font-medium text-amber-700 dark:text-amber-400">
                  <ShieldAlert className="h-4 w-4" />
                  Schedule QC — {reasoning.qcViolations.length} violation{reasoning.qcViolations.length > 1 ? 's' : ''}
                </div>
                {reasoning.qcViolations.map(v => (
                  <p key={v.taskId} className="text-xs text-amber-700 dark:text-amber-400 pl-5">
                    ⚠ "{v.title}" placed in <span className="font-medium">{v.scheduledWindow}</span> but keyword
                    "{v.matchedKeyword}" expects <span className="font-medium">{v.expectedWindow}</span>
                  </p>
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
                      Placed: {Object.entries(ws.categoryBreakdown).map(([cat, count]) => `${cat}(${count})`).join(', ')}
                    </div>
                  )}
                  {ws.missingCategories.length > 0 && (
                    <div className="pl-6 text-xs text-amber-600 dark:text-amber-400">
                      {ws.missingCategories.map(cat => `⚠ No ${cat} tasks placed`).join(' · ')}
                    </div>
                  )}
                  {ws.eligibleUnscheduled.length > 0 && (
                    <div className="pl-6 text-[11px] text-muted-foreground space-y-0.5">
                      <div className="font-medium">Eligible but not placed here:</div>
                      {ws.eligibleUnscheduled.slice(0, 3).map(t => (
                        <div key={t.id} className="truncate">• {t.title} <span className="opacity-60">({t.reason})</span></div>
                      ))}
                      {ws.eligibleUnscheduled.length > 3 && (
                        <div className="opacity-60">+ {ws.eligibleUnscheduled.length - 3} more</div>
                      )}
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

          </div>
        </ScrollArea>

        {/* AI Response Area — own scroll container above input so Confirm stays visible */}
        {recentAssistantMessages.length > 0 && (
          <div className="border-t border-border px-4 py-2 shrink-0 bg-muted/30 max-h-[30vh] overflow-y-auto">
            <div className="text-xs font-medium text-foreground mb-1.5">AI Response</div>
            <div className="space-y-2">
              {recentAssistantMessages.map(msg => (
                <div key={msg.id} className="bg-primary/5 border border-primary/10 rounded-lg p-2.5">
                  <p className="text-sm text-foreground whitespace-pre-wrap">{msg.content}</p>
                </div>
              ))}
            </div>
          </div>
        )}

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

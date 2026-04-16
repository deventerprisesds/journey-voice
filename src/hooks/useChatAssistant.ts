import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { logRealtime, logChat } from '@/utils/activityLogger';

// ── Interactive content types (aligned with call-context-builder patterns) ──

export interface InteractiveContent {
  type: 'topic_selection' | 'task_selection' | 'confirmation';
  topics?: Array<{ topic_name: string; task_count: number; priority_density: number }>;
  tasks?: Array<{ id: string; title: string; priority: string; status: string; category: string }>;
  selectedTopicName?: string;
  scheduledCount?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isLoading?: boolean;
  interactive?: InteractiveContent;
}

// Window detection moved to server-side (call-context-builder.ts is the single source of truth)
// Kept minimal client-side version only for startWindowCheckIn UI hints
import { detectCurrentWindow, getWindowCategories } from '@/lib/timeWindows';

interface UseChatAssistantReturn {
  messages: ChatMessage[];
  isLoading: boolean;
  threadId: string | null;
  sendMessage: (content: string) => Promise<void>;
  createNewThread: () => Promise<void>;
  loadThread: (threadId: string) => Promise<void>;
  startWindowCheckIn: () => Promise<void>;
  selectTopic: (topicName: string) => Promise<void>;
  scheduleSelectedTasks: (taskIds: string[]) => Promise<void>;
}

export function useChatAssistant(): UseChatAssistantReturn {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  
  const [realtimeStatus, setRealtimeStatus] = useState<string>('idle');
  const subscribeStartTimeRef = useRef<number | null>(null);

  // ── Agenda state for tangent tracking (mirrors phone/voice SharedAgendaManager) ──
  const activeAgendaThreadId = useRef<string | null>(null);
  const agendaStep = useRef<'topic_selection' | 'task_selection' | 'scheduling' | null>(null);
  const lastInteractiveContent = useRef<InteractiveContent | null>(null);
  const checkInTaskContext = useRef<string | null>(null);

  const userId = user?.id || null;

  // ── Agenda manager helper ──
  const callAgendaManager = useCallback(async (operation: string, params: Record<string, unknown> = {}) => {
    if (!user) return null;
    const { data, error } = await supabase.functions.invoke('agenda-manager', {
      body: {
        operation,
        threadId: activeAgendaThreadId.current,
        userId: user.id,
        ...params
      }
    });
    if (error) {
      console.error(`[useChatAssistant] agenda-manager ${operation} error:`, error);
      return null;
    }
    return data;
  }, [user]);

  // Load or create thread on mount
  useEffect(() => {
    if (user) {
      loadOrCreateThread();
    }
  }, [user]);

  const loadOrCreateThread = async () => {
    if (!user) return;

    try {
      const { data: defaultAssistant } = await supabase
        .from('assistants')
        .select('id')
        .eq('user_id', user.id)
        .eq('is_default', true)
        .maybeSingle();
      
      const assistantId = defaultAssistant?.id || null;

      const { data: existingThread } = await supabase
        .from('ai_threads')
        .select('id, openai_thread_id')
        .eq('user_id', user.id)
        .eq('assistant_id', assistantId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingThread) {
        setThreadId(existingThread.id);
        await loadMessages(existingThread.id);
      } else {
        await createNewThread(assistantId);
      }
    } catch (error) {
      console.error('Error loading thread:', error);
    }
  };

  const loadMessages = async (threadIdToLoad: string) => {
    try {
      const { data: storedMessages } = await supabase
        .from('conversation_messages')
        .select('*')
        .eq('thread_id', threadIdToLoad)
        .order('created_at', { ascending: true });

      if (storedMessages) {
        setMessages(storedMessages.map(msg => ({
          id: msg.id,
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
          timestamp: new Date(msg.created_at)
        })));
      }
    } catch (error) {
      console.error('Error loading messages:', error);
    }
  };

  // Realtime subscription
  useEffect(() => {
    if (!userId || !threadId) {
      if (!userId) console.log('[useChatAssistant] Realtime: No userId, skipping subscription');
      if (userId && !threadId) {
        console.log('[useChatAssistant] Realtime: No threadId yet, waiting...');
        logRealtime(userId, 'waiting_for_thread', 'started', { source: 'useChatAssistant' });
      }
      return;
    }

    console.log('[useChatAssistant] Realtime: Setting up subscription for thread:', threadId);
    
    subscribeStartTimeRef.current = Date.now();
    setRealtimeStatus('subscribing');
    logRealtime(userId, 'setup', 'started', { threadId, source: 'useChatAssistant' });

    const channel = supabase
      .channel(`chat-assistant-${threadId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'conversation_messages',
          filter: `thread_id=eq.${threadId}`,
        },
        (payload) => {
          const newMessage = payload.new as any;
          console.log('[useChatAssistant] Realtime message received:', newMessage.id);
          
          logChat(userId, 'realtime_received', 'completed', {
            messageId: newMessage.id,
            role: newMessage.role,
            source: 'useChatAssistant',
            threadId
          });

          setMessages(prev => {
            if (prev.some(m => m.id === newMessage.id)) return prev;
            return [...prev, {
              id: newMessage.id,
              role: newMessage.role as 'user' | 'assistant',
              content: newMessage.content,
              timestamp: new Date(newMessage.created_at),
              isLoading: false
            }];
          });
        }
      )
      .subscribe((status) => {
        const elapsedMs = subscribeStartTimeRef.current
          ? Date.now() - subscribeStartTimeRef.current
          : null;
          
        console.log('[useChatAssistant] Realtime subscription status:', status);
        setRealtimeStatus(status);
        
        logRealtime(
          userId,
          status === 'SUBSCRIBED' ? 'subscribed' : `status_${status}`,
          status === 'SUBSCRIBED' ? 'completed' : 'started',
          { status, threadId, elapsedMs, source: 'useChatAssistant' },
          status === 'CHANNEL_ERROR' ? `Subscription failed: ${status}` : undefined
        );
      });

    return () => {
      console.log('[useChatAssistant] Realtime: Cleaning up subscription for thread:', threadId);
      logRealtime(userId, 'cleanup', 'completed', { threadId, source: 'useChatAssistant' });
      supabase.removeChannel(channel);
      setRealtimeStatus('idle');
    };
  }, [threadId, userId]);

  // Realtime watchdog
  useEffect(() => {
    if (realtimeStatus !== 'subscribing') return;
    const timeout = setTimeout(() => {
      if (realtimeStatus === 'subscribing') {
        logRealtime(userId, 'timeout', 'error', { threadId, source: 'useChatAssistant' }, 'Subscription not SUBSCRIBED after 5 seconds');
        console.warn('[useChatAssistant] Realtime: Subscription timeout');
      }
    }, 5000);
    return () => clearTimeout(timeout);
  }, [realtimeStatus, userId, threadId]);

  const createNewThread = useCallback(async (assistantId?: string | null) => {
    if (!user) return;

    try {
      let finalAssistantId = assistantId;
      if (finalAssistantId === undefined) {
        const { data: defaultAssistant } = await supabase
          .from('assistants')
          .select('id')
          .eq('user_id', user.id)
          .eq('is_default', true)
          .maybeSingle();
        finalAssistantId = defaultAssistant?.id || null;
      }

      // FIX: ai_threads has a unique constraint on user_id (ai_threads_user_id_key),
      // so a per-user single-row design is enforced at the DB level. Trying to
      // INSERT a second row throws 23505 ("duplicate key") and silently breaks
      // the chat experience. Instead, look up any existing thread for this user
      // first and reuse it; only insert when truly absent.
      const { data: anyExisting } = await supabase
        .from('ai_threads')
        .select('id, assistant_id')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (anyExisting) {
        setThreadId(anyExisting.id);
        await loadMessages(anyExisting.id);
        return;
      }

      const { data: newThread, error } = await supabase
        .from('ai_threads')
        .insert({
          user_id: user.id,
          assistant_id: finalAssistantId,
          openai_thread_id: ''
        })
        .select()
        .single();

      if (error) {
        // Race condition fallback: another tab inserted between our check and
        // insert. Re-read and reuse instead of surfacing a 23505 error.
        if ((error as any).code === '23505') {
          const { data: raced } = await supabase
            .from('ai_threads')
            .select('id')
            .eq('user_id', user.id)
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (raced) {
            setThreadId(raced.id);
            await loadMessages(raced.id);
            return;
          }
        }
        throw error;
      }

      setThreadId(newThread.id);
      setMessages([]);
    } catch (error) {
      console.error('Error creating thread:', error);
    }
  }, [user]);

  const loadThread = useCallback(async (id: string) => {
    setThreadId(id);
    await loadMessages(id);
  }, []);

  // ── Interactive check-in functions ────────────────────────────────

  const startWindowCheckIn = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);

    try {
      const window = detectCurrentWindow();
      const windowCategories = getWindowCategories(window);

      // Fetch topic groups (same pattern as getTopicGroupsManual in call-context-builder)
      let query = supabase
        .from('tasks')
        .select('id, title, category, priority, updated_at')
        .eq('user_id', user.id)
        .neq('status', 'BLOCKED')
        .neq('status', 'DONE')
        .not('title', 'ilike', '%test%');

      if (windowCategories.length > 0) {
        query = query.in('category', windowCategories as any);
      }

      const { data: tasks } = await query;

      let topics: InteractiveContent['topics'] = [];

      if (tasks && tasks.length > 0) {
        const taskIds = tasks.map(t => t.id);
        const { data: mappings } = await supabase
          .from('task_topic_mappings')
          .select('task_id, topic_id')
          .in('task_id', taskIds);

        if (mappings && mappings.length > 0) {
          const topicIds = [...new Set(mappings.map(m => m.topic_id))];
          const { data: topicRows } = await supabase
            .from('task_topic_index')
            .select('id, topic_name')
            .in('id', topicIds);

          if (topicRows) {
            const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
            const taskMap = new Map(tasks.map(t => [t.id, t]));
            const topicTaskMap = new Map<string, string[]>();
            for (const m of mappings) {
              if (!topicTaskMap.has(m.topic_id)) topicTaskMap.set(m.topic_id, []);
              topicTaskMap.get(m.topic_id)!.push(m.task_id);
            }

            topics = topicRows.map(topic => {
              const tIds = topicTaskMap.get(topic.id) || [];
              const topicTasks = tIds.map(id => taskMap.get(id)).filter(Boolean);
              const priorityDensity = topicTasks.filter((t: any) => t.priority === 'HIGH' || t.priority === 'URGENT').length;
              return {
                topic_name: topic.topic_name,
                task_count: topicTasks.length,
                priority_density: priorityDensity
              };
            })
            .sort((a, b) => b.priority_density - a.priority_density || b.task_count - a.task_count)
            .slice(0, 6);
          }
        }
      }

      // Tier-2 fallback: all topics if window-specific is empty
      if (topics.length === 0) {
        const { data: allTasks } = await supabase
          .from('tasks')
          .select('id, title, category, priority, updated_at')
          .eq('user_id', user.id)
          .neq('status', 'BLOCKED')
          .neq('status', 'DONE')
          .not('title', 'ilike', '%test%');

        if (allTasks && allTasks.length > 0) {
          const allTaskIds = allTasks.map(t => t.id);
          const { data: allMappings } = await supabase
            .from('task_topic_mappings')
            .select('task_id, topic_id')
            .in('task_id', allTaskIds);

          if (allMappings && allMappings.length > 0) {
            const allTopicIds = [...new Set(allMappings.map(m => m.topic_id))];
            const { data: allTopicRows } = await supabase
              .from('task_topic_index')
              .select('id, topic_name')
              .in('id', allTopicIds);

            if (allTopicRows) {
              const taskMap = new Map(allTasks.map(t => [t.id, t]));
              const topicTaskMap = new Map<string, string[]>();
              for (const m of allMappings) {
                if (!topicTaskMap.has(m.topic_id)) topicTaskMap.set(m.topic_id, []);
                topicTaskMap.get(m.topic_id)!.push(m.task_id);
              }

              topics = allTopicRows.map(topic => {
                const tIds = topicTaskMap.get(topic.id) || [];
                const topicTasks = tIds.map(id => taskMap.get(id)).filter(Boolean);
                const priorityDensity = topicTasks.filter((t: any) => t.priority === 'HIGH' || t.priority === 'URGENT').length;
                return {
                  topic_name: topic.topic_name,
                  task_count: topicTasks.length,
                  priority_density: priorityDensity
                };
              })
              .sort((a, b) => b.priority_density - a.priority_density || b.task_count - a.task_count)
              .slice(0, 6);
            }
          }
        }
      }

      const windowLabel = window.replace('_', ' ');
      const content = topics.length > 0
        ? `What would you like to focus on during ${windowLabel}? Here are your topic groups:`
        : `You don't have any topic groups right now. Try creating some tasks first!`;

      // ── Wire agenda-manager: initialize + start_item(0) ──
      if (topics.length > 0 && threadId) {
        activeAgendaThreadId.current = threadId;
        agendaStep.current = 'topic_selection';
        const interactivePayload: InteractiveContent = { type: 'topic_selection', topics };
        lastInteractiveContent.current = interactivePayload;

        await callAgendaManager('initialize', {
          context: '1. Select topic group\n2. Select tasks from topic\n3. Schedule selected tasks',
          source: 'chat_checkin'
        });
        await callAgendaManager('start_item', { itemIndex: 0 });
      }

      // Store check-in context for grounding follow-up messages
      if (topics.length > 0) {
        checkInTaskContext.current = `Window: ${windowLabel}. Topics presented: ${topics.map(t => `${t.topic_name} (${t.task_count} tasks, ${t.priority_density} urgent)`).join(', ')}`;
      }

      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content,
        timestamp: new Date(),
        interactive: topics.length > 0 ? { type: 'topic_selection', topics } : undefined
      }]);
    } catch (error) {
      console.error('Error starting window check-in:', error);
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'Sorry, I had trouble loading your topics. Please try again.',
        timestamp: new Date()
      }]);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  const selectTopic = useCallback(async (topicName: string) => {
    if (!user) return;
    setIsLoading(true);

    // Add user selection message
    setMessages(prev => [...prev, {
      id: crypto.randomUUID(),
      role: 'user',
      content: topicName,
      timestamp: new Date()
    }]);

    try {
      const { data, error } = await supabase.functions.invoke('execute-tool', {
        body: {
          toolName: 'get_tasks_by_topic',
          args: { topic_name: topicName },
          userId: user.id,
          context: { interface: 'chat', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }
        }
      });

      if (error) throw error;

      const tasks: InteractiveContent['tasks'] = (data?.tasks || []).map((t: any) => ({
        id: t.id,
        title: t.title,
        priority: t.priority || 'MEDIUM',
        status: t.status || 'TODO',
        category: t.category || ''
      }));

      const content = tasks.length > 0
        ? `Here are the tasks under "${topicName}". Select which ones you'd like to schedule:`
        : `I don't have any active tasks under "${topicName}" right now.`;

      // ── Wire agenda-manager: complete topic selection, advance to task selection ──
      if (activeAgendaThreadId.current) {
        await callAgendaManager('complete_item', {});
        agendaStep.current = 'task_selection';
        if (tasks.length > 0) {
          lastInteractiveContent.current = { type: 'task_selection', tasks, selectedTopicName: topicName };
          // Enrich check-in context with task details
          checkInTaskContext.current = `Topic: ${topicName}. Tasks: ${tasks.map(t => `${t.title} (${t.priority})`).join(', ')}`;
        }
      }

      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content,
        timestamp: new Date(),
        interactive: tasks.length > 0 ? { type: 'task_selection', tasks, selectedTopicName: topicName } : undefined
      }]);
    } catch (error) {
      console.error('Error fetching topic tasks:', error);
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'Sorry, I had trouble loading those tasks. Please try again.',
        timestamp: new Date()
      }]);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  const scheduleSelectedTasks = useCallback(async (taskIds: string[]) => {
    if (!user || taskIds.length === 0) return;
    setIsLoading(true);

    setMessages(prev => [...prev, {
      id: crypto.randomUUID(),
      role: 'user',
      content: `Schedule ${taskIds.length} selected task${taskIds.length > 1 ? 's' : ''}`,
      timestamp: new Date()
    }]);

    try {
      // Use execute-tool with schedule_task for each task
      let successCount = 0;
      for (const taskId of taskIds) {
        const { error } = await supabase.functions.invoke('execute-tool', {
          body: {
            toolName: 'schedule_task',
            args: { task_id: taskId },
            userId: user.id,
            context: { interface: 'chat', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }
          }
        });
        if (!error) successCount++;
      }

      // ── Wire agenda-manager: complete remaining items and clear ──
      if (activeAgendaThreadId.current && successCount > 0) {
        await callAgendaManager('complete_item', {}); // completes "Select tasks"
        await callAgendaManager('complete_item', {}); // completes "Schedule selected tasks"
        activeAgendaThreadId.current = null;
        agendaStep.current = null;
        lastInteractiveContent.current = null;
        checkInTaskContext.current = null;
      }

      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: successCount > 0
          ? `Got it — scheduled ${successCount} task${successCount > 1 ? 's' : ''} for this window. ✅`
          : 'I had trouble scheduling those tasks. Please try again.',
        timestamp: new Date(),
        interactive: successCount > 0 ? { type: 'confirmation', scheduledCount: successCount } : undefined
      }]);
    } catch (error) {
      console.error('Error scheduling tasks:', error);
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'Sorry, scheduling failed. Please try again.',
        timestamp: new Date()
      }]);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  const sendMessage = useCallback(async (content: string) => {
    if (!user || !threadId || !content.trim()) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: content.trim(),
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);

    const loadingId = crypto.randomUUID();
    setMessages(prev => [...prev, {
      id: loadingId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isLoading: true
    }]);

    // ── Reusable push helper (covers success + error paths) ──
    const maybeSendPush = async (messageContent: string, messageId: string, trigger: 'success' | 'error') => {
      const isHidden = document.visibilityState === 'hidden';
      logChat(user.id, `push_decision_${trigger}`, isHidden ? 'started' : 'completed', {
        visibilityState: document.visibilityState,
        action: isHidden ? 'sending_push' : 'skipped_visible',
        threadId,
        messageId
      });

      if (!isHidden) return;

      try {
        await supabase.functions.invoke('send-push-notification', {
          body: {
            userId: user.id,
            title: 'Iris',
            body: messageContent.substring(0, 100) + (messageContent.length > 100 ? '...' : ''),
            data: {
              type: 'chat_message',
              openCommsConsole: true,
              threadId,
              messageId,
              messageData: {
                id: messageId,
                role: 'assistant',
                content: messageContent,
                source: 'chat',
                created_at: new Date().toISOString(),
                thread_id: threadId
              }
            }
          }
        });
        console.log(`[useChatAssistant] Push sent (${trigger}, user away)`);
      } catch (pushErr) {
        console.warn(`[useChatAssistant] Push failed (${trigger}):`, pushErr);
      }
    };

    try {
      // ── Tangent detection: pause agenda if active ──
      const isAgendaActive = !!activeAgendaThreadId.current;
      if (isAgendaActive) {
        await callAgendaManager('pause_for_tangent', { userQuery: content.trim() });
      }

      // User message is now saved server-side by hybrid-assistant-api
      // Just display it optimistically in the UI (already done above with userMessage)

      // Build grounded userInput when agenda is active
      let groundedInput = content.trim();
      if (isAgendaActive) {
        const stepLabel = agendaStep.current || 'unknown';
        const lastContent = lastInteractiveContent.current;
        const lastContentDesc = lastContent?.type === 'topic_selection'
          ? `topic selection chips (${lastContent.topics?.map(t => t.topic_name).join(', ')})`
          : lastContent?.type === 'task_selection'
            ? `task checklist for "${lastContent.selectedTopicName}" (${lastContent.tasks?.map(t => t.title).join(', ')})`
            : 'a confirmation';
        const taskContext = checkInTaskContext.current || 'No specific task context stored.';

        groundedInput = `[ACTIVE CHECK-IN CONTEXT]
The user is currently in the "${stepLabel}" step of their check-in.
The assistant just presented: ${lastContentDesc}.
Check-in context: ${taskContext}
The user's message below is likely a follow-up question about this check-in.
Do NOT execute any task modification tools (unschedule_task, update_task, move_to_backlog, etc.) unless the user EXPLICITLY asks you to change something.
Respond conversationally based on the current check-in context.

User message: ${content.trim()}`;
      }

      const { data, error } = await supabase.functions.invoke('hybrid-assistant-api', {
        body: {
          userInput: groundedInput,
          userId: user.id,
          threadId: threadId
        }
      });

      if (error) throw error;

      const assistantContent = data?.response || 'I apologize, but I couldn\'t process your request.';
      const assistantMessageId = data?.assistantMessageId || loadingId;

      // Update the loading placeholder with the real response
      // Messages are saved server-side; realtime subscription handles deduplication
      setMessages(prev => prev.map(msg => 
        msg.id === loadingId 
          ? { 
              id: assistantMessageId, 
              role: 'assistant' as const, 
              content: assistantContent, 
              timestamp: new Date(),
              isLoading: false 
            }
          : msg
      ));

      // Push notification if user left while AI was thinking
      await maybeSendPush(assistantContent, assistantMessageId, 'success');

      // ── Tangent recovery: resume agenda and re-present interactive UI ──
      if (isAgendaActive && lastInteractiveContent.current) {
        const resumeData = await callAgendaManager('get_resume_hint', {});
        if (resumeData?.hint) {
          await callAgendaManager('resume', {});
          setMessages(prev => [...prev, {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: resumeData.hint,
            timestamp: new Date(),
            interactive: lastInteractiveContent.current || undefined
          }]);
        }
      }

      // Thread timestamp is now updated server-side

    } catch (error) {
      const errorContent = 'I may still be processing your request. Check back shortly.';
      setMessages(prev => prev.filter(msg => msg.id !== loadingId));
      const errorMsgId = crypto.randomUUID();
      setMessages(prev => [...prev, {
        id: errorMsgId,
        role: 'assistant',
        content: errorContent,
        timestamp: new Date()
      }]);

      // Push notification on error path so user knows the request failed
      await maybeSendPush(errorContent, errorMsgId, 'error');
    } finally {
      setIsLoading(false);
    }
  }, [user, threadId, callAgendaManager]);

  return {
    messages,
    isLoading,
    threadId,
    sendMessage,
    createNewThread,
    loadThread,
    startWindowCheckIn,
    selectTopic,
    scheduleSelectedTasks
  };
}

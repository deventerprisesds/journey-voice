
# Round 3: Feature Module Documentation

Create the final 4 documentation files covering individual feature subsystems.

## Files to Create

### 1. `docs/TASK_MANAGEMENT.md`
- Task type system (12 statuses, 4 priorities, 6 categories)
- Kanban board with drag-and-drop (@hello-pangea/dnd), columns, boards
- Smart scheduling: `smart-calendar-scheduler` edge function, re-organize and fill-gaps flows
- Task detail modal: dependencies with circular detection, checklists, time tracking
- Demo mode: localStorage fallback for tasks prefixed `demo-`
- AI task parsing via `ai-task-parser` edge function
- Assignment sync from external sources (Google Sheets)

### 2. `docs/CALENDAR_INTEGRATION.md`
- OAuth flow: `CalendarOAuthManager` → `calendar-token-manager` edge function → redirect
- Providers: Google and Outlook/Office365
- Sync pipeline: `calendar-delta-sync` for incremental sync, `calendar-integration-manager` for availability
- Calendar module views: day/week/month with external event overlay
- Smart actions: Re-Organize (reschedule past-due tasks), Fill Gaps (schedule unscheduled tasks)
- Calendar selection panel with localStorage preferences per calendar_id
- Busy slot conflict detection

### 3. `docs/NOTIFICATIONS.md`
- Push notification stack: Service Worker (`sw.js`) + VAPID keys + Web Push API
- `useNotifications` hook: permission flow, subscribe/unsubscribe, force-resubscribe for VAPID rotation
- Edge functions: `manage-push-subscription`, `send-push-notification`, `send-unified-notification`, `notification-scheduler`, `notification-delivery`
- Notification channels: EMAIL, SLACK, PUSH, OUTLOOK_EVENT, GOOGLE_EVENT
- Notification preferences: due reminders, overdue, daily/weekly digest, quiet hours
- Presence tracking (`usePresenceTracking`) for conditional push (don't push if user is active)
- Service worker message handling: notification clicks open CommsConsole, new chat messages via SW

### 4. `docs/COMMS_CONSOLE.md`
- Architecture: `CommsConsoleContext` (1140-line provider) as central state manager
- Three rendering modes: embedded (full-page `/comms`), panel (right sidebar), overlay (legacy)
- Three communication modes: chat (SSE streaming), voice (WebRTC via `RealtimeVoiceAssistant`), phone (Twilio)
- Unified thread system: `useUnifiedThread` hook → `ai_threads` table, one thread per user+assistant
- SSE streaming: `hybrid-assistant-api` with delta events, tool_call indicators, JSON fallback
- Chat history: load last 50 messages (desc + reverse), Realtime subscription for live updates
- Message deduplication: temp IDs (`user-*`, `assistant-*`) replaced by DB IDs on Realtime INSERT
- Latency metrics: time-to-first-token, response_time_ms persisted with messages
- Smart visibility reload: only fetch new messages on tab focus
- Assistant management: fetch from `assistants` table, auto-create default Iris, demo mode shares dev's assistants
- Retry and new conversation flows

## Technical Details
- Each doc follows the established pattern from Round 1-2 (header, overview, architecture section, implementation details)
- Cross-references to `ARCHITECTURE.md`, `EDGE_FUNCTIONS.md`, and `DATABASE_SCHEMA.md` where relevant
- Concise but complete — targeting ~200-300 lines per file

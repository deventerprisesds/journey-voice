# Notification System

> Technical reference for push notifications, multi-channel delivery, and presence-aware routing.

## Overview

The notification system delivers reminders and messages through five channels: Web Push, Email, Slack, Google Calendar events, and Outlook Calendar events. It uses a centralized lifecycle managed by `notification-delivery`, with `scheduled_notifications` as the single source of truth.

## Architecture

```
notification-scheduler (cron)
  → Creates scheduled_notifications records
  → notification-delivery processes due notifications
      → send-unified-notification (multi-channel dispatch)
          → send-push-notification (Web Push)
          → send-slack-notification (Slack webhook)
          → send-chat-message (in-app chat)
          → calendar-integration-manager (calendar events)
```

### Deduplication

A unique partial index on `(task_id, notification_type, minute)` prevents duplicate reminder scheduling at the database level. `notification-delivery` owns the lifecycle — `send-unified-notification` only updates existing records, never creates new ones.

## Web Push Stack

### Components

| Component | Role |
|-----------|------|
| `public/sw.js` | Service Worker — receives push events, shows notifications, handles clicks |
| `useNotifications` hook | Permission flow, subscribe/unsubscribe, VAPID key management |
| `manage-push-subscription` | Edge function — stores/removes subscriptions in `push_subscriptions` table |
| `send-push-notification` | Edge function — sends via Web Push API using VAPID keys |
| `get-vapid-key` | Edge function — returns public VAPID key to client |

### Subscription Flow

```
1. useNotifications checks Notification.permission
2. If 'default' → prompt user
3. If 'granted' → fetch VAPID public key from get-vapid-key
4. Register service worker (sw.js)
5. Call pushManager.subscribe({ applicationServerKey: vapidKey })
6. Send subscription (endpoint, p256dh, auth) to manage-push-subscription
7. Stored in push_subscriptions table
```

### VAPID Key Rotation

When VAPID keys change (e.g., environment migration):
- `useNotifications` exposes `forceResubscribe()`
- Unregisters existing subscription
- Re-subscribes with new VAPID key
- Updates `push_subscriptions` record

### Service Worker (`sw.js`)

Version: v5+

**Push event handling**:
- Parses payload as JSON
- Shows notification with title, body, icon (`iris-icon-192.png`), badge (`iris-badge-72.png`)
- Custom ringtones unsupported (Web Push API limitation on mobile)

**Click handling**:
- `notification.data.url` → opens or focuses that URL
- Default: opens CommsConsole (`/comms`)
- `notificationclick` event closes the notification and focuses/opens the app window

**Message relay**:
- SW receives `postMessage` from push events
- Broadcasts to all clients via `clients.matchAll()` + `client.postMessage()`
- Used for live chat message delivery when app is backgrounded

## Notification Channels

### Channel Types (enum: `notification_channel`)

| Channel | Delivery Method |
|---------|-----------------|
| `PUSH` | Web Push API → browser notification |
| `EMAIL` | Email provider (via send-unified-notification) |
| `SLACK` | GET request to n8n webhook URL |
| `GOOGLE_EVENT` | Creates/updates Google Calendar event |
| `OUTLOOK_EVENT` | Creates/updates Outlook Calendar event |

### Slack Integration

`send-slack-notification` edge function:
- Accepts `webhook_url`, `message`, `output`, `type`
- Sends as GET request with URL params to n8n webhook
- n8n workflow formats and posts to Slack channel

## Notification Types

| Type | Trigger |
|------|---------|
| Due reminder | `reminder_minutes` before `due_date` |
| Overdue alert | Task past `due_date` and not `DONE` |
| Daily digest | Scheduled morning summary |
| Weekly digest | Scheduled weekly summary |
| Chat message | System-initiated messages (check-ins) |
| Schedule change | Task rescheduled by AI |

## Notification Preferences

Stored in user profile / notification settings:
- **Channels enabled**: Which channels to use per notification type
- **Quiet hours**: Start/end times when push is suppressed
- **Reminder defaults**: Default `reminder_minutes` for new tasks

### `NotificationSettings` Component

UI for managing preferences:
- Toggle channels per notification type
- Set quiet hours
- Test notification button
- `NotificationStatusDashboard` shows delivery history and failures

## Presence Tracking

### `usePresenceTracking` Hook

- Tracks user activity via mouse/keyboard events
- Updates `last_active_at` in Supabase Realtime presence channel
- **Conditional push**: `notification-delivery` checks if user was active in last N minutes
  - Active → skip push, deliver in-app only
  - Inactive → send push notification

## Delivery Logging

### `delivery_logs` Table

| Field | Purpose |
|-------|---------|
| `notification_id` | FK to `scheduled_notifications` |
| `channel` | Which channel was used |
| `delivered_at` | Successful delivery timestamp |
| `failed_at` | Failure timestamp |
| `failure_reason` | Error message |
| `response_data` | Raw response from delivery provider |

## Key Files

| File | Role |
|------|------|
| `src/hooks/useNotifications.tsx` | Client-side push management |
| `src/hooks/usePresenceTracking.ts` | Activity tracking |
| `src/components/NotificationSettings.tsx` | Preferences UI |
| `src/components/NotificationStatusDashboard.tsx` | Delivery monitoring |
| `public/sw.js` | Service Worker |
| `supabase/functions/notification-delivery/` | Central dispatcher |
| `supabase/functions/notification-scheduler/` | Cron-based scheduling |
| `supabase/functions/send-push-notification/` | Web Push sender |
| `supabase/functions/send-unified-notification/` | Multi-channel router |
| `supabase/functions/send-slack-notification/` | Slack webhook proxy |

---

*See also: [ARCHITECTURE.md](./ARCHITECTURE.md), [EDGE_FUNCTIONS.md](./EDGE_FUNCTIONS.md), [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md)*

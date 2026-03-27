

# Multi-Account Calendar UI with Push/Pull Toggles + Add Account Buttons

## Current State

The UI uses single-object state (`outlookConnection` / `googleConnection`) via `selectBestConnection`, showing only one connection per provider. There's no way to see multiple accounts, no explicit push/pull toggles per account, and no "Add Another Account" button.

## What Changes

### Refactor `NotificationSettings.tsx` — Calendar Section

Replace single-connection state with arrays. Each provider section renders **all active connections** as individual cards.

**Per-connection card layout:**
```text
Outlook Calendar
┌─────────────────────────────────────────────────┐
│ Dev@EnterpriseDS.io                             │
│ Push tasks to calendar  ──────────── [toggle]   │
│ Pull events for scheduling ────────  [toggle]   │
│   └─ Calendars: Work, Personal (sub-toggles)   │
│ [Disconnect]                                    │
├─────────────────────────────────────────────────┤
│ ⚠ tavonoellis@gmail.com (expired)              │
│ [Reconnect]  [Disconnect]                       │
└─────────────────────────────────────────────────┘
[+ Add Another Outlook Account]

Google Calendar
┌─────────────────────────────────────────────────┐
│ dev@gmail.com                                   │
│ Push tasks to calendar  ──────────── [toggle]   │
│ Pull events for scheduling ────────  [toggle]   │
│   └─ Calendars: Primary (sub-toggles)          │
│ [Disconnect]                                    │
└─────────────────────────────────────────────────┘
[+ Add Another Google Account]
```

### State Changes

- Replace `outlookConnection: CalendarConnection | null` → `outlookConnections: CalendarConnection[]`
- Replace `googleConnection: CalendarConnection | null` → `googleConnections: CalendarConnection[]`
- Remove `outlookExpired` / `googleExpired` booleans (expiry computed per-connection inline)
- Add `purposes: string[]` to `CalendarConnection` interface

### `loadCalendarConnections` Changes

- Remove `selectBestConnection` helper
- Filter all active connections per provider into arrays
- Include `purposes` field from RPC result

### Push Toggle Logic

Each connection gets a "Push tasks to calendar" toggle that:
- Adds/removes `WRITE` from that connection's `purposes` array in DB
- Adds/removes the corresponding channel (`OUTLOOK_EVENT` / `GOOGLE_EVENT`) from notification prefs if any connection has WRITE

### Pull Toggle Logic

Each connection gets a "Pull events for scheduling" toggle that:
- Adds/removes `READ` from that connection's `purposes` array
- When enabled, expands the `CalendarPullToggles` sub-calendar selector below it

### Add Another Account Button

- Always rendered below each provider's connection list
- Calls `CalendarOAuthManager` with `provider` but no `connectionId`
- Opens a fresh OAuth flow

### Disconnect Button

Per-connection button that sets `is_active = false` on that connection row and refreshes the list.

### CalendarOAuthManager Changes

- Accept optional `showAlways` prop (default true) so the button renders even when connections exist
- Label changes: "Connect" when no connections, "Add Another Account" when connections exist

## Files to Change

| File | Change |
|------|--------|
| `src/components/NotificationSettings.tsx` | Multi-connection arrays, per-connection cards with push/pull toggles, disconnect, add account |
| `src/components/CalendarOAuthManager.tsx` | Add `showAlways` prop, dynamic button label |

## Also Included (from prior approved plan, not yet implemented)

These fixes will be applied in the same implementation pass:
- Fix Google 23505 duplicate key → reactivate existing row
- Fix Outlook email → prefer `userPrincipalName`
- Add token refresh to `listCalendars`
- Add structured trace logging

| File | Change |
|------|--------|
| `supabase/functions/calendar-token-manager/index.ts` | 23505 reactivation, MS email fix, trace logging |
| `supabase/functions/calendar-integration-manager/index.ts` | Token refresh in listCalendars, trace logging |
| `src/hooks/useOAuthCallback.tsx` | Trace logging at each stage |




# Combined Plan: Fix Deployment + Calendar Connections

## Issue 1: Published Site Still Shows Placeholder

The build trigger comment (`// Build trigger: 2026-03-27`) was already added but the platform still says "Up to date." The preview works fine (console logs show 28 tasks loaded, demo mode active). The published URL serves the Lovable placeholder HTML.

**Fix**: Make another trivial change to force a fresh build cycle. Update the build trigger timestamp to include time (e.g., `// Build trigger: 2026-03-27T16:30`). This will create a new build diff and re-enable the Update button.

**File**: `src/App.tsx` line 1 -- change comment to include current time.

Additionally, suppress the PresenceTracking RLS errors for the demo user that spam the console every 30 seconds:

**File**: `src/hooks/usePresenceTracking.ts` -- add early return when `userId` matches the demo user ID (`00000000-0000-0000-0000-000000000001`).

## Issue 2: Calendar Connection Fixes

### 2a. Pass `connectionId` to enable silent token refresh

Currently `CalendarOAuthManager` in NotificationSettings receives no `connectionId`, so the refresh button never appears and silent token renewal is impossible.

**File**: `src/components/NotificationSettings.tsx` (lines 1054, 1142)
- Pass `connectionId={outlookConnection?.id}` and `connectionId={googleConnection?.id}` to each `CalendarOAuthManager`.

**File**: `src/components/CalendarConnectionModal.tsx` (line 318)
- Pass `connectionId={status.connectionId}` for expired connections.

### 2b. Add pull toggle under each calendar connection

Under each connected calendar in NotificationSettings, add a "Pull events for scheduling" toggle that updates the connection's `purposes` array (adding/removing `READ`).

**File**: `src/components/NotificationSettings.tsx`
- After each connected calendar section (lines 1072-1103 for Outlook, 1160+ for Google), add a toggle that calls `calendar-token-manager` with `action: 'update_purposes'`.

### 2c. Add `list_calendars` action to edge function

**File**: `supabase/functions/calendar-integration-manager/index.ts`
- Add a `list_calendars` case in the switch that fetches calendar list from Google (`/users/me/calendarList`) or Microsoft (`/me/calendars`) using stored tokens.
- Return calendar names and IDs to the UI.

### 2d. Remove redundant Calendars tab from Settings

**File**: `src/pages/Settings.tsx`
- Remove `{ value: 'calendars', ... }` from `tabConfig` array.
- Remove the `TabsContent value="calendars"` block (lines 170-193).
- Remove imports for `CalendarConnectionModal` and `CalendarSelectionPanel`.
- Remove `isCalendarModalOpen` state.

## Files Changed

| File | Change |
|------|--------|
| `src/App.tsx` | Update build trigger timestamp |
| `src/hooks/usePresenceTracking.ts` | Skip writes for demo user |
| `src/components/NotificationSettings.tsx` | Pass connectionId, add pull toggle |
| `src/components/CalendarConnectionModal.tsx` | Pass connectionId for expired |
| `src/pages/Settings.tsx` | Remove Calendars tab |
| `supabase/functions/calendar-integration-manager/index.ts` | Add list_calendars action |

## After Implementation
1. Preview rebuilds with the new trigger
2. Click Publish > Update to deploy
3. Verify journey-voice.lovable.app loads the app
4. Test calendar connection refresh and pull toggle in Settings > Notifications


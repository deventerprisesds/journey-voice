

# Visual Differentiation + Assignment Sync on Demand

## Problems
1. **No visual distinction** between regular tasks, assignment-sourced tasks (EMBA/MIT), and external calendar events in FocusView
2. **Sync button ignores assignments** — only calls `calendar-delta-sync`, never `nightly-assignment-sync`
3. **External events show "External" badge** — no indication of which calendar/provider
4. **Assignment source (EMBA vs MIT) not stored** on the task — only in the description string, not queryable

## Changes

### 1. `nightly-assignment-sync` — Store source in `scheduling_context`

Currently `syncAssignments('assignments', 'EMBA')` passes source but only puts it in the description. Add `scheduling_context: { source }` to the task insert so the UI can read it:

```typescript
const taskData = {
  ...existing fields,
  scheduling_context: { source }, // 'EMBA' or 'MIT'
};
```

### 2. FocusView Sync button — also invoke `nightly-assignment-sync`

In the Sync button `onClick` (line ~889), add a parallel call:

```typescript
// Existing: calendar-delta-sync
await supabase.functions.invoke('calendar-delta-sync', { body: { user_id: user.id } });
// New: assignment sync
await supabase.functions.invoke('nightly-assignment-sync', { body: { userId: user.id } });
// Then reload tasks
onTaskUpdate();
```

Update the toast to report assignment counts too.

### 3. FocusView task cards — show source badge for assignments

In the task card rendering (line ~1087), add a source badge when task has `assignment_id`:

- Check `task.scheduling_context?.source` for 'EMBA' or 'MIT'
- Fallback: if `assignment_id` exists but no source, check category (`PROF_EDUCATION` → "EMBA", `EDUCATION` → "MIT")
- Render a distinct colored badge: **"📚 EMBA"** (indigo) or **"📚 MIT"** (red)
- Add a purple left border to distinguish from regular tasks

### 4. FocusView external event cards — show provider + account

Change the external events query (line ~177) to join connection data:
```typescript
.select('*, calendar_connections!connection_id(provider, provider_account_email)')
```

In the external event card (line ~1117):
- Replace `<Badge>External</Badge>` with provider name ("Google" / "Outlook")
- Show `provider_account_email` as subtitle
- Use fallback `evt.title || 'Untitled Event'`

### 5. Task type — add `position` to `scheduling_context` typing

No schema change needed — `scheduling_context` is already JSONB.

## Files to Change

| File | Change |
|------|--------|
| `supabase/functions/nightly-assignment-sync/index.ts` | Add `scheduling_context: { source }` to task insert |
| `src/components/FocusView.tsx` | (a) Sync button also invokes assignment sync + reloads tasks (b) Assignment badge on task cards (c) Provider label on external event cards (d) Join connection data on external events query |


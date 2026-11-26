<!--
WHAT:          acceptance criteria for "deadline reminders" (time-card nag): a user-editable list of weekly
               must-do items that nag hourly by full-screen alarm + email + chat until marked Done.
WHY:           owner request 2026-11-22 / 2026-11-26 (verbatim in the brief); Tier 1 (decides whether a
               notification fires, parses times and days), so ACs come from an independent cold pass.
SUPERSEDES:    nothing
SUPERSEDED-BY: nothing -- current
EVIDENCE:      written against journey-voice origin/main c7cc683 ("ledgers + UAT check: category ignore live (#141)")
-->

## Acceptance Criteria — Deadline reminders (time card)

Task: add a Settings-managed list of recurring "deadline reminder" items. Each occurrence creates ONE task.
From the start time it fires every hour (full-screen phone alarm with Done, plus email and TaskOS chat when the
item's switches are on). It skips quiet hours, resumes no earlier than the item's "not before" time, and stops
at the deadline or the moment the task is DONE. The seeded item is the owner's time card: Fri 19:00 to Sat
20:00, not-before 08:00.

Sources read (journey-voice origin/main c7cc683):
- `supabase/functions/notification-scheduler/index.ts` (L50-110 main loop + single bulk insert; L144-198 per-user pass)
- `supabase/functions/notification-scheduler/reminder-rules.ts` (L27-59 `isInQuietHours`)
- `supabase/functions/_shared/digest-content.ts` (L642-674 `localClockParts`, `TICK_WINDOW_MINUTES=15`, `shouldSendAtLocalHour`)
- `supabase/functions/_shared/activities.ts` (L23-50 shape; L86-112 `resolveActivities`/`HHMM`/`parseClockTime`; L114-140 `localDayOfWeek`/`occursOn`; L246-298 `normalizeActivity`)
- `supabase/functions/notification-delivery/index.ts` (L16-19 `ALARM_TYPES`/`alarmDeepLink`; L219-298 call-row channel fan-out; L693-1000 batched path: quiet batching L700, alarm never-batched L707-713, DONE/ancient/unscheduled skips L733-830, channels L846-852, alarm push L913-934, email via unified L943-990, digest chat L896-912)
- `src/components/SchedulingSettings.tsx` (L41, L70-77 `activitiesEdited` save guard; L449-453 Activities card mount)
- `src/components/ActivitiesSettings.tsx` (L30-45 onChange/patch/add; L77-85 On switch + delete)
- `src/utils/mergeStoredConfig.ts` (L23-29 shallow top-level merge, undefined skipped)
- `package.json` L12 (`npm test` = `node scripts/run-tests.mjs`)

Existing system this extends (not duplicates):
- Storage: `user_scheduling_prefs.config`, a NEW top-level key beside `activities`, saved through the same
  `saveUserSchedulingConfig` + `mergeStoredConfig` path. Not a new table.
- Recurrence: Activities' `days` / `everyNWeeks` / `anchorDate` and `occursOn` semantics (activities.ts L127-140).
- Clock: `localClockParts` (digest-content.ts L642). Quiet hours: `isInQuietHours` (reminder-rules.ts L34).
- Scheduling: the hourly `notification-scheduler` pass, not a new cron.
- Delivery: `scheduled_notifications` rows rendered by `notification-delivery` (alarm push on `calendar_events`,
  email through `send-unified-notification`, chat through `send-chat-message`). Not a new sender.
- Completion: `public.tasks.status = 'DONE'`, which the phone's Done button already sets and which delivery
  already honours (L756-760, L804-806). Not a second "submitted" flag.

Hazards found while reading. Each has an AC below; these are where a working-looking build goes wrong.
- H1. `notification-delivery` L767-775 drops any task-linked row whose task has `start_time IS NULL` and
  `due_date < today (local)` as "ancient". A Friday-dated occurrence task with no start_time would have EVERY
  Saturday nag silently dropped. (AC-D6)
- H2. L783-791 drops `task_start_reminder`/`task_start_now` rows whose task has no `start_time`
  (`task_unscheduled`). Reusing those types for nags on an unscheduled task kills every nag. (AC-D5)
- H3. L700-705: a row with `queued_during_quiet=true` is folded into a "Daily Summary" batch: no alarm, no Done
  button. Nags must be skipped in quiet hours, never queued. (AC-N4)
- H4. L846-852: email only goes out if the GLOBAL `notification_prefs.channels` contains EMAIL, and the owner's
  does not. A per-item email switch must bypass that filter for this type only. (AC-D3, AC-R4)
- H5. The batched alarm path (L896-990) never calls `send-chat-message` for alarm types; chat today is
  digest-only (L897). (AC-D4)
- H6. `scheduler/index.ts` L98-110 inserts ALL users' rows in ONE `.insert(notifications)`. One bad nag row fails
  every user's digests for that hour with a 500. (AC-R3)
- H7. No unique constraint on `scheduled_notifications` was found in `supabase/migrations/`, so idempotency
  must be built, not assumed. (AC-O2, AC-N6)
- H8. `shouldSendAtLocalHour` only matches minute < 15 (L656, L673). A cron run that starts at :17 matches no
  hour, so a slot gate copied from it silently skips a whole hour. (AC-N8)
- H9. `SchedulingSettings.handleSave` sends `activities: undefined` unless the card was edited (L70-77), so an
  agent's concurrent edit survives a stale page. The new key needs the same guard. (AC-S9)
- H10. `isInQuietHours` builds `new Date(now.toLocaleString(...))` (reminder-rules.ts L36), which is only correct
  because the edge runtime clock is UTC. New tests must run with TZ=UTC or use `localClockParts`. (AC-T4)


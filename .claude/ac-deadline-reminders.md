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

Reference scenario used below ("the owner's week"). Timezone America/New_York, quiet hours 22:00-06:00, time-card
item: start Fri 19:00, deadline Sat 20:00, not-before 08:00, email on, chat on, every week. Expected fire slots
(local): Fri 19:00, 20:00, 21:00; Sat 08:00 through 20:00 hourly. That is 16 slots if 20:00 is inclusive (see
Gaps G1). Quiet hours block Fri 22:00 to Sat 05:59. Not-before blocks Sat 06:00 and 07:00.

### Settings list (S)

| # | Given / When / Then | Category | Observed via |
|---|---|---|---|
| AC-S1 | Given Settings > Scheduling, when the page loads, then a card titled "Deadline reminders" renders as its OWN card next to the Activities card (SchedulingSettings.tsx L449-453), and none of its items appear inside the Activities card list | happy-path | Playwright: both card titles visible; Activities card text does not contain "Time card" |
| AC-S2 | Given the owner's stored config has NO deadline-reminders key, when Settings loads, then exactly one seeded item shows: name "Time card", On, day Fri, start 19:00, deadline Sat 20:00, not-before 08:00, email On, chat On, every 1 week | happy-path | Playwright field values; DB `user_scheduling_prefs.config` unchanged until Save |
| AC-S3 | Given the owner deletes the seeded item and clicks Save, when the page reloads, then the list is EMPTY and the seed is NOT re-added (an empty list is stored, not a missing key). Contrast `resolveActivities` L86-89, which re-seeds on a missing key | edge | DB: key present and `[]`; Playwright: 0 items after reload |
| AC-S4 | Given the list, when the owner clicks Add, fills name "Expense report", Mon 09:00 to Tue 17:00, email Off, chat On, and Saves, then after reload the new item shows those exact values and the time card item is unchanged | happy-path | Playwright reload; DB JSON has 2 items with distinct ids |
| AC-S5 | Given an item, when the owner edits start time 19:00 to 18:00 and Saves, then the stored item has start 18:00, the same id, and every other field unchanged | happy-path | DB diff of the item object |
| AC-S6 | Given an item, when the owner switches it Off and Saves, then the stored item has `enabled:false` and is still listed (Off, not deleted) after reload | happy-path | Playwright switch state; DB |
| AC-S7 | Given an item, when the owner clicks delete and Saves, then it is gone from the stored list and the other items keep their ids and values | happy-path | DB |
| AC-S8 | Given invalid input (any REJECT row in the spelling table, a deadline at or before the start, a window longer than 7 days, no day chosen, an empty name), when the owner clicks Save, then an error naming the field is shown and NOTHING is written (stored config byte-identical) | error | Playwright error text; DB `updated_at` unchanged |
| AC-S9 | Given the Settings page was loaded before an agent or second tab changed the deadline list, when the owner saves an edit to a DIFFERENT card (e.g. a time window), then the deadline list in the DB is the newer version, not the stale page's (same guard as `activitiesEdited`, L70-77) | regression | DB before/after; unit test of the save payload: key is `undefined` when the card was not touched |
| AC-S10 | Given a save that changes only the deadline list, when it completes, then `activities`, `timeWindows`, `categoryMappings` and every other top-level config key are byte-identical (mergeStoredConfig L23-29) | regression | DB JSON diff limited to the one key |
| AC-S11 | Given deadline items exist, when the busy-slot reader (`activityBusySlots`, activities.ts L215) or the nightly builder runs, then no busy block is produced for a deadline item (it is a nag, not reserved time) | regression | unit test: `activityBusySlots` output identical with and without deadline items in config |
| AC-S12 | Given every-other-week is chosen, when the owner saves without picking an anchor date, then an anchor date is stored (as `normalizeActivity` L269-274 does) and the card shows which Friday is "on" | edge | DB anchorDate is YYYY-MM-DD; Playwright text |

### Occurrence creation (O)

| # | Given / When / Then | Category | Observed via |
|---|---|---|---|
| AC-O1 | Given the owner's week, when the scheduler runs at Fri 19:00-19:59 local, then exactly ONE `public.tasks` row exists for that occurrence: owner's user_id, title containing the item name, status not DONE, a due date/time equal to the DEADLINE (Sat 20:00 local, stored correctly in UTC), and a stable reference to (item id, occurrence start date) | happy-path | SQL count of tasks with that reference = 1 |
| AC-O2 | Given AC-O1's task exists, when the scheduler runs again in the same hour, every later hour of the window, and as a manual re-invoke (`immediate:true`), then the task count for that occurrence stays 1 | edge | same SQL after 3 invocations |
| AC-O3 | Given the task insert succeeded but the run then failed (simulated throw after the task write), when the next hourly run happens, then it reuses the existing task (count stays 1) and still creates that hour's nag | error | unit test with an injected failure; SQL count |
| AC-O4 | Given the scheduler runs Thu 19:00 or Fri 18:00 local, then no task is created for the coming occurrence (creation is not early) | edge | SQL count 0 |
| AC-O5 | Given an occurrence's deadline has passed with the task still open, when later runs happen (Sat 21:00, Sun, Mon), then the old task is left exactly as it was (not DONE, not deleted, title and due unchanged) and no nag row is created for it | edge | SQL row unchanged; no `scheduled_notifications` rows for its task_id after the deadline |
| AC-O6 | Given last week's occurrence task is still open, when the next Friday 19:00 arrives, then a NEW separate task is created for the new occurrence and nags reference only the NEW task_id | edge | two task rows, different refs; nag rows' task_id = new id |
| AC-O7 | Given everyNWeeks=2 anchored on Fri 2026-11-27, then occurrences exist for 11-27, 12-11, 12-25 and none for 12-04 or 12-18. The Saturday slots of an "on" week fire even though Saturday is a different day from the anchor (membership is decided by the occurrence START date only) | edge | unit test over 6 weeks of hourly ticks; task count = 3 |
| AC-O8 | Given the item is Off, or has been deleted, when Friday 19:00 arrives, then no task is created | edge | SQL count 0 |
| AC-O9 | Given the owner opens the app on Fri 19:30, then the occurrence task is visible in TaskOS with the deadline shown | happy-path | Playwright task list text |

### Nag slots (N)

| # | Given / When / Then | Category | Observed via |
|---|---|---|---|
| AC-N1 | Given the owner's week and the task not DONE, when hourly runs execute from Fri 18:00 to Sat 21:00 local, then nag rows are produced for exactly the reference slot list (Fri 19, 20, 21; Sat 08..20) and for no other hour | happy-path | unit test that drives the slot function over every hour of that span and asserts the exact list; live: `scheduled_notifications` rows for the task_id, ordered |
| AC-N2 | Given Fri 22:00 through Sat 05:59 (quiet hours), then no nag row is created and no alarm, email or chat goes out | edge | unit test; live: no rows with scheduled_for in that span |
| AC-N3 | Given Sat 06:00 and 07:00 (quiet over, before not-before), then no nag fires. The first Saturday nag is 08:00 | edge | unit test |
| AC-N4 | Given any nag row, then `queued_during_quiet` is false. A nag is SKIPPED in quiet hours, never queued into the "Daily Summary" batch (delivery L700-705) | regression | SQL: no nag rows with `queued_during_quiet=true`; no Daily Summary containing the item name |
| AC-N5 | Given the deadline Sat 20:00 has passed, when Sat 21:00 and later runs execute, then no nag row is created | edge | unit test; SQL |
| AC-N6 | Given one slot (e.g. Sat 10:00), when the scheduler is invoked 3 times inside that hour, then exactly ONE nag row exists for (task_id, slot) and the phone, inbox and chat each receive exactly one notification for that slot | edge | SQL count per slot = 1; `send-push-notification` invocations for that tag = 1 |
| AC-N7 | Given the scheduler missed 09:00 and 10:00 (outage) and runs at 11:05, then ONE nag fires for 11:00 and none is back-filled for 09:00 or 10:00 (no burst) | edge | unit test; SQL: no 09:00/10:00 slot rows |
| AC-N8 | Given a run that starts late in the hour (10:17 or 10:52, past the 15-minute `TICK_WINDOW_MINUTES`, digest-content.ts L656), then the 10:00 slot still fires once in that hour | edge | unit test at :17 and :52 |
| AC-N9 | Given Dismiss on the phone at 19:05, then no write happens to the task (status and updated_at unchanged) and the 20:00 nag still fires | happy-path | SQL task row before/after; 20:00 row delivered_at set |
| AC-N10 | Given Done on the phone alarm at 20:03, then the task becomes DONE and NO later slot (21:00, Sat 08:00, ...) delivers anything on any channel. Any already-queued row for that task is marked skipped (delivery L804-822 behaviour) | happy-path | SQL tasks.status='DONE'; later rows have failure_reason set or do not exist; no push/email/chat after 20:03 |
| AC-N11 | Given the task is marked DONE from the TaskOS app (not the phone) between slots, then AC-N10 holds the same way | happy-path | same |
| AC-N12 | Given the task was DONE and the owner reopens it before the deadline, then nags resume at the next slot (task status is the only source of truth) | edge | unit test; SQL |
| AC-N13 | Given the alarm's "Doing" button is pressed, then the task is not DONE and nags continue (see Gaps G3) | edge | SQL status != DONE; next slot fires |
| AC-N14 | Given slots are anchored to clock hours from the start time, when the owner dismisses at 19:40, then the next fire is 20:00, not 20:40 (see Gaps G2) | edge | unit test |

### Edits mid-window (E)

| # | Given / When / Then | Category | Observed via |
|---|---|---|---|
| AC-E1 | Given the window is live (Sat 10:30) and the owner turns the item Off and Saves, then no nag is delivered at 11:00 or later, and the open task is left as it is | edge | SQL: no delivered rows after the save time |
| AC-E2 | Given the window is live and the owner deletes the item, then AC-E1 holds, and the task stays open and untouched | edge | SQL |
| AC-E3 | Given the window is live and the owner moves the deadline from Sat 20:00 to Sat 14:00, then the last nag is 14:00 (inclusive, per G1) and the occurrence task is REUSED (count stays 1). Its due shows 14:00, or stays unchanged, per Gaps G5 | edge | SQL count; slot list |
| AC-E4 | Given the window is live and the owner turns email Off, then the next slot sends alarm + chat and no email | edge | send-unified-notification invocations for the slot = 0 |
| AC-E5 | Given an item turned Off at Sat 09:30 is turned back On at 12:20, then the next nag is 13:00. No catch-up for 10:00-12:00 | edge | SQL |
| AC-E6 | Given the start day/time is changed so the current occurrence no longer contains "now", then no second task is created for the same week, and nags follow the new window from the next run | edge | unit test; SQL task count for the week at most 1 |

### Delivery (D)

| # | Given / When / Then | Category | Observed via |
|---|---|---|---|
| AC-D1 | Given a nag slot, then the phone gets a FULL-SCREEN alarm: `send-push-notification` called with `channel:'calendar_events'`, `data.taskId` = the occurrence task id, a unique `tag` per row, and `deepLink:'/calendar?task=<id>'` (delivery L913-934) | happy-path | activity_log `alarm_notification_dispatched` with that taskId; the owner confirms on the phone a full-screen alarm with a Done button (LIVE, not sandbox) |
| AC-D2 | Given a nag fires in the same 2-minute window as another reminder, then the nag is NOT batched (it is its own alarm batch, L707-713): the push still carries the single task id and the Done button | edge | activity_log batchSize=1 for the nag |
| AC-D3 | Given the item's email switch is On and the global `notification_prefs.channels` has NO EMAIL, then one email per slot is sent through `send-unified-notification` (not a new mailer), naming the item and the deadline. With the switch Off, zero emails even if the global channels later include EMAIL | happy-path | function invocation log/channelResults; owner's inbox shows 1 email per slot |
| AC-D4 | Given the item's chat switch is On, then one message per slot appears in TaskOS chat history via `send-chat-message`, naming the item and the deadline. Off means none | happy-path | chat history row count per slot = 1; Playwright chat text |
| AC-D5 | Given the occurrence task has no `start_time`, then nags are NOT dropped as `task_unscheduled` (delivery L783-791) | regression | SQL: no nag row with failure_reason 'task_unscheduled' |
| AC-D6 | Given the Saturday slots of an occurrence whose task was created on Friday, then nags are NOT dropped as "ancient" (L767-775), because the task's due date is the deadline date | regression | SQL: Saturday nag rows have delivered_at set, not failure_reason 'Task completed or ancient' |
| AC-D7 | Given a slot where email delivery fails, then the alarm and chat for that slot still go out, the failure kind is recorded on that row, and the next slot proceeds normally | error | channelResults with email success:false; next slot delivered |
| AC-D8 | Given the alarm push fails, then the row records the failure kind (it is not marked delivered silently), and email/chat for that slot still go out | error | row failure_reason / activity_log |
| AC-D9 | Given each nag, then its title/body says what is due and when ("Time card due by Sat 8:00 PM") in the owner's timezone, not UTC | happy-path | push/email/chat text |

### DST and timezone (T)

| # | Given / When / Then | Category | Observed via |
|---|---|---|---|
| AC-T1 | Given EST (Fri 2026-11-27), then the Fri 19:00 slot is 2026-11-28T00:00Z, a SATURDAY in UTC, and it fires as the Friday 19:00 start. Weekday is judged on the LOCAL clock (`localClockParts`), not UTC | edge | unit test at that instant |
| AC-T2 | Given EDT (Fri 2026-10-30), then the Fri 19:00 slot is 23:00Z the same day; the next week (EST, Fri 2026-11-06) it is 2026-11-07T00:00Z. Both fire at local 19:00 | edge | unit test both weeks |
| AC-T3 | Given an item whose window spans the fall-back night (e.g. Sat 22:00 to Sun 04:00 with quiet hours off, Sun 2026-11-01), then the slot list has no duplicate and no gap in elapsed hours, and no exception. Same for spring-forward (Sun 2026-03-08, local 02:00 does not exist): no fire labelled 02:00, no crash | edge | unit test lists |
| AC-T4 | Given the test suite runs with a non-UTC process TZ (TZ=America/Los_Angeles), then every slot test still passes (no reliance on the server clock being UTC, per H10) | regression | run the tests with TZ set |
| AC-T5 | Given the owner changes timezone to America/Chicago, then the slots move to 19:00 Chicago local from the next run | edge | unit test |
| AC-T6 | Given a NULL timezone, then the America/New_York default is used (as `shouldSendAtLocalHour` does, L662-663) and the user is not skipped | edge | unit test |

### Regression (R)

| # | Given / When / Then | Category | Observed via |
|---|---|---|---|
| AC-R1 | Given a user with NO deadline items, then the scheduler's output (overdue reminders, daily/weekly digests, calendar reminders) is identical to before the change for the same `now` | regression | existing `reminder-rules.test.ts` passes; snapshot of `processUserNotifications` output with and without the feature |
| AC-R2 | `npm test` passes with at least the 765 baseline tests plus the new ones, and 0 failures | regression | `npm test` summary line |
| AC-R3 | Given a deadline item that throws or yields an invalid row, then other users' and the same user's digests still insert that hour (the single bulk insert at scheduler/index.ts L98-110 is not poisoned) | error | unit test with an invalid item; digest rows present |
| AC-R4 | Given the per-item email switch, then no OTHER notification type starts sending email (the global EMAIL filter at delivery L846-852 is unchanged for everything else) | regression | unit test on channel selection for `due_reminder`, `daily_digest`, the existing alarm types |
| AC-R5 | Given existing task start alarms (`task_start_reminder`/`task_start_now`), then their Done/Doing, never-batched and unscheduled-skip behaviour is unchanged | regression | existing delivery tests; review of L16-19 and L783-822 |
| AC-R6 | Given the occurrence task, then the phone receives at most ONE alarm per hour for it. If the nightly builder also places it on the calendar, its start alarm and a nag in the same hour do not both ring (see Gaps G6) | edge | activity_log alarm count per task per hour at most 1 |
| AC-R7 | Huddle's phone is unaffected: the nag push targets TaskOS (journey-native, no `app:"huddle"`) | regression | push data has no `app:"huddle"` |

### Performance (P)

| # | Given / When / Then | Category | Observed via |
|---|---|---|---|
| AC-P1 | Given the owner's account, then the hourly scheduler run takes no more than 2 s longer with the feature than without | performance | timed run / function logs |
| AC-P2 | Given a nag slot HH:00, then the alarm reaches the phone by HH:05 (to confirm against the delivery cron cadence; see Gaps G7) | performance | push dispatch timestamp minus slot time |
| AC-P3 | Given 20 deadline items for one user, then Settings saves in under 2 s and the scheduler makes one task query per user per run, not one per item | performance | timed save; query count in a unit test with a mock client |

### Spelling table (Tier 1: parses times and days, and matches the clock against them)

Documented by: the repo's OWN grammar, which the new parser must reuse rather than re-invent:
`parseClockTime` (activities.ts L107-111: `^(\d{1,2}):([0-5]\d)(?::[0-5]\d)?$`, hour <= 23, trimmed),
`HHMM` (L92: `^([01]\d|2[0-3]):([0-5]\d)$`), the days rule "0=Sun..6=Sat" (L35, L266), `occursOn` (L127-140),
`isInQuietHours` (reminder-rules.ts L34-59, overnight when start > end), `localClockParts` (digest-content.ts L642).
External standards I could NOT open in this pass (named under Gaps): WHATWG HTML `<input type=time>` value
format, IANA tz rules for America/New_York 2026.

**Times (start, deadline, not-before)**

| # | Input spelling | Documented by | Expected verdict | Wrong answer would be |
|---|---|---|---|---|
| S-1 | `19:00` | HHMM L92 | ACCEPT as 19:00 | FALSE REFUSAL |
| S-2 | `7:00` | parseClockTime pads, L110 | ACCEPT as **07:00** (7 AM, never 7 PM) | FALSE PASS (fires 12 h wrong) |
| S-3 | `07:00` | HHMM | ACCEPT 07:00 | FALSE REFUSAL |
| S-4 | `19:00:00` | parseClockTime seconds group | ACCEPT as 19:00 | FALSE REFUSAL |
| S-5 | ` 19:00 ` (spaces) | parseClockTime `.trim()` | ACCEPT 19:00 | FALSE REFUSAL |
| S-6 | `24:00` | parseClockTime `> 23` null; HHMM rejects | REJECT with a message (use 23:59 or next-day 00:00). Note `isInQuietHours` would treat 24:00 as minute 1440, so it must never reach the clock math | FALSE PASS |
| S-7 | `23:59` | HHMM | ACCEPT | FALSE REFUSAL |
| S-8 | `00:00` as deadline | HHMM | ACCEPT as midnight at the START of the chosen deadline day | FALSE PASS if read as end of day |
| S-9 | `19:60`, `19:5` | `[0-5]\d` | REJECT | FALSE PASS |
| S-10 | `7pm`, `7:00 PM`, `19h`, `1900`, `19.00` | not in grammar | REJECT (no 12-hour guessing) | FALSE PASS |
| S-11 | `-1:00`, `` (empty), `null` | not in grammar | REJECT; never fall back to "now" (L105 comment) | FALSE PASS |
| S-12 | `٠٧:٠٠` (non-ASCII digits) | `\d` in JS without `u` matches ASCII only | REJECT | FALSE PASS |

**Days**

| # | Input spelling | Documented by | Expected verdict | Wrong answer would be |
|---|---|---|---|---|
| S-13 | `5` | L35 0=Sun..6=Sat | Friday | FALSE PASS if Thursday/Saturday |
| S-14 | `6` | same | Saturday | same |
| S-15 | `0` | same | Sunday | FALSE REFUSAL if rejected as falsy |
| S-16 | `7` | L266 filter `d <= 6` | REJECT (not Sunday) | FALSE PASS |
| S-17 | `"5"` (string) | L266 `.map(Number)` | ACCEPT as Friday | FALSE REFUSAL |
| S-18 | `5.5` | L266 filter keeps 5.5 (`>=0 && <=6`). FINDING: the existing filter does not reject non-integers | REJECT | FALSE PASS (never matches any weekday, item silently never fires) |
| S-19 | `[]` | L267 | REJECT "choose a day" | FALSE PASS (never fires) |
| S-20 | `[5,5]` | L268 dedupe | ACCEPT as `[5]`; one occurrence per week | FALSE PASS (two tasks) |
| S-21 | Fri 19:00 EST = `2026-11-28T00:00Z` (UTC Saturday) | localClockParts L642 | counts as FRIDAY | FALSE REFUSAL (Friday start missed every winter week) |
| S-22 | Fri 19:00 EDT = `2026-10-30T23:00Z` | same | Friday | FALSE REFUSAL |

**Windows and quiet hours** (owner tz; slots listed local)

| # | Input | Documented by | Expected verdict | Wrong answer would be |
|---|---|---|---|---|
| S-23 | start Fri 19:00, deadline Sat 20:00 (crosses midnight) | owner request | VALID; slots per reference scenario | FALSE REFUSAL |
| S-24 | start Fri 19:00, deadline Fri 08:00 (same day, earlier) | - | REJECT "deadline must be after start" (do not silently roll to next week) | FALSE PASS |
| S-25 | deadline == start | - | REJECT | FALSE PASS |
| S-26 | start Fri 19:00, deadline the following Sat 20:00 (> 7 days) | overlaps next occurrence | REJECT | FALSE PASS (two live occurrences) |
| S-27 | quiet 22:00-06:00, not-before 08:00 | L53-58 overnight branch | first Sat slot 08:00 | FALSE PASS if 06:00 or 07:00 fires |
| S-28 | quiet 22:00-09:00, not-before 08:00 (quiet ends AFTER not-before) | same | first Sat slot **09:00**; quiet wins | FALSE PASS (08:00 fires inside quiet hours) |
| S-29 | quiet 23:00-06:00 | same | Fri 22:00 FIRES; Fri 23:00 does not | FALSE REFUSAL at 22:00 / FALSE PASS at 23:00 |
| S-30 | quiet hours null/unset | L41 returns false | Fri 19..23 fire; Sat 00:00-07:59 do NOT (not-before applies to every day after the start day); Sat 08..20 fire | FALSE PASS (overnight 1 AM alarm) |
| S-31 | quiet 22:00-22:00 (start == end) | L56-57: always false | treated as no quiet hours (same as S-30) | either direction; pin it |
| S-32 | quiet 19:00-06:00 (starts before the deadline) | overnight branch | Sat 19:00 and 20:00 SKIPPED; the deadline passes with no final nag (see G4) | FALSE PASS (fires in quiet) |
| S-33 | not-before 08:00 on the START day (Fri) | owner: "starting again saturday morning" | not-before does NOT apply on the start day; Fri 19:00 fires | FALSE REFUSAL |
| S-34 | Over-match negative: an Activity named "Time card" in `config.activities` | different key | creates NO task and NO nag; only items in the deadline list nag | FALSE PASS |
| S-35 | Over-match negative: an existing open task titled "Time card" created by hand | - | is NOT adopted as the occurrence task (matched by item reference, not by title) and gets no nags | FALSE PASS |

### Goal -> AC coverage
- "chat and email starting 7pm Friday" -> AC-N1, AC-D3, AC-D4, AC-T1, AC-T2
- "respecting quiet time settings" -> AC-N2, AC-N4, S-27..S-32
- "starting again Saturday morning (08:00)" -> AC-N3, S-27, S-28, S-30, S-33
- "through Saturday at 8pm" -> AC-N1, AC-N5, AC-O5, G1
- "every hour after dismissed" -> AC-N9, AC-N14, AC-N6, AC-N7, AC-N8
- "if I click submitted (Done) it stops" -> AC-N10, AC-N11, AC-N12, AC-N13
- "absolutely must be done" (an open task remains after the deadline) -> AC-O5, AC-O6
- "an actual feature I can edit, turn on and off, add a similar item" -> AC-S1..AC-S12, AC-E1..AC-E6
- "full-screen alarm and email like regular TaskOS emails" -> AC-D1, AC-D2, AC-D3, AC-D5, AC-D6
- Every-other-week reuse of the Activities shape -> AC-O7, AC-S12
- Must not break what exists -> AC-R1..AC-R7, AC-S9..AC-S11
- No AC without a goal: AC-P1..AC-P3 are the performance defaults the owner did not state (confirm below).

### Gaps / open questions (each has a safe default the ACs assume; reversible)
- **G1. Is 20:00 inclusive?** "through Saturday at 8pm". Default: YES, a final nag at 20:00 (16 slots). Alternative: last nag 19:00 (15 slots).
- **G2. Hour anchor.** Default: nags on clock hours counted from the start time (19:00, 20:00, ...), not "60 min after you dismissed". Dismiss at 19:40 means the next nag is 20:00.
- **G3. "Doing" button.** The alarm shows Done/Doing for task alarms. Default: Doing does not stop nags. Alternative: hide Doing on this alarm type.
- **G4. Quiet hours that swallow the deadline (S-32).** Default: quiet wins, no final nag. Alternative: one nag at the last non-quiet hour before the deadline.
- **G5. Editing the deadline mid-window.** Default: the open task's due date updates to the new deadline.
- **G6. Double alarm (AC-R6).** If the nightly builder schedules the occurrence task, its existing task start alarm could ring in the same hour as a nag. Default: at most one alarm per task per hour, with the nag taking precedence. The implementer must say which mechanism enforces it.
- **G7. Delivery latency.** I did not read the `notification-delivery` cron cadence. AC-P2's HH:05 bound needs confirming against it.
- **G8. Overdue reminders on a missed time card.** `generateOverdueReminders` (reminder-rules.ts L69) will treat an open past-deadline occurrence task like any overdue task and remind daily at 9 AM. Default: leave that existing behaviour as is (the task "absolutely must be done"). Owner to confirm.
- **G9. Agent tool.** The owner asked to edit items himself, in Settings. A chat/agent tool to manage the list is out of scope here unless he asks for it.
- **G10. Standards not opened:** WHATWG `<input type=time>` value format (affects S-2/S-4 from the UI), and IANA tz 2026 America/New_York transitions (assumed Mar 8 and Nov 1, 2026, per US rules). Neither was read in this pass. Rows S-21, S-22 and AC-T2/T3 must be confirmed by running the code with those instants, not from recall.
- **G11. Live proof.** AC-D1 (full-screen alarm with Done) and AC-D3 (email in inbox) can only be confirmed by the owner on his phone and in his inbox. A sandbox push log is mechanism-only evidence.
- Not covered by reading: `send-chat-message` and `send-unified-notification` internals, `notification-callback` (the Done action path), the `schedule_task_reminders` DB trigger, and `scripts/run-tests.mjs`. ACs that touch them are stated as observables, not line citations.

AC-DONE


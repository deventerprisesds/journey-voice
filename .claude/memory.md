# Project Memory — journey-voice
Last updated: 2026-09-03  (see also `.claude/accuracy-log.md` — wrong-first-answers + their structural guards)

## get_tasks now honors the advertised `query` param (fuzzy title search) — 2026-08-02
`getTasks` (`supabase/functions/execute-tool/index.ts`) previously IGNORED the `query`/`keyword` param
its own tool schema (`_shared/tool-definitions.ts`) advertised. On the large real board (234 tasks, 208
DONE) the legacy terminal `.order('start_time', {ascending:true, nullsFirst:false}).limit(50)` truncates
unscheduled/DONE tasks out of the top 50, so an agent couldn't resolve them BY NAME to then update them.
- **Fix (additive, executor-only):** when `args.query`/`args.keyword` is non-empty → tokenize, sanitize
  each token to alphanumerics only (`replace(/[^a-z0-9]/g,'')` — this is what makes the PostgREST `.or()`
  string injection-proof: no `,`/`(`/`)`/`.`/`*` can survive), drop stopwords + <2-char tokens, then
  `query.or(tokens.map(t=>\`title.ilike.*${t}*\`).join(','))`, SKIP the time_filter branch, order
  `created_at` desc, limit 50. Status/category filters still AND-compose. Zero significant tokens (e.g.
  "the task") → returns EMPTY (not a board dump). Absent/empty query → byte-identical legacy path.
- **Both consumers inherit it with zero extra work:** journey's own assistant AND Huddle (which fetches
  journey's tool catalog dynamically and proxies `get_tasks` through this same executor). No schema edit.
- **Proven (real rows, user `a3378f93-…`):** "Prepare investor pitch" (DONE, unscheduled) is ABSENT from
  the legacy top-50 but PRESENT via `query:"investor pitch"`; injection token collapses to a harmless
  single alnum ILIKE; query+status AND-composes. Deployed via `deploy-supabase-functions.yml` run
  30753410276 ("Deploy single function → success"). Chosen over a parallel Huddle-side fuzzy search
  (the "extend, don't duplicate" call).


## Purpose
journey is the primary life-assistant app (voice + chat, Iris the voice agent). It owns the OUTBOUND
half of the journey→Huddle task-sync mirror (see `CLAUDE.md`), and its `RealtimeVoiceAssistant.ts` is
the org's reference implementation for a live, barge-in voice agent.

## Voice architecture — OpenAI Realtime + ElevenLabs voices DO compose (reference impl lives HERE)
`src/utils/RealtimeVoiceAssistant.ts` is the canonical example, referenced across the org (Huddle's 1:1
`useVoiceCallRealtime.ts` is a lighter variant). The key fact, often re-litigated: you are NOT forced to
choose between OpenAI Realtime and your own ElevenLabs voices. Only OpenAI's *native end-to-end
speech-to-speech* is OpenAI-voice-only. Iris runs both together:

- **Realtime in text mode** — `modalities:['text']`; OpenAI generates the reply as **text**, not native
  speech-to-speech audio.
- **OpenAI's own audio track is muted** — `RealtimeVoiceAssistant.ts:~598` comments "OpenAI still sends
  audio via RTC track even with modalities:['text']" and disables that track in ElevenLabs mode.
- **Native turn-taking + barge stay OpenAI's** — on `input_audio_buffer.speech_started` it sends
  `response.cancel` (`:~897`) + `pauseAgendaForTangent`. Real interruption, not a freeze/re-speak hack.
- **ElevenLabs voices the text** — on `response.text.done` → `playElevenLabsAudio(text)` → the
  `elevenlabs-tts` edge function with that agent's `elevenlabsVoiceId` → MP3 → a **unified audio queue**
  that plays both OpenAI PCM and ElevenLabs MP3 sequentially.
- The `ttsProvider: 'openai' | 'elevenlabs'` field selects the path; server sends `tts_config` with the
  provider + `elevenlabs_voice_id`.

**The "one voice per session / voice can't change mid-session" limit is MOOT** in this pattern — the
voice comes from ElevenLabs per `playElevenLabsAudio` call, not the Realtime session — so distinct
per-agent voices are free. `gpt-realtime-2` (May 2026) did not change the native-S2S-is-OpenAI-voice-only
constraint. (OpenAI's own docs 403 the CCR WebFetch tool; confirm Realtime specifics by reading this
file / the SDK source, not web search alone.)

**Two roles Realtime can play — pick deliberately:**
- **AS BRAIN** (what Iris does here): the Realtime model generates the reply from its own
  instructions/thread. Lowest latency, but it REPLACES any app-side routing/snapshot/owner-awareness.
- **AS EAR ONLY** (Huddle `useVoiceCallRealtime`): `create_response:false` — Realtime does VAD/STT/barge
  only and never generates a reply; every utterance routes through the app's OWN pipeline (semantic
  router + agent snapshot + tools), ElevenLabs voices it. Keeps all app-side intelligence. Choose this
  when routing/snapshots/ownership must be preserved (Huddle's multi-agent ceremony needs this).

## Related
- Huddle side of the task-sync mirror + agent brains: `deventerpriseds-org/huddle-extension-app`.
- Supabase project ref, edge-function deploy, and the outbound task-sync trigger facts: see `CLAUDE.md`.

## Scheduling redesign — faithful dryRun harness (IN PROGRESS 2026-08-11)
Goal: test the scheduler by running the REAL pipeline verbatim (incl. the batch-calendar-scheduler AI
slotter — user is firm the AI is a MUST; deterministic keyword rules would be a REGRESSION). Approach:
add `dryRun` to `nightly-schedule-builder` that runs the full pipeline but performs ZERO writes; the AI
slotter is READ-ONLY (verified: no update/insert/upsert/delete — all writes are caller-side), so dryRun
fires the real AI and just collects the returned slots into `dryRunPlan` instead of persisting.
FIDELITY TRAP (R3, handled): the candidate pool filters `is_scheduled=false`, which is set by the
rollover/future-clear WRITES we skip in dryRun. So dryRun must (a) still SELECT the would-clear tasks and
add their ids to `dryRunClearedIds`, (b) drop the `is_scheduled=false` filter in the candidate + busy
queries, (c) exclude `dryRunClearedIds` from busy-slot capacity. Assert fidelity at the DETERMINISTIC
layer (task→day/window/tier/inclusion/archival), NOT exact AI minutes (non-deterministic by design).
Owner for validation: a3378f93 (rich custom config), project wwxgajrtmslzklnyplah. 20 ACs written by an
independent subagent. NOT the toy sim (that was scrapped — invented weights/no-AI/wrong owner; the
"stacked at 20:00" was a toy artifact, prod works). Redesign logic changes (composite-sort switch +
same-day flexibility nudge) come AFTER dryRun reproduces the live board.

## ⚙️ DEPLOYED: nightly-schedule-builder `dryRun` mode (2026-08-11) — REVERT + DISCOVERY NOTE
**What shipped:** `nightly-schedule-builder` now accepts `{dryRun:true}` → runs the FULL real pipeline
(incl. the read-only batch-calendar-scheduler AI slotter) with ZERO writes, returns the computed `plan`.
Commits `1697014` (scaffold) + `d113cc6` (impl) on branch `claude/huddle-journey-integration-xokgv1`,
PR deventerprisesds/journey-voice#26. Deployed to the LIVE journey project (ref wwxgajrtmslzklnyplah).
**The non-dryRun path is BYTE-IDENTICAL** (every change is an `if(!dryRun)` guard / conditional query
chain / `dryRun?collect:write` branch), so the nightly cron + every existing caller behave exactly as
before. This is why deploying was low-risk.
**HOW TO FIND IT LATER:** grep `dryRun` in `supabase/functions/nightly-schedule-builder/index.ts`, or
search memory for "faithful dryRun harness".
**HOW TO REVERT (if any unforeseen issue):**
  1. Code: `git revert d113cc6 1697014` on the branch (main was never touched — the PR is unmerged), OR
     close PR #26.
  2. Live function: redeploy the pre-change version by dispatching `deploy-supabase-functions.yml` with
     `ref=main, function_name=nightly-schedule-builder` (main still has the original). The dryRun path is
     opt-in + read-only, so leaving it deployed is harmless if reverting isn't urgent.
**Suspect this change if:** the nightly build ever behaves oddly → confirm by checking whether callers
pass `dryRun` (only an explicit `{dryRun:true}` invocation changes behavior; cron never sets it).

## ✅ dryRun harness VALIDATED live (2026-08-11) — faithful + zero-write PROVEN
Deployed nightly-schedule-builder (branch, run 31515722282) → invoked via pg_net (egress blocks
supabase.co; DB→fn works: `select net.http_post(...)` then read `net._http_response`; anon key as Bearer).
- **Zero writes PROVEN ×2** (singleDay + full week): tasks count/max(updated_at)/scheduled, task_schedule_history,
  activity_log, scheduled_notifications ALL byte-identical before/after (257 / 2026-08-11 13:24:36 / 35 / 912 /
  51684 / 8553). The AI slotter fired for real; nothing persisted.
- **Faithful:** full-week dryRun placed 36 tasks across 08-11..08-15, both main+reshuffle passes; 08-11 is CLEAN
  (church 07:30, pack-kids 08:30, consulting 10-12, biz-arch 12-14, nexus 14-16, AI-cert 16-17, research 19:00) —
  NO 20:00 stacking (that was the scrapped toy's artifact; prod works, as the user said).
- **Reproduces the reported RECENCY BUG:** fresh due-TODAY items pushed days out — "Make Amex payment due today"
  → 08-13, Complete MIT → 08-13, funding → 08-14, hair/braids → 08-14, packets/Review → 08-15. i.e. the real
  is_priority→rank→score sort buries fresh due-today items under old priority ventures. This is the faithful
  "before" the redesign must fix.
NEXT: implement switchable composite sort + same-day flexibility nudge behind flags; dry-run before/after to
show those due-today items move to 08-11.

## ✅ Composite scoring switch VALIDATED (2026-08-11) — recency fix works through the real pipeline
Commit 925d9df (deploy run 31525401213). `body.scoringModel:'composite'|'priority-rank'` (default priority-rank
= byte-identical). Composite = is_priority bonus +10/+5→+2/+1 + comparator orders by composite score first.
Before/after dryRun (default 563238 vs composite 563239, real AI, both 36 tasks):
- **Due-today items bubble up:** Make Amex payment 08-14→**08-11**; Complete MIT 08-14→**08-11**; Reserve hotel
  08-13→**08-11**; Confirm MIT/Push packets/Review rules/Style hair 08-15→08-13; Take out braids 08-16→08-13.
- **Default BYTE-IDENTICAL:** 08-11 SCORING_AUDIT top-10 hash identical old(562911) vs new(563238) = 35685991…
- **ZERO scheduler writes:** tasks.max(updated_at) pinned 13:24:36, history 912, notifications 8553, and 0
  nightly_schedule_built/reschedule_deferred rows since baseline. (Raw activity_log grew from LIVE-app
  push/alarm/chat noise — a3378f93 is an active production account — NOT from the dryRun. Lesson: on a live
  account, zero-write = tasks/history/notifications + scheduler-attributable activity rows, not raw activity count.)
Not all due-today LIFE items reach 08-11 (LIFE window = mornings/evenings only, fills up) → that's what the
FLEXIBILITY NUDGE (next lever) addresses: relax same-day-signaled items to flexible so they take today's daytime,
displacing lower-priority originals. Independent verifier running.

## ✅ parse_and_create_tasks dryRun (the "Add a task for today" BUTTON) — 1:1 baseline (2026-08-11)
Commit 8d70611 (deploy run 31534153742). `execute-tool` toolName `parse_and_create_tasks` now accepts
`args.dryRun:true` → runs the EXACT button flow (real ai-task-parser + real batch-calendar-scheduler,
both read-only) with ZERO writes; returns the plan (parsed tasks + scheduled slots + the previously-
discarded `rejected` set). 6 write sites guarded (W1 insert→synthetic in-memory task+index mapping,
W2 topic-map, W3 Outlook invoke [fire-and-forget — gate the CALL], W4/W6 activity_log, W5 schedule
update). Non-dryRun byte-identical. Invoke via pg_net: execute-tool body {toolName,userId,context,args}.
**Baseline it reveals (req 563558, 15 today-items, targetDate 08-11):** "would create 15", scheduler
places only **3** and REJECTS **12** — and the 3 include a DOUBLE-BOOK: Make Amex payment + Have kids
outfits BOTH 18:00-19:00. Rejects: "no available slot in window" (congested board, no displacement of
originals). This 1:1 reproduces the user's screenshot breakage (double-booking + external not blocked +
20:00-style piling). **ZERO writes proven:** tasks 257/mappings 197/create+sched-log 431 all pinned,
tasks.max(updated_at) pinned 13:24:36.
LESSON (important): earlier reconstructions were NOT 1:1 — the toy sim, the nightly-builder dryRun (spreads
across 7d, allowOverflow=false), and the isolated batch-calendar-scheduler call all diverged from the
real button (parse_and_create → batch targetDate=today allowOverflow=true → apply WITHOUT conflict re-check
→ double-books). Always test the EXACT function behind the UI control, not an adjacent one. The user had to
correct this 3x. NEXT (awaiting user go-ahead): fix the double-booking in this path — block existing tasks
+ external_calendar_events as busy, require end_times, and windows-first→displace lower-priority originals
(complaint #2) instead of rejecting; dry-run before/after.

## ✅ Conflict-aware apply for parse_and_create_tasks (the "Add a task for today" BUTTON) — 2026-08-11
Flag `args.conflictAware:true` (default off = byte-identical). Commits 4ef7b8c (feat) + 0d9bb68 (fix),
deployed to live via deploy-supabase-functions.yml (function_name=execute-tool, branch
claude/huddle-journey-integration-xokgv1). Solves the two complaints: recency/"work-on-these-today"
items get scheduled TODAY (windows-first, flexible round) instead of the AI slotter pushing overflow to
next day, and no double-booking / external events blocked.
- **How:** after the real batch-calendar-scheduler runs (AI stays central), the apply step loads the live
  busy set (existing is_scheduled tasks + non-all-day external_calendar_events) and places every created
  task via: (1) honor AI slot if free; (2) windows-first (user_scheduling_prefs config via resolveConfig,
  data-driven — NOT keyword rules); (3) flexible round anywhere free 06:00–22:00 local today;
  (4) displacement — earliest slot whose ONLY occupants are existing TASKS the incoming STRICTLY outranks
  (LOW<MED<HIGH<URGENT, tie is_priority); events + already-placed + equal/higher tasks are HARD, never
  cleared; ALL soft occupants of the taken slot are vacated together (tagged displaced-<date>, status
  UP_NEXT); (5) overflow surfaced. end_time ALWAYS = start+estimate. dryRun computes it all ZERO-write.
- **BUG caught by ground-truth (why 0d9bb68):** first cut displaced ONE occupant of a multi-occupant slot
  and placed anyway → live overlap (an URGENT item landed on a still-present task AND an inviolable event).
  Fixed with findSlotWithDisplacement (hard vs soft blockers, typed event/task/placed). RE-verified live.
- **Proven live (dryRun, user a3378f93, 08-11):** congested all-LOW 10-task input → packs the 2 real free
  gaps (3 placed, no overlap), overflow the rest, 0 displaced (LOW can't outrank existing MED — correct).
  URGENT/HIGH 3-task input → Submit 18:00 (flexible gap), Wire 19:00 (displaces LOW "Review 10 rules" +
  MED "Research Slack" — BOTH occupants of 19-20), Finalize 21:00 (skips the 20:00 "Pack bags" EVENT →
  correctly can't take the event slot, takes 21:00 displacing MED "Find sample"). Overlap SQL against the
  true busy set (excluding displaced ids): overlapping_tasks=0, overlapping_events=0, overlapping_placed=0
  for all 3. Zero-write confirmed: displaced-3 still is_scheduled=true, 0 test tasks created, 0 displaced tags.
- **Note (follow-on, not a bug):** the parser assigns LOW to unqualified "add these for today" items, so
  they won't displace existing MED originals — the "signaled for today = important" intent would need the
  parser/UI to raise their priority for displacement to fire on plain phrasing. Flag stays off until the
  user turns it on (QuickTaskInput would pass conflictAware:true).

## ✅ Builder dryRun fidelity fix + EXACT double-book trace (2026-08-11)
Complaint: composite builder dryRun appeared to double-book. TRACED EXACTLY (not assumed):
- The builder makes 3 batch-calendar-scheduler calls per day (assignments L897, main L1428, reshuffle
  L1578). The slotter avoids overlaps via intra-call acceptedSlots (validation 2, always) + DB-loaded
  is_scheduled tasks/events (validation 3). It takes NO busy-slots input and IGNORES the windowCapacity
  the builder sends (L43 never destructures it — dead param). Cross-call coordination is ONLY via DB
  writes: each pass writes is_scheduled=true, next pass reloads it.
- In dryRun those writes are gated off, so later passes can't see earlier ones → overlaps. PROVEN: all
  10 overlaps in a composite dryRun were main×reshuffle cross-call (0 within a single call, 0 same-task).
  A REAL run writes between passes so validation 3 prevents them — i.e. the double-book was a DRYRUN
  FIDELITY ARTIFACT, not a production bug (matches user: "I never experienced conflicts").
- ALSO: earlier "5 tasks stacked 08:30–10:00" was MY display error — I showed HH:MM and grouped by the
  plan's `day` field, but `day`=iteration targetISO while allowOverflow lets reshuffle spill to +1/+2
  days; real start_time dates were 08-11/12/13, no same-day overlap. Always read full start_time, never
  the `day` field, and never drop the date.
FIX (commit ce1cd3a, both fns deployed): batch-calendar-scheduler accepts `busySlots` (deduped vs DB,
treated as scheduled tasks for overlap + prompt); nightly-schedule-builder passes accumulatedBusySlots
on all 3 calls. Real run unchanged (injected slots already persisted → dedup no-op). PROVEN live:
composite dryRun overlapping_pairs 10 → 0 (34 placements).
OPEN (separate real bug, not fidelity): 1 plan row gets start_time=1970-01-01T00:00:00Z ("Research Slack
AI Agents") — epoch-0 bad value in the real scheduling path. Not yet traced/fixed.
COMPOSITE SCORE (corrected understanding): NOT "recency". It's multi-factor (index.ts:1102-1159:
due-soon±48h +5, 3-7d +3, financial/comms keyword +5, topic +2, UP_NEXT +1, recency +1/2, assignment
grace +10) and its POINT is DEMOTING the is_priority weight (+10-15 → +2-3, L1107) so deadline/finance/
recency can compete instead of old flagged-priority items monopolizing the day. Recency is one minor term.

## ✅ epoch-0 slot bug fixed (2026-08-11)
Traced exactly: batch-calendar-scheduler, when the AI returns a result with a null/empty start_time,
`normalizeDateTime(null)`→null, then `snapTo15(null)` does `new Date(null)`=epoch-0 → the slot becomes
1970-01-01T00:00:00Z (+15min via the end<=start guard). It slips ALL validation: 19:00 local is an
allowed window and a 1970 interval overlaps nothing present, so it gets "scheduled" at a bogus date
(observed: "Work on consulting AI project"). FIX (commit fdf1180, deployed): null-guard before snapTo15
rejects the slot (reason `ai_missing_or_invalid_time`) so the task stays unscheduled / reshuffle-eligible.
PROVEN live: composite dryRun epoch0 1→0, overlapping_pairs still 0, the task now placed 2026-08-13 09:30.

## ⏳ OPEN: production nightly builder delays the day's start by ~1h (2026-08-12)
CONFIRMED (evidence): production Wed 08-12 first task=10:00 with 09:00 free (no event) and the nightly
builder ran at 01:01 ET (runId 32bd4f13) with the whole day ahead → day starts ~1h late. Slotter is
EXONERATED: called directly (1 task AND 5 tasks) it places business_hours at 09:00 correctly. NOT my
deploys: nightly ran 05:01 UTC, my builder/slotter deploys landed 07:14 UTC (after). computeUsedMinutes/
getActiveWindows use raw config hours; tzOffset=-04:00 EDT correct. So the +1h is in the BUILDER's real-run
orchestration — the slotter only returns 10:00 if 09:00 looked BUSY at call time (transient occupant that's
empty now), OR the AI anchors late. Could NOT pin from persisted data (get_logs edge-function = request-level
only, no console output; run was 8h old).
DIAGNOSTIC IN PLACE (commit efad832, deployed, TEMPORARY — MUST REMOVE after pinning): batch-calendar-scheduler
now writes an `activity_log` row `activity_type='slotter_trace'` per call with metadata.input (nowET, targetDate,
tasks, busy intervals) + metadata.output (rawAI raw slots, finalScheduled, rejected). Verified working
(rawAI 09:00 on a clean test). 
SCHEDULED CHECK-IN: send_later trig_01Sr3wCkcuQZ6Zg5ex8uAgto fires 2026-08-13T05:30:00Z (~01:30 ET, after the
~01:00 nightly cron) to read the run's slotter_trace rows: if rawAI earliest=10:00 → AI anchors late (prompt);
if input.busy has a phantom 09:00-10:00 → builder feeds bad busy set (orchestration). Then fix + REMOVE the
slotter_trace diagnostic. USER ASKED to be reminded of this tomorrow when they mention it.

## UPDATE (2026-08-13 nightly): day-start delay did NOT reproduce on current code
Tonight's real nightly run (01:00 ET, runs on my deployed busySlots-fidelity + epoch-0 code) shows NO
1h delay: board first slots Thu 07:00, Fri 07:00, Sat/Sun 10:00 (weekend-correct). slotter_trace for
today's MAIN pass: input.busy=[] and output.rawAI placed earliest at 06:00 (morning) + 09:00 (business)
— AI correct, no phantom 09:00 busy. So the 08-12 10:00 start was on the OLD code (pre-deploy 07:14 UTC
08-12); the busySlots fidelity fix appears to have also closed the real-run day-start gap. NOT declaring
fixed off one night (user has seen it repeatedly; may be intermittent/data-dependent). Keeping slotter_trace
diagnostic (commit efad832) IN for one more nightly run to confirm; remove after tomorrow's run if clean.
Check-in re-armed for ~01:30 ET 08-14. Awaiting user confirm that today's board looks right.

## ✅ 5am notifications — root cause + fixes (2026-08-18)
User got pushes at ~4-5am. Root cause was pervasive UTC-vs-user-timezone bugs across the notification stack:
1. **notification_prefs.timezone was 'UTC'** (should be America/New_York) → isInQuietHours evaluated the
   02:00-06:00 quiet window in UTC = 10pm-2am ET, so 4-5am ET wasn't "quiet". FIXED (data): set TZ=
   America/New_York, quiet 22:00-06:00.
2. **notification-scheduler timed everything off the Deno UTC clock** (now.getHours()===8/9) → daily digest
   fired 4am ET, overdue reminders 5am ET; overdue was also un-gated by quiet. FIXED (commit 74ba671):
   userNow from prefs.timezone drives shouldSendDailyDigest/WeeklyDigest + overdue trigger; overdue now
   gated by !inQuietHours. (generateDueReminders is dead/uncalled — DB trigger owns due/start reminders.)
3. **DB trigger schedule_task_reminders scheduled due_tomorrow at "09:00" in the UTC session = 05:00 ET.**
   FIXED (migration 20260218000000_due_tomorrow_tz_aware): compute 9am on the day-before-due in the USER's
   tz via `(((due_date AT TIME ZONE user_tz)::date - 1) + TIME '09:00') AT TIME ZONE user_tz`. Also
   rescheduled the 13 already-queued due_tomorrow rows from 05:00→09:00 ET.
OPEN (flagged, not yet fixed): due_soon (~23:44 ET) and due_now (~23:59 ET) from the same trigger fall
inside quiet (22:00-06:00) — they're end-of-day due pings, not the 5am complaint. The SYSTEMATIC catch-all
is a **delivery-time quiet gate** in notification-delivery (defer any notification whose fire time is in the
user's quiet hours to quiet-end) — one place, covers every source (digest/overdue/due/calendar/future).
notification-delivery currently only special-cases already-flagged queued_during_quiet; it has no general
delivery-time quiet check. Recommend implementing that as the durable fix. VERIFY LIVE: user should confirm
no 4-5am pushes tomorrow.

## Self-serve scoring-model switch (composite ⇄ priority-rank) — 2026-08-20
User asked to make the composite vs priority-rank choice self-serve so they can flip it, watch it in
production for a week, and flip back — no code change per switch. Built two pieces (branch
claude/huddle-journey-integration-xokgv1):
1. **Builder reads per-user config** (`nightly-schedule-builder/index.ts`). Was: global `scoringModel`
   from request body only. Now: `bodyScoringModel` (override, or null) resolved from body at top; INSIDE
   the per-user loop `const scoringModel = bodyScoringModel ?? (config.scoringModel === 'composite' ?
   'composite' : 'priority-rank')`. Resolution order = body override → user's config.scoringModel →
   'priority-rank' default. Top-level response field became `bodyScoringModel ?? 'per-user-config'`
   (per-user actual model is on `results[userId].scoringModel`, unchanged, inside the loop). Backward
   compatible: no config + no body = byte-identical priority-rank.
2. **UI toggle** in Settings → Scheduling. The core funnel is `user_scheduling_prefs.config` (JSONB).
   Trace: `saveUserSchedulingConfig` destructures dedicated columns and dumps the rest (incl.
   scoringModel) into `config` JSONB — so SAVE works automatically. But `mergeSchedulingConfig`
   (schedulingRules.ts) rebuilds config FIELD-BY-FIELD (no top-level spread), so a new field is DROPPED
   on reload unless named there — added `scoringModel: userConfig.scoringModel === 'composite' ?
   'composite' : 'priority-rank'`. Also added the field to the `SchedulingConfig` interface + default
   'priority-rank'. UI: a "Scheduling Strategy" card (Select: Priority-first default / Balanced
   composite) writing `config.scoringModel`. This is the same JSONB field the builder reads — one
   source, no parallel store.
The actual FLIP for user a3378f93 (set config.scoringModel='composite') is the USER's switch to make in
the UI, or a separate confirmed step — NOT done as part of building the mechanism. Revert per user =
flip the toggle back (or unset config.scoringModel). Issues 1 (maxPerDay cap) + 2 (composite overdue
escalation) already fixed+verified live in commit c5de8f4; Test task 47f6d33e cleaned up (0 remaining).

## UPDATE (2026-08-20): composite is now the DEFAULT + user flipped live
User: "the default should be composite not priority rank, also switch it to composite immediately."
- Inverted the default everywhere (commit follows 5445bc2): builder per-user fallback now
  `bodyScoringModel ?? (config.scoringModel === 'priority-rank' ? 'priority-rank' : 'composite')`;
  bodyScoringModel checks 'priority-rank' first; DEFAULT_SCHEDULING_CONFIG.scoringModel='composite';
  mergeSchedulingConfig `=== 'priority-rank' ? 'priority-rank' : 'composite'`; UI default `?? 'composite'`,
  labels "Balanced (default)" / "Priority-first (legacy)". Only an explicit 'priority-rank' opts OUT now.
- Flipped user a3378f93 live: set config.scoringModel='composite' (has_key=true) — effective on the
  currently-deployed builder for tonight's nightly build immediately; new-default builder deployed too so
  no-key would also = composite. Backward-compat note: this is a DELIBERATE behavior change (composite is
  no longer opt-in), per explicit user request — the old "no config = byte-identical priority-rank" claim
  no longer holds by design.

## Task-creation dedup guard (Phase 1) — 2026-08-20
Finding (ground-truthed): journey had NO dedup on task creation. `parse_and_create_tasks` fetches
existingTasks but passes them only as SCHEDULING context to ai-task-parser; the insert loop had zero
title check. ai-task-parser uses existingTasks only for slot-avoidance. So exact-title dupes landed
(3 near-dup Klarna tasks created in one 3.5-min burst; 2 exact-title). Huddle side has
`loadExistingOpenTitles()` normalized-exact dedup — journey's path never got it.
Built (branch claude/huddle-journey-integration-xokgv1), flag-gated `config.dedup.enabled` (default OFF):
- `_shared/task-dedup.ts`: shared module. titleSignature (lowercase, strip punct, drop SAFE stopwords,
  dedupe+sort tokens) collapses "Make payments to Klarna" == "Make Klarna payments" == "klarna make
  payments". buildDedupPlan: signature exact-match (vs open tasks + in-batch siblings) → duplicate;
  else semantic cosine (OpenAI text-embedding-3-small, reuses OPENAI_API_KEY, batched) ≥highThreshold
  (0.90) → duplicate(skip), [possibleThreshold 0.80, high) → possible(create+tag 'possible-duplicate',
  NEVER merge distinct). Fail-open on embed error. Within-batch dedup. runDedup/finalizeDedup DB
  orchestration (loadOpenTasks excludes DONE/completed; one scheduled_notifications 'dedup_notice' per
  batch — reuses existing delivery, no new sender). Thresholds config-driven.
- Migration `20260220000000_task_dedup_log` (APPLIED live): audit table capturing FULL candidate
  payload (undo source) + matched/method/similarity/created_task_id. RLS own-row select/update.
- Wired into execute-tool `create_task` (single) + `parse_and_create_tasks` (bulk, index-aligned;
  all-skipped returns success not error; surfaces dedupedDuplicates preview incl. dryRun).
- Offline unit tests 10/10 (supabase/functions/_shared/task-dedup.test.ts, mock embedder).
User decisions (2026-08-20): keep the Aug-20 Klarna task, removed the other two (rows captured for undo
in transcript). Approach = "Normalized + semantic, surface a note for genuinely-distinct (don't merge),
notify me on every dedup so I can review/undo." Phase 2 TODO: wire mcp + twilio-voice paths; undo
action/UI; then enable the flag for the user after live verification.

## Dedup notifications → Iris chat + undo (Phase 2) — 2026-08-20
User feedback: tapped the dedup push, wasn't taken to Huddle/journey Iris chat, couldn't read the
truncated body. Root cause (Explore-mapped): dedup push had no tap target — journey web SW routes on
data.openCommsConsole/type (public/sw.js:165-217), not deepLink; the regular-batch push builder
(notification-delivery:650) never forwards scheduled_notifications.metadata; no in-app surface showed
full text. Fix (chosen destination = Iris chat, per user):
- finalizeDedup now writes notification_type='scheduled_chat' with metadata.message = FULL untruncated
  Iris text (+ metadata.dedup summary for undo). notification-delivery's existing scheduled_chat branch
  (index.ts:388-405) invokes send-chat-message → inserts an assistant conversation_messages row (Iris
  message in chat) AND sends a push with openCommsConsole → tapping OPENS the chat. Reuses existing
  infra, zero new deep-link plumbing.
- New `undo_dedup` tool (execute-tool + tool-definitions): restores skipped task(s) from task_dedup_log
  (bypasses guard), default = most-recent batch (rows within 5s), or {all:true}/{log_id}. Iris calls it
  on "undo"/"add it back". Marks undone_at + created_task_id.
Verified LIVE end-to-end (execute-tool redeployed): skip → scheduled_chat row → notification-delivery →
Iris conversation_messages row (role=assistant, source=chat, full text) + delivered; undo_dedup restored
"Make Klarna payments" to the board. All test artifacts cleaned (task, chat msg, notif, log rows = 0).
Board Klarna = 1 real task (Aug 20). Guard still enabled. chat store = public.conversation_messages
(thread=ai_threads, one per user); send-chat-message is the system-initiated Iris-posts path.

---

<!-- MERGE 2026-08-20: both sessions' memory retained in full. Above = huddle-journey-integration
     (dedup guard, composite scoring, shadow-run harness). Below = mobile-widget-web-bridge-debug
     (scheduler trait layer, config-authoritative placement, window reconciliation). -->

# Project Memory — journey-voice (Scheduler focus)
Last updated: 2026-07-24 by session 017C29GJuPwR4Z4gJmiyCyGf

> Scheduler-scoped memo: how tasks get scheduled (priorities + external events +
> old/new, placed into sensible time windows) and the agreed direction to make it
> reliable. Companion: huddle-extension-app `.claude/memory.md` (Huddle = ranking only).

## ⭐ CONFIG-AUTHORITATIVE PLACEMENT (LOCKED 2026-07-31 — supersedes any earlier "load-up" idea)
The user's in-app **config page** → `public.user_scheduling_prefs.config` (timeWindows +
categoryMappings + contextRules) is the **SINGLE SOURCE OF TRUTH** for what can be placed in which
window. Hard rules (also in CLAUDE.md):
- **GO BY THE CONFIG.** Never reassign a category to a non-allowed window; never "load up" outside
  config-allowed windows. `_shared/scheduling-defaults.ts` is only a FALLBACK when config is absent.
- **Only an APPOINTED (pinned) time overrides a configured window.** Traits/keywords/priority/load-up
  affect ONLY ordering + preference AMONG already-allowed windows.
- **"Load up" = pack each category's ALLOWED windows on the earliest days first** so the week trails
  off — WITHIN the windows, never by breaking them.
- **Empty allowed window (capacity, no eligible task) → Iris NUDGES the user** ("fill this window with
  other items, or add new tasks?") reusing the B3 nudge mechanism. The scheduler does NOT auto-fill by
  relaxing rules. THIS is the sanctioned fix for gap/thin days — not window overrides.
- **NAIL the existing config/window/trait/priority behavior before adding anything new.**
- ❌ DROPPED (my over-reach, 2026-07-31): putting VENTURES in weekday business hours; a new
  "institution-hours" trait; soft evening ceilings. All rejected — they broke the windows.

### LIVE STATE (2026-07-31) — ROOT CAUSE + what's done/open
- **ROOT CAUSE of "never adheres to my config":** the live working account **`a3378f93`**
  (dev@enterpriseds.io, ~19 VENTURES-heavy open tasks) had an **EMPTY `config`** → the builder ran on
  hardcoded defaults the ENTIRE time. Only DEMO `…0001` (0 tasks) had a populated config. RLS + the
  save code are fine — it was simply never saved; `loadUserSchedulingConfig` shows merged defaults so the
  page LOOKS configured (UX trap). (Supersedes line ~101's "confirm which account".)
- **DONE (user-approved):** duplicated DEMO config → `a3378f93`, reconciled `after_work`→**17-19 [1-5]**
  (demo had the OLD overlap bug after_work 17-**22** [Mon-**Sat**]) and `maxDailyHours`→**0** (uncapped;
  builder treats 0/absent as Infinity — for the 9am-10pm goal).
- **OPEN demo-config mismatches (config edits = user's call, DO NOT guess):**
  - `VENTURES/CAREER → [business_hours, weekends]` only → weekday work stops 5pm, evening empty → NO
    9-10pm. To hit the goal, add `after_work`+`evening` to VENTURES/CAREER.
  - `EDUCATION → [flexible, business_hours, weekends]`, `PROF_EDUCATION → [after_work, weekends,
    business_hours, evening, flexible]` — neither matches the user's intended **evenings + weekends**.
  - **Education split NOT enforced in code:** EDUCATION vs PROF_EDUCATION are enums the builder LUMPS
    (stale-archive `category IN (EDUCATION,PROF_EDUCATION)`). "Assignments to submit" keys on
    **`assignment_id`, NOT category** (tiers A/B/C, maxPerDay 2, 7-day grace, never-archive). User's model:
    EDUCATION = formal degree (MBA/doctorate) → assignments, deadline-tiered, evenings+weekends;
    PROF_EDUCATION = training/courses → flexible, evenings+weekends. Currently 0 assignment-linked tasks.
- **Manual rebuild (verify without cron wait):** `net.http_post` the builder `{userId, triggerSource}`;
  read `activity_log`(`nightly_schedule_built`) + its PLACEMENT steps. Rebuild MUTATES the real schedule
  → only with user approval. NOTE: memory line ~88 "after_work 17–22" is STALE; canonical is 17-19 [1-5].

## THE ASK (2026-07-24)
Get **consistent** scheduler results — priorities, external calendar events, new AND
old tasks — **without old-but-important items dropping off**. Tasks land in a
**time-window system** with **common-sense checks** (not per-noun keywords) so items
go to sensible windows. Deliverables: (1) heavy assessment → memory + CLAUDE.md [this];
(2) gap review + scheduler sub-agent decision; (3) test plan judging schedules like an
executive/life assistant. Scope guard: **no meal windows** — make the working 80% → 100%.

### Refinements the user gave (authoritative)
- **Common sense, not keywords.** Church→Sunday etc. must fall out of general reasoning,
  not a keyword dictionary. Keywords may exist only as **test oracles**.
- **Venue-dependent errands** (bank, post office, gov office, pharmacy): default
  **after-work**, then a **nudge** to move to business/lunch hours when the venue is
  likely closed then. Must be caught **systematically** (trait), not per-word.
- **Doctor/dentist = Pinned trait.** When a real appointment time exists → **pinned/
  immovable**, any window ("already appointed outside your control"). When just an
  unbooked to-do → **flexible, NOT forced to business hours**. Hardcode doctor/dentist
  as **ground-truth anchors** to TEST that the systematic layer catches siblings
  (optometrist, physio, vet, specialist) the same way.
- **Value-aware overflow.** Current behavior: full window → task rolls to next available
  day for that window (KEEP for ordinary items). **Nudge only when a HIGH-IMPACT item
  overflows** (financial / time-sensitive / pinned appt / communication) so it can be
  **bumped up** (displace a lower-value item). Overflow nudge triggers on **any** full
  window, not just after 5pm. Scheduler ALREADY scores these high (reuse the signal).
- **External meetings need confirmation** ("are you doing this?"). On decline/no-show,
  release the slot and slot the **next task of that same category** into it.

## TRAIT MODEL (agreed design)
Classify each task by 3 orthogonal traits (inferred by the common-sense layer); rules
act on traits, not nouns → generalizes to unseen tasks:
| Trait | Detects | Behavior |
|---|---|---|
| Venue-dependent | needs a place/service w/ operating hours | default after-work; nudge to business-hours/next-open-day when likely closed |
| Pinned/fixed-time | externally-set slot (booked doctor/dentist/meeting) | placed at exact time, immovable, any window; unbooked → flexible, not forced to business hours |
| Impact-if-missed | financial / time-sensitive / others-waiting | value-aware overflow nudge (bump vs quiet roll); already scored high |

## Responsibility split (verified)
- **journey-voice = PLACEMENT.** Owns `tasks` (canonical), window defs, category/keyword
  →window mapping, nightly builder + batch scheduler (assign `start_time`),
  `find_open_slots`, external-calendar awareness, scoring/archive.
- **huddle = RANKING ONLY.** Mirrors tasks → Azure PG, additive score, `prioritize`
  returns ranked list. No time-window placement in Huddle. The "after_work 17–22 vs
  17–19" note in Huddle's CLAUDE.md is a drift *between two journey files*.

## Placement pipeline (journey)
- **Nightly builder** `supabase/functions/nightly-schedule-builder/index.ts` (~1770 ln),
  cron `0 3 * * *` **UTC** (global, not per-user tz). rollover→clear→archive→tier→
  score→dispatch. Scoring `:988-1072`, sort `:1079-1112`, archive `:542-631`,
  keyword override `getKeywordWindowOverride` `:219-243` (invoked `:1175`). ONLY path that reads keywords.
- **Batch scheduler** `supabase/functions/batch-calendar-scheduler/index.ts` (~767 ln).
  Assigns `start_time`: Gemini prompt + 3 validation passes + gpt-4o-mini "common-sense"
  pass `:666-743`. **Common-sense day/time matching lives in the prompt RULE 1c `:335-343`**
  (church→Sunday, errands→weekday business hrs, gym→morning, etc.) + RULE 1b hints `:363-372`.
  gpt-4o-mini pass **silently no-ops if OPENAI_API_KEY unset** → guard can vanish.
- **Smart scheduler** `supabase/functions/smart-calendar-scheduler/index.ts` (~1051 ln).
  Single-task manual/voice path. **Divergent engine**: own inline DEFAULT_CONFIG `:242-329`,
  only 4 categories (LIFE|CAREER|VENTURES|EDUCATION — no PERSONAL/PROF_EDUCATION), **NO
  RULE 1c common-sense**. Imports `validateTaskWindow` only. Root of path-dependent results.
- **execute-tool** `.../execute-tool/index.ts` (~2603 ln): `findOpenSlots` `:2436`,
  reschedule/move/swap/explainScore; server scoring mirror `:2295-2359`.

## Time windows — canonical (`_shared/scheduling-defaults.ts:29-45`)
```
morning 6–9 [1-5] | business_hours 9–17 [1-5] | after_work 17–22 [1-5] (weekdays)
evening 19–22 [0-6] | flexible 9–22 [0-6] | weekends 10–20 [0,6]
CAREER→[business_hours] PROF_EDUCATION→[after_work,weekends] max2/day
EDUCATION→[flexible] VENTURES→[after_work,weekends] LIFE/PERSONAL→[flexible]
```

## Live settings (DB: user_scheduling_prefs, tz America/New_York)
- Config is edited from a **GUI**, persisted to `public.user_scheduling_prefs.config` (JSON) + timezone.
- Saved `contextRules.keywords` ALREADY map bank/doctor/dentist/post_office→business_hours,
  errands/grocery/shopping→after_work, meeting→business_hours, appointment→flexible — but
  **only nightly reads keywords; the voice/manual path ignores them.**
- Config also has `customAIInstructions` (free-text), `workingHours`(maxDailyHours 7,
  breakMinutes 60), `workloadBalance`, per-category `estimatedDuration`, `PROF_EDUCATION.maxPerDay 2`.
- **Two rows:** seed user `…0001` has the rich config; real user `cce61d43…` has config `{}`
  (empty → runs entirely on hardcoded defaults). CONFIRM which is the live account.

## CONFIRMED BUGS / GAPS (evidence-based)
1. **Window config duplicated 5× and DRIFTED** — canonical `scheduling-defaults.ts` not
   imported by all. after_work 17–**22** (placer/validator) vs **17–19** (timeWindows.ts,
   build-day-context, execute-tool:2309/2317, dailyReviewPipeline, call-context-builder:805).
   evening/weekends also drift in execute-tool `:2318-2319`. → placed-window ≠ shown/searched-window.
2. **smart-calendar-scheduler is a divergent engine** (own config, no common-sense, 4 cats)
   → **path-dependent results**: same task scheduled differently by nightly vs voice/manual.
3. **array-vs-string LIVE bug** — GUI writes `categoryMappings.X.defaultTimeWindow` as an
   ARRAY (e.g. LIFE=["after_work","weekends","evening"]); smart-scheduler expects a STRING
   (`:216-220`) and silently drops it → user's saved category windows ignored on voice path.
4. **Keywords only read by nightly** → voice/manual bank task won't go to business hours.
5. **Overdue drift (seen in live data):** overdue non-assignment VENTURES tasks scheduled
   ~a week PAST their due date (due 2026-07-22, placed 2026-07-29/30). RULE 4 violated.
   Non-priority MED/LOW old-but-important tasks still take −3/−10 staleness + archive at 5+ pushes.
6. **windowCapacity computed then IGNORED** by batch (`batch:43`) → over/under-packing.
   `workingHours.maxDailyHours` likely not enforced.
7. **find_open_slots UTC-naive day bounds** `execute-tool:2442-2443` → misses 8pm–midnight local, DST-fragile.
8. **customAIInstructions** (GUI free-text) appears NOT injected into batch prompt (hardcoded). Likely dead.
9. **No venue-hours concept. No overflow QUEUE table/status. No pinned/fixed-time flag.** (to be added)
10. Nightly cron 3 AM **UTC** for all users (far-east users get mid-evening rebuilds).

## CORRECTIONS to earlier shallow findings (do not repeat)
- **Reminders ARE created on auto-schedule** — via DB trigger `schedule_task_reminders_trigger`
  (`…20251015004913…sql`) `AFTER INSERT OR UPDATE OF … start_time …` on tasks: creates
  `task_start_reminder` (default 15m before), `task_start_now`, due-date reminders; delivered by
  `notification-delivery` cron (every min). `generate-task-reminders` edge fn is LEGACY/superseded.
- Priority IS already elevated for financial/comms/time-sensitive: batch RULE 2 A/B/C `:374-389`;
  huddle scoring `hasSchedulingPriorityKeyword`+5, `isDueSoon`+5, `is_priority`+10.

## THE PLAN (scoped: 80%→100%, no meal windows)
A. **One source of truth** — collapse 5 window/category copies onto scheduling-defaults;
   reconcile after_work/evening/weekends drift; **de-fork smart-calendar-scheduler**;
   **fix array-vs-string** so saved category windows are read; wire dead GUI settings.
B. **Trait/common-sense layer in EVERY path** — reliable (not gated on OPENAI_API_KEY),
   present on nightly AND voice/manual; implement the 3 traits + venue-hours (LLM knowledge + nudge).
C. **Value-aware overflow** — quiet roll for ordinary; **nudge on high-impact overflow** to
   bump; **overflow queue** the agent watches; **external-meeting confirmation** releases slot
   to next same-category task.
D. **Overdue front-loading** — stop scheduling overdue tasks past due date.
E. **Pinned/fixed-time flag** — add the missing immovable-time concept (doctor/dentist booked).
F. **Test plan** — golden-path vs real pipeline: doctor/dentist anchors + sibling generalization;
   venue nudge; pinned immovability; high-impact overflow bump; external-meeting release;
   overdue front-loading; drift regression (placed-window == reported-window).

## Files to change (when we act)
- Windows/category (edit together): `_shared/scheduling-defaults.ts` (canonical) →
  `src/config/schedulingRules.ts`, `src/lib/timeWindows.ts`, `_shared/build-day-context.ts`,
  `src/utils/buildDayContext.ts`, `execute-tool:2305-2322`, `_shared/call-context-builder.ts:803-806`.
- De-fork: `smart-calendar-scheduler:242-329` → import `resolveConfig`/defaults + add common-sense.
- Placement: `batch-calendar-scheduler` prompt `:318-421`, validation `:585-644`, sanity `:666-743`; wire `windowCapacity`.
- Scoring/freshness/archive: `nightly:988-1072,542-631` + mirrors `schedulingCandidates.ts`, `execute-tool:2295-2359`.
- Reminders already handled by DB trigger `schedule_task_reminders` — don't rebuild.
- find_open_slots tz: `execute-tool:2442-2443` → `localDateToUtcBounds`.

## Sub-agent decision
No dedicated scheduler agent today — placement is raw Gemini/gpt-4o-mini calls in edge fns.
Direction: deterministic window/trait layer (source of truth + validation/repair) with an
LLM proposing and the deterministic layer validating — LLM not the only guardrail.

## Open inputs
- Settings wired-vs-dead sweep (agent) still to finalize the exact dead-settings list (§A, gap 8).
- Confirm which user_scheduling_prefs row is the live account.

## Active work
Assessment COMPLETE. IMPLEMENTATION IN PROGRESS on branch
`claude/mobile-widget-web-bridge-debug-nsishi` (journey-voice). Section A (source of
truth / de-fork / array-vs-string) + Section B #1–#4 DONE, deployed, verified:

### DONE + deployed (Section B)
- **B1 LLM trait generalization** (`_shared/scheduling-defaults.ts`): `classifyTaskTraitsLLM`
  (Lovable gateway google/gemini-2.5-flash, temp 0, returns null on any failure → deterministic
  anchor floor never lost), `mergeTraits` (OR-merge, LLM can only ADD a trait). Wired into
  smart-scheduler (per-task) + nightly (warm a title→traits cache ONCE, concurrency 5, before the
  day loop). Keyword fallback now RARE; LOUD ⚠️⚠️ warn + placementBasis/keywordFallbackNotice
  when it IS hit. LIVE-verified: DMV→venue_dependent, optometrist→appointment (both source=trait,
  keywordFallbackUsed=false).
- **B2 Appointment pinning** (`scheduling-defaults.ts` + smart-scheduler): `parseFixedClockTime`
  (title time, requires am/pm or colon), `WindowPlan.pinned`/`fixedTimeMinutes`, source `'pinned'`.
  Booked appt (appointment trait + concrete time) → pinned at EXACT time, immovable, ANY window
  (smart-scheduler fast-path BYPASSES window validation so a 7am appt isn't rejected); unbooked →
  flexible (unchanged). `isAutoPlaceableWindow` lets pinned fill weekend evening. LIVE-verified:
  3pm→15:00, 7am→07:00 (out-of-window honored), no-time→flexible.
- **B3 Venue nudge delivery** (nightly + build-day-context server+client + DailyReviewModal):
  nightly persists `scheduling_context.venue_nudge={toWindow,message}` at both write sites; day
  context exposes `venueNudges` + lists them in `summarizeDayContext` (→ morning-review assistant
  gets them in DAY_CONTEXT); modal shows an amber banner. NOTE: server `build-day-context.ts` is a
  parity MIRROR not yet imported by any edge fn — the LIVE path is the frontend `src/utils/
  buildDayContext.ts`.
- **B4 maxDailyHours cap** (nightly + scheduling-defaults): `resolveMaxDailyMinutes(config)` /
  `withinDailyCap()`. Nightly seeds day-used from already-scheduled tasks (NOT external events),
  defers tasks past the budget (reason `daily_hours_cap`), stops the day at budget, surfaces
  overcommit in the PLACEMENT trace.
  **⚠️ REGRESSION FOUND + FIXED (2026-07-31):** B4 originally defaulted the cap to 7h when unset,
  which silently THINNED every day — live proof: days hit exactly 420 min and deferred 6 & 16 tasks
  purely to the cap; user saw sparse days. Fix: `resolveMaxDailyMinutes` returns **Infinity when the
  user hasn't set a positive `workingHours.maxDailyHours`** → NO cap by default, day fills by window
  capacity as before (OPT-IN only). Verified live: rebuild after fix → maxDailyMinutes=null,
  cap_deferrals=0, first days fill to ~600 min (10h), today 6→9 tasks. **Lesson: a default-on
  numeric cap is SUBTRACTIVE — keep new limiters opt-in.** The `manual_rebuild` invocation:
  `net.http_post` the builder with body `{userId, triggerSource}` (single-user full rebuild).

Verification method (egress: supabase.co BLOCKED from sandbox): `deno check` on the shared module
(only fully type-checkable file); deterministic `deno run` unit tests off the shared module; LIVE
smoke via `net.http_post` from the DB → read `net._http_response` (pass `timeout_milliseconds:=20000`
— default 5000 sometimes DNS-times-out on the FIRST call, retry once). Do NOT run the nightly builder
live (mutates the user's real schedule).

- **B5 Value-aware overflow + queue** DONE, deployed, LIVE-verified. NEW table
  `public.task_overflow_queue` (migration `20260726000000`; RLS own-row read/update; builder writes
  service-role). `classifyImpact()` in scheduling-defaults reuses scorer signals (FINANCIAL_KEYWORDS /
  COMMUNICATION_KEYWORDS whole-word, is_priority, due_soon/overdue, high score) — NO recompute.
  Nightly clears the user's OPEN rows at run start, collects high-impact overflows at BOTH rejection
  sites (daily_hours_cap + no_window_capacity) with a suggested bump (lowest-scored placed task below
  it), upserts after the week loop keeping only tasks never scheduled in the run (one row/task).
  Ordinary overflows quietly roll (unchanged). DailyReviewModal fetches OPEN rows → rose banner +
  attaches to assistant dayContext. Write-contract verified live (insert/upsert idempotent/cleanup).
- **B6 External-meeting confirmation + slot release** DONE, deployed, LIVE-verified end-to-end.
  NEW table `public.external_event_attendance` (migration `20260726010000`; keyed by STABLE
  external_event_id so it survives calendar delta re-sync; RLS own-row). NEW edge fn
  `confirm-external-meeting`: records decision (idempotent upsert); on decline/no-show RELEASES the
  freed window → next unscheduled same-category task that fits, scheduled into the exact slot
  (`scheduling_context.backfilled_from_meeting`), marks released+backfill_task_id; idempotent (no
  double-fill); attending just records. Ranks candidates like the builder. LIVE test: declined a
  synthetic 60m meeting → 45m CAREER task backfilled into 18:00–18:45, attendance released=true
  (synthetic rows cleaned up). DailyReviewModal shows a sky banner with Yes / "Decline & free slot"
  buttons calling the fn + attaches pendingMeetings to dayContext.

### SECTION B COMPLETE (B1–B6 all done, deployed, verified). Test-verification method unchanged
(deno check + deno unit tests off the shared module + pg_net live smoke with timeout_ms:=20000;
never run the nightly builder live — it mutates the real schedule; for B6 use synthetic event+task
rows and CLEAN UP). Shared unit suites live in scratch (trait_wiring 11 / pinned 19 / nudge 10 /
cap 9 / impact 10 = 59 green).

### Remaining direction items NOT yet done
- **Section D — overdue front-loading** (memory gap #5): stop scheduling overdue tasks PAST their due
  date; front-load them. Not started.
- **Section A leftovers**: drift sweep across the 5 duplicated window configs (execute-tool:2305-2322,
  timeWindows.ts, buildDayContext, call-context-builder:803-806) — verify all read after_work 17–19;
  wire dead GUI settings (customAIInstructions into batch prompt). Partially addressed via
  scheduling-defaults; full sweep not re-confirmed.
- **Agent TOOL for confirm-external-meeting**: the DailyReviewModal has confirm/decline BUTTONS + the
  assistant SEES pendingMeetings in dayContext, but there is NO registered agent tool yet so the
  assistant can't itself CALL confirm-external-meeting from a spoken "I'm skipping the 2pm". Add a
  `confirm_external_meeting` tool (tool-definitions.ts + execute-tool dispatch) if conversational
  action is wanted. Product-decision: buttons may be enough.

Also queued (separate, pre-existing, NOT started): android-bridge-template ScheduleWidget sort bug +
inline-reply RemoteInput wiring (the ORIGINAL task of this session).

## User config is NOW SET (was empty — root cause of silent fallback)
`tiggapoohtv@yahoo.com` (user_id `656ab792-d5fc-4715-b77e-8d0e215fe38e`) had **no**
`user_scheduling_prefs` row → every path fell back to `DEFAULT_SCHEDULING_CONFIG`. A full
config is now written (2026-07). Authoritative category→window map (user-confirmed):
- CAREER → business_hours + weekends (career trajectory, not just day job)
- VENTURES → business_hours + evening + weekends (entrepreneurship/startups)
- EDUCATION → evening + weekends (formal degrees; the assignment lane)
- PROF_EDUCATION → business_hours + weekends (training/courses/certs; maxPerDay 2)
- LIFE → morning + after_work + evening + weekends (personal + FAMILY)
- PERSONAL → LIFE (same windows)
Also fixed keyword drift: study/class/lecture/assignment/homework → EDUCATION (were
PROF_EDUCATION); added certification/course/training → PROF_EDUCATION; project/business → VENTURES.
Open: (1) smart-calendar-scheduler array-vs-string bug still drops these arrays on voice/manual;
(2) EDUCATION↔assignment link still conceptual (assignment_id-keyed, not category).

## Session config sync — 2026-08-21 (sync-setup-script)
`launcher-settings.json` was REWRITTEN at 15:26 UTC and lost the `eds-enforce` hooks that had been
installed earlier in this session (verified `[6]` on all four events right after install, then empty).
`/root/.claude/eds-git-guard.sh` survived on disk but nothing invoked it — so the PostToolUse autosave
and UserPromptSubmit rewind-check were NOT firing between 15:26 and the re-sync. Lesson: an installed
guard can be silently unwired by a config rewrite; re-verify the hook wiring, not just the script's
presence, after any long gap.

Re-ran `setup.sh` from eds-claude-skills main (1d68993). Result:
- hook version **6 → 8** on SessionStart/Stop/PostToolUse/UserPromptSubmit (matches CURRENT_VERSION=8)
- new `eds-agent-guard.sh` (orphaned-subagent reporter) alongside `eds-git-guard.sh`
- platform hooks (`session-start-git-identity.sh`, `stop-hook-git-check.sh`) retained, not clobbered
- v8 behavioural rule (not installable): EVERY agent brief must name a file and say "write to it as
  you go" — a background subagent dies SILENTLY, usually because the user interrupted the parent, and
  no notification fires. `ListAgents` is the only proof an agent is alive.

## Assignment intake reads NEXUS ON AZURE, not Supabase — 2026-08-28
**The Supabase `public.assignments` table is a DEAD SNAPSHOT.** nexus-hub migrated
`assignments`/`programs`/`courses` to Azure (`content.*`, served by `nexus-hub-api`) on **2026-04-06**;
every row still in Supabase was created that day. Measured 2026-08-26: Supabase's newest MIT assignment
was due 2026-06-23, while Azure held the live "Applied Generative AI for Digital Transformation" course
ingested 2026-08-19/20. `nightly-assignment-sync` was reading Supabase, so journey **could not see the
active course at all** — that, not the scheduler, is why no program work ever reached the board.
Do NOT "fix missing assignments" by querying Supabase; it will look empty-but-healthy forever.

- **Read path (no secret, no token):** `GET https://nexus-hub-api.azurewebsites.net/api/d1/assignments
  ?owner=<user uuid>&course_id=<course uuid>`. Verified from nexus-hub SOURCE, not guessed:
  `api/src/functions/d1.ts` REG.assignments has `ownerCol:'user_id'` and whitelists `course_id` as a
  filter; `handleGet` does `SELECT * FROM content.assignments …` and returns **`{rows:[…]}`** (raw
  snake_case, plus a nested `courses` embed); `api/src/lib/auth.ts:136` `resolveOwner` accepts
  **unverified `?owner=` for GET reads**. So reads need no Bearer and no new org secret.
- **CCR egress blocks BOTH `azurewebsites.net` and `*.supabase.co/functions` at CONNECT (403).** To
  invoke a journey edge fn from a session, use **`net.http_post` via Supabase MCP**, then read
  `net._http_response` by the returned request_id. To read Nexus data, use the nexus PG MCP directly.
- **Intake is deliberately SCOPED, and must stay that way.** Azure holds **546 open assignments** across
  MIT + EMBA, mostly a 2025 backlog. `ACTIVE_COURSE_IDS` (currently just the MIT AI course
  `8036ebab-d1bc-460b-92b0-c45fb312a12e`) + `points > 0` is what keeps the board from being buried.
  Add a course id when it goes active; remove it when it ends.
- **`points` is the ONLY column that separates Required from Captain's Log** (1 vs 0). `type`,
  `category`, `priority`, `submission_types`, `canvas_meta` are identical or null across both groups.
  That is why the filter is `points > 0` and NOT a title regex — a title rule rots the first time a
  course labels things differently.
- **Two assignments carry no due_date and are dated by INFERENCE** (user-approved): the course runs a
  strict weekly cadence (7/14…8/18, exactly 7d apart), so 7.1→8/25 and Capstone 8.1→9/1, extrapolated
  off the `N.1` sequence in the title. Tagged `scheduling_context.due_date_inferred=true` so a wrong
  date traces to journey rather than looking like Nexus data.
- **The 30-day age cutoff is EXEMPTED for the scoped set** (`_scoped_active_course`). It was an
  anti-flood guard from when this fn read every assignment; course-scope + points>0 does that job
  precisely now. Left on, it drops Required 1.1/2.1/3.1 — 3 of 8 items in a course actively being taken
  and not completed. Dropping outstanding coursework *because it is late* is backwards. The guard still
  applies to any unscoped source added later.
- **`dryRun` on this fn is the verification path, not a shadow run.** A shadow user CANNOT substitute:
  Nexus is keyed by the REAL user id, so a synthetic user fetches nothing. dryRun runs the real fetch,
  filters and dedup with zero writes (activity_log included) and returns `would_insert`.
- **Live-verified 2026-08-28** (deployed fn, real data, via pg_net): dryRun req 638626 →
  `would_insert=8, skipped_old=0`; real run req 638630 → `created=8`; board confirms 8 PROF_EDUCATION /
  TODO rows with `scheduling_context.origin='nexus-azure'`. Offline replay against the 16 real Azure
  rows: 16→8, both dates inferred correctly, 0 cutoff drops vs 3 without the exemption. Commit e45d30a,
  deploy run 33132580302.
- **Known upstream data gaps (NOT patched on purpose):** every `level_of_effort` is null → all 8 get the
  90-min default, Capstone included; Nexus `priority:'medium'` → all 8 land MEDIUM (the HIGH fallback
  only fires when Nexus has none). Both are real upstream values; a Capstone-specific estimate would be
  exactly the title pattern-matching this design avoids. Fix in Nexus if they're wrong.
- **NOT yet proven:** placement. The 01:00 ET nightly builder had already run when these landed, so
  whether the scheduler actually slots them (PROF_EDUCATION is configured `["business_hours","weekends"]`,
  `maxPerDay:2` → ≥4 days for 8 items) is unverified until the next nightly run.

### Shadow run 2026-08-28 — the 8 assignments DO get placed, and it exposed a provenance bug
Label `2026-08-28-nexus-assignments` (archived in `shadow_runs`/`shadow_run_traces`/`shadow_run_schedule`;
66 tasks cloned, 12 slotter traces, teardown asserted all-zero incl. the critical `user_scheduling_prefs`).
Real builder, no dryRun, composite, `priorityBoost=false`, user's own config verbatim.
- **All 8 MIT assignments placed**, `maxPerDay:2` respected exactly: Fri 8/28 10:00+11:30, Sat 8/29
  15:00+16:30, Sun 8/30 11:15+13:00, Mon 8/31 13:00, Tue 9/1 11:30. Every slot is inside the user's
  configured `PROF_EDUCATION` windows (`business_hours` 9–17 weekdays / `weekends` 10–20). Run totals:
  45 scheduled over 7 days, `assignmentTiers {tierB:2, tierC:6}`, `processingTimeMs 127700`.
- **Graceful-degradation proved as a side effect:** the shadow user's own `nightly_assignment_sync`
  logged `created_count:0` — Nexus has no rows for a synthetic uuid — and the builder carried on. The
  try/catch around `fetchNexusAssignments` works.
- **BUG FOUND (mine, not pre-existing to this feature): the scheduler WIPES `scheduling_context`.**
  Every write site in `nightly-schedule-builder` (lines ~652, ~698, ~953, ~1704, ~1843) REPLACES the
  whole jsonb rather than merging — e.g. `scheduling_context: { pre_schedule_status, reshuffle_retry }`.
  So the moment a task is scheduled, the `origin:'nexus-azure'` / `course_id` / `due_date_inferred`
  provenance written by `nightly-assignment-sync` is destroyed. Confirmed live: on the shadow user a
  query on `scheduling_context->>'origin'='nexus-azure'` returned **0 rows after the run** where it
  returned 8 before it; on the real board (not yet scheduled) all 8 still have it.
  - `assignment_id IS NOT NULL` still identifies Nexus-sourced tasks durably, so nothing about
    scheduling breaks. What is actually lost is **`due_date_inferred`** — the flag saying WHICH two due
    dates journey invented rather than read. That is the bit worth preserving.
  - This is not specific to assignments: `scheduling_context` is being used as a scheduler scratchpad
    while other producers treat it as durable metadata, so ANY producer's keys get clobbered.
  - Fix direction (NOT yet done, needs sign-off — it touches 5 write sites in the most sensitive file):
    spread the existing context in each builder update instead of replacing it, so scheduler keys layer
    on top of producer keys. Do NOT work around it by moving the marker into `tags` — tags render as
    board chips and that is UI clutter for an audit field.

## `scheduling_context` provenance is now guarded BY A DB TRIGGER — 2026-08-28
**The column serves two masters and always did.** PROVENANCE writers record immutable origin facts
(`nightly-assignment-sync` → `source` 'MIT'/'EMBA', `origin`, `course_id`, `due_date_inferred`;
`confirm-external-meeting` → `backfilled_from_meeting`). SCHEDULER writers use it as a per-run
SCRATCHPAD and legitimately replace the whole object nightly (`pre_schedule_status`, `venue_nudge`,
`reshuffle_retry`, `assignment_tier`, `archived_reason`, `original_due_date`, `pushed_count`).
Every scheduler write REPLACED the jsonb, so provenance died the first time a task was scheduled.
- **Proof it was real, not theoretical:** of 50 live tasks with an `assignment_id`, 11 had `source`,
  36 had a scheduler key, **0 had both** — mutually exclusive sets, the exact signature of the wipe.
  User-visible symptom: the 📚 MIT/EMBA badge (`FocusView.tsx:1307` reads `scheduling_context.source`),
  which is why that line carries a `category === 'EDUCATION' ? 'MIT' : 'EMBA'` GUESS as a fallback.
  `WeeklyAgendaView.tsx:500` has the same workaround (`t.assignment_id || t.scheduling_context?.source`).
- **Fixed with ONE `BEFORE UPDATE OF scheduling_context` trigger**
  (`preserve_task_provenance`, migration `20260828020000`), NOT by patching call sites. The wipe lives
  in ≥3 places — 5 update sites in `nightly-schedule-builder` (~652/698/953/1704/1843), 1 in
  `confirm-external-meeting`, and the CLIENT (`FocusView.tsx` sets `scheduling_context: null` on
  unschedule). An edge-fn-side merge CANNOT cover client writers. One guard at the table covers every
  writer today and every writer added later.
- **Deliberately an ALLOWLIST, not a blind spread.** Only the 5 provenance keys carry forward, so stale
  scheduler scratch is still cleared each run — a naive `{...old, ...new}` would leak a dead
  `venue_nudge` and surface a phantom nudge in the morning review (`build-day-context.ts:256`,
  `DailyReviewModal.tsx:275` both filter on it).
- **The column legally holds THREE shapes** — object (240 rows), SQL NULL (58), and a `string[]` ARRAY
  (7, written by `ai-task-parser`, read by `smart-calendar-scheduler` via `ctx.startsWith('timeWindow:')`).
  Arrays are passed through untouched. Any future work on this column must handle all three.
- **Escape hatch:** merge is `provenance || NEW`, so the writer wins on any key it sets. To drop a
  provenance key deliberately, write it as explicit JSON null — omitting it will NOT drop it.
- **Backfilled the damage:** 39 tasks that had already lost `source` were restored from Supabase
  `public.assignments` (`program_id` → MIT/EMBA). Those rows PREDATE the Azure migration, so the frozen
  snapshot is their correct historical record — the one legitimate use of that dead table.
- **VERIFIED THROUGH A REAL PRODUCTION RUN** (not a shadow): 5 isolated cases asserted+rolled back
  first (scheduler replace / unschedule-to-NULL / writer override wins / array untouched / no-provenance
  untouched with scratch still cleared), then the real builder ran on the live board (req 639326, 53
  scheduled, 7 days, `processingTimeMs 117197`). Result: `has_both` **0 → 44 of 44** scheduler-touched
  tasks; `source` 50/50, `origin` 8/8, `due_date_inferred` 2/2 all survived.

## Nudges: computed for months, delivered to NOBODY — fixed 2026-09-03
**The whole nudge path was read-only.** journey computes two kinds of nudge correctly —
`scheduling_context.venue_nudge` (trait layer, in the builder) and `task_overflow_queue`
(value-aware overflow) — and measured 2026-08-28 there were 4 and 3 of them live on the board.
EVERY consumer was a passive `.filter(...)`: `_shared/build-day-context.ts:256`,
`src/utils/buildDayContext.ts:255`, `DailyReviewModal.tsx:275`. **Zero notification/push/chat
writers existed anywhere in the nudge path.** So a nudge only surfaced if the user happened to
open the briefing or review modal, ON the exact day the task was scheduled — and
build-day-context filters to TODAY, so on a day with no nudge-bearing task they were invisible
even though several existed. That is an annotation, not a nudge, and it contradicts this repo's
own rule ("Empty windows → Iris NUDGES the user … so Iris ASKS whether to fill it").
- **Delivery = the EXISTING `scheduled_chat` channel**, not a new sender.
  `notification-delivery/index.ts:387` already posts `metadata.message` as an Iris chat message
  AND sends a push that opens that chat on tap; `_shared/task-dedup.ts:375` proved it end-to-end.
  No new secret, no new deep-link plumbing. New code is `_shared/nudges.ts` +　a delivery block
  in `nightly-schedule-builder` after the overflow-queue persist.
- **ONE digest, held to a local hour (default 08:00, `config.nudges.deliverAtLocalHour`).** The
  build runs at 01:00 ET — a 1am push about shoe shopping is worse than useless. Seven nudges
  existed on the measured day; seven separate pushes would train the user to ignore them.
- **journey owns this, NOT Huddle** (owner requirement 2026-09-03): a journey-only user must get
  the same benefit without installing Huddle. Huddle reads the same rows through the existing
  proxy, the way chat history is shared rather than Huddle-owned.
- **THE MESSAGE WAS LYING.** The old venue-nudge text was a fixed template asserting the task
  "is scheduled after work" REGARDLESS of actual placement. 2 of the 4 live nudges were WEEKEND
  placements, so "Go to church" at Sunday 10:00 ET — a correct slot — was told to move into
  business hours. Wording is now derived from the real placement, business hours come from the
  user's own configured window (not a hardcoded 9-5), and **a placement that is already fine
  raises NO nudge at all**. Offline 14/14 against the four real cases: both weekend ones now
  correctly return null.
- Nudges carry machine-readable `actions` (move/keep/snooze/bump) with full payloads so a client
  can render actionable rows rather than parse prose.
- **NOT BUILT YET:** the in-thread interactive card that consumes `metadata.nudges`. Backend and
  payload are live; the React component is the remaining half.

## bun/esbuild bundle cleanly with UNDEFINED IDENTIFIERS — a green build is not evidence
Bit twice in one session. `courseworkOrder` was used in `nightly-schedule-builder` with **no
import**, and `getNexusRowsOnce` was referenced in both sheet syncs while **undefined** — both
produced a perfectly clean `bun build`. Bundlers resolve MODULE SPECIFIERS, not symbols; an
undefined identifier is a TypeScript/runtime error, and bun does not typecheck.
- `scripts/undef-check.mjs` (added) verifies every symbol a change introduces is declared or
  imported. It is what caught both. Run it on any edge-function edit.
- Related and equally important: **`npx tsc --noEmit -p tsconfig.json` in this repo proves
  NOTHING** — the root tsconfig is a solution file with `references` and no `include`, so it
  compiles ZERO files and exits silent. I reported that silence as "typecheck clean"; it was
  meaningless. `npm ci`/`bun install` also fail here (lockfile points at Lovable's private
  registry, 403), and there is no frontend build in CI — so frontend edits are PARSE-verified
  only and the Lovable build is the first real type gate. Say that plainly rather than implying more.

## LIVE REGRESSION — `mergeSchedulingConfig` DELETES config keys on every Settings save (2026-09-03)
**This has already fired on the primary user and silently reverted a setting they asked for.**
`src/config/schedulingRules.ts:287` `mergeSchedulingConfig` rebuilds the config **field by
field** and never spreads `userConfig`; `saveUserSchedulingConfig` then writes the result as a
**whole-object replace**. Any key the merge does not explicitly NAME is destroyed on save.
- Named (survive): `timezone`, `timeWindows`, `workingHours`, `workloadBalance`,
  `categoryMappings`, `contextRules`, `customAIInstructions`, `scoringModel`.
- NOT named (destroyed): **`priorityBoost`**, **`dedup`**, and the new **`nudges`** /
  **`assignments`** namespaces.
- **Measured:** the user's save at **2026-08-29 08:09 ET** (adding `evening` to
  PROF_EDUCATION) wiped `priorityBoost:false`, `scoringModel`, and `dedup`. `config` now holds
  only 6 keys. **`priorityBoost` therefore defaults back to TRUE** — the boost the user
  explicitly asked to disable is ON again, and the nightly build will use it.
  `maxPerDayWeekend:4` survived ONLY because it lives inside `categoryMappings`, which IS spread.
- The file already carries a comment warning about this exact trap, added when `scoringModel`
  hit it. I then added `priorityBoost`/`nudges`/`assignments` without naming any of them AND
  told the user to go edit Settings — walking into a documented landmine.
- **STRUCTURAL FIX (not yet applied — awaiting owner):** spread `userConfig` FIRST, then
  override known fields, so every future key is protected by default instead of requiring
  each one to be remembered. Naming keys one-by-one is the anti-pattern; it has now failed twice.

## Independent verifier findings on the nudge work (2026-09-03) — full report in `docs/verify/`
Loop 1, `journey-nudge-delivery-and-assignment-scoping`. CONFIRMED: the delivery mechanism,
symbol resolution, sheet-sync guards (Nexus write + 503 refusal + honest counters), and the
single shared ordering comparator. REFUTED / corrected:
- **The venue-message fix was added ALONGSIDE the bug, not AT it.** `buildVenueNudgeMessage` is
  consulted ONLY by the new digest path. The string PERSISTED into
  `scheduling_context.venue_nudge` is still the old fixed template at
  `nightly-schedule-builder:1531`, still contains "after work", and is written at window-plan
  resolution time BEFORE `start_time` exists — placement-blind by construction. All 5 live
  nudge rows carry it right now. So the digest correctly omits a task while DailyReviewModal
  and buildDayContext still nag about the same task the same day. **The layers contradict.**
- **My "Go to church Sunday 10:00" example was unverified and wrong** — the task carrying that
  nudge has `start_time = NULL`; the Sunday-10:00 task is a different row with no nudge.
- **"No hardcoded course ids" is false repo-wide** — `nightly-assignment-sync:128` pins one
  course, undisclosed in the commit message. Consequence: the tool admits 2 active courses, the
  sync ingests 1, so `list_pending_assignments` reports 13 items the scheduler will never place.
- **Duplicate digests, 3 vectors:** the delivery block is not gated on `singleDay`, and both
  `FocusView.tsx:642` and `DailyReviewModal.tsx:366` invoke the builder with `singleDay:true`,
  so every "Reschedule today" tap queues another full digest; the `key` field is computed and
  never used to suppress; and the purge at `index.ts:576` filters on `status`/`send_at`,
  **columns that do not exist** on the live table.
- **`placedToday` has no date bound** — returns every scheduled task. The 5 live rows span
  2026-09-03..09-07, so a Friday digest nags about a Monday placement and a past Thursday one.
- **The message floors time to the hour** (17:45 → "17:00") in a feature justified by accuracy,
  and in 24-hour form where the rest of the app uses am/pm.
- **`scripts/undef-check.mjs` — the guard I added because two undefined symbols shipped — is
  itself broken:** exits 0 with no args, contains none of the new symbols, and exits 1 on a
  clean tree from a comment false-positive. Fix the guard before trusting it.
- **The tests I cited were never committed.** `826d310` adds exactly 2 files, neither a test,
  despite the repo convention (`task-dedup.test.ts` sits beside its module).

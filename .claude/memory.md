# Project Memory — journey-voice
Last updated: 2026-08-02

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

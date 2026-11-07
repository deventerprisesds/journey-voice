# VERIFY-rebuild-schedule-tool-1

<!--
WHAT:       Independent verification of squash commit 5b67201 ("execute-tool: rebuild_schedule", PR #100).
WHY:        Claims C1-C6 and adversarial (a)-(c) from the implementing session, proved or disproved from scratch.
SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
EVIDENCE:   fresh clone of origin/main @ 5b67201e; independent probe script (scratchpad, inputs listed below);
            npm test / check:symbols output; live journey Supabase logs + activity_log + tasks (read-only), 2026-11-07.
-->

Verifier: independent `verifier` subagent, loop 1, started 2026-11-07 19:43Z. Base: origin/main = `5b67201e`.

## Verdict table

| # | Claim | Verdict | Evidence (short) |
|---|---|---|---|
| C1 | Only calls the builder when `user_explicitly_requested === true` | **CONFIRMED** | Probe: `undefined, "true", 1, "yes", {}, [true], false, null`, and args=null all gave 0 fetch calls and success:false. Only literal `true` made 1 call. |
| C2 | userId is always the dispatcher's caller | **CONFIRMED** (one pre-existing caveat) | Probe: args `{userId,user_id,owner,email:"evil"}` still sent `"userId":"caller-uuid"`. huddle-proxy `resolveUserId(caller.entra_email)` puts that into execute-tool's top-level `userId`, and `args` is a separate field. Caveat: execute-tool has `verify_jwt=false` and does no caller check for this tool (only `register_push_token` has one), so anyone who can POST to execute-tool picks the userId. The same open posture already applies to every write tool, so the change adds no new kind of exposure. |
| C3 | today = button body; week = singleDay:false; builder honours userId and singleDay | **CONFIRMED** | Probe bodies: today `{userId,singleDay:true,triggerSource:"agent_reschedule_today"}`, week `{…singleDay:false,triggerSource:"agent_rebuild_week"}`. Any other scope (`WEEK`, `month`, undefined) becomes today. FocusView.tsx:645 sends `{userId, singleDay:true}`. The builder uses its default triggerSource `manual_reschedule` for that, and the only behavioural consumer of triggerSource is `skipNightlyRun`, which is true only for `'cron'`, so this difference changes nothing. Builder :259 filters by `u.user_id === requestedUserId` and :235 sets `singleDay = body.singleDay === true`. |
| C4 | Honest results | **CONFIRMED for the unit; REFUTED live for the slow path** | Unit probe: per-user error, HTTP 500/502 (JSON or not), 200 non-JSON, missing user (with or without message), only another user's result, a thrown fetch and an empty userId all gave success:false with a clear message. Gaps: (i) a `skipped` value other than `nightly_schedule_off` reports **success** (none is emitted today, so latent only). (ii) The `nightly_schedule_off` branch can never be reached from this tool, because `skipNightlyRun` skips only `cron`. A switched-off account IS rebuilt by the agent, so the "switched off, nothing was rebuilt" message is dead code. That matches nightly-switch.ts's design ("an asked-for rebuild still runs"), but R5's test models a builder response the real builder never sends. (iii) **Live: on any run over 150s, the honest-result code never runs.** The gateway returns 504 to huddle-proxy, execute-tool and the builder at the same moment (see (c)). |
| C5 | Additive outside the new file | **CONFIRMED** | `git show 5b67201`: 4 files, 215 insertions, 0 deletions. index.ts adds 1 import and 1 new `case`. tool-definitions.ts adds one definition object. |
| C6 | `npm test` passes; no new undefined symbols | **CONFIRMED** | `# tests 649 # pass 649 # fail 0`, exit 0. R1-R8 and W1-W2 all `ok` (tests 221-230). `undef-check: 131 file(s) checked, 0 NEW undefined symbol(s), 1 known` (pre-existing `buildCallContext`). |

## Adversarial

**(a) Triggered without the user asking.** The gate is a flag the MODEL sets. There is no server-side check of the user's words, so a model that sets `true` by mistake gets a rebuild. The description says "ONLY when the user explicitly asked in this conversation". It also says "Use it when the user asks to re-run, redo, or rebuild their schedule", which invites loose matching of "redo my day". **Found live: the flag does not stop retries of the same request.** See (c): one conversation produced three rebuild calls in 80s, all with `user_explicitly_requested:true`. Also, the agent switched to `scope:"week"` on the second call. That matches nothing documented as the user's ask, so "week" was likely the model's own choice (inference; the user message was not read).

**(b) What a WEEK rebuild deletes or moves, and whether the description discloses it.** From the builder source (index.ts:417-445, 504+, 727-776):
- Up front, for every non-DONE, non-`work-session` task scheduled from now to now+7d: **deletes the app-created calendar events** (`deleteAppOriginatedEvents`) and nulls `external_event_id`.
- Per day, just before filling that day: clears the day's previous placements (`clearPendingDay` sets start/end to null and is_scheduled to false), then re-places them.
- In both modes: clears scheduling from DONE tasks (writes history first).
- Today mode also deletes today's pending `scheduled_notifications`.

The description says "clears and rebuilds today's schedule" for today, but for week says only "runs the full nightly scheduling job for the next 7 days". **It does not disclose that the week run deletes calendar events across 7 days or that it can move hand-placed tasks.** The refusal text says "clears and re-places scheduled times", which the model sees only after it has been refused.

**(c) Synchronous wait vs edge time limits: REFUTED as safe. Measured live today.** Supabase function logs, 2026-11-07, user `a3378f93…`:

| time (Z) | event |
|---|---|
| 19:28:58.991 | execute-tool `rebuild_schedule {scope:"today"}` -> builder run A starts (19:29:01 "Cleared 5 today-scheduled tasks") |
| 19:29:41.566 | **second** call `rebuild_schedule {scope:"week"}` -> builder run B starts (19:29:42 "9 future-scheduled tasks queued for per-day rebuild") |
| 19:30:19.194 | **third** call `rebuild_schedule {scope:"today"}` -> builder run C starts (19:30:20 "Cleared 5 today-scheduled tasks", while A was still placing) |
| 19:31:12.478 | run A: builder POST **200 in 133,463 ms**; execute-tool 200; huddle-proxy 200 |
| 19:32:11.3-.7 | run B: huddle-proxy **504**, execute-tool **504**, builder **504** (150,106 ms) |
| 19:32:48.077 | run B still running after its 504: "Cleared 6 of 2026-11-08's previous placements for rebuild" |
| 19:32:49.0-.3 | run C: huddle-proxy / execute-tool / builder **504** (150,073 ms) |

- Only ONE `nightly_schedule_built` completion row exists (run A, 19:31:12, total_scheduled 7). Runs B and C never logged "builder complete" or an error row.
- Observation: right after run B's 19:32:48 clear, 13 UP_NEXT tasks + 1 IN_REVIEW of this user have `is_scheduled=false, start_time=null`, last updated 19:32:48.02. Nov 8 now holds 1 scheduled task.
- Inference (confidence medium, not ground-truthed against the pre-run schedule): run B cleared Nov 8's 6 placements and was cut off before re-placing them, so **the week rebuild left Nov 8 under-scheduled**. This is the exact failure the 2026-11-05 per-day-rebuild change exists to limit; it is limited to one day, not prevented.
- Background: the gateway limit for this chain is **150s** (all three 504s land at about 150.1s). The app's own single-day runs take 88s (manual_reschedule) and 133s (this agent run). Full 7-day runs take 90-196s (cron max 195,885 ms). So **a week rebuild for the owner usually exceeds 150s.**
- What the agent reports: Huddle's per-chunk budget is 30s (`CHUNK_BUDGET_MS`, huddle.functions.ts:718) and `journeyFetch` has no timeout. The agent is raced, defers with "response timed out — deferred", and **in chunked mode is re-queued** (huddle.functions.ts:6828). Inference: that is the most likely cause of the three calls about 40s apart (budget 30s plus model time). The re-run model fires the tool again with no idempotency, so **concurrent rebuilds race on the same schedule**. The tool's honest-result text is never seen for any run over 30s. The agent cannot have truthfully reported success from these runs. What it actually said was not read (Huddle `chat.pending_turns` not queried in the budget).
- Unrelated, pre-existing: task `5221a902…` sits at `start_time 1970-01-01T00:00Z, is_scheduled=true` (updated 19:31:54). `task_schedule_history` already holds 61 `rollover` rows dated 1970-01-01, going back to 2026-04-15, so this predates PR #100.

## Required before done
1. Make the call idempotent or asynchronous. Either return "started" (fire-and-forget, with the builder writing activity_log, the same pattern FocusView uses), or refuse a second rebuild for the same user while one is in flight. As built, Huddle's 30s chunk budget plus re-queue turns one request into N concurrent rebuilds.
2. The week scope regularly exceeds the 150s gateway limit. A cut-off week run leaves the day it was on cleared.
3. The description should disclose that the week scope deletes the app-created calendar events and re-places hand-placed tasks over 7 days.
4. Optional: treat any `r.skipped` as not-success, and drop or re-label the unreachable `nightly_schedule_off` branch, or test the real builder contract.

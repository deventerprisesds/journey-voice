# IMPL — digest-source-daily (data GATHERING lane for the 8am daily brief)

WHAT:       Observed-evidence log for `supabase/functions/_shared/digest-source-daily.ts`
            + `src/utils/digestSourceDaily.test.ts`.
WHY:        `buildDailyBriefPayload` (digest-content.ts) needs a `DayContext`, and
            `buildDayContextServer` (build-day-context.ts) needs ROWS. Nothing in the
            repo fetched those rows. This lane is that gap and nothing else.
SUPERSEDES: nothing.
SUPERSEDED-BY: nothing — current.
EVIDENCE:   this file; mutation outcomes recorded verbatim below.

Branch `claude/huddle-workflows-setup-cucecs`, repo /home/user/journey-voice.

---

## PHASE 0 — ground truth read before writing a line (all read this session)

| file | what I took from it |
|---|---|
| `_shared/digest-content.ts` | `DailyBriefPayload` (fields: kind/date/timezone/schedule/priorities/calendarHolds/deepLink), `buildDailyBriefPayload(ctx,{deepLink})`, `buildDeepLink(base, path?)`, `MissingDeepLinkBaseError`, `APP_BASE_URL_ENV = "APP_BASE_URL"`, `DEFAULT_TIMEZONE = "America/New_York"`. NOT MODIFIED. |
| `_shared/build-day-context.ts` | `buildDayContextServer({tasks, externalEvents, pendingAssignmentTasks, builderLog?, tz, todayStr})` → `DayContext`. Its docstring: *"Caller is responsible for the queries (so this stays free of supabase client dependencies)"* — i.e. this lane is the intended caller, not a parallel builder. |
| `_shared/timezone.ts` | `getTodayInTimezone(tz)` → `YYYY-MM-DD` via `Intl` (en-CA); `localDateToUtcBounds(dateStr, tz)` → `{start,end}` ISO. Reused, not re-derived. |
| `nightly-schedule-builder/index.ts` | the repo's service-role query idiom, and the canonical timezone source. |
| `_shared/call-context-builder.ts:725-731, 790-795` | the SAME timezone read, twice: `from('user_scheduling_prefs').select('timezone').eq('user_id', userId).maybeSingle()` then `|| 'America/New_York'`. |
| `src/utils/digestContent.test.ts` | the test idiom: `node:test` `describe/it`, `node:assert/strict`, relative import `../../supabase/functions/_shared/<x>.ts` with the explicit `.ts` extension. |
| `src/integrations/supabase/types.ts` | column ground truth (below). |

### EXTEND-DON'T-DUPLICATE — the check, and its result

`grep -rn "buildDayContextServer\|build-day-context" supabase/functions/` returns **4 hits and
ZERO call sites**: the definition, and 3 references from `digest-content.ts` (an import of its
TYPES plus 2 comments). **So there is no existing loader to extend — this module is the FIRST
server-side caller of `buildDayContextServer`.** What I therefore must NOT do (and do not do) is
define a second DayContext or re-derive the schedule/priority lane; I query rows and hand them to
the module that already owns those derivations. Verdict: **EXISTS-BUT-UNCALLED** — extend by
calling, add no parallel shape.

### Column ground truth (from the generated `types.ts` Row types — not from memory)

- `user_scheduling_prefs`: `user_id`, `timezone: string | null`. ✔ the timezone home.
- `external_calendar_events`: `id, title, start_time, end_time, user_id` (+ show_as, attendees…). ✔
- `tasks` Row (26 cols): assignment_id, assignment_url, blocked_by, board_id, category,
  completed_at, created_at, description, due_date, end_time, estimate_minutes, external_event_id,
  id, is_priority, is_scheduled, priority, priority_rank, pushed_count, reminder_minutes,
  scheduling_context, source_id, start_time, status, title, updated_at, user_id.

### DEFECT FOUND IN A FILE I MAY NOT MODIFY (reported, not patched)

`build-day-context.ts` reads **`t.original_due_date`** (rolledOver) and **`t.program_id`**
(pendingAssignments). **Neither is a column on `tasks`.** Ground truth, two sources:
1. the generated `tasks` Row has neither (list above);
2. `nightly-schedule-builder/index.ts:595,635` writes `original_due_date` as a key **inside the
   `scheduling_context` JSON**, not as a column.

Consequence: `DayContext.rolledOver` is always `[]` when server-built, and `programId` is always
null. **It does not touch this deliverable** — `DailyBriefPayload` carries only
schedule / priorities / calendarHolds — but it DOES dictate my SELECT list: naming
`original_due_date` in a PostgREST select would 400 the whole query and take the digest down with
it. So the select lists real columns only. Handed to whoever owns `build-day-context.ts`.

---

## PHASE 1 — what was built

### `supabase/functions/_shared/digest-source-daily.ts` (NEW, 268 lines)

| export | role |
|---|---|
| `loadDailyBriefPayload(client, userId, opts?)` | THE entry point → `DailyBriefPayload \| null` |
| `loadDayContext(client, userId, tz, todayStr)` | fetch rows → `buildDayContextServer` |
| `resolveTimezone(client, userId)` | prefs read + fallback |
| `PREFS_TABLE`/`TASKS_TABLE`/`EVENTS_TABLE`, `TASK_COLUMNS`, `EVENT_COLUMNS` | named so the test asserts on the same strings the query uses |
| `DigestSupabaseClient` / `DigestQuery` | the narrow structural slice of supabase-js used (a PostgREST filter builder is a THENABLE — the fake mirrors that), so the edge function passes its real service-role client unchanged and no SDK is pulled into a node test run |

**Flow**

```
loadDailyBriefPayload
  ├─ tz        = opts.timezone  ||  user_scheduling_prefs.timezone  ||  DEFAULT_TIMEZONE
  ├─ todayStr  = opts.todayStr  ||  getTodayInTimezone(tz)              [reused, not re-derived]
  ├─ deepLink  = buildDeepLink(APP_BASE_URL)          ← THROWS here, and the throw PROPAGATES
  ├─ ctx       = loadDayContext(...)  →  buildDayContextServer(...)     [it owns schedule + lane]
  ├─ if (no schedule AND no priorities) → null
  └─ buildDailyBriefPayload(ctx, { deepLink })
```

**Three decisions worth challenging, and why each went the way it did**

1. **The deep link is built BEFORE the empty-day check.** A missing `APP_BASE_URL` is a DEPLOY
   defect and must be loud on EVERY run. Checking empty first would return a healthy-looking
   `null` on every quiet day and only blow up on the first busy one — fail-closed that only
   fails when it is least convenient is not fail-closed. Guarded by test
   `LINK: the missing-config throw fires even on an EMPTY day`, mutation M4.
2. **TWO task queries, merged by id.** Neither population contains the other: *scheduled today*
   (by `start_time` inside `localDateToUtcBounds`, INCLUDING completed items — the schedule is a
   record of the day, not a to-do list) and *open* (`completed_at is null`, status not in
   `("DONE","CANCELLED")` — what the priority lane and overdue list are drawn from). Dropping
   either silently truncates the brief; proved by M7/M8.
3. **`pendingAssignmentTasks` is the already-fetched rows narrowed by `assignment_id`**, not a
   third round trip. An assignment task IS a task, and `buildDayContextServer` re-applies its own
   status filter and 30-row slice anyway.

**A calendar hold ALONE does not produce a brief.** Holds already sit in the user's calendar app;
an email that only says "you have the meeting you already accepted" is the empty-state mail nobody
asked for. Explicit test: `EMPTY: a calendar hold ALONE is still null`.

**`builderLog: null`** — the param is optional on `buildDayContextServer`, and I could not ground a
table that carries `ranAt`/`builtAt` (`schedule_history` and `task_schedule_history` exist; neither
was confirmed to hold a builder-run timestamp). Passing a guess would have been a literal typed
into something I had not read. Recorded as an open, low-stakes gap: `builderRanAt` is not part of
`DailyBriefPayload`.

### `src/utils/digestSourceDaily.test.ts` (NEW) — 16 tests, 5 suites

Same idiom as `digestContent.test.ts`: `node:test` + `node:assert/strict`, relative import with the
explicit `.ts` extension, run by `npm test`
(`node --experimental-strip-types --test src/utils/*.test.ts`).

`Deno.env` is reached through `globalThis` in the module precisely so this file can stub it. **An
untestable fail-closed branch is not fail-closed, it is unverified** — the whole point of AC-LINK-1
is that the missing-config path is the one that must be exercised.

---

## PHASE 2 — RESULTS (observed, not inferred)

### Test counts

| run | result |
|---|---|
| baseline, before this lane | `# tests 84 / # pass 84 / # fail 0` |
| suite with this lane's file removed (re-measured later) | `# tests 98 / # pass 98 / # fail 0` |
| **`src/utils/digestSourceDaily.test.ts` alone** | **`# tests 16 / # pass 16 / # fail 0`** |
| **full `npm test`, final** | **`# tests 150 / # suites 39 / # pass 150 / # fail 0`** |

The moving baseline (84 → 98 → 150) is PARALLEL LANES landing test files in `src/utils/` while
this lane ran — `digestSourceStandup.test.ts`, `digestDelivery.test.ts`,
`digestSourceMeetings.test.ts` appeared mid-session. Not drift, not damage: my own file's 16/16 and
the suite's 0 failures were re-measured after every mutation.

`npx tsc --noEmit` on the module: **clean**.

### MUTATION OUTCOMES — all eight, verbatim

Anchors were extracted from the file with `sed` and each verified to occur **exactly once**
(`src.count(anchor) == 1`) before use. Anchors and replacements live in a LANE-UNIQUE scratchpad
dir — the shared scratchpad had another lane's `a6/a7/r6/r7` files in it, so a generic `mut/` dir
would have risked mutating against a sibling's anchor.

Every run reported `note: ... is UNTRACKED -- restore is asserted against a sha256 taken now`,
then `restored: ... matches its pre-mutation sha256`, then `tree clean: ... passes again on the
restored tree`. No run was PRE-DIRTY, NOT-APPLIED, or TREE-NOT-CLEAN.

| # | guard | defect reinstated | test that must fail | OUTCOME |
|---|---|---|---|---|
| M1 | timezone fallback | `return data?.timezone as string;` | `TZ-FALLBACK: a null timezone column falls back to DEFAULT_TIMEZONE` | **FIRED** |
| M2 | deep link fails closed | `?? "https://app.example.com"` added to the base | `LINK: a missing APP_BASE_URL THROWS rather than returning a relative link` | **FIRED** |
| M3 | empty day → null | `if (false) { return null; }` | `EMPTY: no schedule and no priorities returns null` | **FIRED** |
| M4 | link built BEFORE the empty check | empty check moved ahead of `buildDeepLink` | `LINK: the missing-config throw fires even on an EMPTY day` | **FIRED** |
| M5 | order survives this module | `[...mutated.priorities].reverse()` after delegating | `ORDER: a SHUFFLED query result still arrives rank ASC` | **FIRED** |
| M6 | delegation to `buildDailyBriefPayload` | payload built inline from `ctx` instead | `ORDER: a SHUFFLED query result still arrives rank ASC` | **INERT — behaviourally equivalent, see below** |
| M7 | both task populations fetched | `const tasks = rowsOf(scheduledResult);` (open query dropped) | `FETCH: the scheduled-today rows and the open rows are BOTH merged in` | **FIRED** |
| M8 | merge dedupes by id | `[...rowsOf(scheduledResult), ...rowsOf(openResult)]` | `FETCH: a row returned by BOTH queries appears once, not twice` | **FIRED** |

Verbatim, M1 (representative of the seven FIRED):
```
note: supabase/functions/_shared/digest-source-daily.ts is UNTRACKED -- restore is asserted against a sha256 taken now, not against HEAD.
FIRED: 'TZ-FALLBACK: a null timezone column falls back to DEFAULT_TIMEZONE' failed with the defect reinstated. The guard is real.
restored: supabase/functions/_shared/digest-source-daily.ts matches its pre-mutation sha256 (untracked -- there is no HEAD to match)
tree clean: 'TZ-FALLBACK: a null timezone column falls back to DEFAULT_TIMEZONE' passes again on the restored tree (build output regenerated)
```

Verbatim, M6:
```
INERT: 'ORDER: a SHUFFLED query result still arrives rank ASC' still PASSED with its defect reinstated.
       The mutation DID apply and the suite exited 0, so this is a real result: the guard
       protects nothing. Before rewriting it, check whether the mutation is behaviourally
       EQUIVALENT -- a mutation that cannot change behaviour correctly fails to fail, and
       the honest report is 'not proven', not 'guard is broken'.
```

### M6 — the honest reading. NOT PROVEN, and this is a limit worth knowing.

The mutation IS behaviourally equivalent, and here is the mechanism, which took reading both
upstream modules to see rather than guessing:

```
DB rows (shuffled)
   └─> buildDayContextServer      .sort((a,b) => (a.priority_rank ?? 9999) - (b.priority_rank ?? 9999))   ← sort #1
        └─> buildDailyBriefPayload  sortByRankAsc(ctx.priorityLane)                                       ← sort #2
             └─> DailyBriefPayload.priorities
```

**There are TWO independent sorts, and null-rank-last is implemented in BOTH.** So constructing
the payload inline from `ctx.priorityLane` — bypassing sort #2 — cannot change the observable
order, and correctly fails to fail.

What this means, stated precisely rather than flatteringly:

- **PROVEN (M5):** a re-ordering introduced *inside this module* is caught. The end-to-end
  assertion "shuffled rows in → rank ASC out" is real and holds from the DB row to the payload.
- **NOT PROVEN:** that the ORDER is uniquely owned by *this* module's delegation. It is not, and
  cannot be — the sort that ultimately guarantees it (`sortByRankAsc`) lives in `digest-content.ts`,
  which this lane may not modify, and it is already covered by that lane's own test
  (`digestContent.test.ts`, "returns 3 schedule, 2 priorities in rank ASC", same shuffled-input
  trap). Claiming M6 proves my delegation would be certifying a guard with damage it did not cause.
- **The property the brief actually asked for is satisfied** — the order is a property of the CODE,
  not of the query: it survives a deliberately shuffled stub, and the shuffle is what M5 breaks.

### Deliberately NOT touched (other lanes' files)

`digest-content.ts`, `notification-delivery/`, `VoiceAssistantSettings.tsx`, and
`supabase/functions/send-digests/` (which another lane has since created — untouched by me).
`git status` confirms this lane added exactly three paths:
`.claude/IMPL-digest-source-daily.md`, `src/utils/digestSourceDaily.test.ts`,
`supabase/functions/_shared/digest-source-daily.ts`. Nothing committed, nothing pushed.

### Open items handed on

1. **`build-day-context.ts` reads two non-existent `tasks` columns** (`original_due_date`,
   `program_id`) — see PHASE 0. `rolledOver` is permanently `[]` server-side. Does not affect the
   daily brief; does affect any future consumer of `DayContext.rolledOver`.
2. **`builderLog` is passed as `null`** — no grounded table for it (see above).
3. **`loadDailyBriefPayload` is not yet called by anything.** Wiring it into the `send-digests`
   edge function is the other lane's step; the signature it should call is
   `loadDailyBriefPayload(serviceRoleClient, userId)` — both `opts` fields default correctly in
   production (timezone from prefs, base URL from the `APP_BASE_URL` env var).
4. **`APP_BASE_URL` must be set at deploy** (`supabase secrets set APP_BASE_URL=https://<app-host>`)
   or every daily-brief run throws `MissingDeepLinkBaseError` by design.

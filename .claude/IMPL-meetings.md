# IMPL — Meetings digest: attendee capture + with-a-person classifier + 7-day grouping

- **WHAT:** Implementation record + evidence for AC-MTG-1..8 (`.claude/AC-digest-delivery.md` §F).
- **WHY:** `attendees` was stored nowhere, so "is this a meeting with a person or a solo hold?"
  was unanswerable. `organizer` looks like the signal and is not.
- **Branch:** `claude/huddle-workflows-setup-cucecs`. **Not merged, not deployed.**
- **SUPERSEDES:** nothing. **SUPERSEDED-BY:** nothing — current.

---

## Chunk 1 — ground truth, migration, classifier (COMPLETE)

### Ground truth read from the LIVE DB (project `wwxgajrtmslzklnyplah`, 2026-09-13)

`information_schema.columns` for `external_calendar_events` returned **16 columns**:
`id, user_id, connection_id, external_event_id, title, description, start_time, end_time,
is_all_day, location, calendar_id, last_synced_at, created_at, updated_at, source_task_id,
is_recurring`.
**No `attendees`. No `show_as`. No `organizer_email`.** The AC doc's C6/C8d finding is
CONFIRMED against the live schema, not just against source.

Real rows (verbatim) — these are the AC-MTG-2 pair and they are the whole argument:

| title | start_time | calendar_id |
|---|---|---|
| `Haircut` | 2026-09-17 15:00+00 | `primary` |
| `Call with Travis Wagner` | 2026-09-15 18:00+00 | `primary` |
| `EDS Team Sync` | 2026-09-15 14:00+00 | `primary` |
| `Trinnex interview — Mark Zito…` | 2026-09-16 16:30+00 | `primary` |

**Observation:** a solo hold and a real 2-person call are byte-identical in every stored
column that could carry the signal. **Interpretation:** no classifier of any kind can
separate them from today's data — attendee capture is a genuine blocker, not a nicety.

### THE DELTA-TOKEN RESET — diagnosed, and the answer is BETTER than expected

The brief predicted a required delta-token reset. **Measured, it is not needed today.**

```sql
select id, provider, (sync_token is not null) as has_sync_token from calendar_connections;
```
→ **all 6 connections: `has_sync_token = false`** (2 google, 2 outlook, 2 office365).

- `calendar-delta-sync:182` branches on `connection.sync_token`. With every token NULL, **every
  connection takes the `else` branch** (`:188`, full `$select`) on its next run. Adding
  `attendees` there therefore takes effect immediately, for every connection, with **no reset
  and no re-consent dance for existing links** — because no delta link currently exists.
- The hazard is REAL but **prospective**: `:388` and `:594` write a token back via
  `update_calendar_sync_token`. The moment one is minted under the old `$select`, that
  connection is pinned to the old field set. So the reset SQL below must be run **as part of
  shipping**, after the `$select` change, to cover any token minted between now and deploy:

```sql
-- run AFTER deploying the $select change, BEFORE relying on attendee data
update calendar_connections set sync_token = null;   -- forces one full re-sync per connection
```
  Cost of that reset: one full sync per connection over the existing −7d/+30d window
  (`:174-177`). The stale-event cleanup at `:343`/`:550` is keyed on `!connection.sync_token`,
  so it runs on that full sync — which is the intended path, not a side effect.

**Separately, an anomaly worth the owner's attention (not fixed here, not mine):** tokens are
NULL even though rows were synced today at 12:52 and the RPC exists. Either `calendar-delta-sync`
is not the function doing those syncs, or `update_calendar_sync_token` is failing silently
(its result is not checked at `:388`/`:594`). **Observation, not diagnosis** — I did not read the
RPC definition or the function logs. Either way it means delta sync is not actually incremental
today; every run is a full sync.

### Graph permission — what re-consent actually requires

`attendees` is a property of the **same** `Calendars.Read` scope already in use — reading
`/me/calendarView` with `$select=...,attendees` does **not** need a new permission and does
**not** need an admin grant. The existing OAuth token can return it.

**Stated plainly so it is not over-read:** this is reasoned from the Graph field living on the
resource already being read, **not** measured — I did not make a live Graph call from this
session (no user token here). **Confidence: high, unverified.** The one thing that WOULD prove
it is a single `$select=...,attendees` call with an existing access token; that is a one-command
check for whoever deploys. If it 403s, the permission to name is **`Calendars.Read`** (delegated),
already consented for calendar sync to work at all.

### Migration — `supabase/migrations/20260913140000_calendar_attendee_capture.sql`

Additive only; three `add column if not exists` + one partial index. Nothing dropped or retyped.

- `attendees jsonb not null default '[]'::jsonb` — **ONE storage shape for both providers**
  (AC: extend-don't-duplicate). Element:
  `{email, name?, self?, optional?, resource?, responseStatus?}`.
- `show_as text` — Graph's vocabulary is canonical; Google's `transparency` is **mapped onto it**
  so one column serves both paths rather than two provider-specific columns.
- `organizer_email text` — captured for diagnosis, **explicitly not a classifier input**, and the
  comment on the column says so, so the next reader cannot mistake it for one.

**NOT YET APPLIED.** Written to disk only. It is additive and low-risk, but applying DDL to the
live project is a live-system change on a feature branch and was not in scope to ship.
Apply with MCP `apply_migration` or `supabase db push` when the owner is ready.

### Classifier — `supabase/functions/_shared/meetings.ts` (new shared module)

One module, consumed by both sync paths and by the digest. Exports:
`MEETING_HORIZON_DAYS`, `normalizeAttendees`, `normalizeShowAs`, `showAsCountsAsMeeting`,
`otherPeople`, `isWithPerson`, `groupMeetingsByDay`, `shouldSendMeetingsDigest`.

- **`isWithPerson`** = availability counts **AND** ≥1 attendee who is not the owner and not a
  resource mailbox. It never reads `organizer`.
- **`showAs` rule (owner's decision, AC-MTG-7):** `busy` + `tentative` count; `free` + `oof` do
  not. Added by me and stated here because the owner's decision did not cover them:
  `workingElsewhere` counts, and **NULL/unknown counts** — legacy rows have no `show_as`, and
  dropping them would make the digest go quiet instead of showing a meeting the owner has.
  Erring toward surfacing is the right direction for a digest. Reversible one-liner if wrong.
- **7-day horizon (AC-MTG-6):** declared **once**, as `MEETING_HORIZON_DAYS`.
  `grep -rn "setDate(.*+ 7)\|totalDays = " supabase/functions/` → the only hits are the two
  **pre-existing** ones in `nightly-schedule-builder` (`:432`, `:717`). **This work introduces
  neither pattern.** The clean finish is a one-line import of `MEETING_HORIZON_DAYS` at those
  two sites — `nightly-schedule-builder` is **not a file this task owns**, so it is left
  untouched and flagged here instead.

### Defect I introduced and caught before it shipped

`groupMeetingsByDay` first called `getTodayInTimezone(tz, d)`. **Reading
`_shared/timezone.ts:184` shows it takes ONE argument and always formats `new Date()`** — the
extra arg is ignored. That would have produced **today's date seven times**, collapsing every
meeting into one bucket: exactly the "silently merged into one list" failure AC-MTG-5 exists to
catch, and it would have passed a careless test. Replaced with a single
`Intl.DateTimeFormat('en-CA', {timeZone: tz})` — the *same* formatter `isDateInTimezone` uses, so
the two cannot drift apart.

### Tests — `supabase/functions/_shared/meetings.test.ts`

`bun supabase/functions/_shared/meetings.test.ts` → **43 passed, 0 failed.**
Fixtures are the real rows above, not invented ones.

Also found while testing: **`'2026-09-15T14:00:00+00'` (no offset minutes) is an Invalid Date**
in V8, and `isDateInTimezone` returns `false` on an unparseable date — so a bad timestamp format
**silently deletes a meeting from the digest** rather than erroring. Three guards now assert the
Postgres space form, the ISO `+00:00` form and the `Z` form all bucket identically.

---

## Chunk 2 — wiring both sync paths + types (COMPLETE)

### `calendar-delta-sync/index.ts`
- `:189` `$select` now ends `...,showAs,seriesMasterId,attendees,organizer`.
- Outlook upsert (`:327-329`) and Google upsert (`:542-544`) both write
  `attendees` / `show_as` / `organizer_email` through the **same** `normalizeAttendees` /
  `normalizeShowAs` helpers — one shape, two providers, no second mapping.

### `calendar-integration-manager/index.ts`
- `CalendarEvent` gains the three fields (`:20-22`).
- Google list mapper (`:275-277`): **attendees were already arriving on the wire and being
  discarded** — now captured; no extra API call, no new scope.
- Outlook list mapper (`:295-297`): that call has no `$select`, so Graph returns the full event
  including `attendees` — also already on the wire.
- Upsert (`:193-194`) persists all three.

### `src/integrations/supabase/types.ts`
Hand-added `attendees: Json`, `show_as`, `organizer_email` to Row/Insert/Update.
**Not regenerated** — `generate_typescript_types` reflects the LIVE schema, and the migration is
deliberately unapplied, so a regeneration today would *delete* these three fields. Re-run the
generator after the migration is applied and the hand edit becomes redundant.

### MUTATION PROOF — `scripts/mutate.sh`, 3 of 3 **FIRED**

| # | Defect reinstated | Test that had to fail | Outcome |
|---|---|---|---|
| 1 | `isWithPerson` keys on `organizer_email` instead of attendees — **the exact AC-MTG-2 trap** | `FAIL solo` (Haircut classified as a meeting) | **FIRED** |
| 2 | `free`/`oof` no longer excluded (AC-MTG-7 rule deleted) | `FAIL free does NOT` | **FIRED** |
| 3 | Day bucketing replaced by `day.offset === 0` — every meeting collapses into today | `FAIL exactly three days` | **FIRED** |

Each reported `restored: ... matches HEAD` and a clean tree afterwards. No `INERT`, no
`NOT-APPLIED` in the final set. (One earlier run returned `NOT-APPLIED` because the anchor file
was written to the wrong directory — reported here rather than hidden, since that outcome is
precisely the "nothing was tested" case, and it was re-run correctly.)

### AC status

| AC | Status | Evidence |
|---|---|---|
| AC-MTG-1 | **Code complete, NOT live-verified** | `$select` contains `attendees` (grep, `:189`); column exists in the migration. **The DB read-back half is NOT done** — migration unapplied, nothing deployed, so `SELECT attendees FROM external_calendar_events` would still error. **This AC is not satisfied until that read-back is observed.** |
| AC-MTG-2 | **PASS** | real Haircut / Travis rows; mutation 1 FIRED |
| AC-MTG-3 | PASS | self-flag, address-match and resource-mailbox cases |
| AC-MTG-4 | PASS | `shouldSendMeetingsDigest` false on a solo-only window |
| AC-MTG-5 | **PASS** | days +0/+2/+6 present, +1/+3/+4/+5 absent; mutation 3 FIRED |
| AC-MTG-6 | **PASS** | `grep -rn "setDate(.*+ 7)\|totalDays = " supabase/functions/` → only PRE-EXISTING hits (`nightly-schedule-builder:432,:717`, `execute-tool:214`); this work's only matches are inside a comment in `_shared/meetings.ts` |
| AC-MTG-7 | PASS | stated rule + 6 tests; mutation 2 FIRED |
| AC-MTG-8 | **PARTIAL — do not read as done** | the classifier is pure over rows handed to it and holds no global lookup, which is asserted. **The real guard is that the CALLER scopes its query by `user_id`, and no caller exists yet** — the digest that consumes this is another lane's work. The two-user seeded test the AC asks for was NOT run. |

## NOT REACHED (45-minute budget)

1. **Migration not applied**, so no live read-back. AC-MTG-1 is therefore half-proven: the
   capture code is right, the stored result is unobserved. **This is the gap that matters most.**
2. **Nothing deployed** — feature branch only, as instructed.
3. **No live Graph call** to confirm `attendees` returns under the existing consent. Reasoned,
   high confidence, **not measured** (see chunk 1).
4. **The digest renderer/sender itself is not built here** — this task was capture + classifier +
   grouping. `groupMeetingsByDay` / `shouldSendMeetingsDigest` are the seams it should consume.
5. `nightly-schedule-builder:432,:717` still inline their own `7`. One-line import each; that
   file is not owned by this task.

## HANDOFF — what the next person must do, in order

1. Apply `supabase/migrations/20260913140000_calendar_attendee_capture.sql`.
2. Deploy `calendar-delta-sync` + `calendar-integration-manager`.
3. `update calendar_connections set sync_token = null;` — **after** step 2, so the full re-sync
   is minted with the new `$select`.
4. Trigger a sync, then the read-back that actually closes AC-MTG-1:
   ```sql
   select title, show_as, jsonb_array_length(attendees) as n, attendees
   from external_calendar_events
   where start_time > now() order by start_time limit 10;
   ```
   Expect `Call with Travis Wagner` / `EDS Team Sync` with `n >= 2`, and `Haircut` with `n = 0`.
   **If every row comes back `n = 0`, the Graph consent theory in chunk 1 is wrong** — that is the
   disconfirming result to look for, and the permission to name is delegated `Calendars.Read`.

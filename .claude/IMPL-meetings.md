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

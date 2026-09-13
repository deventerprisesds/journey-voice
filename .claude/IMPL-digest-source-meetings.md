# IMPL — digest-source-meetings (lane: gather + classify meetings for the meetings digest)

WHAT:       `supabase/functions/_shared/digest-source-meetings.ts` — reads the user's calendar
            rows over the rolling horizon and returns a `MeetingsDigestPayload | null`.
WHY:        `digest-content.ts` defines the payload but has NO source; `meetings.ts` owns the
            classifier but takes rows it is GIVEN. Nothing joined the two. This is that join,
            and nothing else.
SUPERSEDES: nothing.
SUPERSEDED-BY: nothing — current.
EVIDENCE:   this file; `src/utils/digestSourceMeetings.test.ts` (`npm test`).

## Chunk 1 — ground truth READ before a single literal was typed

### `external_calendar_events` real columns
Source of truth: `src/integrations/supabase/types.ts:1747` (generated types), cross-checked against
the writers `calendar-delta-sync/index.ts:327,542` and `calendar-integration-manager/index.ts:193,275,295`.

Row: `attendees (Json)`, `calendar_id`, `connection_id`, `created_at`, `description`, `end_time`,
`external_event_id`, `id`, `is_all_day`, `is_recurring`, `last_synced_at`, `location`,
`organizer_email`, `show_as`, `source_task_id`, `start_time`, `title`, `updated_at`, `user_id`.

- There is NO `organizer` column — it is `organizer_email`. (Typing `organizer` would have been
  the exact "literal that must exist in something you have not read" failure.)
- Both sync paths already write `attendees: normalizeAttendees(event, provider)` and `show_as`,
  so the classifier's inputs are real, not aspirational.
- Query shape copied from an existing reader (`nightly-schedule-builder/index.ts:921`):
  `.from('external_calendar_events').select(...).eq('user_id', userId).gte('start_time', …).lt('start_time', …)`.

### Owner email set ("what counts as self")
- `profiles.email` — the pattern used by `huddle-task-sync/index.ts:49`:
  `.from("profiles").select("email").eq("user_id", userId).limit(1).maybeSingle()`.
  NOTE: keyed on `user_id`, NOT `id` (profiles has both columns).
- `calendar_connections.provider_account_email` — the actual connected mailbox(es), per
  `src/integrations/supabase/types.ts` calendar_connections.Row. This is stronger evidence than
  `profiles.email` for the Graph case where the attendee carries no `self` flag, and a user can
  have several connections, so the "self" set is a UNION, not one address.
- No `auth.admin.getUserById` call exists anywhere in `supabase/functions` (grep: zero hits), so
  there is no in-repo precedent for reading the auth user; the two tables above are the precedent.

### Timezone
`notification_prefs.timezone (string|null)` keyed by `user_id` — `notification-scheduler/index.ts:62`
already drives every send off `notification_prefs`. Falls back to `DEFAULT_TIMEZONE`
("America/New_York") exported by `digest-content.ts`, matching AC-TZ-5 (a user is never skipped
for missing config). `user_scheduling_prefs.timezone` also exists but is the scheduling lane's.

### Reuse map — every function this module does NOT reimplement
| Need | Reused from | Not written here |
|---|---|---|
| 7-day horizon | `MEETING_HORIZON_DAYS` (meetings.ts) | no new `+ 7` literal |
| with-a-person verdict | `isWithPerson` (meetings.ts) | no organizer logic, no attendee counting |
| self exclusion | `otherPeople` via `isWithPerson` | no second self-matcher |
| day bucketing | `groupMeetingsByDay` (meetings.ts) | no second date implementation |
| send/suppress | `meetingsDigestIsEmpty` (digest-content.ts) | no second empty rule |
| local day/time strings | `getTodayInTimezone`, `localDateToUtcBounds`, `formatInTimezone` (timezone.ts) | no new Intl formatter |
| deep link | `buildDeepLink` (digest-content.ts) | no fallback base URL |

### Two decisions that needed stating (both recorded before coding)
1. **What makes a row UNCLASSIFIABLE (`withPerson: null`).** The stored `attendees` column being
   absent/NULL/not-an-array — i.e. capture never ran for that row. An `attendees: []` array is a
   CLASSIFIED verdict of "solo" (meetings.ts already rules this: the live "Haircut" fixture in
   `meetings.test.ts` is `attendees: []` and asserts `isWithPerson === false`). Reclassifying `[]`
   as null here would contradict the module that owns the classifier and would make the
   solo-focus-block guard vacuous.
2. **Deno env under a node test runner.** `npm test` is
   `node --experimental-strip-types --test src/utils/*.test.ts`, and `digestContent.test.ts`
   imports straight from `supabase/functions/_shared/*.ts`. A bare `Deno.env.get(...)` is a
   ReferenceError under node, so the env read is `(globalThis as any).Deno?.env?.get?.(...)` —
   the SAME call in Deno, and `undefined` under node, which makes `buildDeepLink` throw
   `MissingDeepLinkBaseError` exactly as it must when APP_BASE_URL is unset. `opts.appBaseUrl`
   is an explicit override for tests; there is deliberately no default string.

## Chunk 2 — what was built

**`supabase/functions/_shared/digest-source-meetings.ts`** (new, 306 lines). Exports:

| Export | Role |
|---|---|
| `loadMeetingsDigestPayload(client, userId, opts)` | the deliverable: read → classify → payload, or `null` |
| `resolveOwnerEmails(client, userId)` | union of `profiles.email` + every `calendar_connections.provider_account_email` |
| `resolveTimezone(client, userId)` | `notification_prefs.timezone` → `DEFAULT_TIMEZONE` |
| `classifyWithPerson(row, ownerEmails)` | `true` / `false` / `null` — delegates to `isWithPerson` |
| `attendeeEvidence(row)` | the stored attendees as an array, or `null` when there is no attendee data |
| `toDigestMeeting(row, {...})` | pure row → `DigestMeeting` |
| `MEETING_EVENT_COLUMNS`, `readAppBaseUrl()` | the select list; the guarded env read |

Flow, in order, and every step's rule is imported rather than restated:

```
opts.timezone ?? notification_prefs.timezone ?? DEFAULT_TIMEZONE
opts.ownerEmails ?? profiles.email ∪ calendar_connections.provider_account_email
buildDeepLink(...)                      ← FIRST, so an unset APP_BASE_URL fails closed
                                          before any query work exists to half-send
window = localDateToUtcBounds(today) .start … localDateToUtcBounds(today+HORIZON-1).end
external_calendar_events  .eq(user_id) .gte(start_time, windowStart) .lt(start_time, windowEnd)
groupMeetingsByDay(rows, owners, tz, now, horizon)   → day key per QUALIFYING row
classifyWithPerson(row, owners)                      → true | false | null   ← the one verdict
buildMeetingsDigestPayload(meetings, {date, timezone, deepLink})
meetingsDigestIsEmpty(payload) ? null : payload
```

Two notes on the composition that a reader will otherwise re-derive:

- **Day keys come from `groupMeetingsByDay`, not from a second bucketing.** Rows the grouper
  drops (solo / unclassified) still need a `localDate` for the `DigestMeeting` type; those get a
  locally-formatted key with the SAME `Intl.DateTimeFormat('en-CA', {timeZone})` construction the
  grouper uses (meetings.ts:195), and they are excluded by `buildMeetingsDigestPayload` anyway.
  `getTodayInTimezone(tz)` could not be used at all: it takes one argument and always formats
  `new Date()` (timezone.ts:184), so it cannot express an injected clock or a future offset.
- **The horizon is enforced by the QUERY window**, not by the grouper's membership. That is
  deliberate: if the classification result decided which rows survive the horizon filter, then
  breaking the classifier would ALSO remove the row from the payload and the solo-focus-block
  guard would be inert — the mutation would be masked by the very defect it reinstates. Keeping
  the two independent is what makes M1 below able to fire.

**`src/utils/digestSourceMeetings.test.ts`** (new) — node:test + node:assert/strict, the exact
idiom of `src/utils/digestContent.test.ts`, importing `supabase/functions/_shared/*.ts` directly.
The fake supabase client APPLIES the `eq` / `gte` / `lt` filters it is handed, so the horizon
window this module computes is exercised rather than assumed, and records every call so the query
shape itself is asserted (`columns === MEETING_EVENT_COLUMNS`, `eq.user_id === USER`).

## Chunk 3 — RESULTS (the numbers, not a summary of them)

### Suite
- `npm test` (whole repo): **148 pass, 0 fail**, 38 suites, 778ms.
- this file alone (`node --experimental-strip-types --test src/utils/digestSourceMeetings.test.ts`):
  **19 pass, 0 fail**, 8 suites.
- typecheck: `npx tsc --ignoreConfig --noEmit --skipLibCheck --target es2022 --module esnext
  --moduleResolution bundler --allowImportingTsExtensions --lib es2022,dom
  supabase/functions/_shared/digest-source-meetings.ts` → **rc=0** (pulls in digest-content.ts,
  meetings.ts and timezone.ts transitively). `deno` is NOT installed in this container, so a
  `deno check` was not run — stated rather than implied.

### Mutations — VERBATIM `mutate.sh` output, six runs, six FIRED
Every run also printed `note: … is UNTRACKED -- restore is asserted against a sha256 taken now,
not against HEAD.` (these files are new and this lane must not commit), and each ended with
`restored: … matches its pre-mutation sha256` + `tree clean: '<test>' passes again on the
restored tree`.

**M1 — the one that matters: `withPerson` derived from `organizer_email`**
anchor → `if (attendeeEvidence(row) === null) return null;` + `return isWithPerson(row, ownerEmails);`
replacement → `return Boolean((row as any)?.organizer_email);`
```
FIRED: 'a solo block the user organised is absent from the payload' failed with the defect reinstated. The guard is real.
```

**M2 — drop the absent-evidence rule (unclassified becomes classified)**
replacement → the `attendeeEvidence(row) === null` early-return deleted
```
FIRED: 'a row with NO attendee data classifies as null, not false and not true' failed with the defect reinstated. The guard is real.
```

**M3 — return the payload instead of `null` when empty**
anchor → `return meetingsDigestIsEmpty(payload) ? null : payload;` replacement → `return payload;`
```
FIRED: 'a calendar of nothing but solo holds sends NOTHING (not an empty-state email)' failed with the defect reinstated. The guard is real.
```

**M4 — widen the query window past the horizon** (`(horizonDays - 1)` → `(horizonDays + 14)`)
```
FIRED: 'an event beyond the 7-day horizon is never read (the query window bounds it)' failed with the defect reinstated. The guard is real.
```

**M5 — give the deep link a fallback base URL (fail OPEN)**
anchor → `: readAppBaseUrl(),` replacement → `: readAppBaseUrl() ?? 'https://fallback.example.com',`
```
FIRED: 'throws MissingDeepLinkBaseError when no base URL is configured' failed with the defect reinstated. The guard is real.
```

**M6 — drop `calendar_connections` from the owner "self" set**
```
FIRED: 'a second connected mailbox is recognised as self, so its solo hold is not a meeting' failed with the defect reinstated. The guard is real.
```

**NOT mutation-proved, and why — stated rather than quietly skipped.** The test
`a late-evening meeting buckets by the OWNER'S local day, not UTC` (01:00Z on the 16th = 21:00 ET
on the 15th) asserts a COMPOSED result whose logic lives in `groupMeetingsByDay`
(`meetings.ts`) — a file this lane must not modify. Every candidate mutation inside THIS file is
behaviourally equivalent for it (the day key is taken from the grouper), so the honest report is
"not proven here", not "proven". It is proved in `meetings.test.ts` by the module that owns it.

## Chunk 4 — not done / open for the integrating lane
- **Not committed, not pushed** (per the brief). Both files are untracked in the working tree on
  `claude/huddle-workflows-setup-cucecs`.
- **No caller exists yet.** `send-digests` is another lane's; this module is import-ready:
  `loadMeetingsDigestPayload(supabaseClient, userId)` with no opts uses the real timezone, the
  real self-address resolution, `MEETING_HORIZON_DAYS`, and `APP_BASE_URL`.
- **`APP_BASE_URL` must be set at deploy** (`supabase secrets set APP_BASE_URL=https://<host>`) or
  every meetings digest throws `MissingDeepLinkBaseError` — by design, and the caller must record
  the run FAILED rather than swallow it.
- **Untouched, as instructed:** `digest-content.ts`, `meetings.ts`, `notification-delivery/`,
  `nightly-schedule-builder/`. No new `+ 7` literal and no second horizon constant was introduced.

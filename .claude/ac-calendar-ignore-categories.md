<!--
WHAT:          Acceptance criteria for "ignore calendar events by Outlook category" (owner 2026-11-22:
               "ignore a category with purple being the category to turn on for ignoring now").
WHY:           Independent, cold AC pass required before coding (Tier 1: changes what the owner's calendar
               treats as busy time across the planner, reminders and digests, and the ignore decision parses
               free-text names).
SUPERSEDES:    nothing.  SUPERSEDED-BY: nothing -- current.
EVIDENCE:      sources read below; baseline `node scripts/run-tests.mjs` = 743 tests, 743 pass, 0 fail
               (2026-11-22, this worktree, before any change). calendar-ignore.test.ts + onedrive-feed.test.ts
               alone = 30/30 pass.
NOTE:          written into the AC agent's isolated worktree (the harness refused the shared-checkout path);
               copy to /home/user/journey-voice/.claude/ac-calendar-ignore-categories.md.
-->

## Acceptance Criteria — Ignore calendar events by Outlook category

Task: add an owner-editable list `config.calendarIgnoreCategories` (Outlook category NAMES); any stored-calendar
row carrying a listed category is never stored, never shown, never busy time — on every calendar write path —
and seed the owner's own config with `["Purple category"]`.

Sources read:
- `supabase/functions/_shared/calendar-ignore.ts` (whole file, 112 lines)
- `supabase/functions/_shared/onedrive-feed.ts` (whole file; `FeedEventRow` :165-181, `mapFeedEventRows` :187-221)
- `supabase/functions/_shared/onedrive-feed-sync.ts` :95-132 (ignore filter :102-104, stale delete :118-130)
- `supabase/functions/calendar-delta-sync/index.ts` :194-209 (`applyIgnoreList`), :238 (`$select`), :225-228
  (`url = connection.sync_token`), :350-399 (Outlook map + upsert), :578-605 (Google map + upsert)
- `supabase/functions/calendar-integration-manager/index.ts` :170-209 (`syncCalendarEvents`), :285-301 (Outlook fetch, no `$select`)
- `supabase/functions/_shared/calendar-ignore.test.ts` (pinned-shape regexes at :33, :52, :54, :131)
- `src/config/schedulingRules.ts` :119-128 (type), :360-416 (`mergeSchedulingConfig` pass-throughs :405-408)
- `src/components/SchedulingSettings.tsx` :69-95 (`handleSave`), :545-572 (ignore card)
- `src/services/schedulingService.ts` :182-207 + `src/utils/mergeStoredConfig.ts` (save MERGES top-level keys; `undefined` keys are skipped)
- huddle-extension-app `src/features/huddle/lib/email/graph-email.server.ts` :579, :664-683 (Huddle's own hardcoded mirror of the ignore rule)

Existing system this extends (not duplicates): `_shared/calendar-ignore.ts` `isIgnoredCalendarEvent` /
`resolveIgnoreRules` / `loadIgnoreRules` — THE one ignore decision, already called by all three writers
(feed sync, delta sync both providers, integration manager). Storage is the existing
`user_scheduling_prefs.config` JSON and the existing Settings card "Ignore these calendar events". The only new
structure is one nullable column `external_calendar_events.categories`.

### A. The decision function (`_shared/calendar-ignore.ts`)

| # | Given / When / Then | Category | Observed via |
|---|---|---|---|
| AC-1 | Given config `{ calendarIgnoreCategories: ["Purple category"] }`, when `resolveIgnoreRules(config)` runs, then the result has a `categories` field equal to `["purple category"]` (trimmed, lower-cased) AND `phrases` / `tentative` / `ownerEmails` are exactly what they were before the change for the same input. | happy-path | node unit test, `assert.deepEqual` |
| AC-2 | Given config with `calendarIgnoreCategories` absent, `null`, a string `"Purple category"`, a number, or an object, when resolved, then `categories` is `[]` — a malformed value ignores NOTHING by category (fail-open toward keeping meetings; the opposite of the titles seed). | edge | unit test, one assert per input |
| AC-3 | Given a list containing junk entries `[" Purple category ", "", "   ", 3, null, {}]`, when resolved, then `categories` is exactly `["purple category"]` (non-strings and blank strings dropped, never coerced — `3` must not become `"3"`). | edge | unit test |
| AC-4 | Given rules with categories `["purple category"]`, when `isIgnoredCalendarEvent` is called with `{ title: "Sprint Review", show_as: "busy", categories: ["Blue category", "Purple category"] }`, then it returns `true` (ANY listed category ignores the event). | happy-path | unit test |
| AC-5 | Given the same rules, when the row's `categories` is `["Blue category"]`, `[]`, `undefined`, `null`, the string `"Purple category"`, or `[null, 7, {}]`, then `isIgnoredCalendarEvent` returns `false` for each and does not throw. | edge | unit test, loop with labelled asserts |
| AC-6 | Given rules from `resolveIgnoreRules({ calendarIgnoreTentative: false, calendarIgnoreCategories: ["Purple category"] })` (the owner's live tentative setting is `false`), when a busy, non-tentative row has `categories: ["Purple category"]`, then it is ignored (`true`). The tentative switch must not gate the category rule. | regression/edge | unit test |
| AC-7 | Given categories `[]` (absent config), when every existing assertion in `_shared/calendar-ignore.test.ts` runs, then all still pass: "Work Block 2" busy still ignored, tentative group still ignored when switch on, tentative 1:1 / own hold / no-attendee tentative still kept. Existing assertions may be EXTENDED, never deleted or loosened. | regression | `node --experimental-strip-types --test supabase/functions/_shared/calendar-ignore.test.ts`; `git diff` of the test file shows no removed `assert` lines |
| AC-8 | Given an event whose TITLE is "Purple category review" but whose categories are `[]`, with categories rule `["purple category"]` and no matching title phrase, then it is KEPT — category matching reads only the `categories` field, never the title (and the title rule never reads categories). | over-match negative | unit test |
| AC-9 | Given categories rule `["purple category"]`, when a row has `categories: ["Dark Purple category"]`, `["Purple category 2"]`, `["Purple"]`, or `["Purple categoryX"]`, then it is KEPT — exact name equality after trim + case-fold, never substring and never prefix. This deliberately differs from the title rule, which IS substring. | over-match negative | unit test; `scripts/mutate.sh` replacing the equality with `.includes(` must report FIRED |
| AC-10 | Given row `categories: ["  PURPLE CATEGORY  "]` (whitespace/case on the EVENT side), then it is ignored — normalization applies to both the list entry and the event's category name. | edge | unit test |

### B. Schema (must land BEFORE the edge functions)

| # | Given / When / Then | Category | Observed via |
|---|---|---|---|
| AC-11 | Given the new migration, when applied, then `public.external_calendar_events.categories` exists as `text[]`, NULLABLE, with no NOT NULL constraint, and the migration is purely additive (`ADD COLUMN IF NOT EXISTS`; no DROP, no rewrite of existing columns; re-running it is a no-op). | happy-path | `select data_type, udt_name, is_nullable from information_schema.columns where table_name='external_calendar_events' and column_name='categories'` → `ARRAY`, `_text`, `YES`; migration file grep shows no `DROP` |
| AC-12 | Given edge functions auto-deploy on push to `main`, when the writers start sending a `categories` key, then the column already exists in the live project `wwxgajrtmslzklnyplah` — i.e. the migration is applied (MCP `apply_migration`) BEFORE the merge. A writer that upserts `categories` into a table without the column makes PostgREST reject the whole batch, so the feed would return `status:"error"` and store NOTHING (onedrive-feed-sync.ts:110-113). | error/ordering | `information_schema` query run and recorded before the merge commit; first post-deploy feed run returns `status:"ok"` |

### C. Writer 1 — OneDrive work-calendar feed (`_shared/onedrive-feed.ts`, `_shared/onedrive-feed-sync.ts`)

| # | Given / When / Then | Category | Observed via |
|---|---|---|---|
| AC-13 | Given a snapshot record with `categories: ["Purple category", "Blue category"]`, when `mapFeedEventRows` runs, then the row has `categories` deep-equal to `["Purple category", "Blue category"]` (names preserved as sent; `FeedEventRow` type gains `categories`). | happy-path | onedrive-feed.test.ts |
| AC-14 | Given records with `categories` missing, `[]`, `null`, a string, or `[1, null, "Green category"]`, when mapped, then the row's `categories` is `[]` (or `null`) for the first four and `["Green category"]` for the last — the mapper never throws and never emits a non-string element. | edge | unit test |
| AC-15 | Given owner config `calendarIgnoreCategories: ["Purple category"]`, `calendarIgnoreTentative: false`, and a valid snapshot of 3 records — A `["Purple category"]`, B `["Purple category","Blue category"]`, C `["Blue category"]` — when `syncTaskosFeed` (onedrive-feed-sync.ts) runs against the fake supabase in onedrive-feed.test.ts, then the upsert payload contains ONLY C, the result is `{status:"ok", upserted:1}`, and the stored C row's `categories` is `["Blue category"]`. | happy-path | onedrive-feed.test.ts fake-client capture of the upsert payload |
| AC-16 | Given A and B were ALREADY stored as feed rows from an earlier run (before the rule), when the next valid snapshot still contains A and B, then both are deleted by the existing stale-by-id step (onedrive-feed-sync.ts:118-130) because they are absent from `keep`, and `removed` counts them. No new pattern-delete is introduced on the feed path. | happy-path/purge | onedrive-feed.test.ts: seed `existing` with A,B,C ids → assert delete `.in("id", [A,B])` |
| AC-17 | Given the owner then UNTICKS Purple (`calendarIgnoreCategories: []`), when the next snapshot runs, then A and B are upserted again (they come back) — the rule is reversible without any manual data repair. | happy-path/reversibility | unit test, second run with new config |
| AC-18 | Given a REJECTED snapshot (e.g. `wrong_mailbox`), when sync runs with the category rule on, then nothing is deleted or upserted (`status:"rejected:..."`) — the category rule never causes removals from an invalid snapshot. | regression | existing rejected-snapshot test in onedrive-feed.test.ts still passes |

### D. Writer 2 — `calendar-delta-sync/index.ts`

| # | Given / When / Then | Category | Observed via |
|---|---|---|---|
| AC-19 | Given an initial Outlook sync (no `sync_token`), when the request URL is built (:238), then its `$select` contains `categories` alongside the existing fields (none removed). | happy-path | source assertion test: regex on the URL literal includes `categories` and still includes `showAs`, `attendees`, `organizer`, `seriesMasterId` |
| AC-20 | Given an EXISTING Outlook connection that already has a `sync_token` (a Graph delta link), when the next incremental run uses `url = connection.sync_token` (:225-228), then events still arrive WITH `categories`. Graph encodes the original `$select` inside the delta/next links, so editing :238 alone never reaches an already-connected calendar. The change must force one fresh initial sync for Outlook connections (e.g. clear `sync_token` once, or detect a delta link lacking `categories`). | regression/hidden-gap | live: after deploy, one Outlook delta run's stored rows have non-NULL `categories` (`select count(*) filter (where categories is not null) from external_calendar_events e join calendar_connections c on c.id=e.connection_id where c.provider in ('outlook','office365') and e.external_event_id not like 'feed:%'` > 0) |
| AC-21 | Given a Graph event with `categories: ["Purple category"]`, when mapped at :360-380, then the row carries `categories: ["Purple category"]`; given `categories` absent from the payload, the row carries `[]` or `null`, never `undefined`-induced crash. | happy-path/edge | source + unit test of the map (or of an extracted pure mapper) |
| AC-22 | THE EARLY RETURN. Given rules `{ phrases: [], tentative: false, categories: ["purple category"] }` (owner cleared titles, tentative off, Purple ticked), when `applyIgnoreList` (:197-209) runs on rows that include a Purple row, then the Purple row is NOT returned. Today `if (!rules.phrases.length && !rules.tentative) return rows;` (:199) returns everything untouched. | error/bug | unit test driving `applyIgnoreList` (export it or test via the existing source-regex style + a behavioural test); `mutate.sh` restoring the old early return must FIRE |
| AC-23 | Given an Outlook event already STORED without categories, which the owner later tags Purple, when the next delta run re-sends it with `categories: ["Purple category"]`, then the stored row is DELETED — dropping it from the upsert is not enough, because the stored copy keeps its old (empty) categories and would never match a column-based purge. Required: delete by `connection_id` + `external_event_id` of every row the filter dropped in this batch. | purge | unit test with a fake client capturing `.delete().eq('connection_id',…).in('external_event_id',[…])` |
| AC-24 | Given stored rows on this connection whose `categories` column overlaps the list (case-insensitively), when `applyIgnoreList` runs, then they are deleted BY ID (selected, filtered in code with the same `isIgnoredCalendarEvent`, then `.in('id', ids)`) and rows with `source_task_id` set (TaskOS-created events) are never touched — same guard as the title purge (:203) and `purgeTentativeGroups` (calendar-ignore.ts:104). A SQL `ilike`/`&&` purge that is case-sensitive or substring-based does not satisfy this. | purge/over-match | unit test: stored rows `["purple category"]` (deleted), `["Dark Purple category"]` (kept), purple row with `source_task_id` (kept) |
| AC-25 | Given a Google connection, when mapped at :578-597, then rows carry `categories` null or `[]`, are never ignored by the category rule, and the Google path still goes through `applyIgnoreList` (:600) with the title and tentative rules unchanged. | edge/regression | unit/source test |
| AC-26 | Given the category purge errors (fake client returns `{error}`), when `applyIgnoreList` runs, then it logs a warning and still returns the filtered rows; the upsert of kept rows still happens (same non-fatal shape as :204). | error | unit test |

### E. Writer 3 — `calendar-integration-manager/index.ts`

| # | Given / When / Then | Category | Observed via |
|---|---|---|---|
| AC-27 | Given an Outlook `/me/calendar/events` response (:286, no `$select`, so Graph returns `categories`) with one Purple and one Blue event, when `syncCalendarEvents` (:170-209) runs, then `fetchOutlookCalendarEvents` carries `categories` through the `CalendarEvent` shape, `eventsToInsert` (:186-194) carries it onto the row, the upsert payload contains only the Blue event, and the JSON response reports `synced_events: 1, ignored_events: 1`. The pinned regex at calendar-ignore.test.ts:54 still matches, or is updated in the same commit to the new exact shape — never loosened. | happy-path | unit/source test |
| AC-28 | Given a Google fetch on the same path (:270-283), then rows carry no ignoring categories and are kept unless a title/tentative rule applies. | edge | unit/source test |

### F. Frontend config + Settings card

| # | Given / When / Then | Category | Observed via |
|---|---|---|---|
| AC-29 | Given stored config `{ calendarIgnoreCategories: ["Purple category"], calendarIgnoreTentative: false }`, when `mergeSchedulingConfig` (schedulingRules.ts:360) runs, then the result has `calendarIgnoreCategories` deep-equal `["Purple category"]`; given the key absent or not an array, the value is `undefined` (key not invented), same pattern as :406/:408. The `SchedulingConfig` type (:119-128) declares `calendarIgnoreCategories?: string[]` with a contract comment naming `_shared/calendar-ignore.ts`. | happy-path | unit test on `mergeSchedulingConfig` |
| AC-30 | Given the owner's stored config holds `["Purple category"]`, when the owner changes an UNRELATED setting (e.g. a time window) and presses Save, then after reload the stored `user_scheduling_prefs.config.calendarIgnoreCategories` is still `["Purple category"]`. | regression | unit: `mergeStoredConfig(stored, patch)`; live: DB read after save |
| AC-31 | Given the card at SchedulingSettings.tsx:545-572, when rendered, then it shows one labelled checkbox per Outlook default colour category — exactly "Red category", "Orange category", "Yellow category", "Green category", "Blue category", "Purple category" — with "Purple category" checked for the owner (from stored config) and the rest unchecked; the existing title-phrase input and tentative checkbox still render and save as before. | happy-path/regression | Playwright on the deployed app: `getByLabel('Purple category')` checked |
| AC-32 | Given the owner UNTICKS Purple and saves, then the save payload contains `calendarIgnoreCategories: []` — an explicit empty array, NOT `undefined`. `mergeStoredConfig` skips `undefined` keys, so sending `undefined` would leave `["Purple category"]` stored and the untick would silently do nothing. After reload the box is unchecked and the DB value is `[]`. | error/hidden-gap | unit test on the payload; DB read |
| AC-33 | Given the owner adds a custom name "  Client X  " and saves, then the stored list contains `"Client X"` (trimmed), it shows checked after reload, a case-only duplicate of an existing entry is not stored twice, and a blank entry is not stored. | edge | component/unit test + DB read |
| AC-34 | Given the card, then its description says in plain words that an event with ANY ticked Outlook category is not imported, not shown and never blocks time, and that Google events have no categories. | happy-path/copy | rendered text |

### G. Owner seed, live outcome, cross-surface agreement

| # | Given / When / Then | Category | Observed via |
|---|---|---|---|
| AC-35 | Given the owner's `user_scheduling_prefs` row, when the seed is applied, then ONLY the `calendarIgnoreCategories` key is added (a jsonb key merge, not a config replace); every other key — explicitly `calendarIgnoreTentative = false` and `calendarIgnoreTitles` — is identical before vs after, and exactly 1 row changes. | happy-path/regression | SQL: `config - 'calendarIgnoreCategories'` before = after; UPDATE row count 1 |
| AC-36 | Given the seed is live and the next scheduled feed sync has run, then the count of `external_calendar_events` rows with `calendar_id='onedrive-feed'` whose `categories` contains "Purple category" is 0; Blue-only feed rows remain; the run's `removed` is at least the number of Purple feed rows stored before. Reconcile against the measured snapshot (254 records, 132 Purple, 15 of those also Blue): stored-feed-row count after = mapped in-window records minus Purple ones. | happy-path/live | Supabase MCP SQL + feed-sync result |
| AC-37 | Given a Purple feed event that occupied a slot, when the planner, slot finder and meetings digest next read `external_calendar_events`, then none sees it — they all read the one stored table, so NO reader-side filter is added (a second filter would be a parallel system). | cross-surface | grep: `calendarIgnoreCategories` appears only in `_shared/calendar-ignore.ts`, the three writers (via rules), `schedulingRules.ts`, `SchedulingSettings.tsx`, tests, migration/seed |

### H. Regression + performance

| # | Given / When / Then | Category | Observed via |
|---|---|---|---|
| AC-38 | Given the full suite, when `npm test` (node scripts/run-tests.mjs) runs after the change, then it exits 0 with `# fail 0` and `# tests` ≥ 743 (measured baseline) plus the new tests; no per-root floor in run-tests.mjs is lowered. | regression | runner output |
| AC-39 | Given a 999-record snapshot (FEED_MAX_RECORDS − 1), each with 3 categories, and a 6-entry list, when map + filter run, then they finish in < 50 ms in the node test runner, and the ignore rules are loaded ONCE per sync (fake client sees exactly 1 `user_scheduling_prefs` select per feed sync / per `applyIgnoreList`). | performance | timed unit test + call count |
| AC-40 | Each new guard (exact-name match AC-9, early-return fix AC-22, dropped-row delete AC-23, frontend pass-through AC-29, explicit `[]` on untick AC-32) is mutation-proved with `scripts/mutate.sh` and reports FIRED with control EQUIVALENT; NOT-APPLIED or INERT fails this AC. | regression | mutate.sh output per guard |

### Spelling table (list = `["Purple category"]` unless stated; verdict for `isIgnoredCalendarEvent` on a busy, non-tentative row whose title matches no phrase)

Documentation basis: the measured snapshot probe (huddle-extension-app run 44970672964: `categories` is an array of
NAME strings, literal value "Purple category") and Microsoft Graph `event.categories` (String collection of
category display names) / `outlookCategory.displayName` with default names "<Colour> category". The Graph pages
were NOT opened in this pass (see Gaps) — rows resting only on Graph are marked [Graph, unread].

| # | Event `categories` (or list) | Documented by | Expected verdict | Wrong answer would be |
|---|---|---|---|---|
| S-1 | `["Purple category"]` | probe (exact stored value) | IGNORE | FALSE PASS (event shown/busy) |
| S-2 | `["purple CATEGORY"]` | owner rule "case-insensitive" (brief) | IGNORE | FALSE PASS |
| S-3 | `[" Purple category "]` | trim rule (brief) | IGNORE | FALSE PASS |
| S-4 | `["Blue category","Purple category"]` | probe (15 records carry both) | IGNORE | FALSE PASS |
| S-5 | `["Blue category"]` | probe | KEEP | FALSE REFUSAL (meeting lost) |
| S-6 | `["Purple"]` | over-match negative (prefix of list entry) | KEEP | FALSE REFUSAL |
| S-7 | `["Dark Purple category"]` | over-match negative (list entry is a substring) | KEEP | FALSE REFUSAL |
| S-8 | `["Purple category 2"]` | over-match negative (suffix) | KEEP | FALSE REFUSAL |
| S-9 | `[""]` / `["   "]` | blank name | KEEP | FALSE REFUSAL |
| S-10 | `null` / absent / `[]` | Google rows; Outlook events with none (owner's EDS calendar: 0 in next 30 days) | KEEP | FALSE REFUSAL |
| S-11 | `"Purple category"` (string, not array) | non-array input | KEEP, no throw | crash or FALSE REFUSAL |
| S-12 | `[7, null, {}]` | non-string elements | KEEP, no throw | crash |
| S-13 | title `"Purple category sync"`, categories `[]` | over-match negative (title must not feed category rule) | KEEP | FALSE REFUSAL |
| S-14 | list `["purple category"]` (owner typed lower case), event `["Purple category"]` | case-fold on list side | IGNORE | FALSE PASS |
| S-15 | list `[]`, event `["Purple category"]` | owner unticked | KEEP | FALSE REFUSAL |
| S-16 | list `"Purple category"` (string in config) | malformed config | KEEP (category rule off) | FALSE REFUSAL |
| S-17 | list `["Purple category"]`, `calendarIgnoreTentative:false`, event tentative group with `["Purple category"]` | tentative switch independence | IGNORE | FALSE PASS |
| S-18 | `["Purple Category"]` (capital C) | [Graph, unread] names are owner-editable display strings | IGNORE (case-fold) | FALSE PASS |

### Goal → AC coverage
- Goal "Purple-category work events stop appearing in TaskOS and stop taking slots" → AC-4, AC-6, AC-13, AC-15, AC-16, AC-22, AC-23, AC-36, AC-37
- Goal "I can turn categories on and off myself" → AC-17, AC-29, AC-30, AC-31, AC-32, AC-33, AC-34
- Goal "nothing I already rely on changes" (titles, tentative, Google, other settings) → AC-1, AC-7, AC-8, AC-18, AC-25, AC-28, AC-35, AC-38
- Goal "never lose a real meeting to a wrong match" → AC-2, AC-3, AC-5, AC-9, AC-10, AC-14, AC-24, S-6..S-13
- Goal "applies to Outlook calendars too, not just the feed" → AC-19, AC-20, AC-21, AC-27
- Every AC traces to a goal; AC-11/12/39/40 are delivery guards for the goals above.

### Gaps / open questions for the user
1. **Huddle is NOT covered by this change.** Huddle reads the same OneDrive feed with its own hardcoded copy of the
   rule (huddle-extension-app `graph-email.server.ts` :579, :664-683, `IGNORED_CALENDAR_TITLES = ["work block"]`).
   Purple events will keep appearing in Huddle's schedule brief / calendar tool unless Huddle is changed too. The
   2026-11-18 owner wording for work blocks named both TaskOS and Huddle; this request did not say. Needs an owner
   answer (or a tracked follow-up row), not an assumption.
2. **Graph delta-link `$select` carry-over (AC-20)** rests on Graph's documented behaviour that next/delta links
   encode the original query parameters. Not re-read from Microsoft's docs in this pass (no fetch done). Practical
   impact today is small — the owner's EDS Outlook has 0 categorised events in the next 30 days — but without it the
   rule silently never applies to any already-connected Outlook calendar.
3. **Title-rule latent twin of AC-23:** the existing title purge (delta-sync :202-205) deletes by the STORED title, so
   an event renamed to "Work Block" after being stored also survives. Out of scope here; worth a backlog row.
4. Should the six default colour names be the full Outlook preset list (Graph has preset0..preset24 colours, but only
   six have default "<Colour> category" names)? AC-31 assumes the six plus a custom-name input.
5. Non-array `categories` from the feed is treated as "no categories" (kept). The probe saw arrays only; if Power
   Automate ever sends a "; "-joined string, Purple events would silently reappear. Decide: keep fail-open, or split
   strings on `;`/`,` like `feedAttendees` does (onedrive-feed.ts:152).
6. Performance bound in AC-39 (< 50 ms) is a proposed default; no latency target was stated.

AC-DONE

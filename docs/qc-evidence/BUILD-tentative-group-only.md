# BUILD-tentative-group-only

- WHAT:       Build log for narrowing the "ignore tentative" calendar rule to GROUP invites only, and making a
              calendar change (new today event, or tentative -> accepted) reach today's plan within ~15 min.
- WHY:        Owner 2026-11-20: "The ignore tentative should be adjusted to only when it isn't a meeting with me
              alone but is instead a group meeting or when I update it from tentative to accepted it has to
              immediately update on my schedule otherwise meetings I planned to attend after accepting mid day
              are being missed because they were already filtered out at the start of the day".
- SUPERSEDES: the blanket tentative rule of 2026-11-19 (calendar-ignore.ts "TENTATIVE" header; delta-sync's
              `.eq('show_as','tentative')` purge). Those now ignore only tentative events with 2+ other people.
- SUPERSEDED-BY: nothing -- current.
- EVIDENCE:   supabase/functions/_shared/calendar-ignore.test.ts (CI-*), onedrive-feed.test.ts; mutation
              results below. Branch `claude_tentative-group-only`.

## Decided interpretation (session default; owner may overrule -- ONE constant)
- `TENTATIVE_GROUP_MIN_OTHERS = 2` in `_shared/calendar-ignore.ts`.
- Tentative + >= 2 other people (per `otherPeople()` in `_shared/meetings.ts`) -> ignored.
- Tentative + 0 others (own hold) or 1 other (1:1) -> kept.
- `attendees: []` / missing = unknown, counted as NOT a group -> kept.

## Changes (one line each, with the covering test)
- (a) `calendar-ignore.ts`: `CalendarIgnoreRules.ownerEmails`; `TENTATIVE_GROUP_MIN_OTHERS = 2`; `isTentativeGroup()`;
  `loadIgnoreRules(supabase, userId, extraOwnerEmails)` now adds `resolveOwnerEmails()` (profile + connected mailboxes).
  Covered by CI-6, CI-8, CI-10 (solo kept), CI-11 (1:1 kept), CI-12 (2 others ignored), CI-13 (`attendees:[]` kept).
- (b) `calendar-delta-sync` `applyIgnoreList`: blanket `.eq('show_as','tentative')` delete REPLACED by
  `purgeTentativeGroups()` (select tentative rows with attendees, `source_task_id IS NULL`, delete group ids only).
  Covered by CI-15 (behavioural: deletes `['g1']` only) and CI-9 (source: no blanket purge remains).
- (c) OneDrive feed passes `[cfg.mailbox, cfg.driveAccount]` as owner addresses. Covered by CI-4, CI-14, onedrive-feed D3c.
- (d) `calendar-integration-manager` `syncCalendarEvents` filters with the same rule before its upsert. Covered by CI-5
  (every upserting writer must contain `!isIgnoredCalendarEvent(`; exact regex on the integration manager).
- RESTORING already-purged rows: purged solo/1:1 tentative rows are NOT in a delta (Graph/Google delta only re-sends
  CHANGED events). They return on (i) any change to that event, or (ii) a FULL sync: clear the connection's
  `sync_token` (`update calendar_connections set sync_token = null where id = <conn>`) and run calendar-delta-sync,
  or call calendar-integration-manager `sync_events` for the window. The OneDrive feed is a full snapshot every run,
  so feed rows come back on the next run with no action.

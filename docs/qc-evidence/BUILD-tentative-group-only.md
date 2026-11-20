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

-- WHAT:       external_calendar_events.categories -- the Outlook category NAMES on each stored event
--             (e.g. 'Purple category'); NULL/{} when none (Google has none).
-- WHY:        Owner 2026-11-22: "ignore a category with purple being the category to turn on for ignoring now".
--             The ignore rule (_shared/calendar-ignore.ts) drops listed categories before storing, and purges
--             already-stored rows by this column. Measured source: huddle-extension-app run 44970672964.
-- SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
-- EVIDENCE:   .claude/ac-calendar-ignore-categories.md AC-11/AC-12. Purely additive; safe to re-run.
-- ORDER:      apply BEFORE the edge functions that write `categories` deploy (AC-12).
ALTER TABLE public.external_calendar_events ADD COLUMN IF NOT EXISTS categories text[];

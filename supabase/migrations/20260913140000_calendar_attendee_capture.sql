-- WHAT:       Adds attendee / availability capture columns to external_calendar_events so a
--             meeting can be classified as "with a person" rather than a solo hold.
-- WHY:        `attendees` was stored NOWHERE (verified 2026-09-13: zero grep hits across
--             supabase/functions and src/; information_schema.columns for
--             external_calendar_events returned 16 columns, none of them attendees/showAs).
--             `organizer` IS captured but is a FALSE SIGNAL -- calendar-delta-sync:532 writes
--             `event.organizer?.email` into `calendar_id` as a CALENDAR IDENTIFIER, and the
--             owner is the organizer of their own solo focus block, so organizer alone marks
--             every solo hold as a meeting (AC-MTG-2, AC doc C8d).
-- SUPERSEDES: nothing.
-- SUPERSEDED-BY: nothing -- current.
-- EVIDENCE:   .claude/IMPL-meetings.md (chunk 1); AC-MTG-1, AC-MTG-7 in
--             .claude/AC-digest-delivery.md section F.
--
-- ADDITIVE ONLY. No column is dropped, renamed, or retyped.

-- Normalized attendee list. ONE storage shape consumed by BOTH sync paths (Graph + Google);
-- the provider-specific mapping lives in _shared/meetings.ts::normalizeAttendees().
-- Element shape: { email, name?, self?, optional?, resource?, responseStatus? }
alter table public.external_calendar_events
  add column if not exists attendees jsonb not null default '[]'::jsonb;

-- Free/busy status. Graph `showAs` values (free|tentative|busy|oof|workingElsewhere|unknown)
-- are the canonical vocabulary; Google's `transparency` (transparent|opaque) is MAPPED onto it
-- in _shared/meetings.ts::normalizeShowAs() so one column serves both providers.
-- Owner's decision (settled): busy + tentative count as a meeting; free + oof do not.
alter table public.external_calendar_events
  add column if not exists show_as text;

-- The real organizer address, kept SEPARATE from calendar_id (which is a calendar identifier
-- and is already overloaded with an email on the Google path). Diagnostic only -- the
-- classifier does NOT key on it. See WHY above.
alter table public.external_calendar_events
  add column if not exists organizer_email text;

comment on column public.external_calendar_events.attendees is
  'Normalized attendee list, provider-agnostic: [{email,name?,self?,optional?,resource?,responseStatus?}]. Written by both calendar-delta-sync and calendar-integration-manager via _shared/meetings.ts::normalizeAttendees(). Empty array = no attendee data captured (legacy row or provider omitted it) -- NOT proof the event is solo.';

comment on column public.external_calendar_events.show_as is
  'Graph showAs vocabulary (free|tentative|busy|oof|workingElsewhere|unknown); Google transparency is mapped onto it. NULL = not captured (legacy row).';

comment on column public.external_calendar_events.organizer_email is
  'Organizer address. Diagnostic only -- NOT a with-a-person signal (the owner organizes their own solo holds).';

-- Partial index: the meetings digest scans "my events in the next 7 days that have attendees".
create index if not exists idx_external_calendar_events_user_start_attendees
  on public.external_calendar_events (user_id, start_time)
  where jsonb_array_length(attendees) > 0;

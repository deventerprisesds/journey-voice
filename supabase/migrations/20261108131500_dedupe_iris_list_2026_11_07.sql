-- WHAT:       One-off DATA cleanup (no schema change): delete the 20 duplicate cards Iris created from the
--             owner's 2026-11-07 14:38Z list (23 items became 43 cards). Keeps one card per item: the copy
--             with a scheduled time, else the Up next copy (descriptions were copied onto kept cards first).
-- WHY:        Owner 2026-11-08: "Go ahead with deduplication". The Supabase MCP delete twice timed out on an
--             approval prompt the owner never saw; owner's standing route for that case is this workflow.
-- SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
-- EVIDENCE:   journey-voice .claude/actions.md 2026-11-08; ids read from public.tasks the same day.
-- Safe to re-run: deletes only rows that still match all conditions; a second run deletes 0.
DELETE FROM public.tasks
WHERE user_id = 'a3378f93-d655-4913-b2fa-ca5b1d8020f1'
  AND created_at BETWEEN '2026-11-07 14:39' AND '2026-11-07 15:26'
  AND start_time IS NULL
  AND completed_at IS NULL
  AND left(id::text, 8) IN ('4930e1fa','2fa7cb6b','8863c265','3f3e0edc','89abc8f4','b2b8111b','91b5009e',
    'f9070907','2b5a66f6','4b31c53c','98d61f58','1c31692f','fae28c6b','ddaecaa9','fa99ef06','c2bb3c07',
    'abbd395f','a3d137d8','b0c632cc','058389a7');

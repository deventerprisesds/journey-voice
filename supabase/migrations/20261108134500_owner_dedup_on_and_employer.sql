-- WHAT:       Owner settings (DATA, no schema change): (1) turn ON journey's existing task-dedup guard for the
--             owner, keeping any other dedup keys; (2) record his employer as Trinnex, a CDM Smith company.
-- WHY:        Owner 2026-11-08: "Duplicate check should be turned on" and "a separate session was supposed to add
--             trinnex, Cdm smith as my employer in profile". 2026-11-07: 23 tasks became 43 while
--             config.dedup was null (task-dedup.ts:73 needs enabled === true); profiles.company read only "Trinnex".
-- SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
-- EVIDENCE:   docs/qc-evidence/FINDINGS-iris-bulk-task-categories.md (branch claude_iris-task-category-findings) §2d.
-- Safe to re-run: both statements are idempotent.
UPDATE public.user_scheduling_prefs
   SET config = jsonb_set(coalesce(config, '{}'::jsonb), '{dedup}',
                          coalesce(config->'dedup', '{}'::jsonb) || '{"enabled": true}'::jsonb, true),
       updated_at = now()
 WHERE user_id = 'a3378f93-d655-4913-b2fa-ca5b1d8020f1';

UPDATE public.profiles
   SET company = 'Trinnex (a CDM Smith company)',
       updated_at = now()
 WHERE user_id = 'a3378f93-d655-4913-b2fa-ca5b1d8020f1'
   AND company IS DISTINCT FROM 'Trinnex (a CDM Smith company)';

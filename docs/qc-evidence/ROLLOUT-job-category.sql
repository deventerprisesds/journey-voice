-- WHAT:          The owner's one-time DATA steps for the JOB category, run AFTER the enum migration
--                (supabase/migrations/20261104120000_task_category_job.sql) and with the code merged.
-- WHY:           Owner rulings 2026-11-03/04 (deventerprisesds/journey-voice#80): five tasks move to JOB;
--                employer = Trinnex; saved CAREER row becomes after work + weekends; JOB row = business hours;
--                the 13 work keywords point at JOB (none removed); product names and employer tools become
--                editable name-hint rows (Flexible window = never moves a task).
-- SUPERSEDES:    nothing.  SUPERSEDED-BY: nothing -- current.
-- EVIDENCE:      docs/qc-evidence/AC-job-category.md AC-A4..A9, AC-B6, AC-C9, AC-C11, G-2, G-3.
--
-- Every write is scoped to the owner's user id and is idempotent (re-running changes nothing further).
-- Keyword edits use jsonb_set per key on the CURRENT stored object -- never the code defaults, which would
-- resurrect keywords the owner deleted.

-- 1. The five tasks the owner ruled JOB (by id, never by title).
UPDATE public.tasks SET category = 'JOB'
 WHERE user_id = 'a3378f93-d655-4913-b2fa-ca5b1d8020f1'
   AND id IN ('b3816b3f-6aff-4aff-8581-56d8c164af16','ad95646f-cc05-43a0-ae3d-ec0d5f9407c2',
              '1e356db7-ca26-46c1-b3b0-a7c2f8d8be38','24905bd3-7505-4b86-a066-510ce0b4e191',
              '2cdabc28-b148-4044-8c00-a54faa4bb782')
   AND category IN ('VENTURES', 'CAREER');   -- pre-rollout values only: a later re-file by the owner stays

-- 2. Employer name, read by the category AI (Profile > Company).
UPDATE public.profiles SET company = 'Trinnex'
 WHERE user_id = 'a3378f93-d655-4913-b2fa-ca5b1d8020f1'
   AND (company IS NULL OR btrim(company) = '');   -- never overwrite a company the owner typed

-- 3. Saved category rows: JOB = business hours; CAREER = after work + weekends. Other rows untouched.
--    Each write fires only while the row still holds its PRE-rollout value, so a re-run, or an owner edit
--    made in Settings after the first run, is never overwritten (verifier finding D-6).
UPDATE public.user_scheduling_prefs
   SET config = jsonb_set(config, '{categoryMappings,JOB}',
                          '{"defaultTimeWindow":["business_hours"],"defaultStatus":"BACKLOG","estimatedDuration":120}'::jsonb, true)
 WHERE user_id = 'a3378f93-d655-4913-b2fa-ca5b1d8020f1'
   AND NOT (config->'categoryMappings' ? 'JOB');
UPDATE public.user_scheduling_prefs
   SET config = jsonb_set(config, '{categoryMappings,CAREER,defaultTimeWindow}', '["after_work","weekends"]'::jsonb)
 WHERE user_id = 'a3378f93-d655-4913-b2fa-ca5b1d8020f1'
   AND config->'categoryMappings'->'CAREER'->'defaultTimeWindow' = '["business_hours","weekends"]'::jsonb;

-- 4. The 13 work keywords point at JOB. Window unchanged; only the lane (element 1) changes; a key the owner
--    has deleted is not re-created (the WHERE on ? skips it).
DO $$
DECLARE k text;
BEGIN
  FOREACH k IN ARRAY ARRAY['work','email','reply','respond','message','call','meeting','follow_up',
                           'review','budget','invoice','contract','office'] LOOP
    UPDATE public.user_scheduling_prefs
       SET config = jsonb_set(config, ARRAY['contextRules','keywords',k,'1'], '"JOB"'::jsonb)
     WHERE user_id = 'a3378f93-d655-4913-b2fa-ca5b1d8020f1'
       AND config->'contextRules'->'keywords'->k->>1 = 'CAREER';   -- only the pre-rollout lane; an owner edit stays
  END LOOP;
END $$;

-- 5. Name hints (window Flexible = never moves a task; lane = the category the AI should lean to).
--    Added only where the key does not already exist, so an owner edit is never overwritten.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('huddle','VENTURES'),('nexus','VENTURES'),('taskos','VENTURES'),('sidecar','VENTURES'),
      ('prompto','VENTURES'),('boost','VENTURES'),('compass','VENTURES'),('howard_county','VENTURES'),
      ('trinnex','JOB'),('esri','JOB'),('arcgis','JOB'),('power_bi','JOB'),('sdlc','JOB')) AS v(k, lane)
  LOOP
    UPDATE public.user_scheduling_prefs
       SET config = jsonb_set(config, ARRAY['contextRules','keywords',r.k],
                              jsonb_build_array('flexible', r.lane), true)
     WHERE user_id = 'a3378f93-d655-4913-b2fa-ca5b1d8020f1'
       AND NOT (config->'contextRules'->'keywords' ? r.k);
  END LOOP;
END $$;

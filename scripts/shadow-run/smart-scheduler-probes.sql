-- ============================================================================
-- SHADOW RUN — smart-calendar-scheduler probes
--
-- The ADVISORY engine (single-task placement) used by ai-task-parser,
-- taskScheduling.ts and RealtimeVoiceAssistant. It performs ZERO DB writes and
-- every read is .eq('user_id', userId), so pointing it at a shadow user gives
-- full isolation with nothing to undo beyond the shadow rows themselves.
--
-- Prereq: run setup.sql first with :shadow_user / :shadow_board / :scoring, and
-- register the run with engine='smart'.
--
-- NOTE ON `scoringModel`: it does NOT apply here. Composite vs priority-rank is a
-- MULTI-TASK RANKING model (which of N tasks gets a slot) and lives in the nightly
-- builder. This engine places ONE task and its internal `score` is slot-fitness
-- (proximity to a preferred time), not task priority. Running these probes against
-- a composite-configured shadow user is fine, but composite is inert for them.
--
-- Probe classes below deliberately cover the keyword families from the config
-- audit: finance (payment/bill), communications (reply/call), errand, neutral.
-- ============================================================================

-- STEP 1 — fire the probes (async via pg_net; note the returned request ids).
WITH probes(label, text, cat, pri) AS (VALUES
  ('finance-payment','Test-make a payment to the credit union','LIFE','MEDIUM'),
  ('finance-bill',   'Test-pay the electric bill','LIFE','MEDIUM'),
  ('comms-reply',    'Test-reply to the recruiter email','CAREER','MEDIUM'),
  ('comms-call',     'Test-call the insurance office','LIFE','MEDIUM'),
  ('errand-grocery', 'Test-pick up groceries','LIFE','LOW'),
  ('neutral',        'Test-organize the garage','LIFE','LOW')
)
SELECT string_agg(
  net.http_post(
    url := 'https://wwxgajrtmslzklnyplah.supabase.co/functions/v1/smart-calendar-scheduler',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer ' || :'anon_key'),
    body := jsonb_build_object(
      'userId', :'shadow_user',
      'taskText', text, 'taskCategory', cat, 'taskPriority', pri,
      'estimateMinutes', 60, 'timezone','America/New_York',
      'targetDate', to_char(now() AT TIME ZONE 'America/New_York' + interval '1 day','YYYY-MM-DD')),
    timeout_milliseconds := 120000
  )::text || '=' || label, ', ') AS fired_request_ids
FROM probes;

-- STEP 2 — wait ~30-45s, then archive. Replace the id/label pairs with STEP 1's output.
-- The archive is what makes the result survive teardown.
--
-- WITH map(rid, label, txt, cat) AS (VALUES (<id>,'finance-payment','...','LIFE'), ...)
-- INSERT INTO public.shadow_run_suggestions
--   (run_id, probe_label, task_text, task_category, response,
--    suggested_start, suggested_end, reasoning, http_status)
-- SELECT r.run_id, m.label, m.txt, m.cat, resp.content::jsonb,
--        NULLIF(resp.content::jsonb->'scheduledSlot'->>'startTime','')::timestamptz,
--        NULLIF(resp.content::jsonb->'scheduledSlot'->>'endTime','')::timestamptz,
--        resp.content::jsonb->>'reasoning', resp.status_code
-- FROM map m JOIN net._http_response resp ON resp.id = m.rid
-- CROSS JOIN (SELECT run_id FROM public.shadow_runs WHERE label = :'run_label') r;

-- STEP 3 — review (works forever, reads the archive).
SELECT probe_label,
       response->>'timeWindow'            AS window_chosen,
       response->>'placementBasis'        AS basis,
       response->>'nudgeToBusinessHours'  AS biz_nudge,
       response->>'keywordFallbackUsed'   AS keyword_fallback,
       to_char(suggested_start AT TIME ZONE 'America/New_York','Dy HH24:MI') AS slot_et,
       reasoning
FROM public.shadow_run_suggestions s JOIN public.shadow_runs r USING (run_id)
WHERE r.label = :'run_label' ORDER BY probe_label;

-- ============================================================================
-- SHADOW RUN — ANALYSIS
-- Reads the ARCHIVE tables, so every query here works AFTER teardown, forever.
-- Param: :run_label   (or :run_a / :run_b for the A/B comparison at the bottom)
-- ============================================================================

-- 1. Run summary --------------------------------------------------------------
SELECT label, scoring_model, code_ref, tasks_cloned, total_scheduled, created_at, notes
FROM public.shadow_runs ORDER BY created_at DESC;

-- 2. Day-by-day shape of the produced schedule --------------------------------
SELECT to_char(s.start_time AT TIME ZONE 'America/New_York','Dy MM-DD') AS day,
       count(*) AS items,
       to_char(min(s.start_time) AT TIME ZONE 'America/New_York','HH24:MI') AS first_slot,
       to_char(max(s.end_time)   AT TIME ZONE 'America/New_York','HH24:MI') AS last_end,
       sum(EXTRACT(EPOCH FROM (s.end_time - s.start_time))/60)::int AS booked_min
FROM public.shadow_run_schedule s
JOIN public.shadow_runs r USING (run_id)
WHERE r.label = :'run_label' AND s.is_scheduled AND s.start_time IS NOT NULL
GROUP BY 1, date_trunc('day', s.start_time AT TIME ZONE 'America/New_York')
ORDER BY date_trunc('day', s.start_time AT TIME ZONE 'America/New_York');

-- 3. Rejections by kind -------------------------------------------------------
WITH rj AS (
  SELECT jsonb_array_elements(COALESCE(t.rejected,'[]'::jsonb)) AS x
  FROM public.shadow_run_traces t JOIN public.shadow_runs r USING (run_id)
  WHERE r.label = :'run_label')
SELECT split_part(x->>'reason',':',1) AS reason_kind, count(*) AS n
FROM rj GROUP BY 1 ORDER BY n DESC;

-- 4. EVERY rejection, itemized with the task title ----------------------------
--    This is the query whose data was lost in the 2026-08-20 teardown.
WITH rj AS (
  SELECT t.target_date, t.tasks_in,
         jsonb_array_elements(COALESCE(t.rejected,'[]'::jsonb)) AS x
  FROM public.shadow_run_traces t JOIN public.shadow_runs r USING (run_id)
  WHERE r.label = :'run_label')
SELECT target_date,
       COALESCE(tasks_in->((x->>'taskIndex')::int)->>'title','?') AS task,
       COALESCE(tasks_in->((x->>'taskIndex')::int)->>'cat','?')   AS category,
       x->>'reason' AS reason
FROM rj ORDER BY target_date, task;

-- 5. Proposal funnel per slotter call (how many the AI proposed vs survived) ---
SELECT t.target_date, t.called_at,
       jsonb_array_length(COALESCE(t.tasks_in,'[]'::jsonb))    AS handed_in,
       jsonb_array_length(COALESCE(t.ai_proposed,'[]'::jsonb)) AS ai_proposed,
       jsonb_array_length(COALESCE(t.accepted,'[]'::jsonb))    AS accepted,
       jsonb_array_length(COALESCE(t.rejected,'[]'::jsonb))    AS rejected
FROM public.shadow_run_traces t JOIN public.shadow_runs r USING (run_id)
WHERE r.label = :'run_label' ORDER BY t.called_at;

-- 6. Degenerate zero-duration proposals (AI dumping leftovers at a boundary) ---
WITH p AS (
  SELECT t.target_date, jsonb_array_elements(COALESCE(t.ai_proposed,'[]'::jsonb)) AS s
  FROM public.shadow_run_traces t JOIN public.shadow_runs r USING (run_id)
  WHERE r.label = :'run_label')
SELECT target_date, count(*) FILTER (WHERE (s->>'start') = (s->>'end')) AS zero_duration,
       count(*) AS total_proposed
FROM p GROUP BY 1 ORDER BY 1;

-- 7. A/B COMPARISON — composite vs priority-rank -------------------------------
--    Same snapshot, same real code; scoring model is the only variable.
SELECT r.label, r.scoring_model,
       count(*) FILTER (WHERE s.is_scheduled) AS scheduled,
       count(DISTINCT date_trunc('day', s.start_time AT TIME ZONE 'America/New_York')) AS days_used,
       sum(EXTRACT(EPOCH FROM (s.end_time - s.start_time))/60)::int AS booked_min,
       count(*) FILTER (WHERE s.is_priority AND s.is_scheduled) AS priority_items_placed,
       count(*) FILTER (WHERE s.due_date < now() AND s.is_scheduled) AS overdue_items_placed
FROM public.shadow_run_schedule s JOIN public.shadow_runs r USING (run_id)
WHERE r.label IN (:'run_a', :'run_b')
GROUP BY r.label, r.scoring_model ORDER BY r.label;

-- 8. Which tasks did ONE model schedule that the other did not? ----------------
SELECT COALESCE(a.title, b.title) AS task,
       (a.title IS NOT NULL) AS in_run_a,
       (b.title IS NOT NULL) AS in_run_b,
       to_char(a.start_time AT TIME ZONE 'America/New_York','Dy HH24:MI') AS a_slot,
       to_char(b.start_time AT TIME ZONE 'America/New_York','Dy HH24:MI') AS b_slot
FROM (SELECT s.* FROM public.shadow_run_schedule s JOIN public.shadow_runs r USING (run_id)
      WHERE r.label = :'run_a' AND s.is_scheduled) a
FULL OUTER JOIN
     (SELECT s.* FROM public.shadow_run_schedule s JOIN public.shadow_runs r USING (run_id)
      WHERE r.label = :'run_b' AND s.is_scheduled) b
  ON a.title = b.title
WHERE a.title IS NULL OR b.title IS NULL
ORDER BY task;

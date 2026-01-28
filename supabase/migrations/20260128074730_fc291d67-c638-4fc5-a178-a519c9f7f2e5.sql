-- Phase A1: Link legacy threads to Iris assistant (data update)
UPDATE ai_threads 
SET assistant_id = 'f6d67661-c41b-49e4-9d6c-6c4c3073cbaf'
WHERE user_id = 'a3378f93-d655-4913-b2fa-ca5b1d8020f1'
  AND assistant_id IS NULL;

UPDATE ai_threads 
SET assistant_id = 'f6d67661-c41b-49e4-9d6c-6c4c3073cbaf'
WHERE user_id = '00000000-0000-0000-0000-000000000001'
  AND assistant_id IS NULL;

-- Phase A2: Populate openai_assistant_id for dev Iris
UPDATE assistants 
SET openai_assistant_id = 'asst_BcZBxlx9zH8VIPvfJrhPP3EF'
WHERE id = 'f6d67661-c41b-49e4-9d6c-6c4c3073cbaf';

-- Phase B1: Add RLS policy allowing demo user to read dev user's assistants
CREATE POLICY "Demo user can view dev assistants"
ON assistants FOR SELECT
USING (user_id = 'a3378f93-d655-4913-b2fa-ca5b1d8020f1');
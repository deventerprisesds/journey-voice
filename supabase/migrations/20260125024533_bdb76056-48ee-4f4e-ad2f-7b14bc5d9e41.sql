-- Add phone_call_mode column for switchable voice infrastructure
ALTER TABLE user_scheduling_prefs 
ADD COLUMN IF NOT EXISTS phone_call_mode TEXT DEFAULT 'media_streams'
CHECK (phone_call_mode IN ('media_streams', 'conversation_relay', 'cloudflare'));

-- Add comment explaining the options
COMMENT ON COLUMN user_scheduling_prefs.phone_call_mode IS 'Phone call infrastructure: media_streams (OpenAI/ElevenLabs), conversation_relay (Twilio), cloudflare (future)';
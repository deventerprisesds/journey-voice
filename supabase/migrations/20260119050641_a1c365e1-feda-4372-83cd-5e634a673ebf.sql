-- Add TTS provider settings to user_scheduling_prefs
ALTER TABLE user_scheduling_prefs 
ADD COLUMN IF NOT EXISTS tts_provider TEXT DEFAULT 'openai' 
CHECK (tts_provider IN ('openai', 'elevenlabs'));

-- Add ElevenLabs voice ID (default: Sarah)
ALTER TABLE user_scheduling_prefs
ADD COLUMN IF NOT EXISTS elevenlabs_voice_id TEXT DEFAULT 'EXAVITQu4vr4xnSDxMaL';

-- Store custom voices as JSON array
ALTER TABLE user_scheduling_prefs
ADD COLUMN IF NOT EXISTS custom_voices JSONB DEFAULT '[]'::jsonb;

-- Add comment for documentation
COMMENT ON COLUMN user_scheduling_prefs.tts_provider IS 'Text-to-speech provider: openai (default) or elevenlabs';
COMMENT ON COLUMN user_scheduling_prefs.elevenlabs_voice_id IS 'ElevenLabs voice ID for TTS (default: Sarah - EXAVITQu4vr4xnSDxMaL)';
COMMENT ON COLUMN user_scheduling_prefs.custom_voices IS 'User-defined custom ElevenLabs voices as JSON array [{name, id}]';
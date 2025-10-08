-- Update the demo user's EMBA sync config with the correct gid
UPDATE sync_config 
SET config_data = jsonb_set(
  config_data::jsonb,
  '{emba_sheet_gid}',
  '1544435511'
)
WHERE user_id = '00000000-0000-0000-0000-000000000001' 
  AND service_type = 'google_sheets';
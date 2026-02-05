UPDATE user_scheduling_prefs 
SET scheduled_calls = scheduled_calls || '[{
  "id": "custom_fried_fish_test",
  "name": "Fried Fish Recipe",
  "time": "20:00",
  "callType": "custom",
  "commsMode": "phone",
  "context": "Share a delicious fried fish recipe with the user. Cover ingredients, preparation steps, cooking techniques, and serving suggestions. Make it conversational and helpful.",
  "enabled": true
}]'::jsonb,
updated_at = now()
WHERE user_id = 'a3378f93-d655-4913-b2fa-ca5b1d8020f1';
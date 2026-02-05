

# Add Test Recurring Call: 8pm Fried Fish Recipe

## Call Configuration

| Field | Value |
|-------|-------|
| **ID** | `custom_fried_fish_test` |
| **Name** | Fried Fish Recipe |
| **Time** | 20:00 (8pm) |
| **Call Type** | `custom` |
| **Comms Mode** | `phone` (phone call) |
| **Context** | Share a delicious fried fish recipe with the user. Cover ingredients, preparation steps, cooking techniques, and serving suggestions. |
| **Enabled** | `true` (active immediately) |

## Technical Implementation

The existing `scheduled_calls` array in `user_scheduling_prefs` will be updated to include this new call entry:

```typescript
{
  id: "custom_fried_fish_test",
  name: "Fried Fish Recipe",
  time: "20:00",
  callType: "custom",
  commsMode: "phone",
  context: "Share a delicious fried fish recipe with the user. Cover ingredients, preparation steps, cooking techniques, and serving suggestions. Make it conversational and helpful.",
  enabled: true
}
```

## Files to Modify

| File | Change |
|------|--------|
| Database: `user_scheduling_prefs` | Add new entry to `scheduled_calls` JSONB array |

## Verification

After implementation:
1. Go to Settings > Scheduling to confirm the new call appears
2. Wait until 8pm or manually trigger the call via Testing tab
3. Phone should ring with the fried fish recipe topic


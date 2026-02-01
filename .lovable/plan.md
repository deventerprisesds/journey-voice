
# Fix: Profile Settings & Greeting Preference

## Problem Summary

1. **Profile Settings is a placeholder** - Shows "Profile settings will be implemented in a future update"
2. **first_name is NULL in database** - The `profiles.first_name` field is empty
3. **No preferred greeting option** - There's no way to specify "Sir" as the preferred address form
4. **Fallback uses "Dev"** - The system falls back to parsing `full_name` ("Dev") when `first_name` is null

Database shows your profile:
```
first_name: NULL
full_name: Dev
→ AI greets you as "Good morning, Dev" instead of "Good morning, Sir"
```

---

## Root Cause

The greeting logic in all voice/phone bridges uses this pattern:

```typescript
const userName = profile?.first_name || profile?.full_name?.split(' ')[0] || 'sir';
```

This means:
1. If `first_name` exists → use it
2. Else if `full_name` exists → parse first word
3. Else → fallback to "sir"

Since your `first_name` is NULL and `full_name` is "Dev", you get "Dev".

---

## Solution: Implement Profile Settings with Greeting Preference

### Part 1: Add `preferred_greeting` Column to Profiles Table

Create a migration to add a new column:

```sql
ALTER TABLE profiles 
ADD COLUMN preferred_greeting TEXT DEFAULT NULL;

COMMENT ON COLUMN profiles.preferred_greeting IS 
'How the user prefers to be addressed (e.g., "Sir", "Von", "Mr. Chase"). If set, overrides first_name for greetings.';
```

### Part 2: Create ProfileSettings Component

**New File**: `src/components/ProfileSettings.tsx`

A form with fields for:
- **First Name** (text input)
- **Last Name** (text input)  
- **Preferred Greeting** (text input with examples: "Sir", "Von", "Mr. Chase")
- **Full Name** (text input)
- **Phone Number** (text input)
- **Email** (read-only, from auth)

The component will:
1. Load current profile data from `profiles` table
2. Allow editing and saving changes
3. Include a "How would you like to be addressed?" field

### Part 3: Replace Placeholder in Settings Page

**File**: `src/pages/Settings.tsx` (Lines 168-179)

Replace the placeholder with the new component:

```typescript
<TabsContent value="profile" className="mt-6">
  <ProfileSettings />
</TabsContent>
```

### Part 4: Update Greeting Logic in Voice Bridges

Update the userName extraction in all 4 locations to check `preferred_greeting` first:

**Files to modify**:
- `supabase/functions/generate-realtime-token/index.ts`
- `supabase/functions/twilio-realtime-bridge/index.ts`
- `cloudflare/src/TwilioCallSession.ts`
- `src/utils/RealtimeVoiceAssistant.ts`

**New pattern**:
```typescript
// Old: const userName = profile?.first_name || profile?.full_name?.split(' ')[0] || 'sir';
// New: 
const userName = profile?.preferred_greeting 
  || profile?.first_name 
  || profile?.full_name?.split(' ')[0] 
  || 'sir';
```

This allows you to:
- Set `preferred_greeting = "Sir"` → AI says "Good morning, Sir"
- Leave it NULL and set `first_name = "Von"` → AI says "Good morning, Von"
- Leave both NULL → Falls back to parsing full_name or "sir"

---

## Files to Create/Modify

| File | Change |
|------|--------|
| `supabase/migrations/XXXX_add_preferred_greeting.sql` | Add `preferred_greeting` column |
| `src/components/ProfileSettings.tsx` | NEW - Profile editing form |
| `src/pages/Settings.tsx` | Import and use ProfileSettings component |
| `src/integrations/supabase/types.ts` | Update Profile type (if manually maintained) |
| `supabase/functions/generate-realtime-token/index.ts` | Add preferred_greeting to SELECT and greeting logic |
| `supabase/functions/twilio-realtime-bridge/index.ts` | Add preferred_greeting to SELECT and greeting logic |
| `cloudflare/src/TwilioCallSession.ts` | Update greeting logic |
| `src/utils/RealtimeVoiceAssistant.ts` | Update greeting logic |

---

## Technical Details

### Database Query Update

```sql
SELECT first_name, full_name, preferred_greeting FROM profiles WHERE user_id = $1
```

### ProfileSettings Component Structure

```typescript
// Key states
const [firstName, setFirstName] = useState('');
const [lastName, setLastName] = useState('');
const [preferredGreeting, setPreferredGreeting] = useState('');
const [fullName, setFullName] = useState('');
const [phone, setPhone] = useState('');

// Load on mount
useEffect(() => {
  const { data } = await supabase
    .from('profiles')
    .select('first_name, last_name, full_name, phone, preferred_greeting')
    .eq('user_id', user.id)
    .single();
  // Populate state...
}, [user?.id]);

// Save handler
const handleSave = async () => {
  await supabase
    .from('profiles')
    .update({
      first_name: firstName || null,
      last_name: lastName || null,
      full_name: fullName || null,
      phone: phone || null,
      preferred_greeting: preferredGreeting || null,
    })
    .eq('user_id', user.id);
};
```

### UI Example

```
┌─────────────────────────────────────────────┐
│ Profile Settings                            │
├─────────────────────────────────────────────┤
│                                             │
│ Email                                       │
│ ┌─────────────────────────────────────────┐ │
│ │ dev@enterpriseds.io (read-only)         │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ First Name                                  │
│ ┌─────────────────────────────────────────┐ │
│ │ Von                                     │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ Last Name                                   │
│ ┌─────────────────────────────────────────┐ │
│ │ Chase                                   │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ How should I address you?                   │
│ ┌─────────────────────────────────────────┐ │
│ │ Sir                                     │ │
│ └─────────────────────────────────────────┘ │
│ Examples: "Sir", "Von", "Mr. Chase"         │
│                                             │
│ Phone                                       │
│ ┌─────────────────────────────────────────┐ │
│ │ +14434150606                            │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│              [Save Changes]                 │
│                                             │
└─────────────────────────────────────────────┘
```

---

## Expected Behavior After Fix

1. Go to Settings → Profile tab
2. See your current profile info (email, name, phone)
3. Enter "Sir" in the "How should I address you?" field
4. Click Save
5. Next voice/phone call: "Good morning, Sir. What can I help you with?"

The system respects your preference across all communication modes (WebRTC voice, phone calls, chat).



# Fix Missing "Sir" Salutation in WebRTC Voice App

## Problem

The Twilio phone app addresses you as "Sir" (e.g., "Good morning, Sir!") but the WebRTC voice app in the browser just says "Good morning" without the salutation. This is because the **instructions sent to OpenAI are different** between the two systems.

## Root Cause

| System | Loads User Profile? | Includes User Name? |
|--------|---------------------|---------------------|
| **Twilio Bridge** | Yes - calls `loadUserProfile()` to get `first_name`, `full_name` | Yes - adds `USER: ${userName}` to instructions |
| **WebRTC Token** | No - only loads `user_scheduling_prefs` | No - name is not included in session instructions |

### Twilio Bridge (Working)
```typescript
// Line 193-204: Loads profile
async function loadUserProfile(supabase: any, userId: string) {
  const { data } = await supabase
    .from('profiles')
    .select('full_name, first_name, email, phone')
    .eq('user_id', userId)
    .maybeSingle();
  return data || {};
}

// Line 296: Extracts name with "sir" fallback
const userName = userProfile?.first_name || userProfile?.full_name?.split(' ')[0] || 'sir';

// Line 333: Includes in instructions
USER: ${userName}
```

### WebRTC Token Generator (Missing)
- Only loads `core_instructions`, `realtime_extensions`, `config`, and TTS settings
- Never queries `profiles` table
- No user name variable in the instructions

## Solution

Update `supabase/functions/generate-realtime-token/index.ts` to match the Twilio bridge pattern:

### Step 1: Load User Profile

Add profile loading alongside the existing preferences query:

```typescript
// Load user profile for personalization
const { data: profile } = await supabase
  .from('profiles')
  .select('first_name, full_name')
  .eq('user_id', userId)
  .maybeSingle();

const userName = profile?.first_name || profile?.full_name?.split(' ')[0] || 'sir';
```

### Step 2: Include User Name in Instructions

Add the same `USER:` context that the Twilio bridge includes:

```typescript
// Build personalization context
const personalizationContext = `
CURRENT TIME: ${new Date().toLocaleString('en-US', { 
  timeZone: prefs?.timezone || 'America/New_York',
  dateStyle: 'full',
  timeStyle: 'short'
})}
USER: ${userName}
TIMEZONE: ${prefs?.timezone || 'America/New_York'}
`;

// Add to full instructions
const fullInstructions = [
  coreInstructions,
  personalizationContext,
  realtimeExtensions,
  schedulingPhilosophy
].filter(Boolean).join('\n\n');
```

## Implementation Details

### File: `supabase/functions/generate-realtime-token/index.ts`

**Changes Required:**

1. Add profile query in the existing Supabase client block (around line 83)
2. Extract user name with fallback to "sir"
3. Add timezone and current time context (matches Twilio bridge)
4. Include personalization in the instructions sent to OpenAI

**Key Code Addition:**
```typescript
// After line 87 (after loading prefs)
const { data: profile } = await supabase
  .from('profiles')
  .select('first_name, full_name')
  .eq('user_id', userId)
  .maybeSingle();

const userName = profile?.first_name || profile?.full_name?.split(' ')[0] || 'sir';
const userTimezone = prefs?.timezone || 'America/New_York';
const currentTime = new Date().toLocaleString('en-US', { 
  timeZone: userTimezone,
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit'
});
```

Then modify the `fullInstructions` to include:
```typescript
const personalizationContext = `
CURRENT TIME: ${currentTime}
TIMEZONE: ${userTimezone}
USER: ${userName}`;

const fullInstructions = [
  coreInstructions,
  personalizationContext,
  realtimeExtensions,
  schedulingPhilosophy
].filter(Boolean).join('\n\n');
```

## Expected Result

After this fix, both the Twilio phone calls and the WebRTC voice app will:
- Address you by name (e.g., "Good morning, Von!") if `first_name` is set in your profile
- Fall back to "Sir" if no name is configured
- Include the current time and timezone in the AI's context

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/generate-realtime-token/index.ts` | Add profile loading, extract userName, add personalization context to instructions |




# Fix: Settings-Driven Call Style + Server-Side Chat + Batch Group Move

## Summary

Three fixes in one pass:
1. User's call descriptions from Settings are injected into V2 scripts as a STYLE directive
2. Chat messages are saved server-side so they survive browser backgrounding
3. Batch "Move to Group" added to Priorities page

---

## 1. Inject User Settings as STYLE Directive + Clean Up Defaults

### What's broken today

- `buildCallContext` extracts only the window name from `[WINDOW:xxx]` and **throws away** everything the user wrote after it
- `send-chat-message` never fetches `preferred_greeting`, so chat-triggered calls default to "Sir"
- The `DEFAULT_SCHEDULED_CALLS` in Settings contain BRANCH/FLOW boilerplate that is **100% redundant** with the V2 scripts -- the V2 scripts already handle greeting, task presentation, branching, and topic jogging. Users see these walls of text and think they're in control, but none of it reaches the AI

### What changes

**call-context-builder.ts**:
- `buildCallContext` (line ~753): after extracting the window name, also extract everything after the `[WINDOW:xxx]` line as `userGuidance`
- Pass `userGuidance` through `buildWindowTransitionContext` to `buildWindowContextV2`
- `buildWindowContextV2` (line 492): accept optional `userGuidance` param. If non-empty, insert it as a `STYLE:` line between `GREETING:` and `AGENDA QUEUE:`:
```
GREETING: Address user as "Boss"
STYLE: Focus on career tasks before personal ones. If nothing is scheduled, just say so and hang up.
AGENDA QUEUE (in priority order):
```
- The entire V2 script structure (AGENDA_HEADER, tool instructions, branching, task injection) stays exactly as-is

**send-chat-message/index.ts** (line ~473):
- Fetch user profile to get `preferred_greeting` before calling `sharedBuildCallContext`
- Pass it as the 5th parameter so it stops defaulting to "Sir"

**VoiceAssistantSettings.tsx** -- DEFAULT_SCHEDULED_CALLS cleanup:
- Strip all BRANCH/FLOW/greeting boilerplate from window calls since the V2 scripts handle all of that
- Leave just the `[WINDOW:xxx]` tag with an empty or minimal description
- Examples:
  - Morning: `"[WINDOW:morning]"` (empty -- V2 handles everything)
  - Business Hours: `"[WINDOW:business_hours]"` (empty)
  - After Work: `"[WINDOW:after_work]"` (empty)
  - Evening: `"[WINDOW:evening]"` (empty)
  - Weekend: `"[WINDOW:weekends]"` (empty)
- Users can optionally add their own style notes after the tag, which will now actually reach the AI
- The non-window calls (morning_standup, midday_checkin, eod_wrapup) keep their current descriptions since those are plain-text context strings, not V2-scripted

---

## 2. Server-Side Chat Persistence

### What's broken today

When the browser is backgrounded, the fetch to `hybrid-assistant-api` is aborted. The server may still complete processing, but the CLIENT is responsible for saving the assistant message (line 659-665), so the response is lost.

### What changes

**hybrid-assistant-api/index.ts**:
- Save user message to `conversation_messages` at request start (before OpenAI processing)
- Save assistant message to `conversation_messages` after OpenAI completes
- Update `ai_threads.updated_at` server-side
- Return `messageId` in response JSON
- Apply same pattern to `handleTrivialMessage`

**useChatAssistant.ts**:
- Remove client-side INSERT for user message (lines 616-622)
- Remove client-side INSERT for assistant message (lines 659-665)
- Remove client-side thread timestamp update (lines 697-700)
- On success: update loading message with response content for immediate display
- On error: soften to "I may still be processing your request. Check back shortly."
- Realtime subscription in CommsConsole handles deduplication

---

## 3. Batch "Move to Group" on Priorities Page

### What's broken today

`batchMoveToGroup` function exists (line 110-133) but has no UI trigger. The batch action bar only shows category moves.

### What changes

**Priorities.tsx** (batch action bar, lines 566-589):
- Add a second dropdown button "Move to Group..." next to the existing category "Move to..." button
- Lists all topic groups from `allTopicGroupRefs`, grouped by category with sub-headers
- Each item calls existing `batchMoveToGroup(ref.id, ref.categoryKey)`

---

## Files Changed

| File | Change |
|------|--------|
| `supabase/functions/_shared/call-context-builder.ts` | Extract userGuidance; pass to V2 builder; inject as STYLE directive |
| `supabase/functions/send-chat-message/index.ts` | Fetch preferred_greeting; pass to sharedBuildCallContext |
| `supabase/functions/hybrid-assistant-api/index.ts` | Save user + assistant messages server-side; update thread timestamp |
| `src/hooks/useChatAssistant.ts` | Remove 3 client-side DB writes; soften error messages |
| `src/components/VoiceAssistantSettings.tsx` | Strip BRANCH boilerplate from window call defaults; leave clean [WINDOW:xxx] tags |
| `src/pages/Priorities.tsx` | Add "Move to Group..." dropdown in batch action bar |
| `docs/DEBUG_TRACKER.md` | Change log entries |

## Deployment

Deploy edge functions: `hybrid-assistant-api`, `send-chat-message` (both pick up shared `call-context-builder.ts` changes automatically).


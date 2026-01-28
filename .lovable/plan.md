
## What’s happening (and why it feels like “we keep repeating steps”)

You’re right to call this out: several of the “fixes” we discussed were decisions/plans, but the *actual state of Live* still shows they were not applied.

From the Live database (read just now):

- **Dev Iris assistant (`f6d67661-…`) has `openai_assistant_id = NULL`**
- **Dev chat thread (`6643d1fc-…`) has `assistant_id = NULL`**
- **Demo chat thread (`47252746-…`) has `assistant_id = NULL`**

So even if we “decided” to populate these, the Live DB currently confirms they are **not populated**.

Also: there is a concrete frontend bug that can cause `threadId: null` to be sent even after a thread exists (stale closure due to missing dependency), which matches the “thread null” logs you saw.

---

## Tracking + Status (single source of truth)

### Target Outcome
- Live site: chat memory persists across refreshes and sessions (same assistant + same thread)
- Preview/demo: uses **dev Iris (shared)**, not a separate demo Iris; and memory persists

### Current status snapshot (as of now)
**Database (Live)**
- [ ] Iris assistant has correct OpenAI assistant ID populated (optional but recommended)
- [ ] Legacy ai_threads rows have `assistant_id` populated (required)
- [ ] Demo user can SELECT dev user’s assistants via RLS (required for preview/demo “shared Iris”)

**Frontend**
- [ ] `CommsConsoleContext.sendMessage` uses the latest `dbThreadId` (required)
- [ ] `CommsConsoleContext` demo mode fetches assistants from dev user (required)
- [ ] Stop writing OpenAI thread IDs into `threadId` state that is intended as DB thread id (recommended cleanup)

---

## Root causes confirmed in code

### 1) `sendMessage` can keep using `dbThreadId = null` forever (stale closure)
In `src/contexts/CommsConsoleContext.tsx`, `sendMessage` computes:
- `effectiveThreadId = USE_UNIFIED_THREADS ? dbThreadId : threadId`

But the callback deps are:
```ts
}, [userId, threadId, currentAssistant, currentMode]);
```
**Missing:** `dbThreadId` (and `USE_UNIFIED_THREADS`), so `sendMessage` can continue using the *old* `dbThreadId` (often `null`) even after the hook creates/loads the thread.

This alone can cause Live to keep sending `threadId: null` → function creates/uses wrong threads → memory appears broken.

### 2) Demo mode currently fetches assistants for the demo user, not the dev user
In the same file, assistants are fetched with:
```ts
.eq('user_id', userId)
```
In demo mode `userId` is the demo UUID, which is the opposite of your chosen approach (“Use dev Iris shared”).

### 3) Legacy threads in Live still have `assistant_id = NULL`
Your existing dev and demo threads have `assistant_id` null, so the unified-thread lookup that filters by assistant_id can’t match them.

---

## Implementation steps (with verification checkpoints)

### Phase A — Fix Live data (required)
These are **data updates** (not schema). We will apply them to **Live** and optionally to **Test**.

**A1. Populate `assistant_id` for the legacy Live threads (required)**
- Update dev thread `6643d1fc-...` to `assistant_id = f6d67661-...`
- Update demo thread `47252746-...` to `assistant_id = f6d67661-...` (since demo shares dev Iris per your decision)

**Verification after A1**
Run:
- Confirm both rows now show `assistant_id = f6d67661-...`

**A2. (Recommended) Populate `openai_assistant_id` for dev Iris (optional but recommended)**
Set `assistants.openai_assistant_id` for `f6d67661-...` to:
- `asst_BcZBxlx9zH8VIPvfJrhPP3EF`

Why recommended:
- Your frontend already tries to pass `assistantId: currentAssistant.openai_assistant_id`
- The edge function has a fallback, but having the DB correct removes ambiguity and keeps all modes consistent.

**Verification after A2**
Run:
- Confirm dev Iris shows `openai_assistant_id = asst_BcZB...`

---

### Phase B — Fix Preview/Demo data access (required for “shared dev Iris”)
This is an **RLS policy change** on the `assistants` table.

**B1. Add an RLS SELECT policy allowing the demo user to read dev user’s assistants**
Currently assistants policies only allow:
- `auth.uid() = user_id` (so demo user cannot read dev assistants)

We will add a policy that permits:
- demo user UUID to SELECT assistants where `user_id = dev UUID`

**Verification after B1**
In preview/demo mode, the `assistants` query for `user_id = dev` should return Iris.

---

### Phase C — Frontend fixes (required)
**C1. Fix `sendMessage` closure bug**
Update `src/contexts/CommsConsoleContext.tsx`:
- Include `dbThreadId` (and optionally `USE_UNIFIED_THREADS`) in the `useCallback` dependency list.
- Add a guard:
  - if unified threads enabled and `dbThreadId` is not ready, show a “Initializing conversation…” system message and don’t call the edge function with `threadId: null`.

**Verification after C1 (Live)**
- Open Live site, send a message immediately after load:
  - It should NOT log/behave as `threadId: null`
- Refresh and send another message:
  - It should continue using the same DB thread ID (and OpenAI thread) and remember context.

**C2. Demo mode assistant fetching should target dev assistants**
Update the assistants fetch effect in `CommsConsoleContext.tsx`:
- If `isDemoMode`, query assistants where `user_id = devUserId` (not the demo UUID)
- Do not auto-create a new assistant in demo mode if query returns empty; instead hard-fail with a clear message (since we expect dev Iris to exist)

**Verification after C2 (Preview)**
- Preview should show the dev Iris assistant (same configuration as production)
- Unified thread should be created for demo user + dev Iris assistant ID

**C3. Stop overwriting the local `threadId` state with OpenAI thread IDs (recommended cleanup)**
Currently:
- `hybrid-assistant-api` returns `threadId: <OpenAI thread id>`
- `CommsConsoleContext` does:
  - `setThreadId(data.threadId)`
But in this app, `threadId` state is semantically “thread identifier” and elsewhere it’s treated like a DB UUID.

We’ll adjust behavior:
- In unified mode: do not set `threadId` from `data.threadId` at all (or store it separately as `openaiThreadId`).
- Optionally call `updateOpenaiThreadId(data.threadId)` (not required, but consistent).

---

## Rollback / “version tracking” approach

### Code rollback
If after shipping a frontend change something regresses, we’ll revert via Lovable History to the last known-good message/version.

### DB rollback
Data changes (assistant_id linking and openai_assistant_id) are reversible:
- We can revert by setting those fields back to NULL or to the previous values, but we’ll only do that if needed.

---

## Final “definition of done” checklist

**Live**
- [ ] Sending a message does not call the function with `threadId: null`
- [ ] After refresh, the assistant references prior context (same thread)
- [ ] `ai_threads` for dev and demo legacy rows have `assistant_id = f6d67661-...`

**Preview/Demo**
- [ ] Demo UI shows dev Iris (shared)
- [ ] Demo can SELECT dev assistants via RLS
- [ ] Demo’s unified thread is created with the dev Iris assistant id and persists

---

## Notes on your question (“I thought you populated the OpenAI ID earlier”)
Live currently shows `openai_assistant_id` is still NULL, which means either:
- the update was never executed in Live, or
- it was executed in Test only, or
- it was proposed but the run got cancelled before it applied.

This plan explicitly includes a verification checkpoint immediately after we apply the DB updates so we don’t re-litigate whether it “actually happened”.

---

## Optional next improvements (after memory is fixed)
1) Load conversation history UI from `conversation_messages` on page load (so refresh still shows the transcript, not just “memory”).
2) Add a debug panel that shows: userId, currentAssistantId, dbThreadId, openaiThreadId.
3) Make the unified thread hook return “ready” and block sending until ready with a clear UI state.

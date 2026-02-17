

# Rollback-Safe Script Refinement + Category Filter

## What This Plan Does

Four changes deployed in parallel with the existing code, controlled by a single flag per function so you can instantly revert if calls get worse.

## Rollback Strategy

Each changed file gets a version flag at the top:

```text
const USE_V2_SCRIPTS = true;   // flip to false = instant rollback to current behavior
```

The old `buildWindowContext` function is renamed to `buildWindowContextV1` (untouched). The new version is `buildWindowContextV2`. The main export calls whichever the flag selects. Old code is never deleted until you confirm the new version works.

Same pattern for `execute-tool`: the old `getTasks` logic stays inline, the new category/status-group logic is behind `USE_V2_TASK_FILTERS`.

Once you confirm across 2-3 check-ins that calls are better, we remove the V1 code.

---

## Change 1: Script Refinements in `call-context-builder.ts`

**What stays identical:** All `If CONFIRM / If ADJUST / If NO / If YES` branches. All pre-loaded task lists and topic group data. The overall structure of each window.

**What changes (verbatim lines become examples):**

| Window | Current Line | Becomes |
|--------|-------------|---------|
| Morning (tasks) | `Ask: confirm these for this morning, adjust, or skip?` | `Ask something like: "Want to confirm these for this morning, adjust anything, or skip?"` |
| Morning (tasks) | `Remind them of their morning tasks:` | `Briefly present their morning tasks, e.g. "You've got [N] things this morning: [names and times]":` |
| Business hours (tasks) | `Present business-hours tasks:` | `Present their business-hours lineup succinctly, e.g. "Here's what's lined up: [task names with times]":` |
| Business hours (tasks) | `Ask: "Which one do you want to start with?"` | `Ask something like: "Which one do you want to start with?"` |
| Business hours (no tasks) | `Present these business-hour topic groups to jog memory:` | `There are open items that fit this time window, grouped under these areas. Present them naturally, e.g. "You've got 5 open items under Career Development, 3 under Project Alpha -- want to dig into any of these?":` |
| Business hours (no tasks) | `Ask if they want to work on any of these right now` | `Ask something like: "Any of these areas you want to dig into right now?"` |
| Business hours (no tasks, tier2) | `Say: "I don't see any potential items..."` | `Say something like: "Nothing specific lined up for business hours -- want me to look across your whole board?"` |
| After work phase 1 | `Say you want to review how today went...` | `Say something like: "Let's do a quick wrap on today before we look at what's next."` |
| After work phase 1 | `Ask: any tasks completed today to mark done?` | `Ask something like: "Anything you got done today I can mark off?"` |
| After work phase 1 | `Ask: any tasks blocked or to move to another day?` | `Ask something like: "Anything blocked or need to move to another day?"` |
| After work phase 2 | `Ask: keep as-is, adjust, or skip?` | `Ask something like: "Keep these as-is, adjust anything, or skip?"` |
| After work (no tasks) | Same topic group reframing as business hours | Same pattern |
| Evening (tasks) | `Ask: confirm, adjust, or skip?` | `Ask something like: "Good to go with these, or want to change anything?"` |
| Evening (no tasks) | Same topic group reframing | Same pattern |
| Weekends (tasks) | `Ask: confirm, adjust, or skip?` | `Ask something like: "Want to keep this plan, adjust, or take the day off?"` |
| Weekends (no tasks) | Same topic group reframing | Same pattern |

Also remove line 331 (`2. If user goes on a tangent, handle it, then return to the plan`) from business_hours -- tangent handling belongs in `AGENDA_HEADER`, not as an agenda item.

**Topic group reframing (all no-task windows):** Instead of "Present these topic groups to jog memory" followed by "Ask if they want to work on any," the new phrasing positions topic groups as containers for time-relevant tasks: "There are open items that fit this time window, grouped under these areas." The example phrasing shows the AI how to present them succinctly with counts.

## Change 2: Agenda and Tangent Awareness in `AGENDA_HEADER`

Append to the existing `AGENDA_HEADER` (after the current TOPIC DRILL-DOWN RULE):

```text
TANGENT HANDLING:
When the user goes off-topic or asks an unrelated question, handle it fully --
answer their question, use tools if needed, take your time.
The system tracks your agenda progress automatically via an AgendaManager.
When a tangent ends, you will receive a [RESUME] message indicating which
agenda item to return to. When you see [RESUME], transition back naturally --
do not say "getting back to the agenda." Weave back into the flow.
You are responsible for covering ALL agenda items before closing the call.
If the user wants to end early, briefly mention any uncovered items and
confirm they want to skip them.
```

Also change line 41 from `Cover them in sequence` to `Work through them in order, but adapt naturally to the conversation.`

## Change 3: Add `category` and Status Groups to `get_tasks`

**File: `_shared/tool-definitions.ts`**

Add to `get_tasks` parameters:

```text
category: enum [LIFE, CAREER, VENTURES, PROF_EDUCATION, EDUCATION, PERSONAL]
  -- "Life area filter. Use for area-specific queries."

status: add ACTIVE and WORKABLE to existing enum
  -- ACTIVE = everything not DONE/BLOCKED
  -- WORKABLE = READY + UP_NEXT + DOING
```

**File: `execute-tool/index.ts`**

In `getTasks` function (around line 427), replace the simple `.eq('status', ...)` with:

```text
STATUS_GROUPS = {
  ACTIVE: [BACKLOG, TODO, READY, UP_NEXT, DOING, PLANNING],
  WORKABLE: [READY, UP_NEXT, DOING]
}

If status is a group alias -> use .in('status', group)
If status is a single value -> use .eq('status', value) as before

If category provided -> add .eq('category', value)
```

Behind `USE_V2_TASK_FILTERS` flag -- old single-status `.eq()` logic preserved for rollback.

## Change 4: Chat Guardrails in `hybrid-assistant-api`

**File: `hybrid-assistant-api/index.ts`**

Prepend to `additionalInstructions` (line 422, before `parts.join`):

```text
DATA INTEGRITY RULES:
- NEVER fabricate task names. Use EXACT titles from tool results or pre-loaded context.
- For "what can I work on": use get_tasks(status: "ACTIVE").
- For life-area queries ("life tasks", "career items"): use get_tasks with the category filter.
- For ready-now queries: use get_tasks(status: "WORKABLE").
- Always call a tool BEFORE listing tasks you don't already have in context.
```

---

## Deployment Sequence

1. Deploy `execute-tool` (category filter + status groups behind flag)
2. Deploy `hybrid-assistant-api` (guardrails)
3. Deploy `twilio-realtime-bridge` (picks up script + AGENDA_HEADER changes via shared module import)
4. Call `sync-assistant-tools` to update OpenAI Assistant with new `category` and status params

## Validation

- Trigger a scheduled call and verify: examples guide tone but branches still drive flow
- Test a no-tasks window: confirm topic groups are presented as "areas with tasks underneath"
- Test tangent: go off-topic mid-call, confirm [RESUME] weaves back naturally
- Test `get_tasks(category: "CAREER", status: "WORKABLE")` via chat

## Rollback

If any calls feel worse:
- Flip `USE_V2_SCRIPTS = false` in `call-context-builder.ts` -- instant revert to current scripts
- Flip `USE_V2_TASK_FILTERS = false` in `execute-tool` -- reverts to single-status `.eq()` only
- Redeploy the affected function (under 30 seconds)

Old code stays in the files until you explicitly approve removal.

## Files Changed

| File | Risk | Rollback |
|------|------|----------|
| `_shared/call-context-builder.ts` | Low | `USE_V2_SCRIPTS` flag |
| `_shared/tool-definitions.ts` | Low | Additive only (new params) |
| `execute-tool/index.ts` | Low | `USE_V2_TASK_FILTERS` flag |
| `hybrid-assistant-api/index.ts` | Minimal | Remove prepended text |


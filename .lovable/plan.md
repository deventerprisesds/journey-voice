

# Fix: Window Category Breakdown, Assignment QC, and Chat Spillover

## Problems (from screenshot)

1. **Time Windows** show only "6 tasks, ~360 min" — no category breakdown. For QC, each window must show which task categories were placed and flag any expected categories (per `categoryMappings`) that are missing.

2. **No assignment QC note** when assignments exist but none are scheduled today. The current code only checks EDUCATION/PROF_EDUCATION categories, but doesn't surface this prominently enough and the check at line 229 may miss tasks with `assignment_id` that aren't categorized as education.

3. **AI Response area** shows stale messages from previous chat sessions (voicemail messages visible in screenshot). The `recentAssistantMessages` filter on line 324 pulls from the full `messages` array which includes history from prior conversations.

## Changes — single file: `src/components/DailyReviewModal.tsx`

### 1. Window summaries: add category breakdown + missing category flags

Update the `windowSummaries` data structure (lines 120-142) to include:
- `categoryBreakdown`: e.g., `{ CAREER: 3, LIFE: 2, VENTURES: 1 }` — the actual categories of tasks placed in that window
- `missingCategories`: categories mapped to this window in `categoryMappings` that have zero tasks placed

Update the UI (lines 384-397) to render:
- Per-window: "6 tasks, ~360 min — CAREER(3), LIFE(2), VENTURES(1)"
- If missing categories: amber text "⚠ No PROF_EDUCATION tasks placed (mapped to this window)"

### 2. Assignment-specific QC note

Enhance the assignment check (lines 229-243):
- Query tasks with `assignment_id` (not just EDUCATION category) that are incomplete
- If any exist with upcoming due dates but none are scheduled today, add a definitive amber explanation: "No assignment tasks scheduled today — X assignments pending, next due: [title] on [date]"
- Check uses `assignment_id IS NOT NULL` rather than category matching

### 3. Fix AI chat spillover

Add a `modalOpenedAt` ref (set on modal open) and filter `recentAssistantMessages` (line 324) to only include messages created after the modal opened. This prevents voicemail transcripts and other prior conversation history from bleeding into the review modal.

- Add `const modalOpenedAt = useRef<Date>(new Date())` 
- Reset it in a `useEffect` when `open` transitions to `true`
- Filter: `messages.filter(m => m.role === 'assistant' && !m.isLoading && new Date(m.timestamp || 0) > modalOpenedAt.current)`
- If `timestamp` isn't available on messages, track sent message count at modal open and only show messages with index > that count

## No new files, no migrations, no edge function changes.




# Combined Plan: Rules Update + 15-Min Snap + Calendar-Style Grid

## Part 1: Update `.lovable/rules.md` — Two New Mandatory Sections

Insert after line 18 (after the first `---` separator, before SCHEDULING SYSTEM MAP):

```markdown
---

## TIMEZONE INTERPRETATION — MANDATORY

- All database timestamps are stored in UTC.
- NEVER read a raw UTC timestamp and report it as a local time.
- ALWAYS convert UTC to the user's configured timezone (from `user_scheduling_prefs.timezone`) before making any claims about what time something is scheduled.
- When querying tasks for debugging, use `AT TIME ZONE` or convert programmatically — do not eyeball UTC values.

---

## DATA SOURCE — MANDATORY

- When investigating user-reported issues, ALWAYS use the **published app** (`journey-voice.lovable.app`) and the **real dev user** as the reference, not the preview URL or demo account.
- The preview URL may fall back to a mock demo user (`000...001`) which has completely different data.
- NEVER mix rows from different user accounts in a single analysis.
- ALWAYS scope database queries to the authenticated user's `user_id` before drawing conclusions.
- If using the preview instance, explicitly state it and do not conflate its data with the published instance.
```

---

## Part 2: Enforce 15-Minute Alignment in Batch Scheduler

**File**: `supabase/functions/batch-calendar-scheduler/index.ts`

1. **Add to prompt** (line 384, after the naive timestamp warning):
   ```
   - ALL start times MUST align to 15-minute boundaries (xx:00, xx:15, xx:30, xx:45). NEVER use times like xx:07 or xx:22.
   ```

2. **Add `snapTo15` helper** and apply it after `normalizeDateTime` calls (lines 532-533), before the window validation at line 539:
   ```ts
   function snapTo15(isoStr: string): string {
     const d = new Date(isoStr);
     d.setMinutes(Math.round(d.getMinutes() / 15) * 15, 0, 0);
     return d.toISOString();
   }
   ```
   Apply: `normalizedStart = snapTo15(normalizedStart)` and `normalizedEnd = snapTo15(normalizedEnd)`.

---

## Part 3: Calendar-Style Grid with Time Gutter

**File**: `src/components/FocusView.tsx`

Replace the flat timeline rendering (~lines 960-1284) with an absolute-positioned grid layout:

1. **Time gutter** (fixed ~50px left column): Render 15-min tick labels. Show hour labels at `:00`, lighter ticks at `:15/:30/:45`. Each row = 28px tall.

2. **Content area** (`flex-1, position: relative`): Cards positioned absolutely:
   - `top: (startMinuteOffset / 15) * 28px`
   - `height: (durationMinutes / 15) * 28px`

3. **Overlap groups**: Items whose time ranges overlap are grouped. Each item in a group gets `width: 100% / groupSize` and `left: (colIndex / groupSize) * 100%` — rendering side-by-side.

4. **Empty rows**: Background grid lines are clickable drop targets. Clicking opens create modal for that 15-min slot.

5. **Card content unchanged**: Checkbox, title, badge, time range, actions all stay identical. Only the positioning container changes.

```text
┌──────┬───────────────────────────────┐
│ 8:00 │                               │
│ 8:15 │ ┌─────────────────────────┐   │
│ 8:30 │ │  Transfer 40k     LIFE │   │
│ 8:45 │ └─────────────────────────┘   │
│ 9:00 │ ┌──────────┐ ┌──────────┐    │
│ 9:15 │ │  Task A   │ │  Task B  │    │
│ 9:30 │ └──────────┘ └──────────┘    │
└──────┴───────────────────────────────┘
```

---

## Files changed

| File | Change |
|------|--------|
| `.lovable/rules.md` | Add TIMEZONE INTERPRETATION + DATA SOURCE mandatory sections |
| `supabase/functions/batch-calendar-scheduler/index.ts` | Add 15-min prompt rule + `snapTo15` post-processing |
| `src/components/FocusView.tsx` | Replace flat timeline with time-gutter + absolute-positioned grid layout |


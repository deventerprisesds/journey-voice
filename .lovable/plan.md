

## Problem

The batch-calendar-scheduler prompt has a **contradiction**: Rule 1 says category windows are a "HARD CONSTRAINT", then Rule 2 says keywords "TRUMP" the category window. The AI follows Rule 1 (it's first and loudest), so tasks like "Reply to Travis' text" (VENTURES → after_work) stay at 5-8 PM despite containing communication keywords that should override to business_hours.

More fundamentally, you want the AI to **reason about task nature** (financial impact, people-related, time-sensitive) rather than relying on brittle keyword lists.

## Plan

### Restructure the AI prompt in `batch-calendar-scheduler/index.ts`

**Remove** the keyword-matching Rule 2 entirely. **Replace** Rules 1-2 with a unified rule that makes the AI the decision-maker:

```
RULE 1: INTELLIGENT WINDOW ASSIGNMENT
Category windows are the DEFAULT starting point, but you MUST override them 
when the task's nature demands it:

A) FINANCIAL IMPACT tasks (payments, transfers, fees, invoices, budgeting, 
   anything involving money) → business_hours, EARLIEST available slot.
   These are effectively HIGH priority regardless of priority field.

B) PEOPLE/COMMUNICATION tasks (emails, texts, replies, follow-ups, calls, 
   scheduling meetings, contacting someone) → business_hours, EARLIEST 
   available slot. Treat as HIGH priority.

C) TIME-SENSITIVE tasks (due within 48 hours, appointments, deadlines) → 
   EARLIEST available slot in the most appropriate window.

D) ERRANDS & APPOINTMENTS (shopping, doctor, bank, groceries) → 
   after_work or business_hours based on context.

E) ALL OTHER tasks → use their category's default window.

Use your judgment. "Reply to Travis' text" is a communication task → 
business_hours. "Make car payments" is financial → business_hours early. 
"Research Claude Business" is a ventures/research task → after_work is fine.
```

**Rule 2** becomes the old Rule 3 (no conflicts), and so on — renumber remaining rules.

### Matching change in `nightly-schedule-builder/index.ts`

The `hasPriorityKeyword` function is fine for *scoring* candidates — it just boosts priority weight. No change needed there since it doesn't control window placement.

### Files Modified
- `supabase/functions/batch-calendar-scheduler/index.ts` — replace Rules 1-2 with unified AI-driven window assignment rule


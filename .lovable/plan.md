
Goal: debug and fix the 4 Daily Review issues against the real dev account on the published app, not the preview/demo path.

What I found
- The snapshot I can see is from preview and it is definitely running as demo user `000...001`, not your dev user. The requests for `user_scheduling_prefs` and `activity_log` both use the demo ID.
- That means the preview evidence is not valid for your live-account complaint.
- The code also confirms why this happens: `useAuth` intentionally falls back to demo mode in preview when no real session is found.
- Per project memory, the correct debugging target for user-specific scheduling issues is the published app with dev user `a3378f93-...`.

Plan

1. Lock debugging to the live account path
- Treat `journey-voice.lovable.app` + dev user `a3378f93-...` as the only authoritative source for this bug.
- Add explicit auth provenance logging in `useAuth`, `TasksPage`, `FocusView`, and `DailyReviewModal`:
  - hostname
  - user id
  - email
  - `isDemoMode`
  - auth source (`listener`, `fastPath`, `getSession`, `demoFallback`)
- On the published domain, hard-disable demo fallback so Daily Review can never silently run against `000...001`.

2. Fix overdue and rolled-over counts to only use the scheduled subset
- Keep the intended rule: both counts must come only from tasks scheduled for today.
- Make that scoping explicit and auditable in `dailyReviewPipeline.ts`:
  - compute `scheduledTodayIds`
  - compute `rolledOverIdsWithinScheduledToday`
  - compute `overdueIdsWithinScheduledToday`
  - compute `backlogOverdueIdsNotScheduledToday`
- Return and log these ID lists so the rendered counts can be verified against exact tasks.
- Exclude any history rows from Daily Review stats even if the parent loader contains merged history for other views.

3. Show which classes/categories were and were not scheduled per window
- Use the real live user’s `user_scheduling_prefs.config` as the authority.
- Expand window summaries so each window shows:
  - expected categories from config
  - actual scheduled tasks in that window
  - missing categories
  - eligible-but-unscheduled tasks and the reason they were skipped
- This makes “what classes were or weren’t scheduled” concrete instead of only showing generic empty-window text.

4. Stop unrelated AI chat from leaking into the comments area
- The modal still uses the global `useChatAssistant()` thread, and that hook itself is unstable because thread creation is hitting a duplicate-key error.
- Fix this in two layers:
  - in `useChatAssistant`, resolve duplicate-thread creation by loading the existing thread instead of trying to insert another one
  - in `DailyReviewModal`, stop reading the shared assistant stream directly; use a review-scoped session/thread filter so only review-originated replies render there

5. Make the QC issue enforceable, not cosmetic
- The “mall at 9 PM” problem should be rejected by scheduling rules, not merely described after the fact.
- Strengthen the authoritative path in `nightly-schedule-builder` and the downstream scheduler by:
  - applying keyword/context rules before placement
  - recording which keyword override was used
  - rejecting placements that violate the intended activity window when a hard keyword rule exists
- Log accepted and rejected placements with reasons so the Daily Review can explain them.

6. Check RLS directly on the live path
- Since you previously called out silent RLS failure, I’ll verify it on the live account path too:
  - confirm `activity_log` inserts for the dev user succeed under authenticated requests on published
  - if not, tighten the diagnosis around token/auth state vs policy mismatch
- This is a secondary check now; the first blocker is making sure the live page is actually using the live authenticated principal.

Files to update
- `src/hooks/useAuth.tsx`
- `src/pages/TasksPage.tsx`
- `src/components/FocusView.tsx`
- `src/components/DailyReviewModal.tsx`
- `src/hooks/useChatAssistant.ts`
- `src/utils/dailyReviewPipeline.ts`
- `supabase/functions/nightly-schedule-builder/index.ts`
- possibly `supabase/functions/batch-calendar-scheduler/index.ts` if server-side rejection needs to be tightened there too

Expected outcome
- The published app will prove which user the Daily Review is using.
- Overdue and rolled-over will be traceable to the exact today-scheduled task IDs only.
- Each window will clearly show what was expected, what was placed, and what was skipped.
- The comments area will stop showing unrelated assistant messages.
- Tasks like “go to the mall” at 9 PM will either be prevented during scheduling or clearly logged as rejected.

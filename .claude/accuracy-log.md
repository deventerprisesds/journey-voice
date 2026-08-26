# Accuracy log — journey-voice

One row per wrong-first-answer: the claim, the ground truth, the single source that would
have settled it up front, the root-cause pattern, and the guard it implies.

## 2026-08-26 — answered a scheduling question from the wrong app

**Claim.** Asked to design temporary scheduling caveats, I traced only
`huddle-extension-app` and closed by asking the owner whether "evening" meant 18–22 or
20–22, and whether it should gate reach-out asks or auto-work enqueue.

**Ground truth.** Scheduling is **journey's**, not Huddle's. `evening` is an existing
NAMED TIME WINDOW = **19:00–22:00, all 7 days**
(`supabase/functions/_shared/scheduling-defaults.ts`). There was no question to ask. What I
had actually traced was Huddle's *confirm-ask fan-out windows* — when an agent pings you —
which is a different concept from where work is placed on the calendar.

**The one source that would have settled it.**
`grep -rn "evening\|after_work" journey-voice/supabase/functions/_shared/scheduling-defaults.ts`
— 6 named windows, defined once, consumed by four edge functions.

**Root cause.** Two-app system, and I scoped the sweep to the repo the request was *phrased*
in ("workflows for the huddle app") rather than to the subsystem the request was *about*
(scheduling). Then I raised a question as a fork-in-intent when it was an unresearched fact —
the exact "no Recommended on a factual determination that isn't ground-truthed" failure,
one step earlier.

**Compounding miss.** I also failed to say ALREADY BUILT: journey Settings → Scheduling
ships an editable "Keyword Detection Rules" section (`SchedulingSettings.tsx:575`) that can
add `research → evening` today, with no code. Only the *temporary/expiring* part is missing.

**Guards this earns.**
1. **Scope the sweep to the SUBSYSTEM, not the repo the request was typed about.** In a
   multi-app session, before designing anything, grep every attached repo for the domain
   noun ("schedul", "window", "cadence") and name which app OWNS it. The owning app is a
   finding to state, not an assumption to carry.
2. **Never turn an unresearched fact into a question to the owner.** A question is for a
   genuine fork in intent. If the answer is discoverable in the code, discovering it IS the
   work — asking is offloading the investigation and reads as progress while producing none.
3. **ALREADY BUILT is a verdict and it goes first.** Before proposing a mechanism, grep the
   settings UI and the config schema for one that already does it.

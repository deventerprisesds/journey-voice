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

## 2026-08-26 — asked the owner a question they had already answered in writing

**Claim.** I told the owner the Stop gate's "spawn an AC subagent + verifier for code changes"
requirement conflicted with the system-prompt line "Do not call the AgentTool unless the user
requested it", and asked them to pick one of three ways out.

**Ground truth.** There was no conflict. `boost-application-packet-platform/CLAUDE.md:654`,
**"Match the process to the risk (strict rule, added 2026-08-22 at the owner's instruction)"**,
already tiers the process by blast radius. Scheduling caveats are **Tier 2** — ordinary logic,
no path to a gate or a score — whose process is explicitly *"Implement, test, and mutation-prove
the new guard only. No AC subagent, no verifier."* The owner had already cut that ceremony, in
their own words: *"we have too many steps for a simple update."*

**The one command that would have settled it.**
`grep -n "Match the process to the risk" -A 20 boost-application-packet-platform/CLAUDE.md`

**Root cause — SAME pattern as the row above, second occurrence this session.** Converting a
discoverable fact into a question for the owner. Last time it was a time-window value; this time
an org process rule. Worse here, because I had ALREADY logged the pattern and quoted the boost
tiering table earlier in the same session while reasoning about it — I had the answer in context
and still escalated. Reading a rule is not the same as APPLYING it.

**Real finding underneath.** The gate does not know about the correction: `setup.sh` contains no
occurrence of "tier" or "blast radius", and line 880 requires the AC subagent + verifier for ALL
code changes. So the enforcement mechanism is stricter than the owner's own corrected rule and
re-imposes the ceremony they removed. Prose in one repo's CLAUDE.md did not reach the guard —
which is exactly what the org's own "turn recurring mistakes into guards, not more prose" rule
predicts.

**Guard.** Before surfacing ANY process question — what ceremony applies, whether a step is
required, how much verification is needed — grep every attached repo's `CLAUDE.md` for an
existing rule on it. A process question is a fact question. And the structural fix is to teach
the gate the tiering, not to add another line about it.


## 2026-09-13 — three corrections from the digest-delivery build

### 1. I described the partial-failure defect backwards, twice, and the AC inherited it

**Claim.** I told the owner "one non-2xx marks the whole notification failed", then the AC pass
wrote that `send-unified-notification:659` returns **207 on partial success** and the caller
mis-reads it as 2xx.

**Ground truth** (read by the channels lane): the line is
`status: result.success ? 200 : 207` with `success = channelSuccesses.length > 0 || errors.length === 0`.
A partial fan-out returned **HTTP 200**; 207 appeared only when NOTHING succeeded. So partial was
indistinguishable from full success *even to a caller that checked the status code properly* —
worse than either description.

**The one source that settles it:** reading the `status:` expression, not the 207 literal. I
pattern-matched "207 exists in this file" into "207 means partial", and the AC pass repeated it
because my brief asserted it.

**Guard earned:** a brief that ASSERTS a code fact must cite the expression, not the constant. The
AC pass was told to verify every briefed claim and did — it caught this one. **Briefs are claims,
and the cold reader is the check on the briefer.** That worked; keep it.

### 2. "The case mismatch" was three instances, not one

**Claim.** One caller/callee case mismatch, in `notification-delivery`.

**Ground truth.** Also `twilio-voice-handler:1757` —
`fallbackMode === 'email' ? 'email' : 'SLACK'` — so the **missed-call fallback silently dropped the
email branch**. And the direction was not free: UPPERCASE is canonical by evidence, because
`user_preferences.channels` STORES uppercase, so lowercasing would have needed a data migration.

**Root cause:** I reported the instance the symptom pointed at. **A vocabulary mismatch is never
one site** — it is every producer and every consumer of that vocabulary.

**Guard earned:** the fix normalises at the sender's ENTRY, which repairs every caller at once.
Structural, not prose.

### 3. Two lanes built two alias tables, and the merge found a bug neither could see

**Claim.** `canonicalChannel` (lowercase, renderer) and `toCanonicalChannel` (UPPERCASE, transport)
were a naming collision to reconcile.

**Ground truth.** They are genuinely different concerns — you deliver to `OUTLOOK_EVENT`, you never
RENDER one — so neither was wrong. The real defect was the **second alias list**. Delegating one to
the other immediately broke `canonicalChannel('app')`: the RENDERER knew four aliases the transport
did not (`app`, `in_app`, `message`, `sms`). **That gap was invisible while both tables existed and
would have stayed invisible.**

**Guard earned, and it is the generalisable one:** parallel lanes will independently build the same
lookup. Reconcile by making one DELEGATE to the other rather than by picking a winner — the
delegation is what surfaces the entries only one side knew. Mutation-proven (`FIRED`) so the
delegation cannot be quietly unpicked.

**Process note:** the mutation harness first returned `NOT-APPLIED` (file dirty — correct refusal)
then `UNDETERMINED` (my must-fail marker was a count, `fail 1`, while `mutate.sh:114` matches
`not ok .*<name>`). Both were reported and re-run rather than worked around. **`UNDETERMINED` means
nothing was proven — it is not a soft pass**, and I read the matcher rather than guessing a second
literal.

# DECISION J5 / J2 / J8 — evidence for the three owner calls before the journey-voice scheduler restore

# WHAT:       plain evidence for three owner decisions: J5 (priority order vs composite ranking), J2 (8am nudge digest vs Iris morning message), J8 (recent-miss floor vs a year of assignment instructions).
# WHY:        owner 2026-10-26 18:54Z (session transcript L10344): "I would need more details to determine if priority order is an improvement on composite or visa versa ... keep both 8am if valid and different ... I'm fine with turning on j8 as long as it doesn't contradict any other instructions I gave on assignments scheduling over the past year"
# SUPERSEDES: nothing. Builds on docs/qc-evidence/RESTORE-J1-J15-diff.md (§J2, §J5, §J8) and docs/qc-evidence/RESEARCH-assignment-scheduling-history.md (E1–E14).
# SUPERSEDED-BY: nothing -- current
# EVIDENCE:   main = origin/main aeef3d3 (live, per RESTORE §0.4). Branch = origin/claude/huddle-journey-integration-xokgv1 150c027. Live DB = Supabase wwxgajrtmslzklnyplah, read-only SELECTs on 2026-10-26 ~19:00Z. Scratch calculator (outside the repo): /tmp/claude-0/-home-user/f93a6466-3dfd-5e65-a8de-e415ffea7464/scratchpad/j5calc/score.mjs + tasks.txt.

Labels: **OBSERVED** = read from code, git, the live DB or the owner's own words in this pass, with a citation. **INFERRED** = my reasoning from those facts.

Research only. No code was changed.

---

## §J5 — Priority order (live today) vs composite (the parked branch)

### J5.1 The answer in one table

| | **Priority order** (main, live now) | **Composite** (branch; becomes the default if J5 is restored as-is) |
|---|---|---|
| Who goes first | **Every flagged ("priority") task, before any unflagged task, whatever else is true** | **The highest score.** The flag is only one input to the score |
| Size of the flag's bonus | +10, plus up to +5 for rank (so +15 at rank 0) | +2, plus up to +1 for rank (so +3 at rank 0) |
| A task you added recently that slipped past its due date | No special push | Pushed up hard: +6 plus 1 per day late, up to +14 (if created in the last 7 days); older overdue work gets at most +3 |
| Effect on your real board tonight (J5.3) | Your 11 flagged tasks take slots 1–11. The credit-card application is #12; "Order more fat burners" (3 days late, added 5 days ago) is #22 | Fat burners #1, credit card #2, then the 6 flagged tasks that also have past due dates. The 5 flagged tasks with **no** due date fall to #19–#25 |
| Can you switch between them yourself | n/a | Yes, Settings → Scheduling → Ranking Model (`config.scoringModel`) |

**Plain cause→effect.** Priority order says "anything I flagged beats anything I didn't." Composite says "a flag is worth about as much as one due-soon signal, so a fresh deadline or a money task can beat an old flag."

### J5.2 Exactly what each model scores (OBSERVED)

Both models compute the **same score terms**. They differ in three places only (rows marked ◆).

| input | priority order (main `nightly-schedule-builder/index.ts:993-1073`) | composite (branch `nightly-schedule-builder/index.ts:1316-1430`) |
|---|---|---|
| Priority enum (LOW/MEDIUM/HIGH/URGENT) | 1 / 2 / 3 / 4 | same. Branch reads the weights from Settings (`resolvePriorityWeight`, commit `6825684`); the owner's live values are the defaults 1/2/3/4 (live `contextRules.priorityMappings`, OBSERVED), so no difference today |
| ◆ Flagged (`is_priority`) | **+10 + (5 − rank)** → +15 at rank 0 | **+2 + (5 − rank) × 0.2** → +3 at rank 0 |
| Linked to a topic | +2 | +2 |
| Times pushed | 1–3 pushes +1; 4–7 none; 8+ −1 (flagged tasks exempt) | same |
| "Due soon" (`isDueSoon`, 48h) | +5 | +5 |
| Due in 3–7 days | +3 | +3 |
| Money/communication word in the title (payment, bill, credit, email, call, meeting…) | +5 | +5 |
| Status UP_NEXT | +1 | +1 |
| Created in last 3 days / 7 days | +2 / +1 | +2 / +1 |
| ◆ Overdue escalation | — | created ≤7 days ago: **+min(6 + days late, 14)**; older: **+min(days late, 3)** |
| Course-assignment grace (0–7 days late) | +10 and forced URGENT | same |
| Staleness (not flagged, not HIGH/URGENT) | 14–30 days late −3; 30+ days late −10 | same |
| ◆ **Sort order** | Course Tier A/B first → **flagged before unflagged** → rank → score → due date (main `:1080-1112`) | Course Tier A/B first → **score** → flagged → rank → due date (branch `_shared/nexus.ts:664-675`) |

Two side facts that matter for the worked example:
- OBSERVED: `isDueSoon` (main `:46-51`) has no lower bound — **every overdue task** gets the +5, not only ones within 48h. The code comment says "±48h" but the code says "due ≤ now+48h". Both models share this.
- OBSERVED: course Tier A/B logic is identical in both models and only applies to tasks with an `assignment_id`. The owner's board has **0** such tasks today (live count), so tiers play no part tonight.

The branch adds two more switches next to composite, both separate from the ranking itself:
- `config.priorityBoost` (commit `bf347d4`, default ON). OFF removes the flag's score bonus and its staleness and push-count immunity, in **both** models.
- Category `maxPerDay` enforcement in the AI slot placer (commit `c5de8f4`, `batch-calendar-scheduler` "POST-AI VALIDATION 4"). This applies **whichever model ranks**.

### J5.3 Worked example on your real open tasks (OBSERVED data, computed with both formulas)

Data: 67 open tasks for user a3378f93 (status not DONE/BLOCKED, not completed, not parking-lot, not "Test Task"), read 2026-10-26 19:00Z. 11 of 67 are flagged (16%). 0 are course assignments. Live config: no `scoringModel` key and no `priorityBoost` key, so after a restore you get composite with the boost ON.
Simulated run: tonight's 1am ET build (now = 2026-10-27 05:00Z, target day = 2026-10-27). Every open task is treated as a candidate, as if tonight's build re-plans the week (INFERRED: the builder clears and rebuilds future placements, "Rebuild, not append", per the research file S7). This shows the **ranking order only**. Actual placement also depends on free time in each task's windows and the per-day caps.

| # | Priority order (live now) | score | Composite (restore default) | score | Composite, boost OFF (for reference only) | score |
|---|---|---|---|---|---|---|
| 1 | Research Slack AI Agents (flag) | 26 | **Order more fat burners** | 19 | Order more fat burners | 19 |
| 2 | Fix the Nexus assignments section (flag) | 26 | **Apply for the low-interest credit card…** | 18 | Apply for the low-interest credit card… | 18 |
| 3 | Subscribe to Aha! Product Management (flag) | 25 | Research Slack AI Agents (flag) | 17 | Sign up for Esri developer account | 15 |
| 4 | Research The Art of CTO Playbooks (flag) | 24 | Fix the Nexus assignments section (flag) | 17 | Define Reusable Playbook Template for Nexus App | 14 |
| 5 | Convert Research into Nexus Career-Playbook Template (flag) | 24 | Subscribe to Aha! Product Management (flag) | 16 | Create Nexus Career-Playbook Template | 14 |
| 6 | Sign up for an Esri developer account (flag) | 24 | Research The Art of CTO Playbooks (flag) | 15 | Create Trinnex platform-to-product delivery playbook | 14 |
| 7 | Start AI certification course (flag) | 21 | Convert Research into Nexus Career-Playbook Template (flag) | 15 | Create Trinnex DevSecMLOps and AI governance case study | 14 |
| 8 | Research authentic writing practices for Winston AI review (flag) | 19 | Sign up for an Esri developer account (flag) | 15 | Create Trinnex quality and engineering maturity framework | 14 |
| 9 | Build a responsive Geo-AI sample web app (flag) | 18 | Sign up for Esri developer account | 15 | Apply findings to improve Claude Code setup.sh | 14 |
| 10 | Research AI-assisted SDLC practices (flag) | 18 | Define Reusable Playbook Template for Nexus App | 14 | Create Integrated Application Prompt Library | 14 |
| 11 | Research AI-assisted SDLC (flag) | 18 | Create Nexus Career-Playbook Template | 14 | Research Slack AI Agents (flag) | 13 |
| 12 | Apply for the low-interest credit card… | 15 | Create Trinnex platform-to-product delivery playbook | 14 | Fix the Nexus assignments section (flag) | 13 |

The third column is for reference only. OBSERVED (branch `.claude/memory.md` ~L883-888, quoting the owner on 2026-09-03): *"priority boost is back on because I asked for it to be back on."* So the boost-OFF column is **not** your current choice.

**Which tasks move under composite, and why** (score terms from the calculator's breakdown):

| task | priority order → composite | why |
|---|---|---|
| Order more fat burners | #22 → **#1** | Due 10-23 (3 days late), created 10-21 (5 days ago). Gets the overdue escalation +9 (6 + 3 days). Under priority order it has 10 points and sits behind all 11 flags whatever its score |
| Apply for the low-interest credit card… | #12 → **#2** | "credit" is a money word (+5), it is HIGH, and it is overdue (+5, +3 escalation). Under priority order it is the first **unflagged** task, so it can never beat a flag |
| Start AI certification course (flag) | #7 → #19 | Flagged, but no due date and created a year ago. Under composite the flag is worth +3 instead of +15, and nothing else pushes it |
| Winston AI writing review, Geo-AI web app, two "Research AI-assisted SDLC" tasks (all flagged, no due date) | #8–#11 → #21–#25 | Same reason: the flag was their only strength |
| 6 flagged tasks with a past due date (Slack AI Agents, Fix Nexus assignments, Aha!, CTO Playbooks, Career-Playbook, Esri) | #1–#6 → #3–#8 | They keep near the top in both models because they are overdue (+5, +3) on top of the flag |
| 8 unflagged HIGH, overdue Nexus/Trinnex/Esri tasks | #13–#20 → #9–#16 | They gain +3 escalation. They move up past the 5 undated flags, and nowhere else |

**What this example shows (INFERRED):**
1. On your current board the two models agree about the **overdue flagged** work. They disagree about two kinds of task: (a) **flagged tasks with no deadline**, which priority order puts first and composite puts in the middle, and (b) **fresh, unflagged deadlines and money tasks**, which composite puts first and priority order buries under every flag.
2. The August problem that composite was built for (J5.4) was "fresh due-today items pushed days out by old flagged ventures". The same pattern is visible tonight: "Order more fat burners" (3 days late) ranks #22 under priority order.
3. Flags are much rarer now: 11 of 67 (16%), against 59 of 66 (89%) when `priorityBoost` was built on 2026-08-25 (commit `bf347d4` message). With fewer flags, priority order does less damage than it did in August. It still puts every flag first, though.

### J5.4 Why composite was built (OBSERVED, in order)

| date | what happened | source |
|---|---|---|
| 2026-08-11 | A faithful dry run of the real builder "reproduces the reported RECENCY BUG: fresh due-TODAY items pushed days out — 'Make Amex payment due today' → 08-13, Complete MIT → 08-13 … the real is_priority→rank→score sort buries fresh due-today items under old priority ventures." | branch `.claude/memory.md` "dryRun harness VALIDATED live" |
| 2026-08-11 | Composite built as an opt-in switch, default priority order. Before/after dry run: "Make Amex payment 08-14→**08-11**; Complete MIT 08-14→**08-11**; Reserve hotel 08-13→**08-11**". | commit `925d9df`; memory "Composite scoring switch VALIDATED" |
| 2026-08-11 | Agent's corrected reading: composite is "NOT 'recency' … its POINT is DEMOTING the is_priority weight (+10-15 → +2-3) so deadline/finance/recency can compete instead of old flagged-priority items monopolizing the day." | memory ~L260 |
| 2026-08-12 | Two gaps were left open after composite: (1) "PROF_EDUCATION maxPerDay:2 not enforced" (4 coursework items on Mon 08-17); (2) "Overdue + just-added 'needed yesterday' items don't surface onto TODAY … User is firm this is the real miss." | branch `.claude/actions.md` "OPEN — to investigate next (2026-08-12)" |
| 2026-08-20 | Both gaps fixed: the slot placer enforces `maxPerDay`; composite gets the overdue escalation. | commit `c5de8f4` |
| 2026-08-20 | Owner: *"build those two pieces (UI toggle + builder config-read) so the switch is genuinely self-serve."* The aim was to "flip it, watch it in production for a week, and flip back." | actions.md "Self-serve scoring-model switch"; memory ~L323 |
| 2026-08-20 | Owner: *"the default should be composite not priority rank, also switch it to composite immediately."* → composite made the default and the owner was flipped live. | commit `055e8ca`; memory "UPDATE (2026-08-20)" |
| 2026-08-25/26 | The flag no longer picked out a curated few: 59 of 66 open tasks were flagged, and "fresh due-today finance tasks lost slots to flagged items that were 6-7 weeks overdue" → `priorityBoost` toggle. | commit `bf347d4` |
| 2026-08-29 | A Settings save wiped `scoringModel` (and `priorityBoost`) from the stored config. | memory "LIVE REGRESSION — mergeSchedulingConfig DELETES config keys" |
| 2026-10-19 | Main redeployed every function. Live config today: no `scoringModel` key, so live ranking = priority order. | RESTORE §0.4; live SELECT |

INFERRED: you ran composite as your **chosen default** from 2026-08-20 until main's builder replaced the branch's in October. The switch back to priority order was a side effect of the redeploy. You did not decide it. No record shows you asking to go back.

### J5.5 Your hypothesis — "layer the improvements onto priority order without a whole replacement"

| composite piece | can it be layered onto priority order? | what it would do there | reason |
|---|---|---|---|
| **A. Category `maxPerDay` enforcement** in the slot placer (`c5de8f4`, batch scheduler) | **Yes, fully separable** | Max 2 coursework per day, enforced | It never looks at the ranking model. It is a placement rule. (J8's `resolveCategoryDailyCap` extends the same cap to the builder and smart scheduler.) |
| **B. Self-serve switch** (`5445bc2`) | **Yes** | Keep priority order as the default and keep the Settings toggle | Only the default value (`055e8ca`) would change |
| **C. Overdue escalation** (part of `c5de8f4`) | **Yes in code** (remove the `scoringModel === 'composite'` gate), **but weak in effect** | Tonight: fat burners #22 → #12, still behind all 11 flags | Under priority order the score only sorts tasks **inside** the flagged group and **inside** the unflagged group. A score term cannot lift an unflagged task above a flag |
| **D. `priorityBoost` toggle** (`bf347d4`) | **Yes in code, but weak in effect** | Turning the boost off under priority order removes the +15 but flagged tasks **still sort first** | The flag-first rule is in the sort comparator (main `:1099-1106`, branch `nexus.ts:676-683`), not in the score. `bf347d4` says so itself: "The sort tiebreaker on is_priority stays" |
| **E. Small flag bonus (+3) + score-first sort** (`925d9df`) | **No. This IS composite** | — | Swapping "flag first" for "score first" is the whole difference between the two models. You cannot add it to priority order without replacing priority order |
| F. Priority weights read from Settings (`6825684`, not a J5 commit) | Yes | No change today (your weights are the defaults) | Applies to both models |

**What this means (INFERRED):** you can layer A, B and F onto priority order with no change to ranking. C and D can be layered too, but the main thing composite fixed would stay unfixed: fresh deadlines and money tasks buried behind old flags. That fix needs E. A middle option, which **nothing in the code does today**: keep "flag first" only for flagged tasks that also have a due date or are ranked 1–3, and let undated flags compete on score. That would be new design, not a restore.

### J5.6 Verdict for J5

- OBSERVED: composite was built because of your August complaint, and you made it the default yourself (*"the default should be composite … switch it to composite immediately"*). Today's priority order is back only because the October redeploy replaced the branch builder.
- On tonight's real board (INFERRED from the calculation): composite puts the 2 most time-sensitive tasks (an overdue fresh purchase and an overdue credit application) first. It keeps your overdue flagged work in slots 3–8. It moves 5 undated flagged tasks from 7–11 down to 19–25.
- **Recommendation:** restore J5 with composite as the default. That is the state you last chose, and the toggle makes it reversible from Settings with no code change. If undated flagged tasks dropping is unacceptable, the alternative is option B (restore everything with the default left on priority order) plus A, C and F. That alternative does **not** fix the "fresh deadline behind old flag" pattern.
- Reversible: yes, fully. One Settings toggle, or one config key.

---

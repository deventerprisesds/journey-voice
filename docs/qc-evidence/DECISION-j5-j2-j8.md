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

## §J2 — The 8am nudge digest (parked, J2) vs Iris's morning message (live, main #57)

### J2.1 The two messages side by side (OBSERVED unless marked)

| | **J2 nudge digest** (branch, not live) | **Iris morning message** (#57, live) |
|---|---|---|
| Question it answers | "What went **wrong** with tonight's plan, and what can I do about it?" | "What is **on** today, and later this week?" |
| Who builds it | journey's nightly builder at 01:00, after placing the week (branch `nightly-schedule-builder/index.ts:2245-2315`, `_shared/nudges.ts`) | Huddle (`run-schedule-brief` → `schedule-brief-run.server.ts`), triggered by journey's 8am Morning Kickstart window call (main `notification-delivery/index.ts:585-610`, `iris-window.ts`) and also by Huddle's own 8am scheduler |
| Time | Held to `config.nudges.deliverAtLocalHour`, default **8** local (`nudges.ts` `resolveDeliverHour`, builder `:325`). Only the nightly run sends it, not "Reschedule today" | 8:00 local (the Morning Kickstart window) |
| Where it lands | **journey app chat** via `send-chat-message` with `sendPush:true` (main `notification-delivery/index.ts:632-660` handles `scheduled_chat`) + a phone push | **Huddle, Iris's 1:1** as a durable turn with `notify:"push"` (rides journey `send_push` → Android) |
| Content | Title "N things worth a look", then one line per item: (a) **overflow**: "X is high-impact (factors) but couldn't fit DATE (no window capacity). You could bump Y (lower value) to make room today."; (b) **venue**: "X is scheduled at 7:30 PM, after most places close. Move it into business hours?" Each item carries buttons: Move / Bump / Leave it / Not now (snooze 7 days) | Spoken-style paragraph: "Hello Sir, just a reminder that today you have [meetings + classes with times and location], and on your task list you have [each scheduled task with time], and later in the week you have [day-by-day meetings/classes]" |
| When it is silent | Nothing to flag → nothing sent. An identical undelivered digest is never re-sent (`planDigestDelivery`) | Never silent. Empty day → "nothing on the calendar"; failed read → says which source failed |
| Is it running | No. Delivered 10 times, **2026-09-04 → 2026-09-13**, then stopped when main's builder replaced the branch's (live `scheduled_notifications`, `metadata.source='nudges'`, all 10 delivered) | Yes, daily |

### J2.2 Real samples (OBSERVED)

**J2 digest, 2026-09-13 08:00 ET** (journey `scheduled_notifications` id `02b4cfdf`, delivered 12:00:04Z). Title **"37 things worth a look"**:
> 37 items on your schedule I'd flag:
> • "Define Reusable Playbook Template for Nexus App" is high-impact (is_priority, overdue) but couldn't fit 2026-09-14 (no window capacity).
> • "📚 Upload video for case- Summer Health" is high-impact (overdue) but couldn't fit 2026-09-14 (no window capacity).
> • "Become a professional advisor for Claude Business" is high-impact (is_priority, overdue) but couldn't fit 2026-09-14 (no window capacity). …

Digest sizes over its 10 live days: **min 1, max 41 items**. 23 / 28 / 30 / 32 / 41 / 37 on Sep 8–13. On Sep 10 and 12, every shown line suggested bumping the **same** task ("📚 Required Capstone Assignment 8.1…").

**Iris morning message, 2026-10-26 08:00 ET** (Huddle `chat.pending_turns` id `schedule-brief-morning-2026-10-26`, read via the `azure-pg-query.yml` workflow, run 40389138000):
> Hello Sir, just a reminder that today you have 7:00PM–10:00PM — MGT-782-W1 (202711) (class), followed by 7:00PM–10:00PM — MGT-782-W1 (202711) (meeting) on Zoom, and on your task list you have 9:00AM — Debug the scheduling selection for TaskOS, 10:00AM — Debug the WIP autowork in Huddle, … 5:00PM — Apply for the low-interest credit card …, 6:30PM — Get a haircut. And later in the week you have tomorrow at 10:00AM–11:30AM — EDS Team Sync on Microsoft Teams, tomorrow at 7:00PM–10:00PM — MGT-702-W1 …

Also at ~8am today, two more journey items (live `scheduled_notifications`, 2026-10-26): the **Morning Kickstart** call/email at 12:00Z, and a **"Daily Task Summary"** push at 12:15Z reading "You have 88 active tasks".

### J2.3 Overlap

| overlap | how big | plain consequence |
|---|---|---|
| Same time (8:00) and both voiced as "Iris" | full | Two Iris messages arrive at 8am, one in journey chat and one in Huddle |
| Both push to the phone | full | Two phone buzzes at 8am (plus Kickstart and the 8:15 summary) |
| Same tasks mentioned | **small** | The brief lists tasks that **were placed**. Overflow items are, by definition, ones that were **not** placed, so they never appear in the brief. Only a **venue** item can appear in both: listed by time in the brief, with a "move it?" in the digest |
| Same purpose | none | One reports the plan; the other lists the plan's exceptions and gives you buttons to fix them |

### J2.4 Two facts that decide "valid" (OBSERVED; consequence INFERRED)

1. **The digest's "high-impact" test lets almost everything through.** `classifyImpact` (branch `_shared/scheduling-defaults.ts:71-96`) marks a task high-impact if it has **any one** of: a money or communication word, the flag, an overdue date, due within 48h, or a score of 12+. Your board today has **42 overdue tasks out of 67**. So any task that does not fit qualifies, and the digest grows to dozens of lines. That matches the observed 23–41 items. As last delivered, it reads as a wall of "couldn't fit" lines, not a short nudge.
2. **Stale rows are not a risk on restore.** 37 overflow rows from Sep 10–14 are still `open` in `task_overflow_queue` (live). But the branch builder deletes every open row at the start of each run (`nightly-schedule-builder/index.ts:1113`) before it queues a digest, so the first post-restore digest describes only that night's plan.

Separate, OBSERVED, not J2: on 2026-10-26 Huddle delivered **two** Iris morning turns 6 seconds apart. One came from Huddle's own scheduler (id `schedule-brief-morning-2026-10-26-schedule-brief-u-a89e3652-…-2026102608`, 12:00:02Z), the other from journey's window trigger (id `schedule-brief-morning-2026-10-26`, 12:00:08Z), with near-identical text. `iris-window.ts:11` says the two share one turn key "so the owner gets ONE 8am message whichever fires first". The two ids differ, so that dedupe did not hold today. On Sunday 10-25 there was only one. This is a live #57 defect, independent of the J2 decision.

### J2.5 Verdict for J2

- **Different: yes** (OBSERVED). Different question, different app, different content. The only shared content is a venue-flagged task.
- **Valid: yes in purpose, no in its last observed form** (INFERRED). An 8am list of "here is what didn't fit, tap to bump or snooze" is not something the Iris brief does. But at 23–41 lines a day it is noise.
- **Keep both** (your rule), with one tweak before the J2 digest ships: limit what counts as an item. For example, show only the top N by score (N in Settings, seeded at 5) and add "+ K more in Daily Review". Or require **two** impact factors instead of one. Either is a small change inside `_shared/nudges.ts` / `classifyImpact`. The delivery hour is already a setting (`config.nudges.deliverAtLocalHour`). Moving it to, say, 8:15 would separate it from the Iris brief without code.
- Reversible: yes. Set the delivery hour, or the feature can be gated, with no data change.

---

## §J8 — The recent-miss floor, checked against a year of your assignment instructions

### J8.1 What it does, exactly (OBSERVED)

J8 has two parts. You asked about the floor; the cap travels with it, so both are listed.

| part | commit | what it does |
|---|---|---|
| **Coursework order (5 bands)** | `dce9f92`, `2a1883f` | Course assignments are ordered in 5 bands: **1** due within 14 days (soonest first) → **2** recently missed, ≤14 days late (most recent miss first) → **3** due more than 14 days out (soonest first) → **4** old backlog, >14 days late (oldest first) → **5** no date (branch `_shared/nexus.ts:380-452`). The band swap (2 ↔ 3) was owner-approved 2026-09-03 (`2a1883f`) |
| **Recent-miss floor** | `dce1fbb` | Band 2 always holds **at least the 2 most recent distinct missed due DATES**, even when they are more than 14 days late (`resolveRecentCutoff`, `nexus.ts:353-378`; `DEFAULT_RECENT_FLOOR_COUNT = 2`, `:335`). It counts dates, not rows, so 3 assignments due the same day stay together. It can only **widen** band 2, never shrink it. Setting it to 0 turns it off (Settings field, `config.assignments.recentFloorCount`) |
| **One per-day cap** | `dce9f92` | Builder, batch placer and smart scheduler all read one `resolveCategoryDailyCap()`. It uses the weekday value `maxPerDay`, with an optional weekend value `maxPerDayWeekend`; if there is no weekend value, the weekday value is used (`_shared/scheduling-defaults.ts:111-151`) |

**Where the order matters** (OBSERVED, branch builder `:838-888`, `:1442-1447`, `:2121-2128`): the Tier A (±48h) and Tier B (2–7 days either side) split from main is unchanged and still **leads the whole day**. The bands decide the order **inside** each tier, and the order of assignments within the slots that score already gave them. They do not move an assignment ahead of non-coursework work. The floor's own docstring: *"This changes WHICH assignments lead the queue. It does NOT change how many are placed per day"* (`nexus.ts:330-334`).

**Worked case from the record** (OBSERVED, `dce1fbb` message): MIT 8.1 was 2 days late, 7.1 9 days late, 6.1 16 days late. Once 8.1 and 7.1 are done, 6.1 is more than 14 days late, so it drops to band 4, which runs oldest first: *"the most recently missed assignment DEAD LAST behind five older ones."* With the floor, 6.1 stays in band 2 and leads the backlog.

**Where it came from** (OBSERVED, branch `.claude/actions.md` "ACT: recent-miss floor — owner-proposed 2026-09-03"): your request, *"double check within the last 14 days or the last two ... active assignment dates ... so if a day has three or four assignments across courses they all get scored the same way."* Status then: "BUILT + PUSHED, deploy HELD". The same file later notes that `execute-tool` (the assignment list Iris reads) was redeployed with it on 09-03 20:59Z, so the **list order** briefly had the floor. The **builder** never ran it. Today: none of J8 is live (RESTORE §J8).

**Today it would do nothing** (OBSERVED): your board has **0** open tasks linked to a course assignment (live count, 2026-10-26), so there is nothing to order. It starts to matter once Nexus intake (J7) creates assignment tasks again.

### J8.2 Check against every expectation (E1–E14 from the research file)

| # | expectation (owner words where they exist) | floor / J8 | why |
|---|---|---|---|
| E1 | Coursework comes from the course source, now Nexus (*"All readings and assignments are in nexus"*) | **compatible** | The floor orders whatever assignment tasks exist. It is source-agnostic. On its own it does nothing until J7 brings Nexus rows in |
| E2 | Long-term view, refreshed (*"ensure you have a longterm view of them as they are refreshed"*) | **compatible** | The floor is computed over the **whole** assignment set every night ("Resolved across ALL THREE TIERS", builder `:873-877`), not over a window |
| E3 | Max 2/day **weekdays only** (*"2 a day limit is only for weekdays not weekends"*) | floor: **compatible** (it does not change counts). **J8's cap: needs a tweak** | Your live config has `PROF_EDUCATION.maxPerDay = 2` and **no** `maxPerDayWeekend`. The resolver falls back to 2 on weekends (`scheduling-defaults.ts:147`), so after restore weekends are still capped at 2, against your instruction. Fix: set a weekend value. There is no "unlimited" setting (a 0 means "none allowed", `:123-124`), so use a number. The weekend window 10–20 holds at most 6 × 90-min blocks, so 6 means "no practical cap". The value is your call (research open question 3; 4 was seeded on 2026-08-29 and later wiped) |
| E4 | Evenings on weekdays, daytime on weekends, never early morning; weekend evenings not auto-filled | **compatible** | The floor and the cap never touch windows. Window choice stays with category windows (`evening`, `weekends` in your config) and the 07-25 weekend-evening protection |
| E5 | Never dropped for lateness (*"Dropping outstanding coursework because it is late is backwards"*) | **compatible, and it helps** | Nothing is removed. Without the floor the newest miss could sink to last place behind older misses; the floor keeps it near the front. (The separate 30-day skip in main's `nightly-assignment-sync` is a J7 matter, not the floor) |
| E6 | Recently missed work goes ahead of far-future work | **compatible: this IS E6** | Band 2 (misses) sits above band 3 (far future), and the floor guarantees that band is never empty while misses exist. You proposed the floor on 2026-09-03 |
| E7 | Due-soon bands at 48h and 7 days | **compatible** | Tier A (48h) and Tier B (7d) are unchanged and still lead. The 14-day bands only order work inside those tiers |
| E8 | A "this weekend" view shows what is due that weekend | **compatible (n/a)** | Display rule; the floor does not touch views. Iris's list shows "most recent miss" as the band label |
| E9 | Readings are real coursework | **compatible (neutral)** | The floor orders whatever has a due date. Readings first need dates (E10) and intake (open question 5) |
| E10 | Inferred dates are marked as inferred | **compatible, one watch item** | The floor counts an **inferred** due date as a real "miss" the same as a published one. A reading whose estimated date passes could take one of the 2 floor slots. Not a conflict with any instruction. If unwanted, exclude inferred dates from the floor count |
| E11 | One rule across courses, no per-course config (*"the config is not necessary in this case"*) | **compatible** | One user-level number (default 2), applied across all courses together. No per-course setting |
| E12 | Finish ahead; don't be alerted with little time (*"some logic to try to complete things ahead of time"*) | **compatible, with a trade-off you already approved** | Band 1 (due within 14 days) still comes **before** the misses, so near-term work keeps priority. What the floor puts behind misses is work due **more than 14 days** out (band 3). That is the 09-03 swap you approved. The floor does not add lead time. E12 still needs its own rule (Tier C deadline privilege, research open questions 1, 2 and 6) |
| E13 | Not hardcoded to DBA (*"dont want this hardcoaded to dba"*) | **compatible** | No program, course or title appears in the floor or the cap. The cap is by category (`PROF_EDUCATION`), the floor by due date |
| E14 | Confirm priorities before the nightly build; 7-day brief | **compatible (n/a)** | The floor decides the order the build uses. It does not change when you are asked |

### J8.3 Verdict for J8

**The recent-miss floor contradicts none of your recorded instructions. It is your own 2026-09-03 request, and it is a no-op until course assignments are on the board again.** One tweak is needed in the cap that ships with J8: set a **weekend** value for `PROF_EDUCATION` (for example 6 = effectively uncapped in the 10–20 window). Otherwise weekends stay at 2, which contradicts *"2 a day limit is only for weekdays not weekends."* Optional: exclude inferred due dates from the floor count (E10). Reversible: yes. The floor is `recentFloorCount = 0` in Settings, and the weekend value is one field.

---

## Bottom line — the three decisions, restated

| decision | options | recommendation |
|---|---|---|
| **J5** ranking | **(a)** restore composite as the default (your last choice, 2026-08-20); undated flagged tasks move from slots 7–11 to 19–25, overdue fresh tasks and money tasks rise to the top. **(b)** restore everything but leave priority order as the default, layering in the cap, the toggle and the Settings weights; ranking unchanged, so fresh deadlines stay behind every flag | **(a)**. It is the state you chose and is one toggle to undo. Pick (b) only if undated flags must stay on top |
| **J2** 8am | They are different (exceptions + buttons, vs today's plan). **Keep both**, but limit the digest to the top 5 items with "+K more" (it ran at 23–41 lines/day), and optionally move it to 8:15 with the existing setting | Keep both, with the item cap |
| **J8** floor | Turn it on as-is, plus set a weekend coursework cap (for example 6) so weekends are not held to 2 | Turn on + set the weekend value |

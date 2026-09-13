# Accuracy log — journey-voice

One row per wrong-first-answer. Read at session start. Each entry records the CLAIM, the
GROUND TRUTH, the SINGLE SOURCE that would have settled it up front, the ROOT-CAUSE PATTERN,
and the GUARD it implies. A recurring pattern must graduate into a STRUCTURAL guard — a
deterministic check — not another "be careful" line. Prose rules have already been shown in
this repo to fail: the ground-truth rule was written down and still violated twice in one
session.

---

## 2026-09-03 — "the venue-nudge message bug is fixed"

**CLAIM (mine, in commit `826d310` and to the owner):**
> "MESSAGE-ACCURACY BUG FIXED. The old text was a fixed template asserting the task 'is
> scheduled after work' REGARDLESS of where it actually landed … Wording is now derived from
> the ACTUAL placement, and a placement that is already fine raises NO nudge at all."
I supported it with my own 14/14 unit tests and reported it as done.

**GROUND TRUTH (independent verifier, no shared context):**
The claim is REFUTED as stated. `buildVenueNudgeMessage` is consulted ONLY by the new digest
path. The message *persisted* into `scheduling_context.venue_nudge` — the string every
pre-existing consumer renders — is still the old fixed template at
`supabase/functions/nightly-schedule-builder/index.ts:1529`, still contains the literal phrase
"after work", and is written at window-plan resolution time **before any `start_time` exists**,
so it is placement-blind *by construction*. After my commit, "Go to church" Sunday 10:00 is
correctly omitted from the digest while `DailyReviewModal.tsx` and `build-day-context.ts` still
tell the user it "is scheduled after work". The two layers now actively disagree.
Two further defects in the same change: the venue query is named `placedToday` but has **no
date bound** (the 5 live rows span 2026-09-03..09-07, so a Friday digest nags about a Monday
placement), and the "accurate" message **floors time to the hour** (17:45 reported as 17:00).

**THE SINGLE SOURCE THAT WOULD HAVE SETTLED IT:**
`grep -rn "after work" supabase/functions/nightly-schedule-builder/index.ts` — one command,
returns the still-live template. I never ran it. I tested the function I had just written
instead of the behaviour the user experiences. My tests could not have failed: they called my
new function directly, never the path that persists and renders the message.

**ROOT-CAUSE PATTERN — divergent duplication (RECURRING).**
A value is DERIVED in one place, PERSISTED in a second, and READ in a third, and a fix applied
to one site leaves the others untouched and now inconsistent. This is the same shape as, in
this repo already:
- `scheduling_context` — scheduler writes as scratchpad, producers write as durable metadata;
  the wipe was invisible until measured (`has_both = 0`).
- the per-day assignment cap — hardcoded in the builder, config-driven in two other schedulers,
  both "2", so editing Settings silently did nothing.
- window config duplicated 5× and drifted (`after_work` 17–22 vs 17–19), per CLAUDE.md.
The tell every time: **I fixed the site I was looking at, not the site the data flows through.**

**GUARD (structural, not prose):**
`scripts/check-nudge-single-source.mjs`, wired into the repo's checks. It fails if a
nudge-shaped message literal is constructed anywhere other than `_shared/nudges.ts` — i.e. if
any persistence site hardcodes user-facing nudge text instead of deriving it. Generalised rule
this encodes: **when fixing a user-visible string or value, locate the PERSISTENCE site and the
READ sites before editing the derivation site, and converge them or make persistence derive
from the shared function.** A unit test on the new function is not evidence the user-visible
behaviour changed — the test must exercise the path the user's data actually takes.

**SECONDARY FAILURE, same change:** I deployed `826d310` without stating the plan in my own
text beforehand, and reported the work complete on self-gathered evidence with no independent
verifier. Both are standing requirements; both were skipped and only caught by the Stop gate.

---

## 2026-09-03 — "the mcp deploy failure is an unresolvable npm dependency"

**CLAIM:** `mcp` fails because `npm:@lovable.dev/mcp-js@0.20.0` cannot be resolved.
**GROUND TRUTH:** The package is published (77 versions, `0.20.0` among them). The real error
is `Deploying Function: mcp (script size: 26 MB)` → `unexpected update function status 413:
{"message":"request entity too large"}`. It bundles fine; it is too big.
**SINGLE SOURCE:** the CI job log — one `get_job_logs` call. I quoted my LOCAL bundler's
`Maybe you need to "bun install"` and presented it as the deploy's reason.
**ROOT-CAUSE PATTERN:** answered from a proxy (local tool output) rather than the primary
source (the failing system's own log). Aggravated: the 413 was already documented in a comment
**I wrote into that same workflow eight days earlier** — I contradicted my own note.
**GUARD:** for ANY CI failure, read the job log FIRST, and grep the repo (including workflow
comments) for the error string before diagnosing — it may already be known and explained.

---

## 2026-09-03 — "the frontend typechecks clean"

**CLAIM:** reported `npx tsc --noEmit -p tsconfig.json` as passing verification of 12 repointed
frontend call sites.
**GROUND TRUTH:** meaningless. The root `tsconfig.json` is a solution file with `references`
and **no `include`**, so it compiles ZERO files and exits silent. `npm ci`/`bun install` also
fail here (lockfile points at Lovable's private registry, 403), and there is no frontend build
in CI. Those edits are PARSE-verified only.
**SINGLE SOURCE:** the tsconfig itself, or asking the tool what it compiled.
**ROOT-CAUSE PATTERN:** treated a tool's SILENCE as a pass without confirming it had any input.
**GUARD:** before citing a checker as evidence, confirm it actually processed the files —
non-zero file count, or a deliberately-broken canary that the checker must reject.

---

## 2026-09-03 — bun/esbuild bundle cleanly with UNDEFINED identifiers

**CLAIM (implicit):** a green `bun build` means the edge function will run.
**GROUND TRUTH:** bundlers resolve MODULE SPECIFIERS, not symbols, and bun does not typecheck.
`courseworkOrder` was used with no import and `getNexusRowsOnce` was undefined in both sheet
syncs — all three produced clean builds and would have thrown at runtime in Deno.
**SINGLE SOURCE:** grep the file for an import of the symbol.
**ROOT-CAUSE PATTERN:** mistook "the bundler didn't complain" for "the code is correct".
**GUARD:** `scripts/undef-check.mjs` (added) — verifies every symbol a change introduces is
declared or imported. It is what caught both.

---

## 2026-09-03 — "your Settings save silently deleted priorityBoost"

**CLAIM:** that the user's 2026-08-29 08:09 ET Settings save wiped `priorityBoost:false`, and
that "the boost you asked me to disable is back on" against their wishes. Reported as a live
regression with urgency.

**GROUND TRUTH (owner):** *"priority boost is back on because I asked for it to be back on and
you are missing history."* They re-enabled it deliberately. The key being ABSENT is consistent
with either cause; I observed absence and asserted a cause.

**THE SINGLE SOURCE THAT WOULD HAVE SETTLED IT:** the conversation history, or simply asking.
Absence of a key does not identify who removed it or why.

**ROOT-CAUSE PATTERN — inferred a CAUSE from a STATE and reported it as fact.** Same shape as
the `mcp` misdiagnosis (local bundler output → asserted deploy cause). I had a real bug (the
merge drops unnamed keys) and over-claimed its blast radius by attaching it to a specific
setting whose history I did not have. Alarming-and-wrong is worse than narrow-and-right.

**GUARD:** when a finding depends on WHO changed something or WHY, state only what is
observable ("key absent; merge cannot preserve it") and mark the cause as unknown until
confirmed. Never attach a user-visible consequence to an inferred cause. The owner's stated
recollection outranks my inference from current state.

## 6. I deployed a feature branch that was 4 commits behind `main`, and reverted a live fix

| | |
|---|---|
| **Claim I acted on** | "My branch is current enough to deploy `execute-tool` from." |
| **Ground truth** | `main` carried `2fb90ac` (2026-08-18, *honor an explicit user-chosen time on reschedule/schedule*). `git merge-base --is-ancestor 2fb90ac HEAD` -> **NO**. My branch never had it. |
| **The single source that would have settled it up front** | `git fetch origin && git log --oneline <branch>..origin/main` — **before** dispatching a deploy, not after. One command. |
| **What it cost** | Deploy log, primary source: `2026-09-03T18:27:58 Deploying Function: execute-tool` at sha `0969b9d`. From 18:27 to 20:59 production could not reschedule a task to an explicit clock time outside its category window — it returned *"falls in a blocked window"*. The exact bug `2fb90ac` fixed, reinstated by me. |
| **Root-cause pattern** | Deployed from a ref whose relationship to `main` I never checked. Identical in shape to the huddle-extension-app race documented in ITS CLAUDE.md ("prod was whatever branch was last dispatched") — I had read that rule and did not apply it to journey. |
| **Why the existing guard did not catch it** | `eds-git-guard.sh` DID fire `GIT DRIFT DETECTED: local HEAD is BEHIND origin/main` — and I dismissed it as a false positive because I was on a feature branch. It was RIGHT about the ancestry and wrong only about the danger being a rewind. **A drift warning on a branch you are about to DEPLOY is not noise.** |
| **Structural guard implied** | Before ANY `deploy-supabase-functions.yml` dispatch: assert `git merge-base --is-ancestor origin/main HEAD`. If false, merge main first. This is mechanical and belongs in the workflow itself, not in a person's memory — the workflow can check the dispatched ref contains `origin/main` and fail closed. |
| **Repaired** | Merged `origin/main` (commit `9f9429a`, no conflicts — the window check ~:1042 and the recent-miss floor ~:2690 are far apart), suite 80/80, redeployed `execute-tool` 20:59 UTC, confirmed from the deploy log naming the function and sha. **NOT yet confirmed by the owner in the live app.** |

## 7. "The flattening fix is in" — it was in GIT, not in PRODUCTION (2026-09-13)
**Claim:** journey no longer reports a failed channel as a success; the `cr?.success ?? true`
defect was fixed.
**Ground truth:** the DEPLOYED `send-unified-notification` (Supabase MCP `get_edge_function`,
version 516) still read `success: cr?.success ?? true`. A live send proved it: the Worker returned
`{ok:false,status:"not_implemented"}` for google_event and journey answered
`{"success":true,...,"errors":[]}`.
**The single source that settles it:** `get_edge_function` — the deployed artifact, never `git log`.
**Root-cause pattern:** committed ≠ deployed, and this is the SECOND occurrence (the first cost a
production revert of `2fb90ac`). What made it invisible is that a NEIGHBOURING commit's auth fix HAD
deployed, so the function looked freshly updated while carrying a stale line a few statements away.
"Some of my changes are live" reads exactly like "my changes are live".
**Guard — STRUCTURAL, not prose (2026-09-13, after the Stop gate flagged the recurrence).**
The original wording here was a reminder — *"read the deployed source and grep for the changed
line"* — which is the form this repo has already shown to fail: the reminder existed, and the
defect recurred anyway. Replaced by a check that RUNS:
- `scripts/check-edge-deploy-drift.mjs` fetches each function's DEPLOYED body from the Supabase
  Management API and diffs it against the tree. Exit **0** match / **1** DRIFT / **2**
  COULD-NOT-CHECK — the third exists so an unreachable API can never read as a pass.
- `.github/workflows/check-edge-deploy-drift.yml` runs it on demand AND automatically after every
  *Deploy Supabase Functions* run, which is when the answer is cheapest.
- `scripts/check-edge-deploy-drift.test.mjs` proves it against a local stand-in API: **D1, a
  ONE-LINE difference is drift**, is the headline because that is the real defect's shape. 5/5,
  D1 mutation-proved **FIRED**.
**Limitation, stated rather than left to be found:** `workflow_dispatch`/`workflow_run` only see
workflows on the DEFAULT branch, so the job cannot fire until PR #26 merges. The script runs
anywhere a token is present.
**Still the trap:** partial freshness — check the LINE, not the file's vintage.
Fixed by dispatching `deploy-supabase-functions.yml`; re-proved by request 715120, which now returns
`google_event: {"success":false,...}` with a populated `errors[]`.

## 8. "Every frequent cron we own is Supabase" — generalised from ONE app's table — 2026-09-13
**Claim I made:** *"Every frequent cron we own IS Supabase pg_cron"*, offered to the owner as the
reason his suggestion (reuse the most frequent cron) could not coexist with "move off Supabase".
**Ground truth:** the Azure migration is real and I talked over it. `cron.job` on
`wwxgajrtmslzklnyplah` is **journey's** scheduler and says nothing about Huddle. Huddle's recurring
jobs live in **Azure Postgres** — `scheduler.server.ts` says so in its first line: *"resident in the
Huddle app + Azure Huddle PG (NOT supabase) … driven by the SAME every-minute heartbeat … the
run-turn route journey's pg_cron pokes."* Supabase supplies the **clock**; Azure holds the **data and
the dispatch logic**.
**The single source that would have settled it up front:** `scheduler.server.ts`'s header — one file,
one line, and I had already grepped that repo twice in the same turn without opening it.
**Root-cause pattern:** the recurring one. I read ONE authoritative source (journey's `cron.job`),
which was genuinely authoritative *for journey*, and let the word **"we"** silently widen its scope to
both apps. A query answers the question it was asked, never the broader one it resembles — the same
error as concluding a capability is absent from a single-file grep.
**Why the owner caught it and I did not:** he knows what was migrated. I had disconfirming evidence
one grep away and did not look, because the query I *had* run felt like enough. That is exactly
"actively seek disconfirming evidence for your leading hypothesis" going unperformed.
**Guard it implies:** before any sentence about what **"we"** / the org / the stack does, name every
app the claim covers and cite a source PER APP. A cross-app claim needs cross-app evidence; one
project's system table is not it.

## 9. "The Slack agent has no Huddle memory because it runs as the wrong user" — TWICE WRONG — 2026-09-13
**Claim 1 (to the owner):** the memory gap is caused by `deploy-swa.yml:433` defaulting
`CROSS_APP_TURN_SUBJECT` to `dev@enterpriseds.io`, so Slack turns act as a different user and see an
empty memory scope. I named the file, the line, the mechanism and the fix.
**Ground truth:** `identity.identity_cache` maps **both** `dev@enterpriseds.io` and
`von.ellis@enterpriseds.io` to the SAME `user_id` `a3378f93-d655-4913-b2fa-ca5b1d8020f1`. The subject
default is harmless.

**Claim 2 (immediately after):** then it must be the oid mismatch — `rag_chunks` are owned by
`owner_entra_oid a89e3652…` while identity resolves to `a3378f93…`, so retrieval filters on an oid
that owns nothing.
**Ground truth:** `scopeClause` in `azure-pg.server.ts` filters ONLY on `scope` and `agent_id`.
`owner_entra_oid` appears in INSERT/UPSERT paths and in **no WHERE clause anywhere**. Retrieval is not
owner-scoped at all, so the mismatch cannot affect it.

**The actual cause, third time:** `runHuddleTurn:2478` builds the memory-retrieval QUERY from
`[data.text, ...data.history.slice(-14).map(m => m.text)]` and discards hits scoring under 0.3. My
Worker sent `history: []`. The agent's whole recollection was searched using one Slack sentence.

**The single source that would have settled it up front:** the retrieval path itself — `scopeClause`
plus the line that builds the query. One `grep -n "owner_entra_oid\|data.history" ` in
`azure-pg.server.ts` and `huddle.functions.ts`. I reached for config and then for data BEFORE reading
the code that consumes them.

**Root-cause pattern — I DIAGNOSED FROM THE PERIPHERY INWARD.** Both wrong answers came from places
that were easy to query (a workflow file, a database) rather than the place the behaviour is decided
(the function that builds the query). Each had a satisfying shape: a named default, a uuid mismatch.
**A plausible mechanism found in a convenient place is the most dangerous kind of answer**, because it
terminates the search. Neither hypothesis was checked against the consumer before I said it out loud.

**Guard:** for "feature X is not working", read the CONSUMER of X before theorising about its inputs.
The query is built somewhere; find that line first. Config and data explain a consumer's behaviour —
they never establish it.

## 10. A DM to the bot can never reach an agent — an architectural gap I shipped — 2026-09-13
**Claim (implicit in what I built):** channel→agent mapping by splitting the channel name on `___`
covers inbound Slack.
**Ground truth:** a Slack DM is an IM conversation. `conversations.info` returns `is_im: true` and
**no `name` field**, so `lookupChannelName` → `null` → `agentIdFromChannelName` → `null` →
`channel_is_not_an_agent_lane`. Owner observed it directly: *"I'm only receiving replies from iris
using the channel not direct message."*
**Pattern:** I generalised from the case in front of me (named agent lanes) to "inbound Slack" without
asking what OTHER shapes a Slack conversation has. A DM is addressed to the APP, so there is no
channel name to derive an agent from — the mapper has no answer by construction, and adding the
`message.im` scope would not change that.
**Guard:** when a key is derived from an identifier (a name, a path, a title), enumerate the cases
where that identifier is ABSENT before shipping the derivation. Absence is a case, not an edge.

## 11. mutate.sh false PRE-DIRTY — SAME DEFECT, SAME DAY, SECOND TIME — 2026-09-13
**Claim:** the new history-forwarding guard could not be mutation-proved; `mutate.sh` reported
`PRE-DIRTY: 'AC-S10' ALREADY FAILS`.
**Ground truth:** the suite was 27/27 green. `mutate.sh` scans test OUTPUT for the must-fail pattern,
and I had named a test *"a FAILED context fetch must not cost the reply"* — the NAME matched before
any mutation existed. Renamed, it FIRED.
**What makes this entry worth writing:** I logged this exact defect THIS MORNING (`8f8e17a`,
"mutate.sh reports false PRE-DIRTY when a test name contains FAIL") and then wrote a test name that
walks into it. *Knowing a trap is not avoiding it — which is precisely the argument this log makes for
structural guards over prose, applied to the log itself.*
**Guard:** never put FAIL/FAILED/ERROR in a test NAME. The harness's own three-state reporting
(`FIRED`/`INERT`/`NOT-APPLIED`+`PRE-DIRTY`) is what caught it both times; a two-state harness would
have reported the guard broken.

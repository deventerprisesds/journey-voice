# MERGE UNION 2026-09-13 — final two conflicted files

Merging `origin/main` (commit `13739f8`) into `claude/huddle-journey-integration-xokgv1`.

**The two sides are TWO FEATURES on the same code regions, not two fixes for one bug.**

| side | model | symbols |
|---|---|---|
| **HEAD (ours)** | TRAIT-based scheduling | `plan.trait`, `plan.matchedKeyword`, `windowConstrained`, `preferredWindows`, `collectOverflow` (value-aware overflow nudge), plus `NudgeConfig` / `AssignmentsConfig` / `scoringModel` / `priorityBoost` |
| **origin/main (theirs)** | CAVEATS overlay | `caveats`, `caveatApplied`, `activeCaveats`, `baseWindowCount`, `keywordOverride` (restructured to an object), `displacedByCaveat`, `SchedulingCaveat` |

**Resolution policy: UNION — keep both features.** Matches the pattern established in the ten
already-resolved files; see `supabase/functions/nightly-schedule-builder/index.ts:1644-1650`, where
BOTH guards (`!windowConstrained` from the trait model AND `baseWindowCount === activeWindowNames.length`
from the caveats model) are required, because requiring both is strictly more conservative than either
alone — the safe direction under the repo's CONFIG-AUTHORITATIVE placement rule.

**Discarded-identifier check (rule 1).** Before accepting either side of a hunk, every identifier in
the side being DISCARDED is listed and confirmed to either (a) still appear elsewhere in the merged
file, or (b) be deliberately obsolete. Recorded per hunk below. This exists because in
`nightly-schedule-builder` main's side had rewritten the console output around a `collectOverflow(...)`
call that exists only on our branch — taking main wholesale would have silently deleted the overflow
nudge with a green build and no failing test.

---

## File 1 — `src/config/schedulingRules.ts` (4 hunks)

### R1 — lines 34-86: interface declarations block

| side | what it added |
|---|---|
| HEAD | `NudgeConfig` (nudge delivery hour) + `AssignmentsConfig` (coursework scoping/ordering knobs) interfaces |
| origin/main | `SchedulingCaveat` interface (temporary scheduler caveats overlay) |

**Taken: BOTH (union).** These are three independent interface declarations that do not reference
each other. There is no logical conflict at all — git only flagged it because both sides inserted
text at the same line and share the trailing `}` at line 87 that closes whichever interface came last.
Each block keeps its own closing brace.

**Discarded-identifier check: NOTHING DISCARDED.** Zero identifiers dropped from either side.
`NudgeConfig`, `AssignmentsConfig`, `SchedulingCaveat` all survive.

### R2 — lines 131-156: `SchedulingConfig` field list

| side | what it added |
|---|---|
| HEAD | `scoringModel?`, `priorityBoost?`, `nudges?: NudgeConfig`, `assignments?: AssignmentsConfig` |
| origin/main | `caveats?: SchedulingCaveat[]` |

**Taken: BOTH (union).** Five independent optional fields on one interface. No collision.

**Discarded-identifier check: NOTHING DISCARDED.**

### R3 — lines 187-193: `after_work` default window — THE ONE GENUINE VALUE CONFLICT

This hunk is **not** two features. Both sides set the same field to different values:

| side | value |
|---|---|
| HEAD | `end: 19` — "ends where evening begins — no overlap with evening (19–22)" |
| origin/main | `end: 22` |

**Taken: HEAD (`end: 19`).** Settled against ground truth rather than preference:

1. **The canonical source, already merged and agreed by both sides**, is
   `supabase/functions/_shared/scheduling-defaults.ts:164` →
   `after_work: { start: 17, end: 19, days: [1,2,3,4,5] }`, carrying the identical de-overlap comment
   at line 163. `CLAUDE.md` names that file as canonical for window config.
2. **`CLAUDE.md` names 17–22 as the drift, by name**: *"Window config is duplicated 5× and DRIFTED
   (`after_work` 17–22 in the placer vs 17–19 in UI/tools)."* `schedulingRules.ts` is the UI/tools
   side. Taking `end: 22` would have re-introduced the documented drift into the very file the
   drift is measured against, and left `after_work` (17–22) fully overlapping `evening` (19–22).
3. **It is the CONFIG-AUTHORITATIVE-safe direction.** 17–19 is the narrower window: it cannot place
   a task at any hour 17–22 would not have. Under the repo's hard rule, a wider default window is
   the direction that risks placing work where config does not allow; a narrower one cannot.

**Discarded-identifier check: NO IDENTIFIERS discarded** — only the literal `22` and a reworded
comment. `after_work`, `start`, `end`, `days` all still present. Confirmed `end: 19` matches the
canonical file byte-for-byte in semantics.

### R4 — lines 497-516: the `mergeSchedulingConfig` return literal

This is the hunk with real dropped-key risk. The function is a field-by-field READ-TIME NORMALISER
(see the file header) — **any key it forgets is silently dropped**, so taking one side alone would
have wiped the other feature's settings the moment the user touched any unrelated setting. Both
sides' own comments say exactly this about their own key.

| side | what it emitted |
|---|---|
| HEAD | `scoringModel`, `priorityBoost`, conditional spreads for `nudges` / `assignments` |
| origin/main | `caveats: Array.isArray(userConfig.caveats) ? userConfig.caveats : []` |

**Taken: BOTH (union).** `caveats` placed with the plain keys; the two conditional spreads kept
LAST, so the "absent means unset, let the server default apply" contract for `nudges`/`assignments`
is the final word on those namespaces. Key order is otherwise semantically irrelevant — no key
collides with another.

**Discarded-identifier check: NOTHING DISCARDED.**

### File 1 — exhaustive discarded-identifier check (rule 1)

Token-level, not eyeballed. Extracted every `[A-Za-z_][A-Za-z0-9_]*` identifier from
`git show HEAD:` and `git show MERGE_HEAD:` of this file and diffed each against the merged file:

```
in HEAD but NOT in merged        -> (empty)
in origin/main but NOT in merged -> (empty)
```

**Zero identifiers lost from either parent.** (This check is exhaustive for identifiers but blind to
VALUE changes, which is why R3's `22`→`19` is argued separately above from the canonical source.)

**File 1 conflict markers remaining: 0.**

---

## File 2 — `src/components/SchedulingSettings.tsx` (2 hunks)

### U1 — lines 15-26: the import block

| side | types | icons |
|---|---|---|
| HEAD | `SchedulingConfig`, `AssignmentsConfig`, `NudgeConfig` | …, `Scale` |
| origin/main | `SchedulingConfig`, `SchedulingCaveat` | …, `Timer` |

**Taken: BOTH (union)** — all four types and both icons. `Scale` is used by the trait branch's
scoring-model section; `Timer` is the caveats card's header icon. Taking either side alone would
have produced an unresolved-symbol build error in the *other* side's JSX, which is the cheap
failure; the expensive version is the one rule 1 describes, so it was checked anyway below.

**Discarded-identifier check: NOTHING DISCARDED.** Verified `Scale` (3 uses) and `Timer` (3 uses)
both still resolve in the merged file.

### U2 — lines 679-916: TWO COMPLETE `<Card>` SECTIONS (the ~237-line hunk)

This hunk is **not** two edits to one card. Each side added a whole new settings Card, and git
flagged it only because both were inserted at the same line and shared the single closing
`CardContent`/`Card` pair at the end.

| side | card added |
|---|---|
| HEAD | **"Coursework & Nudges"** — nudge delivery hour, due-soon horizon, recently-missed horizon, recent-miss floor, active-course window, only-these-courses, never-these-courses, include-uncoursed (8 controls) |
| origin/main | **"Temporary Caveats"** — per-caveat text editor, match/window summary, clear button, add-caveat button (a full CRUD list) |

**Taken: BOTH (union), as two sibling cards.** HEAD's card is now closed explicitly with its own
`</CardContent></Card>`; the caveats card keeps the original shared closer. Each keeps its own
`CardContent` spacing class (`space-y-6` for Coursework, `space-y-4` for Caveats).

**Why not pick one:** rule 4. Every control in the discarded card would be a setting the owner can
no longer configure — a direct violation of the repo's config-centric rule ("no hardcoded config;
everything user-setting driven"). Nine settings would have vanished from the UI while remaining live
in the config schema and still read by the server — the silent, green-build failure mode.

**Discarded-identifier check: NOTHING DISCARDED.** Exhaustive token-level diff (below), plus a
targeted confirmation that HEAD's card's four helper functions survive the merge and are defined
OUTSIDE the conflict region, so the spliced JSX actually resolves:

| helper | defined at | uses in merged file |
|---|---|---|
| `numberOrUnset` | line 88 | 6 |
| `idsOrUnset` | line 91 | 3 |
| `patchAssignments` | line 96 | 8 |
| `patchNudges` | line 99 | 2 |

### File 2 — exhaustive discarded-identifier check (rule 1)

```
in HEAD but NOT in merged        -> (empty)
in origin/main but NOT in merged -> (empty)
```

**Zero identifiers lost from either parent.**

### File 2 — JSX structural check

Splicing two cards apart is exactly the edit that silently unbalances JSX, so tags were counted:

```
Card            open=12  close=12
CardHeader      open=11  close=11
CardContent     open=12  close=12
CardTitle       open=11  close=11
CardDescription open=11  close=11
```

Card count reconciles: HEAD had 11 cards, origin/main had 10, 9 in common → 9 + 2 (HEAD-only:
Scheduling Strategy, Coursework & Nudges) + 1 (main-only: Temporary Caveats) = **12**. Both union
cards confirmed present in document order between "Category Mappings" and "Keyword Detection Rules".

> **Trap worth recording:** my first two MERGE-UNION comments contained *literal* `</CardContent>`
> and `<Card>` tag text, which poisoned the tag-count greps and produced two false imbalance alarms
> (`open=12 close=13`, then `open=13 close=12`). Both comments were reworded to name the tags in
> prose instead. Harmless to the compiler (JSX comments are block comments), actively misleading to
> any future grep. The real counts were balanced all along.

### Save-path check (does a surviving CONTROL actually persist?)

A control that survives the merge is still worthless if the persist path drops its key — the same
class of silent defect as rule 1. Verified end-to-end:

- `handleSave` (line 60) passes the **whole** `config` object to `saveUserSchedulingConfig`.
- `saveUserSchedulingConfig` (`src/services/schedulingService.ts:256`) destructures only the
  dedicated *columns* and spreads everything else as `...restConfig`, then PATCHes every entry whose
  value is not `undefined`. **It has no key whitelist** — confirmed by grep: `caveats`, `nudges`,
  `assignments`, `scoringModel`, `priorityBoost` appear nowhere in that file, precisely because it
  never needed to know about them.
- `mergeSchedulingConfig` (file 1, hunk R4) now emits all five keys, so both features round-trip.

Both features therefore persist. No follow-up needed in the service layer.

**File 2 conflict markers remaining: 0.**

---

## Definition-of-done results

### 1. Conflict markers — CLEAN

`git grep` over every tracked file (not just the four requested trees — `package.json` and
`.gitignore` were also conflicted and sit outside `src/ supabase/ cloudflare/ .claude/ .github/`):

```
git grep -n -e '^<<<<<<< ' -e '^>>>>>>> ' -e '^=======$' -- . ':!node_modules'   -> NO OUTPUT
```

### 2. `npm run test` — **309 passed / 0 failed** (45 suites, 190 top-level, 1189 ms)

```
# tests 309   # suites 45   # pass 309   # fail 0
# cancelled 0 # skipped 0   # todo 0
```

### 3. `npx tsc --noEmit -p tsconfig.json` — **0 errors, exit 0**

This is the meaningful independent check on file 2: a mis-spliced JSX card or a missed import would
be a hard type error, and there is none.

### 4. `npm run check:symbols` (undef-check) — **FAILS: 12 NEW undefined symbols.**
### NOT caused by this merge, and deliberately NOT silenced. See below.

```
undef-check: 93 file(s) checked, 12 NEW undefined symbol(s), 0 known, 0 not analysable
  supabase/functions/_shared/digest-run.ts:32-38        loadDailyBrief, loadMeetings,
                                                        resolveUserEmail, loadStandup,
                                                        deliver, isFatalConfigError
  supabase/functions/_shared/digest-source-daily.ts:62-68  select, eq, gte, lt, not, maybeSingle
```

**So `npm run check` as a whole exits non-zero.** Ground-truthed rather than assumed:

| question | evidence | answer |
|---|---|---|
| Did I touch these files? | not in the conflict set; status `A` (added by origin/main) | **No** |
| Are they identical to origin/main's? | `diff <(git show MERGE_HEAD:<f>) <f>` → IDENTICAL, both files | **Yes, byte-identical** |
| Do they exist on our branch? | `git cat-file -e HEAD:<f>` → absent | **No, new from origin/main** |
| Did the merge drop a baseline entry that covered them? | `scripts/undef-check.baseline.json` exists on **HEAD only**, ABSENT on origin/main, `"known": {}` — empty on both | **No — there was never an entry** |
| Are they real defects? | **No — false positives.** All 12 are TypeScript **interface method signatures**, i.e. declarations, not call sites: `export interface DigestRunDeps { loadDailyBrief(...): ... }` and `export interface DigestQuery { select(...): DigestQuery; eq(...) ... }`. `undef-check.mjs` reads `name(args)` inside an interface body as a call. | **No** |

**Why this surfaced now:** the `undef-check` guard is **ours-only**. origin/main's `package.json`
has no `check:symbols` and no `check` script at all (its `test` is a different runner). The
package.json conflict was resolved — before I started — in favour of our richer script set, which is
right. So origin/main's digest files have simply never been seen by this checker before; the merge
is the first time our guard and their code occupy one tree. That is the guard working as designed
(it fails on anything NEW), meeting code it mis-parses.

**Why I did not make it green.** Three reasons, all rules:
1. *Do not silence a flag to make an issue disappear — a firing trap is signal.* Adding baseline
   entries would be exactly that, and the baseline's own `_why` states its entries are for "a
   genuine latent defect, **not a false positive**". Parking false positives there misuses the
   mechanism and, by its `_rules`, would then fail the run forever once someone fixes the parser.
2. `scripts/undef-check.mjs` **decides a gate**, so a change to it is Tier 1 — it needs its own AC
   pass and verifier, not a drive-by edit inside a merge commit.
3. It is outside the scope I was given (finish the merge). Fixing a checker's TS-interface parsing
   is a separate, reviewable change.

**Recommended follow-up for the parent session (not done here):** teach `undef-check.mjs` to skip
`interface`/`type` bodies when collecting call sites. That is a one-place parser fix covering all 12
and any future interface, versus 12 baseline entries that document nothing true.

---

## Summary — what was taken, per hunk

| # | File | Hunk | Taken | Identifiers discarded |
|---|---|---|---|---|
| R1 | schedulingRules.ts | interface declarations | **BOTH** — NudgeConfig + AssignmentsConfig + SchedulingCaveat | none |
| R2 | schedulingRules.ts | `SchedulingConfig` fields | **BOTH** — scoringModel/priorityBoost/nudges/assignments + caveats | none |
| R3 | schedulingRules.ts | `after_work` window | **HEAD (`end: 19`)** — genuine value conflict, settled by the canonical already-merged `scheduling-defaults.ts:164`; 17–22 is the drift CLAUDE.md names, and 19 is the narrower/config-safe direction | none (only the literal `22`) |
| R4 | schedulingRules.ts | normaliser return literal | **BOTH** — all five keys emitted, or the other feature's settings are wiped on next save | none |
| U1 | SchedulingSettings.tsx | imports | **BOTH** — all 4 types, both icons (`Scale`, `Timer`) | none |
| U2 | SchedulingSettings.tsx | two whole Cards (~237 lines) | **BOTH** — "Coursework & Nudges" and "Temporary Caveats" as sibling cards | none |

**Token-level discarded-identifier check across both files: ZERO identifiers lost from either
parent.** R3 is the only place any *value* from either side was not carried, and it is argued from
the canonical source above.

## Things I was NOT fully confident about

1. **R3 is the only judgement call in the merge.** It is the one hunk where a side was genuinely
   dropped rather than unioned, because it is the one hunk that is not two features. I took
   `end: 19` on canonical-source evidence and the config-authoritative safe direction, but if
   origin/main's `end: 22` was a deliberate recent widening rather than the old drift, this is the
   line to revisit. Everything else in this merge is additive and carries no such risk.
2. **The undef-check failure is reported, not resolved** — see §4. `npm run check` is red on a
   pre-existing checker limitation. I judged fixing a gate-deciding script to be out of scope for a
   merge; if the parent session disagrees, the fix is a parser change, not baseline entries.
3. **The two union Cards were not verified in a running browser.** `tsc` proves they compile and the
   tag counts prove the JSX is balanced, but nobody has seen them render side by side. Mechanism
   verified statically; NOT user-confirmed live.

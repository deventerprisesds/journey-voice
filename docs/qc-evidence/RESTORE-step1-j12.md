# RESTORE step 1 — J12: deploy guard + test/CI infrastructure

WHAT: the record of porting J12 (the Supabase deploy guard, the `checks.yml` CI, the test collector, the undefined-symbol guard, the committed-vs-deployed drift check, and the fix for two always-red workflows) from the parked branch onto `main`, as step 1 of the owner-approved surgical restore. It also records one deliberate behaviour change: a blank manual deploy now fails instead of deploying every function.
WHY: owner 2026-10-26: "Option a surgical restore approved". Earlier owner instruction (2026-10-20): "The j1-j15 updates should be surgical so that if there is anything that was added in the oct 15 overwrite that will be lost, i know what the difference will be before and after". The spec is `docs/qc-evidence/RESTORE-J1-J15-diff.md` (branch `claude_schedule-sanity-timing`), section "J12", Summary rows 4, 8 and 9, and "Recommended apply order" step 1.
SUPERSEDES: nothing.
SUPERSEDED-BY: nothing — current.
EVIDENCE: branch `claude_restore-j12-deploy-guard` (base `origin/main` `aeef3d3`); source refs `origin/claude/huddle-journey-integration-xokgv1` (`150c027`) and `origin/claude/mobile-widget-web-bridge-debug-nsishi` (`d1059fe`). For every path ported here the two branches hold identical content (O: `git diff --stat xokgv1 nsishi -- <paths>` is empty). The command outputs are quoted below.

Labels: **O** = observed in this pass. **I** = inferred.

---

## 1. Method (surgical, not a folder copy)

3-way merge per path, with base = `0459770` (the last point the branch took main in), ours = `origin/main`, theirs = the branch.

| path | did main change it since `0459770`? (O) | 3-way result |
|---|---|---|
| `.github/workflows/checks.yml` | absent on main | branch content (new file) |
| `.github/workflows/check-edge-deploy-drift.yml` | absent on main | branch content (new file) |
| `.github/workflows/read-widget-debug-log.yml` | no (blob at main == blob at `0459770`) | branch content (`60e7565`) |
| `.github/workflows/test-priorities-widget-query.yml` | no | branch content (`60e7565`) |
| `scripts/widget-debug-log-read.py`, `widget-error-log-read.py`, `widget-priorities-queries.py` | absent on main | branch content (`60e7565`) |
| `scripts/run-tests.mjs` | absent on main | branch content (`8fe3dc4`, `4ed84fc`, `32eb8c5`) |
| `scripts/undef-check.mjs`, `undef-check.test.mjs` | absent on main | branch content (`06b0eba`, `8fe3dc4`, `8fc7f73`, `4ed84fc`) |
| `scripts/undef-check.baseline.json` | absent on main | **`8fe3dc4`'s version, NOT the branch tip** — see conflict C3 |
| `scripts/check-edge-deploy-drift.mjs` + `.test.mjs` | absent on main | branch content (`3f2e786`) |
| `scripts/assert-ref-contains-main.test.sh` | absent on main | branch content, mode 755 (`93abcb6`, `d131dca`) |
| `scripts/assert-ref-contains-main.sh` | **yes** — added by main `93aede9` (#55), identical text, mode 644 | text unchanged; mode → 755 |
| `package.json` | **yes** — main `93aede9` (#55) added `cloudflare/src/*.test.ts` to `test` | conflict C1, resolved to the branch side |
| `.github/workflows/deploy-supabase-functions.yml` | no | **only the guard hunk** (`93abcb6` + `c2d9b4a`) — see C2 |
| `.github/workflows/parse-edge-functions.yml` | yes, main-only (`e919cb7`) | **untouched; kept** |

No path under `supabase/functions/` is touched (verified in section 4).

## 2. Commits ported (O)

| commit | what | ported how |
|---|---|---|
| `93abcb6` | deploy guard: refuse a ref that does not contain `origin/main` | guard step in `deploy-supabase-functions.yml`; `assert-ref-contains-main.test.sh`; `checks.yml` "Deploy-staleness guard" step |
| `d131dca` | guard test emits a failure-only token (mutation-provable) | in `assert-ref-contains-main.test.sh` |
| `c2d9b4a` | fixes `fetch-depth` having landed inside the guard's `run:` block | the corrected step layout (guard step is the branch-tip shape) |
| `8fe3dc4` (paths only) | `run-tests.mjs`, `undef-check.mjs` rewrite, baseline, `checks.yml`, `package.json` scripts | ONLY those 5 paths. The rest of this WIP commit (scheduler, nexus, nudges, SchedulingSettings, docs/impl) belongs to J5/J7/J8 and is NOT ported |
| `8fc7f73` | symbols guard now covers the Worker | in `undef-check.mjs` |
| `4ed84fc` | a TypeScript type body is not a call site | in `undef-check.mjs`, `run-tests.mjs`, `undef-check.test.mjs` |
| `32eb8c5` (`run-tests.mjs` only) | collector gathers `cloudflare/src` | in `run-tests.mjs`. Its `deploy-cloudflare.yml` part is notify-lane and NOT ported |
| `06b0eba` (`undef-check.mjs` only) | first version of the symbol guard | superseded inside the same file by `8fe3dc4`. Its workflow/function parts are J7 and NOT ported |
| `3f2e786` | `check-edge-deploy-drift` committed-but-not-deployed detector | workflow + script + test |
| `60e7565` | the two unparseable workflows fixed (logic moved into 3 python scripts) | all 5 paths |

**Not ported, on purpose** (all touch `deploy-supabase-functions.yml` on the branch but are NOT J12 step 1):

| commit | hunk on the branch | why left out |
|---|---|---|
| `06b0eba` | "Sync UAT_BYPASS_TOKEN to Supabase edge secrets" step | J7 (Nexus writes). Belongs to apply-order step 7, which the spec says must confirm `UAT_BYPASS_TOKEN` first |
| `30eb9a2` | "Point UNIFIED_WEBHOOK_URL at journey's own /notify" step | September notify lane, excluded by spec §0.1. It would overwrite a live edge secret on every deploy; main's Oct 15 notify work is what is live |
| `f13d7f7` | "Deploy all functions" loops one function at a time with a summary; "Deploy changed functions" continue-then-summarise | Commit belongs to J4 ("repair out-of-window AI slots… fix deploy all-mode"); not in the step-1 list. Recorded as a candidate for the J4 step |
| shadow-run harness (`6024b0b`, `9e2c98a`, `05c2019`, `7b4fcaf`, `2bbf52b`) | `scripts/shadow-run/*` | in the J12 section but NOT in "Recommended apply order" step 1 |

## 3. Conflicts and how each was resolved

**C1 — `package.json`, 1 hunk (O).** main: `"test": "node --experimental-strip-types --test src/utils/*.test.ts supabase/functions/_shared/*.test.ts cloudflare/src/*.test.ts"`. Branch: `"test": "node scripts/run-tests.mjs"` + `check:symbols` + `check`. Resolved to the **branch side**, as the spec says. Nothing of main's is lost: the collector's `ROOTS` include `cloudflare/src` with `min: 1` (O: `scripts/run-tests.mjs`), and the run below collects both `cloudflare/src/notify.test.ts` and `cloudflare/src/slack-events.test.ts`. After the edit, `git diff <nsishi> -- package.json` is empty (O).

**C2 — `deploy-supabase-functions.yml` (not a textual conflict; a scope choice + one comment merge).** Main has not changed this file since `0459770`, so a whole-file 3-way take would have brought ALL the branch's hunks (UAT token, UNIFIED_WEBHOOK_URL, the per-function loops). Only the guard hunk was applied; its `+`/`-` lines were first applied byte-for-byte and checked identical to the branch's (O: `diff` of the two hunks' changed lines → `GUARD-HUNK-IDENTICAL-TO-BRANCH`). Then one comment was merged by hand: the branch's `fetch-depth` comment had REPLACED main's, and it says the change detection uses `git diff HEAD~1 HEAD`, which is false (the step diffs `github.event.before..github.sha`). The comment now keeps BOTH reasons for `fetch-depth: 0` (main's event.before reason and the guard's shallow-clone reason). Comment-only; `fetch-depth` stays `0`.

**C3 — `scripts/undef-check.baseline.json`.** The branch tip has `"known": {}` because the branch also fixed the defect (`37024bb`, which edits `supabase/functions/send-chat-message/index.ts`). Main does not have that fix, and this PR must touch nothing under `supabase/functions/`. With the tip baseline the guard failed on main (O, first run):

```
undef-check: 85 file(s) checked, 1 NEW undefined symbol(s), 0 known, 0 not analysable
  supabase/functions/send-chat-message/index.ts:498  buildCallContext
```

Resolved by taking the baseline from `8fe3dc4` (the branch's own earlier version), which lists exactly this symbol as a known latent defect. Line 498 on main is still the call (O: `sed -n 494,500p`). When `37024bb` lands in a later step, the ratchet will FAIL with "STALE BASELINE" until the entry is deleted — that is the designed behaviour.

**C4 — `scripts/assert-ref-contains-main.sh`, add/add.** Text identical (same blob `dfca956` on both sides, O). Only the mode differs; set to 755 (`git update-index --chmod=+x`).

## 4. Test outputs (O, this tree, node v22.22.0)

- `node scripts/run-tests.mjs` → rc 0. `collected 25 test file(s)`; `# tests 291 # pass 291 # fail 0`. For comparison, main's old glob on the same tree: `# tests 286 # pass 286 # fail 0` over 23 files. The collector runs those same 23 plus `scripts/check-edge-deploy-drift.test.mjs` and `scripts/undef-check.test.mjs`.
- `node scripts/undef-check.mjs --all` → rc 0: `85 file(s) checked, 0 NEW undefined symbol(s), 1 known, 0 not analysable` (the known one is C3).
- `bash scripts/assert-ref-contains-main.test.sh` → rc 0, `assert-ref-contains-main: 7 passed, 0 failed` (AC-D1..AC-D7).
- Deploy guard against real refs (full clone, `is-shallow-repository` = false):
  - `assert-ref-contains-main.sh origin/main origin/claude/huddle-journey-integration-xokgv1` → **rc 1**, `::error::REFUSING TO DEPLOY -- … does not contain origin/main.` / `is missing 64 commit(s) that are on origin/main` (lists `aeef3d3`, `990b60d`, `4fadd05`, `c11b1a2`, …).
  - `assert-ref-contains-main.sh origin/main origin/main` → **rc 0**, `✅ origin/main (aeef3d3) contains origin/main (aeef3d3)`.
  - `assert-ref-contains-main.sh origin/main HEAD` (this branch) → rc 0.

- Mutation proof of the ported guard test (`mutate.sh`, anchor and replacement in files): the guard's predicate `if git merge-base --is-ancestor "$BASE_SHA" "$HEAD_SHA"; then` reversed to `"$HEAD_SHA" "$BASE_SHA"` → **`FIRED: 'stale branch -> exit 1' failed with the defect reinstated. The guard is real.`**, then `restored: scripts/assert-ref-contains-main.sh matches HEAD`. (A first attempt with the name `FAILED:AC-D1` came back UNDETERMINED, because that string is the failure token, not the check name. Re-run with the check's own name.)
- The symbols guard's ratchet showed it can fail on this tree: with the branch-tip baseline it exited 1 on `buildCallContext` (C3).
- YAML: every changed workflow parses with `yaml.safe_load` (`check-edge-deploy-drift.yml`, `checks.yml`, `deploy-supabase-functions.yml`, `read-widget-debug-log.yml`, `test-priorities-widget-query.yml`). main's copies of the two widget workflows do NOT parse: `could not find expected ':'` at line 18 / line 19. `actionlint` is not installed here.

## 5. The blank-dispatch fix (new in this PR, not from the branch)

`deploy-supabase-functions.yml` `workflow_dispatch` input `function_name` said blank = "changed functions". That was false. Evidence: the step's own `run:` block, pulled out with `yaml.safe_load` and run under `bash -e` with the `${{ }}` expressions filled in for each case:

| case | `origin/main` (O) | this branch (O) |
|---|---|---|
| dispatch, blank | rc 0, `mode=all`, "Push range unavailable … deploying all" | **rc 1**, `::error::function_name is blank -- name a function or pass all. …` |
| dispatch, `all` | `mode=all` | `mode=all` (unchanged) |
| dispatch, `execute-tool` | `mode=single fn=execute-tool` | same (unchanged) |
| push, empty `before` | `mode=all` | same (unchanged) |
| push `990b60d^..990b60d` (#60) | — | `mode=list fns=notification-delivery`, which matches the real run `39287074527`'s log |
| push `c11b1a2^..c11b1a2` (#59) | — | `mode=all` ("_shared changed"), unchanged |

The change is 3 lines plus the help text. A blank dispatch still runs the steps before this one (the deploy guard, CLI setup, token resolution, and the `JOURNEY_PROXY_TOKEN` re-sync from the same org secret, which writes the same value), then fails before any deploy.

Also changed: `checks.yml`'s push trigger gains `'claude_**'` next to the branch's `'claude/**'`. The branch predates the `claude_` prefix rule (2026-09-25). Without it, pushes to current-style branches get no Checks run until a PR exists.

## 6. Diff against main (O)

`git diff --stat origin/main...HEAD`: 18 files, +1556 / −196. `git diff --name-only origin/main...HEAD | grep '^supabase/'` returns nothing. `deploy-supabase-functions.yml` is triggered only by `paths: supabase/functions/**`, so **merging this PR deploys no edge function** (I, from the trigger block; high confidence). On merge, the only workflow that runs is `checks.yml` (push to main).

## 7. What will no longer be in place

Every behaviour of `main` that this PR changes:

1. **A blank manual "Deploy Supabase Functions" no longer redeploys every function.** It now fails with "function_name is blank -- name a function or pass all". To deploy everything you now type `all`. (Intended; section 5.)
2. **A Supabase deploy from a ref that does not contain `origin/main` no longer goes through.** It is refused before any secret sync or deploy, and the refusal lists the main commits it would have reverted. Push-triggered deploys from `main` always pass (a ref contains itself). In practice this affects only `workflow_dispatch` runs on a stale branch.
3. **`npm test` is no longer the inline glob** `node --experimental-strip-types --test src/utils/*.test.ts supabase/functions/_shared/*.test.ts cloudflare/src/*.test.ts`. It is now `node scripts/run-tests.mjs`. That runs the same 23 files (286 tests), plus `scripts/check-edge-deploy-drift.test.mjs` and `scripts/undef-check.test.mjs` (291 total). It exits 2 if any root collects fewer files than its floor, where the glob passed on zero matches. Nothing main ran is dropped.
4. **The two widget workflows no longer fail on every push.** On main they could not be parsed at all, so they never ran and showed as red, zero-duration runs. They now parse and stay `workflow_dispatch`-only. Their inline queries moved into `scripts/widget-*.py`. No working behaviour is lost, because the old files never ran.
5. **New, not replacing anything:** `checks.yml` (tests + symbols guard + deploy-guard test) on pushes to `main`, `claude/**`, `claude_**` and on every PR. It can now turn a PR red. `check-edge-deploy-drift.yml` runs after every "Deploy Supabase Functions" run, read-only against `api.supabase.com` with the existing `SUPERBASE_ACCESS_TOKEN` secret, and can turn red if live ≠ committed. It has **not** been run live from here (no token in this session). Its first real run will be after the next deploy.
6. Cosmetic: `scripts/assert-ref-contains-main.sh` mode 644 → 755 (both callers use `bash <path>`, so this changes nothing). The `fetch-depth: 0` comment now gives both reasons.

**Kept, untouched:** `parse-edge-functions.yml`; `deploy-cloudflare.yml`; every file under `supabase/`, `src/`, `cloudflare/`; the deploy workflow's secret syncs, change detection and deploy steps (apart from item 1).

**Not brought over from the branch's copy of `deploy-supabase-functions.yml`** (so their absence is not a regression; they were never on main): the `UAT_BYPASS_TOKEN` sync (J7), the `UNIFIED_WEBHOOK_URL` cutover (notify lane, excluded), and the per-function deploy loop with a summary (J4, `f13d7f7`).

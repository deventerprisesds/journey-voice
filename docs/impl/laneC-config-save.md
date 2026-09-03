# Lane C — config save path: stop destroying keys without making deletion impossible

<!--
WHAT:       Implementation record for AC-6a..6e (config merge/save) plus verifier finding F2
            (no UI for the newer scheduling knobs), scoped to src/config/schedulingRules.ts,
            src/services/schedulingService.ts and src/components/SchedulingSettings.tsx.
WHY:        docs/verify/nudge-delivery-loop1.md §F1 — a Settings save permanently deletes
            config namespaces the client merge does not know about. Measured below to be
            broader than F1 states: three of the four save call sites wipe far more than F1
            describes, and two of them fire on every save today (not latent).
SUPERSEDES: nothing.
SUPERSEDED-BY: nothing — current.
EVIDENCE:   file reads quoted inline (line numbers at branch
            claude/huddle-journey-integration-xokgv1, head 611ceca); docs/ac/nudge-and-ordering-ACs.md
            AC-6; docs/verify/nudge-delivery-loop1.md F1/F2; .claude/accuracy-log.md.
-->

Lane C owns only: `src/config/schedulingRules.ts`, `src/services/schedulingService.ts`,
`src/components/SchedulingSettings.tsx`. Nothing under `supabase/functions/`, `scripts/` or
`package.json` is touched — three sibling agents own those.

**Verification status of everything below: PARSE-VERIFIED ONLY.** This repo cannot be built or
typechecked here — `npm ci`/`bun install` fail against Lovable's private registry (403), there is
no `node_modules`, and the root `tsconfig.json` is a solution file (`references`, no `include`) so
`tsc -p .` compiles zero files and its silence is not evidence. `tsc` is not cited anywhere in
this document. See "Verification" at the bottom for what was actually run.

---

## 1. Ground truth, re-verified before changing anything

The brief said the diagnosis was already made and told me to verify it rather than re-derive it.
I read all four sites. The diagnosis is **confirmed**, and it is **narrower than the real defect**.

### 1.1 Confirmed: the normaliser is field-by-field, deliberately

`mergeSchedulingConfig` (`src/config/schedulingRules.ts:271-309`) builds an explicit object
literal. It never spreads `userConfig`. Each field carries defaulting semantics a spread cannot
express — this is not accidental terseness:

| field | semantic in the code | what a plain spread would do |
|---|---|---|
| `timezone` (`:288`) | `??` null-coalesce | equivalent (this one is spreadable) |
| `timeWindows`/`workingHours`/`workloadBalance` (`:289-291`) | shallow merge **over** defaults | replace wholesale, losing unsaved sub-keys |
| `contextRules` (`:296-299`) | **two-level** merge — `keywords` and `priorityMappings` merged separately | replace the nested object wholesale |
| `categoryMappings` (`:275-295`) | merge over defaults **plus** a string→array migration of `defaultTimeWindow` | skip the migration |
| `customAIInstructions` (`:301-303`) | blank/whitespace means "use the default" | keep the blank string |
| `scoringModel` (`:307`) | only an explicit `'priority-rank'` opts out; anything else → `'composite'` | pass an invalid value through |

**Interpretation (confidence: high; source = the file, read in full).** In its declared role this
function is a **read-time normaliser and migrator**: possibly-partial, possibly-legacy stored
config in → complete, valid, current-shape config out. **Dropping unknown keys is legitimate in
that role.** A normaliser is entitled to emit only the shape it knows about.

### 1.2 Confirmed: the normaliser's output is used as the SAVE payload

`schedulingService.ts:127` loads through `mergeSchedulingConfig(...)`; the UI holds that object as
its state; `schedulingService.ts:193-197` then writes:

```ts
const updateData: any = { user_id: userId, config: restConfig as any, updated_at: ... };
```

A **whole-object replace**. So the read-time normaliser is pressed into service as a write-time
serialiser, and every key it does not emit is deleted on the next save. That is the bug, and it
is on the **save path**, not in the merge.

### 1.3 NEW — the defect is materially worse than F1 records, and two variants are NOT latent

F1 says "a Settings save deletes `config.nudges` and `config.assignments`", and notes it is
currently latent because both are `null` live (G6). That is true of **one** of the four callers.
The whole-object replace is applied to whatever the caller passes, and three of the four callers
pass a **partial**. Traced by reading each call site:

| caller | payload it passes | `restConfig` after the destructure at `:176-191` | what the DB `config` column becomes |
|---|---|---|---|
| `SchedulingSettings.tsx:55` | the full merged config | all known scheduling keys | known keys only — `dedup`, `nudges`, `assignments`, `priorityBoost` **deleted** (this is F1) |
| `VoiceAssistantSettings.tsx:272` | `{core_instructions, customAIInstructions, realtime_extensions, assistant_extensions, auto_greeting_timeout, tts_provider, elevenlabs_voice_id, openai_voice, custom_voices, scheduled_calls, recurring_calls_enabled, phone_call_mode}` | `{customAIInstructions}` **only** — every other key is a dedicated column and is destructured out | `{"customAIInstructions": "…"}` — **`timeWindows`, `workingHours`, `workloadBalance`, `categoryMappings`, `contextRules`, `scoringModel` all deleted** |
| `CeremonySettings.tsx:71` | `{ceremony_schedule}` | `{}` | **`{}` — the entire scheduling config is wiped** |
| `schedulingService.ts:123` | `{timezone}` (auto-detect first-save) | `{}` | **`{}` — same total wipe**, on a path the user never triggers knowingly |

**Observation vs interpretation.** OBSERVED: the four payloads, the destructure list, and the
unconditional `config: restConfig`. INTERPRETED (high confidence, from PostgREST upsert
semantics): rows 2–4 replace the stored JSONB with the value shown. Not observed: whether these
have already fired against the live row — **this is the cheap live probe in §5, and it should be
run before the change lands**, because if it has fired, the live config is already a remnant and
"preserve what is stored" preserves the remnant rather than the user's intent.

This matters for the design: a fix aimed only at "keys the normaliser doesn't know about" would
leave rows 2–4 wiping known keys just the same. **The fix has to be about the WRITE being a
replace, not about the merge's key coverage.**

### 1.4 Confirmed: `priorityBoost` is a fourth casualty, by a different mechanism

`priorityBoost` is declared in the interface (`schedulingRules.ts:68`) and in
`DEFAULT_SCHEDULING_CONFIG` (`:242`), and is **absent from the merge's return literal**
(`:287-308`). So it cannot round-trip at all: nothing ever emits it, so nothing can ever save it.
This is not the same failure as §1.2 — it is a *declared* field the normaliser silently omits.
Treated as a class, not a special case, in §2.4.

---

## 2. The design

### 2.1 The distinction the fix rests on

| function | role | may it drop a key? |
|---|---|---|
| `mergeSchedulingConfig` (schedulingRules.ts) | **read-time normaliser/migrator** — produce a complete, valid, current-shape config for the app to use | **Yes.** Emitting only the known shape is its job. |
| `saveUserSchedulingConfig` (schedulingService.ts) | **write-time persister** — apply the user's edits to what is stored | **No, never implicitly.** It receives an edit, not a world. |

The previous code had the persister trusting the normaliser's output as a complete world. Both
functions were individually reasonable; the composition was not.

### 2.2 What was rejected, and why

- **`{...DEFAULT_SCHEDULING_CONFIG, ...userConfig}` in the merge.** Rejected. It breaks four of
  the six semantics in §1.1 (skips the string→array migration, replaces `contextRules` wholesale,
  keeps a blank `customAIInstructions`, passes an invalid `scoringModel` through) — this is
  exactly the mutation AC-6a requires to FAIL. It also does not fix the actual defect: with a
  spread in the merge, `CeremonySettings` passing `{ceremony_schedule}` still writes `config: {}`
  and still wipes everything (§1.3 row 3). The merge is not where the data is lost.
- **`{...DEFAULT, ...userConfig, timeWindows: {...}, contextRules: {...}, …}`** — a spread with
  the field-by-field logic bolted back on. Rejected for the same reason plus the AC-6a
  adversarial note: it is the easy path, and it still leaves the write a whole-object replace.
- **Naming `dedup`/`nudges`/`assignments`/`priorityBoost` in the merge literal.** Rejected as the
  *mechanism* — it fixes four symptoms and the fifth namespace anyone adds dies identically. (Two
  of those four are separately given a UI and therefore a legitimate place in the normaliser —
  see §2.5 — but that is a consequence of them becoming user-facing, not the fix.)

### 2.3 What was done: patch semantics on the write

`saveUserSchedulingConfig` no longer treats its argument as the whole config. It:

1. destructures out the dedicated-column fields exactly as before (unchanged);
2. if the remaining payload has any `config` keys **or** a deliberate removal was requested,
   reads the **stored raw JSONB** — not the normalised object — for that user;
3. applies only the top-level keys present in the payload over the stored object;
4. applies `options.removeConfigKeys` as explicit deletions;
5. writes the result.

Consequences, stated as the properties they are:

- **A key absent from the payload is preserved.** Accidental loss is now structurally impossible,
  for *any* key, known or not, because absence is no longer an instruction to anything.
- **A key present in the payload replaces its stored value** at the top level. The UI edits whole
  sections (`timeWindows`, `categoryMappings`, …) so top-level replacement is the right grain; a
  deep merge here would make it impossible to remove one category or one keyword.
- **A key whose payload value is literally `undefined` is treated as "not mentioned", not as a
  deletion.** Without this, `JSON.stringify` dropping `undefined` would silently reintroduce
  deletion-by-absence through a side door. `null` is a real stored value and is written as one.
- **If the read of the stored config fails, the save FAILS.** It does not fall back to writing the
  patch alone — that fallback would be the original wipe, reintroduced as an error path. Fail
  closed, log, return `false`.

### 2.4 Purposeful removal stays expressible — by a mechanism that is not "absence"

AC-6d requires that a deliberate clear be persistable and **distinguishable** from an accidental
omission. A third argument does that in the type system rather than by convention:

```ts
saveUserSchedulingConfig(userId, patch, { removeConfigKeys: ['dedup'] })
```

- **Deliberate removal** = the key is *named* in `removeConfigKeys`. It is deleted.
- **Accidental omission** = the key is simply not in `patch`. It is preserved.
- **Deliberate clear of a value the UI owns** = the key is in `patch` with the cleared value
  (`''`, `[]`, `null`). It is written as that value.
- **Deliberate section reset** = the key is in `patch` set to that section's defaults. Other
  sections and unknown keys are untouched. `SchedulingSettings`' existing "Reset to Defaults"
  button (`:74-81`, sets local state to `DEFAULT_SCHEDULING_CONFIG` and then saves) now means
  exactly this and nothing more — before this change it also silently deleted every unknown key.

These three are now different code paths, which is the AC's actual requirement: *"A design where
1 and 3 are indistinguishable fails this AC."*

**AC-6d.1 asks explicitly whether the `customAIInstructions` "blank means default" rule stays.
It stays, and the consequence must be stated rather than left implicit.** Clearing that field now
genuinely *persists* — the save writes `""` to the database and it is still `""` on re-query
(asserted in §4.3). But the normaliser turns a blank value back into the default prompt on read
(`schedulingRules.ts`, the `customAIInstructions` branch), so **the user cannot end up with an
empty AI prompt** — the app will show and use the default. That is deliberate: an empty prompt
would silently degrade every scheduling decision, and this is a field where "blank" is far more
likely to mean "I want the standard behaviour" than "I want no instructions at all." The
distinction worth being precise about is that *the storage layer no longer lies about it*: the
cleared value is what is stored, and only the read layer substitutes. Changing that rule is a
product decision, not a bug fix, and was not taken unilaterally here.

**Known limitation, stated rather than hidden:** step 2→5 is a client-side read-modify-write and
is therefore not atomic. Two saves racing from two tabs can lose the earlier one's keys. The
durable fix is a server-side JSONB `||` merge (an RPC or a `config = config || $1` update), which
lives in a migration — **out of Lane C's scope**. Recorded here as a follow-on rather than
silently accepted. For a single-user app the window is small, but it is real.

### 2.5 `priorityBoost` — fixed as a class, not as a special case

The defect class is: *a field declared in the interface and in `DEFAULT_SCHEDULING_CONFIG` but
omitted from the normaliser's return literal is silently unpersistable, and nothing detects it.*
Adding one line for `priorityBoost` fixes today's instance and leaves the class open — the next
field someone adds fails identically and just as quietly.

Two changes, together:

1. `priorityBoost` is emitted with its own defaulting semantic (`=== false` opts out; absent or
   anything else → `true`), mirroring how `scoringModel` is handled. Not a spread.
2. **`assertNormaliserCoversDefaults()`** — a dev-time structural check that every key of
   `DEFAULT_SCHEDULING_CONFIG` appears in the normaliser's output, run once per module load
   outside production. The *next* omitted field is caught at the moment it is introduced, by a
   check rather than by a reviewer remembering. This is the "graduate a recurring mistake into a
   guard, not more prose" rule applied to the merge itself.

Note the check deliberately asserts `keys(DEFAULT) ⊆ keys(output)` and not equality: namespaces
that must NOT be given invented client-side defaults (§2.6) are legitimately absent from
`DEFAULT_SCHEDULING_CONFIG` while still being emitted when the user has set them.

### 2.6 `nudges` and `assignments` become known — carefully

Verifier finding F2 requires these knobs to be reachable from the UI, so they must be typed and
normalised. **They are pass-through-with-validation and get NO invented defaults**: when the user
has not set a value, the key is omitted entirely so the server's own default applies. This
matters — the AC-3 adversarial note shows that materialising `activeCourseIds: []` where the
server expects "absent" changes which courses are ingested. The normaliser drops values that are
out of range or the wrong type rather than substituting a client-side guess.

`dedup` remains deliberately **unknown** to the client: it is server-read only
(`_shared/task-dedup.ts:19`, `execute-tool/index.ts:882,1354`), has no UI, and there is no reason
for the client to hold an opinion about it. It is now preserved by the write path, which is the
correct answer for a namespace the client should not model. **That `dedup` needs no client change
to survive is the evidence that the mechanism, not the key list, was fixed.**

### 2.7 AC-6c — the permanent probe key

AC-6c requires a key *no source file references* to survive the round trip, because naming the
four known namespaces would pass a naive test while leaving the mechanism broken.

`CONFIG_ROUNDTRIP_PROBE_KEY = '__ac6_probe'` is exported from `schedulingRules.ts` **for the
regression script to import**, and is deliberately:

- **not** a member of `SchedulingConfig`;
- **not** referenced by `mergeSchedulingConfig` (the normaliser still drops it on read, which is
  correct — see §2.1);
- **not** referenced by `saveUserSchedulingConfig` (the write preserves it *because it preserves
  everything unmentioned*, not because it knows the name).

Exporting the string does not make the key "known" to the mechanism under test: neither function
has a branch on it. If anyone ever adds one, the probe stops testing what it claims and that is a
review-visible change in a file this document names.

**The committed round-trip script AC-6c asks for lives under `scripts/`, which Lane C does not
own.** It is specified in §5.2 for whoever owns that lane; the constant is exported so the script
does not have to hardcode it.

---

## 3. Changes made

### 3.1 `src/config/schedulingRules.ts`

- Header comment stating which function is the read-time normaliser and why the save must not use
  its output (AC-6e), pointing at `schedulingService.ts`.
- `NudgeConfig` and `AssignmentsConfig` interfaces; `nudges?` and `assignments?` added to
  `SchedulingConfig`.
- `priorityBoost` emitted from `mergeSchedulingConfig` with an explicit defaulting rule.
- `nudges`/`assignments` normalised pass-through, omitted when unset (§2.6).
- `assertNormaliserCoversDefaults()` dev-time guard (§2.5).
- `CONFIG_ROUNDTRIP_PROBE_KEY` exported (§2.7).
- No spread of `userConfig` anywhere. The six semantics of §1.1 are untouched.

### 3.2 `src/services/schedulingService.ts`

- Header comment stating this file holds the write-time persister, that
  `mergeSchedulingConfig`'s output is a normalised *view* and never a save payload, and why
  (AC-6e).
- `saveUserSchedulingConfig` takes a third `options` argument and applies patch semantics
  (§2.3/2.4).
- `loadStoredSchedulingConfigRaw` — reads the untouched JSONB so the patch is applied to what is
  really stored, not to a normalised copy.
- Fail-closed on a failed read.

### 3.3 `src/components/SchedulingSettings.tsx`

New "Coursework & Nudges" card, following the existing card/Label/Input/Select patterns already
in the file (the `maxPerDay`/`maxPerDayWeekend` numeric inputs at `:575-627` and the Scheduling
Strategy `Select` at `:154-187`), plus a `priorityBoost` control in the existing Scheduling
Strategy card. Controls added (all previously unreachable — F2):

| control | config key | previously |
|---|---|---|
| Priority-flag boost | `priorityBoost` | declared + defaulted, **no UI, unpersistable** |
| Nudge delivery hour | `nudges.deliverAtLocalHour` | no UI |
| "Due soon" horizon (days) | `assignments.soonDays` | no UI |
| "Recently missed" horizon (days) | `assignments.recentOverdueDays` | no UI |
| Active-course era (days) | `assignments.activeCourseEraDays` | no UI |
| Only these courses (ids) | `assignments.activeCourseIds` | no UI |
| Never these courses (ids) | `assignments.excludeCourseIds` | no UI |
| Include assignments with no course | `assignments.includeUncoursed` | no UI |

Blank input = "use the system default", which is written as *key omitted*, not as `0`/`[]` — the
distinction §2.6 exists to preserve.

**One contract mismatch found while wiring this, for whoever owns `_shared/nexus.ts` /
`nightly-assignment-sync`:** `ActiveCourseOptions` names the field `eraDays`
(`_shared/nexus.ts:184`) while the doc comment at `:196` says the user config key is
`config.assignments.activeCourseEraDays`. The UI writes `activeCourseEraDays` (the documented
config contract); **something server-side must map `config.assignments.activeCourseEraDays` →
`opts.eraDays`**, and today the only caller has the course set pinned to a literal, so no mapping
exists. Flagged, not fixed — that file is not Lane C's.

---

### 3.4 `src/config/schedulingRules.test.ts` (new)

Lane D landed `scripts/run-tests.mjs` as the `npm test` collector (it discovers every
`*.test.ts` under `src` and `supabase/functions` with a per-root floor). AC-9's whole point is
that a test which is committed but never collected is invisible, and that tests left in `/tmp`
are lost — so the merge suite is committed here rather than only in `docs/`. **Judgement call,
flagged:** this is a fourth file, one past the three Lane C was scoped to. It is additive, new
(no sibling owns it), and raises a floor that is a minimum — but it is worth naming rather than
slipping in.

The SAVE-path suite could not be ported to this runner: it must mock the aliased
`@/integrations/supabase/client` import, which node's test runner cannot do without
`--experimental-test-module-mocks`. It is preserved at `docs/impl/laneC-tests/save-check.test.ts`
and runs green under bun (§4.3). Wiring it into `npm test` needs either that node flag or a bun
test root — a `package.json`/`scripts/` change, which is not Lane C's to make.

---

## 4. Verification

**Frontend changes are PARSE-VERIFIED ONLY** in the sense that no production build and no
typecheck was possible (§ constraint note at the top); `tsc` is not cited anywhere. However the
two modules under change were **executed**, and against the real modules, not copies — see below.
Nothing here is a live/browser confirmation: **no rendering of `SchedulingSettings.tsx` was
observed**, and the DB round trip was exercised against a fake client, not Supabase.

### 4.1 Parse check — all three owned files

```
$ bun build <file> --target=browser --external '*'
src/config/schedulingRules.ts        PARSE OK
src/services/schedulingService.ts    PARSE OK
src/components/SchedulingSettings.tsx PARSE OK
```

### 4.2 `mergeSchedulingConfig` — executed, real module

`schedulingRules.ts` has **zero imports**, so bun executes it directly. This is the module the app
loads, not a re-implementation.

`node --experimental-strip-types --test src/config/schedulingRules.test.ts` → **13 pass, 0 fail**.
The same assertions plus a few extra run under bun via `docs/impl/laneC-tests/merge-check.ts` →
**19 pass, 0 fail**.

`npm test` **collects it** — the run lists `- src/config/schedulingRules.test.ts` among the
discovered files (AC-9b: committed is necessary and insufficient). Whole-repo result at the time
of writing: `# tests 51 / # pass 50 / # fail 1`. **The one failure is not Lane C's**: it is
`supabase/functions/_shared/assignment-cadence.test.ts:112` — *"AC-2c: an offset-less timestamp is
read as UTC, so TZ cannot move the inferred day"*, a sibling lane's in-flight AC-2 work. All 13
Lane C tests pass.

### 4.3 `saveUserSchedulingConfig` — executed, REAL service module

The service imports `@/integrations/supabase/client`, and `@supabase/supabase-js` is not installed
here, so the **client** module is `mock.module`'d before the service is imported. The function
under test is the genuine one — deliberately, because "I tested the function I had just written
instead of the path the data takes" is the exact failure in `.claude/accuracy-log.md`. The fake
client is a one-row store with PostgREST-ish upsert semantics (only provided columns are written).

`bun test docs/impl/laneC-tests/save-check.test.ts` → **12 pass, 0 fail**:

| test | AC |
|---|---|
| an unknown key the code never heard of survives a save | **AC-6c** |
| `dedup`/`nudges`/`assignments`/`priorityBoost` survive an unrelated save | AC-6b |
| a `CeremonySettings`-shaped `{ceremony_schedule}` save leaves `config` untouched (and does not write the column at all) | §1.3 row 3 |
| a `{timezone}`-only save leaves `config` untouched | §1.3 row 4 |
| a `VoiceAssistantSettings`-shaped save writes only `customAIInstructions` | §1.3 row 2 |
| a section absent from the payload is preserved, never deleted | AC-6d.3 |
| clearing a UI-owned value persists the cleared value | AC-6d.1 |
| `removeConfigKeys` deletes, and takes nothing else with it | AC-6d |
| resetting one section leaves other sections and the probe intact | AC-6d.2 |
| an explicit `undefined` does not delete the stored key | §2.3 |
| a failed read FAILS the save instead of replacing (nothing written at all) | §2.3 fail-closed |
| no existing row: the patch becomes the config | first-save |

**To re-run it** (it is not wired into `npm test` — see §3.4): copy it to the repo root and
`bun test ./save-check.test.ts`, because the `@/*` alias resolves relative to the repo's
`tsconfig.json`.

### 4.4 Mutation proofs — three run, three FIRED, none INERT, none NOT-APPLIED

Every anchor was extracted **by line range from the file itself**, never typed from memory, and
each was asserted to match exactly once before being applied.

**`scripts/mutate.sh` could not be used**, for a stated reason rather than convenience: it refuses
a file with uncommitted changes (so that a failed restore is not mistaken for your own edit), and
Lane C must leave its changes in the working tree unpushed and uncommitted. Two substitutes were
used instead, both preserving its three-outcome discipline (FIRED / INERT / NOT-APPLIED):
mutations M1–M2 were applied to a **copy** so the real file was never touched at all, and M3
(which must run through the aliased import) was applied to the real file with a **sha256-asserted
restore**, printed after every run.

| # | mutation | must fail | outcome |
|---|---|---|---|
| **M1** | delete the `priorityBoost:` line from the return literal — the original defect | the 3 priorityBoost tests | **FIRED** — 4 fail: all three round-trip tests **plus** `keys(DEFAULT) subset of keys(output)`, which printed `missing=priorityBoost`. The structural guard catches the CLASS, not just this instance. |
| **M2** | replace the return literal with `{...DEFAULT_SCHEDULING_CONFIG, ...userConfig}` — the spread AC-6a forbids | AC-6a tests 2, 3, 4, 5 | **FIRED** — 9 fail, including all four the AC names (2 by throwing, because `contextRules` is replaced wholesale and `priorityMappings` no longer exists) plus test 1 and the `nudges` validation tests. |
| **M3** | restore `updateData.config = restConfig as any` — the whole-object replace | the round-trip tests | **FIRED** — **10 of 12 fail**, including AC-6c (the probe is deleted) and all three §1.3 partial-save wipes. Restore verified: `restore OK (sha matches)`. |

**M3's two survivors are reported rather than glossed**, since a mutation that leaves a test green
means that test does not prove what the mutation breaks: *"clearing a UI-owned value persists"*
and *"no existing row: the patch becomes the config"* pass under the old code too — correctly,
because the old code also handled those two cases. They are coverage of behaviour that was never
broken, not evidence of the fix.

**A finding from M2 worth recording**, because it cuts against the easy path: under the spread,
the *probe-key* test also fails — the spread makes the normaliser pass unknown keys through, which
would make AC-6b/6c pass at the read layer while leaving the write a whole-object replace. That is
precisely the "fix that satisfies the test while leaving the architecture unchanged" AC-6b's
adversarial note warns about, and it is why the round-trip assertion lives against
`saveUserSchedulingConfig` (§4.3) rather than against the merge.

### 4.5 What was NOT verified — stated plainly

- **No build, no typecheck.** `npm ci`/`bun install` fail (private registry, 403); root
  `tsconfig.json` is a solution file so `tsc -p .` compiles zero files and proves nothing. Type
  errors in `SchedulingSettings.tsx` would not have been caught here.
- **`SchedulingSettings.tsx` was never rendered.** No browser, no Playwright, no screenshot. The
  new card is parse-valid and follows the file's existing patterns; that it *renders* and that the
  controls *write the values described* is UNCONFIRMED.
- **No live database was touched.** The round trip ran against a fake client. AC-6b/6c/6d demand a
  **live** seed → save → re-query; that is §5.2 and has not been done.
- Nothing was deployed, committed or pushed. The changes are in the working tree.

## 5. For the parent agent to run

### 5.1 Cheap live probe — run this BEFORE trusting the "latent" framing

No DB tool is available in this lane, so this is described rather than run. Against Supabase
project `wwxgajrtmslzklnyplah`:

```sql
select jsonb_object_keys(config) as key
from public.user_scheduling_prefs
where user_id = 'a3378f93-d655-4913-b2fa-ca5b1d8020f1'
order by 1;
```

Interpretation, decided in advance so the answer cannot be rationalised after the fact:

- keys include `timeWindows`, `categoryMappings`, `contextRules`, `workingHours`,
  `workloadBalance` → the §1.3 rows 2–4 wipes have **not** fired recently; the config is intact
  and the change is purely protective.
- keys are only `customAIInstructions` (or the object is `{}`) → a wipe **has already fired**.
  The stored config is a remnant, and preserving it preserves the damage: the user should be told
  their scheduling settings need re-entering before, not after, the next save.

G6 (recorded in the AC file on 2026-09-03) lists six keys including all five above, so the
expected answer is the first. Re-running it is still worth one query because it is the only thing
that distinguishes "protect an intact config" from "protect a remnant", and it costs seconds.

### 5.2 The AC-6c/6d round-trip script (owner: whoever owns `scripts/`)

Not written here — `scripts/` is another lane. Specification:

1. Seed, by SQL, for a test user: `dedup`, `nudges`, `assignments`, `priorityBoost`, and
   `__ac6_probe = {"v":1}` (import `CONFIG_ROUNDTRIP_PROBE_KEY` rather than retyping it).
2. Call `saveUserSchedulingConfig(userId, <a full config with one unrelated field changed>)` —
   the exact call `SchedulingSettings.handleSave` makes.
3. Assert all five are byte-identical afterwards. **`__ac6_probe` is the one that matters**;
   the other four can pass for the wrong reason.
4. Assert the *partial* callers too — `saveUserSchedulingConfig(userId, {ceremony_schedule})` and
   `saveUserSchedulingConfig(userId, {timezone})` — leave `config` **entirely** unchanged. These
   are §1.3 rows 3–4 and they are the wipes that fire today.
5. Assert `saveUserSchedulingConfig(userId, {}, {removeConfigKeys:['__ac6_probe']})` **does**
   delete it — proving deletion is still expressible (AC-6d).
6. **Mutation proof (AC-6b):** restore `config: restConfig` in `schedulingService.ts`; steps 3 and
   4 MUST fail. Use `scripts/mutate.sh` with anchors supplied from files, never as shell
   arguments. A `NOT-APPLIED` result means the guard is UNPROVEN, not passed.

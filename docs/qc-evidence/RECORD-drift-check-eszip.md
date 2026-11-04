# RECORD — edge-deploy drift check: read ESZIP bundles, compare SOURCE to SOURCE

<!--
WHAT:       Why scripts/check-edge-deploy-drift.mjs reported "checked 51, drifted 51" with nothing
            out of sync, what was changed, and the evidence that the fixed check is accurate.
WHY:        A guard that fires on every run gets ignored or switched off. This one did that from the
            first run after it landed on main (PR #64).
SUPERSEDES: nothing (first record for this check).
SUPERSEDED-BY: nothing -- current.
EVIDENCE:   runs 40414573682 (job 121893535258, the false alarm), 40432331168 (fixture capture),
            40432653868 (fixed check against live, branch claude_drift-check-eszip @ 6dcbe13).
-->

## The false alarm

Run 40414573682, job 121893535258 (after the deploy on 2026-10-26) printed `DRIFT` for every function,
then `checked 51, drifted 51, unreachable 0`, then exited 1. Every "deployed" line started like this:

```
deployed: ESZIP2.3\0\0\0\x04\0\0\x01\0\0\0!T\0\0\0\x1fsend-push-notification/index.ts\0...
```

`GET /v1/projects/{ref}/functions/{slug}/body` returns an **ESZIP2.3 bundle**, not the source file.
The script decoded those bytes as UTF-8 text and diffed them line by line against `index.ts`. They
never match, so the check reported every function as drifted. Both deploys on that commit had
succeeded.

## What I found before writing code (observed)

| # | Observation | Source |
|---|---|---|
| 1 | The format is ESZIP v2 as written by `EszipV2::into_bytes`: magic, options (v2.2+), a modules header (specifier + offsets), an npm section (v2.1+), then the sources and source-maps sections. All integers are u32 big-endian. | eszip crate `src/v2.rs`, crates.io `eszip-0.109.0` |
| 2 | The live bundle for `ping` is ESZIP2.3 with checksum `none`. It holds 4 modules: `functions/ping/index.ts`, `functions/_shared/config.ts`, `---SUPABASE-ESZIP-VERSION-ESZIP---` (opaque, `2.0`) and `---EDGE-RUNTIME-METADATA---` (opaque). The parse leaves zero trailing bytes. | `scripts/fixtures/eszip/ping.eszip`: 17110 bytes, sha256 `aa292a1eb5e71addced392426d937364d57dc7afde35e77ec8b59a04d5297529`, committed byte-exact by run 40432331168 |
| 3 | **A module's stored `source` is TRANSPILED JS, not the .ts.** `ping/index.ts`: 2187 bytes stored vs 2210 in the tree. Types are stripped, and line 13 joins `*/` to the import. Comparing that to the tree would cry wolf forever. | the fixture, decoded |
| 4 | **The original TypeScript is in each module's source map `sourcesContent[0]`.** It equals the tree byte for byte for both `ping/index.ts` and `_shared/config.ts`. That matches the crate: `from_graph` sets `inline_sources = true`. | the fixture vs `supabase/functions/` @ origin/main 578b28c |
| 5 | The Supabase MCP `get_edge_function` (read-only) returned the same TS for `ping` and `send-slack-notification`, listing only local files. | MCP output, 2026-10-27 |
| 6 | Specifier roots vary between functions: `send-slack-notification/index.ts` vs `functions/twilio-voice-handler/index.ts`. Matching must therefore be by suffix, not by a fixed prefix. | job 121893535258 log |

## Route taken: parse the bundle (the preferred route)

I chose the preferred route: no CLI, no new dependency. `scripts/eszip.mjs` is a dependency-free
reader for ESZIP_V2, 2.1, 2.2 and 2.3. It also unwraps an optional `EZBR` (brotli) wrapper. The
checker now works like this:

1. It fetches `/body` as **bytes**, not text.
2. If the body is an ESZIP, it parses it. It ignores remote dependencies (`https:`, `npm:`, `jsr:`) and
   Supabase's `---…---` metadata entries. It finds the entry module ending in `<slug>/index.ts`; the
   part before that suffix is the bundle's root.
3. For the entry module and **every local import** under that root (`_shared/*`), it takes the original
   source from the module's source map, then compares it to `supabase/functions/<rel>`. It ignores
   trailing whitespace, as before.
4. It assigns one result per function:

   | Result | When | Exit code |
   |---|---|---|
   | `DRIFT` | any module differs, or a bundled local module is missing from the tree | 1 |
   | `UNVERIFIABLE` | the bundle did not parse, a module has no source map or `sourcesContent`, there is no entry module (or more than one), a local module falls outside the root, a sha256 does not match, or the body is binary but not an ESZIP | 2 |
   | `ok` | everything matched | 0 |

   Unverifiable functions get a `!!!` line on stderr naming the count, and they are **never** counted
   as matched.
5. A plain-text body (the old API shape) is still diffed directly, so D1–D5 are unchanged.

The exit-code contract stays the script's own: **1 = drift, 2 = could not check, 0 = everything
matched.** With a working parser, an unverifiable bundle is an anomaly in that specific bundle. It is
not the normal state, so reporting it as "not a pass" does not cry wolf.

Route not taken, recorded for whoever comes next: the MCP sends `Accept: multipart/form-data` to the
same `/body` endpoint, and the API then unpacks the bundle server-side into files. That is a viable
alternative if the bundle format ever changes in a way this reader cannot follow.

## Results

**Live** (run 40432653868, `workflow_dispatch` on `claude_drift-check-eszip` @ 6dcbe13, every function):

```
checked 51, matched 51, drifted 0, unverifiable 0, unreachable 0
Every checked function matches its deployed source.
```

Module counts are printed per function, e.g. `notification-delivery (ESZIP2.3, 9 local module(s)
compared)`, `send-digests … 12`, `twilio-realtime-bridge … 10`. So the `_shared` imports really are
being compared.

**Tests** (`scripts/check-edge-deploy-drift.test.mjs`, collected by `npm test`: 309/309 pass):

| Case | Asserts |
|---|---|
| D1–D5 | unchanged plain-text cases |
| E1, E1b | the REAL live `ping` bundle against matching tree copies (`fixtures/eszip/ping.*.ts.txt`): exit 0, 2 modules compared |
| E2 | the real bundle with one line changed in the entry module: DRIFT, exit 1 |
| E3 | the real bundle with one line changed in `_shared/config.ts`: DRIFT, exit 1 |
| E4, E4b | the real bundle truncated to 200 bytes: exit 2, printed `UNVERIFIABLE`, `matched 0`, no "matches" line |
| E5, E5b | a module with no source map: exit 2 with a reason. It is never compared as transpiled source. |
| E6 | no entry module for the slug: exit 2 |
| E7 | a binary body that is not an ESZIP: exit 2 |
| E8 | ESZIP2.1 with sha256, with a remote dependency present: matches, exit 0 |
| E9 | a sha256 mismatch: exit 2 |
| E10 | a bundled local module absent from the tree: DRIFT, exit 1 |
| E11 | an `EZBR` + brotli copy of the real bundle: unwrapped, exit 0 |

**Mutation proofs** (`mutate.sh`, anchors in files, baseline + restore asserted): **11/11 FIRED**,
and every restore matched HEAD.

| # | Defect reinstated | Fired |
|---|---|---|
| M1 | compare the transpiled `source` instead of `sourcesContent` | E1 |
| M2 | a parse error returns `ok` | E4 |
| M3 | a missing source map counts as matched | E5 |
| M4 | a missing entry module returns `ok` | E6 |
| M5 | a non-ESZIP binary body is text-diffed | E7 |
| M6 | (eszip.mjs) sha256 verification removed | E9 |
| M7 | only the entry module is compared, not the imports | E3 |
| M8 | a bundled module missing from the tree counts as matched | E10 |
| M9 | unverifiable does not force exit 2 | E4 |
| M10 | remote deps are not skipped | E8 |
| M11 | (eszip.mjs) EZBR unwrap removed | E11 |

## What will no longer be in place

- **The text diff of the raw `/body` is gone for bundle bodies.** "deployed N lines" is no longer
  printed for them; drift output names the module (`_shared/config.ts:`) and its first differing
  line.
- **Remote dependencies are not compared.** A changed `https://deno.land/...` import shows up as
  drift in the importing module's source line, but the bundled remote code itself is not
  re-checked against anything.
- **The transpiled JS that actually runs is not verified.** The check proves that the source the
  bundle was BUILT FROM equals the tree. It does not re-transpile to confirm the emitted JS; that
  would need a Deno/SWC toolchain on the runner.
- **xxhash3 checksums are not verified** (node has no built-in for them). sha256 is verified; the
  live bundles use checksum `none`.
- **The EZBR path has not been seen live.** It is covered by E11 against a wrapper built locally,
  not against an API response.
- **The temporary fixture-capture step** (commits b441e35 and 0e319ac: a `capture` input and
  `contents: write`) was reverted in 6dcbe13. The workflow file is byte-identical to `origin/main`.

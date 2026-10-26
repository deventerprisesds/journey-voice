# VERIFY — restore-j13-alarm-actions, loop 1 (journey-voice PR #65, head dca92b1)

WHAT: independent verification of PR #65 (J13 signed alarm action token + J14 FCM dead-token prune).
WHY: security-relevant — the PR mints tokens that let a phone change a task with no login.
SUPERSEDES: nothing. SUPERSEDED-BY: nothing — current.
EVIDENCE: own clone at head dca92b1; probes under docs/qc-evidence/probes/; Supabase MCP read-only.

Verifier started 2026-10-26 19:38 UTC, budget 50 min. Labels: O = observed, I = inferred.

| # | claim | result | evidence |
|---|---|---|---|
| C1 | only the stated files change; port == `git diff 0459770 nsishi` | **CONFIRMED** | see C1 |
| C2 | token security (scoping, constant-time, expiry, forgery, key, logging, allow-list) | **CONFIRMED for the token + alarm-action code**, with **one REFUTED end-to-end property (C2-SEC1)** | see C2 |

## C1 — scope of the port (O)
- `git diff --name-only origin/main...HEAD` = exactly 7 paths: the record, `config.toml`, `_shared/action-token{,.test}.ts`, `alarm-action/index.ts`, `manage-push-subscription/index.ts`, `send-push-notification/index.ts`.
- `notification-delivery` and `notification-scheduler`: `git diff --stat origin/main...HEAD -- <both>` is empty.
- `git log 0459770..origin/main -- <6 paths>` is empty (main never touched them since the split).
- The 5 code files: blob ids at HEAD equal blob ids at `origin/claude/mobile-widget-web-bridge-debug-nsishi` (d1059fe) — byte-identical (acb76d8, 2286c6e, 348853e, ed9fc91, 0823e8e). `diff <(git diff origin/main HEAD -- <5>) <(git diff 0459770 nsishi -- <5>)` → identical.
- `config.toml` differs from the nsishi diff ONLY by commit 2's seven `verify_jwt=false` pins; the `[functions.alarm-action]` hunk is the nsishi hunk verbatim.
- Note: branch is 3 commits behind origin/main (migrations + a record only, no `supabase/functions/**`), so no merge interaction with these files.

## C2 — token security (O, real code run under node with stubbed remote imports)
Probe: `docs/qc-evidence/probes/alarm-action.probe.test.ts` + `harness.ts`. The harness loads the UNCHANGED
`alarm-action/index.ts`, swaps only the `std serve` / `supabase-js` / `web-push` imports for in-memory stubs, and fails
loudly if any remote import is left unstubbed. Run: `node --experimental-strip-types --test docs/qc-evidence/probes/alarm-action.probe.test.ts` → **15/15 pass**.

| sub-claim | result | evidence |
|---|---|---|
| token for task A / user X acts on task B or user Y? | **CONFIRMED safe** | (X,A) DONE changes A only; read+write filters are `[eq id A, eq user_id X]`. A validly-signed (X,B) where B is Y's → `matched 0`, no update/delete, Y's `scheduled_notifications` untouched (DONE/BACKLOG/PARK/DOING). (Y,A) → matched 0. `taskId`/`userId` in the request body are ignored. |
| scoping guard is real | **CONFIRMED** | `mutate.sh` dropping the READ's `.eq("user_id", …)` → **FIRED** (C2a cross-user test fails), restored = HEAD. Dropping the WRITE's `.eq("user_id", …)` → no FIRED: equivalent, because the read is already scoped and no write happens without it (defence in depth, not proven separately). |
| constant-time compare | **CONFIRMED (by reading)** | MAC check is `crypto.subtle.verify("HMAC", key, sig, msg)`; no JS `===`/loop compare on MAC bytes. Timing not measured (I: WebCrypto HMAC verify is constant-time). |
| expiry enforced | **CONFIRMED** | set_status rejects tokens 1s, 1h, 6d, 29d past `exp` → 401 `expired`, no write; >30d → 401 `bad_token`. |
| unsigned / malformed passes? | **CONFIRMED rejected** | 22 cases → 401, no DB write, for set_status AND trace: forged body + real sig, empty sig, 2-part, flipped sig byte, `v2.`/`V1.` prefix, 4 parts, non-b64 sig, sig made with the RAW service key, wrong key, truncated, leading space, `''`, `null`, `undefined`, number, object, array. |
| key derivation | **CONFIRMED** | MAC = HMAC(HMAC(serviceKey, "journey/alarm-action/v1"), "v1.<body>"), recomputed independently; ≠ HMAC(serviceKey, msg). Key cache is keyed on the root secret (switching secret does not reuse the old key). Empty service key → mint rejects, verify of a well-formed token rejects, handler → 500 with no write. |
| token in logs / web-push payload | **CONFIRMED absent** (alarm-action side) | Console capture across 5 request shapes + all response bodies + all `activity_log` rows: token signature never present. send-push side: see C3 probe. |
| status allow-list | **CONFIRMED** | Only DOING/DONE/BACKLOG/PARK (case-insensitive) reach the DB. 19 bad values (`IN_PROGRESS`, `TODO`, `COMPLETED`, `' DONE'`, `'DONE\n'`, `__proto__`, `constructor`, null, number, bool, object…) → 400 `bad_status` with **zero** DB calls (checked before token verify). `mutate.sh` replacing the `STATUSES.has` gate with `false` → **FIRED**. Live enum (read-only SELECT): `task_status` = `{BACKLOG,TODO,DOING,DONE,BLOCKED,…}` — DOING/DONE/BACKLOG all exist; there is **no** `IN_PROGRESS` value, so the brief's "IN_PROGRESS" is DOING here. PARK → BACKLOG + tag union `['x','parking-lot']`, schedule cleared, only A's queued notifications deleted. |

Observations (facts, not defects): (a) `status` is `String()`-coerced, so `["done"]` is accepted as DONE — still an allowed value. (b) signature ENCODING is malleable: `token+"="`, `token+" "`, `token+"\n"` verify (atob is forgiving) — same claims and MAC, no new authority. (c) the `trace` op accepts tokens up to 30 days past expiry and writes up to 20 × 500-char caller-chosen lines to `activity_log` per call, unlimited calls — a holder of an old token can fill the owner's `activity_log`.

### C2-SEC1 — REFUTED: "the token authorises exactly one task for one user" holds only if the push reaches the user's OWN device, and who receives the push is unauthenticated
O (read): `send-push-notification` and `manage-push-subscription` are both `verify_jwt = false` (config.toml L48/L90), and neither checks a caller identity in code — `userId` comes from the request body. `manage-push-subscription` `subscribe_fcm` upserts `{user_id: <body.userId>, endpoint: "fcm:<userId>", fcm_token: <body.fcmToken>}` `onConflict user_id,endpoint`, i.e. it **overwrites** the user's journey FCM token.
I (chain, not executed live): anyone holding the APK (to get a valid FCM token for this Firebase project) and the victim's user uuid can (1) POST `subscribe_fcm` with their own token and the victim's `userId`, then (2) receive every alarm push the scheduler sends that user. **Before this PR** that leaks titles/bodies. **With this PR** each of those pushes also carries a 7-day `actionToken` for that task, so the attacker can mark tasks DONE / BACKLOG / PARK, clear their schedule and delete their queued notifications with no login. They can also call `send-push-notification` themselves with `{userId, data:{taskId}}` to mint a token for any of that user's task ids (send-push does not check the task belongs to `userId`; alarm-action then scopes it correctly). The weakness (unauthenticated registration) is PRE-EXISTING; J13 raises it from read to write. The new J14 dedupe adds a second unauthenticated primitive: anyone who knows a device's FCM token can POST `subscribe_fcm` with any `userId` and delete every OTHER user's row for that token.
Severity (I): medium for a single-user estate (it needs the APK + the owner's uuid), but this is the exact property the PR describes as its security boundary. Not fixed here, per the brief.

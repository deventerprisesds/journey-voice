# RESTORE step 3 — security follow-up to VERIFY C2-SEC1 (who may receive / mint alarm action tokens)

WHAT: the record of closing (or handing to the owner) VERIFY-restore-j13-alarm-actions-1's C2-SEC1 on PR #65: who calls `manage-push-subscription` and `send-push-notification`, with which credential, and what was enforced as a result.
WHY: C2-SEC1 REFUTED "an action token authorises exactly one task for one user". Both functions are `verify_jwt = false` and take `userId` from the body, so (1) anyone can register a device under the owner's id and receive 7-day tokens that change the owner's tasks, (2) anyone can POST send-push with any `{userId, data:{taskId}}` and get a token minted for a task that is not that user's, (3) J14's "one device, one owner" dedupe lets anyone who knows a device token delete other users' rows for it.
SUPERSEDES: nothing. SUPERSEDED-BY: nothing — current.
EVIDENCE: `docs/qc-evidence/VERIFY-restore-j13-alarm-actions-1.md` (C2-SEC1); probes `docs/qc-evidence/probes/push-auth.probe.test.ts`; unit tests `supabase/functions/_shared/push-auth.test.ts`; android-bridge-template @ `f41e814`; supabase-js 2.39.3 and 2.110.0 sources read from `npm pack` tarballs.

Labels: **O** = observed (read or run in this pass). **I** = inferred.

---

## STEP 1 — who calls what, with which credential (written before any code change)

### How `supabase.functions.invoke` authenticates (O, read from the library source)
- supabase-js **2.39.3** (the edge functions' esm.sh pin): `dist/main/SupabaseClient.js:132` builds the FunctionsClient with `customFetch: this.fetch`; `dist/main/lib/fetch.js:64-70` sets `Authorization: Bearer <session access_token ?? supabaseKey>` unless the caller set one; `SupabaseClient.js:174-179` returns `session.access_token ?? null`. A server client created with `SUPABASE_SERVICE_ROLE_KEY` and never signed in therefore sends **`Bearer <service-role key>`**.
- supabase-js **2.110.0** (the web app's lockfile version): `src/SupabaseClient.ts:404` same `customFetch: this.fetch`; `src/SupabaseClient.ts:570-578` returns `session?.access_token ?? this.supabaseKey`. A signed-in browser therefore sends **`Bearer <the user's access token (JWT)>`**; a signed-out one sends the anon/publishable key.

### (a) Callers of `manage-push-subscription`
| caller | file:line | action | Authorization it sends |
|---|---|---|---|
| web app, Android WebView shell | `src/utils/bridgeFcmRegistration.ts:41` (started from `src/App.tsx:62` with `session.user.id`) | `subscribe_fcm`, `source:'web'` | user JWT (O: only runs with a session; I: supabase-js attaches it) |
| web app, Android WebView | `src/hooks/useNotifications.tsx:82` (guarded by `if (!user …) return` at :77) | `subscribe_fcm` | user JWT |
| web app, browser web-push | `src/hooks/useNotifications.tsx:408` / `:432` | `subscribe` / `unsubscribe` | user JWT |
| **Android app, native** | **android-bridge-template `app/src/main/java/com/bridgetemplate/util/FcmRegistrar.kt:33-34`** — `apikey: <anon>` and **`Authorization: Bearer $anon`** (the ANON key, read from `EncryptedPrefs "supabase_anon_key"` at :24). Called from `BridgeFirebaseService.kt:187` (`onNewToken`) and `MainActivity.kt:123` | `subscribe_fcm`, `source:'native'` | **anon key — NOT a user JWT** |
| (related) Huddle APK | registers through `execute-tool` `register_push_token` (`supabase/functions/execute-tool/index.ts:405-410`, `:2040`), not this function | — | — |

**Answer (a): NO.** The web callers send the signed-in user's JWT, but the Android native registrar sends the anon key. The native path exists precisely for a token Firebase rotates while the app is closed (`FcmRegistrar.kt:11-14`: "exactly what silenced full-screen alarms 2026-10-05 → 10-08").

### (b) Callers of `send-push-notification`
| caller | file:line | credential |
|---|---|---|
| notification-scheduler (alarms) | `supabase/functions/notification-scheduler/index.ts:526` via client from `:54-57` | service-role key |
| notification-delivery (×2) | `supabase/functions/notification-delivery/index.ts:237`, `:919` via client from `:97-100` | service-role key |
| send-unified-notification | `supabase/functions/send-unified-notification/index.ts:916` via client from `:560-563` | service-role key |
| send-chat-message | `supabase/functions/send-chat-message/index.ts:644-647` raw `fetch`, `Authorization: Bearer ${supabaseServiceKey}` (`:15` = `SUPABASE_SERVICE_ROLE_KEY`) | service-role key |
| execute-tool `send_push` (Huddle reminders/alarms) | `supabase/functions/execute-tool/index.ts:2015` via client from `:2864` (`SUPABASE_SERVICE_KEY` = `SUPABASE_SERVICE_ROLE_KEY`, `:41`) | service-role key |
| browser: KanbanBoard | `src/components/KanbanBoard.tsx:719` (taskId `''`) | user JWT |
| browser: NotificationSettings test push | `src/components/NotificationSettings.tsx:702` (no taskId) | user JWT |
| browser: EnhancedTaskGridView | `src/components/EnhancedTaskGridView.tsx:544` (taskId `''`) | user JWT |
| browser: SmartTaskInput | `src/components/SmartTaskInput.tsx:148` (**taskId = new task**) | user JWT |
| browser: TaskCreationModal | `src/components/TaskCreationModal.tsx:805` (taskIds list, no taskId) | user JWT |
| browser: useChatAssistant | `src/hooks/useChatAssistant.ts:620` (no taskId) | user JWT |
| browser: taskScheduling | `src/utils/taskScheduling.ts:166` (**taskId = saved task**) | user JWT |
| browser: RealtimeVoiceAssistant | `src/utils/RealtimeVoiceAssistant.ts:1709` (**taskId = task**) | user JWT |

No other repo calls it directly (O: grep of `/home/user/*` — Huddle goes through execute-tool `send_push`; android-bridge-template only reads the token it mints). No migration / pg_net / Cloudflare caller (O: grep of `supabase/migrations`, `cloudflare/` — `cloudflare/src/notify.ts:370` is a comment).

**Answer (b): mixed.** Six server callers use the service-role key; eight browser callers use the signed-in user's JWT (three of them pass a real `taskId`). No caller was found that sends the bare anon key, but nothing stops one.

### What that decides (per the brief)
- Registration (fix 2): a caller (Android native) does NOT send a user JWT → **do not enforce**; write up and leave to the owner (section "Left for the owner").
- send-push (fix 3): not every caller is server-side → **do not gate the whole push**; gate only token MINTING (section "STEP 2").

---

## STEP 2 — what was changed

### Fix 1 — mint only for the push user's own task (commit `49d5fb2`)
- `supabase/functions/_shared/push-auth.ts` `taskBelongsTo(client, taskId, userId)`: one read, `tasks.select('user_id').eq('id', taskId).maybeSingle()` with send-push's existing service client; true only when the row exists and `user_id === userId`. Missing row, read error, thrown error, or a non-string input → false.
- `send-push-notification/index.ts`: when `data.taskId` is a uuid, the token is minted only if `taskBelongsTo` is true. Otherwise the push is **still delivered**, without `actionToken` / `actionUrl`, and logs `action token not minted: task does not belong to userId` (no token, no ids).
- Tests (O): `supabase/functions/send-push-notification/index.auth.test.ts` runs the REAL handler through the probe harness, with a real RSA key for send-push's own FCM JWT signing and `fetch` stubbed: own task → token verifies as exactly (X, A), not in the web payload, not logged; another user's task → delivered 2/2, no token; missing task → no token; no/blank/non-uuid taskId → no token. `supabase/functions/_shared/push-auth.test.ts`: 2 unit tests. `npm test` **305/305** (299 before + 6).
- Mutations (O, `mutate.sh`, anchors in files under the scratchpad):
  - handler: `if (!(await taskBelongsTo(…)))` → `if (false)` → **FIRED** ("another user's task"), restored = HEAD, tree clean.
  - module: the `user_id === userId` return → `return true;` → **FIRED** ("true only for the owning user"), restored = HEAD, tree clean.

### Fix 3 — mint only for a server caller or the push's own signed-in user (commit `5755ccb`)
(b) found browser callers (user JWT) as well as server callers (service-role key), so per the brief the **push itself is not gated**. Only token MINTING is.
- `_shared/push-auth.ts` `mintCaller(req, client, userId, serviceKey)`:
  - `service_role` when the `Authorization: Bearer` value equals `SUPABASE_SERVICE_ROLE_KEY`. The comparison is constant-time: both sides are SHA-256'd, then XOR-compared over 32 bytes, so neither the first differing byte nor the key length shows in timing.
  - `owner_jwt` when `auth.getUser(bearer)` resolves to exactly `userId`.
  - `none` otherwise: no bearer, the anon key, another user's JWT, a forged/expired JWT, the key sent only in `apikey`, a `getUser` error, or an unset service key.
- `send-push-notification/index.ts`: `mintCaller === 'none'` → no token, and the log line `action token not minted: caller is neither service role nor this user`. The caller check runs before the task read, so an unauthorised caller costs no DB read. Then fix 1's ownership check runs. A token needs **both**.
- What it breaks (I, from the caller table): **nothing found.** All six server callers send the service-role key. The three browser callers that pass a real `taskId` (`SmartTaskInput.tsx:148`, `taskScheduling.ts:166`, `RealtimeVoiceAssistant.ts:1709`) send the signed-in user's JWT for that user's own `userId`, so they still get tokens. One assumption: hosted `SUPABASE_SERVICE_ROLE_KEY` is the same value in every function's environment. Callers and callee read the same env var, so I expect it is; this is not checked live. If it ever differed, server pushes would still be delivered, just without buttons. That is the same fallback as before J13.
- Tests (O): 4 more handler tests in `index.auth.test.ts` and 3 more unit tests in `push-auth.test.ts`:
  - owner JWT → token for (X, A);
  - 7 bad caller shapes → delivered 2/2, no token, no task read;
  - another user's valid JWT → no token;
  - owner JWT plus another user's task → no token.

  `npm test` **312/312**.
- Mutations (O, `mutate.sh`), all **FIRED**, each restored = HEAD with a clean tree:
  - handler gate → `if (false)` ("caller = anon key");
  - drop `id === userId` from the owner-JWT check, caught by the handler test ("ANOTHER user's valid JWT") and the unit test ("mintCaller");
  - `constantTimeEqual` → `return true`, caught by the handler test ("caller = anon key") and the unit test ("constantTimeEqual").

### Fix 2 — registration: NOT enforced (left for the owner) — SUPERSEDED 2026-10-27 by "Fix 2 — Option A" below
(a) is **NO**. android-bridge-template `FcmRegistrar.kt:33-34` registers with `Authorization: Bearer <anon key>`. If `subscribe_fcm` required a user JWT matching `body.userId`, this caller would get **401**. It is the native path that re-registers a token Firebase rotates while the app is closed (`onNewToken`, `BridgeFirebaseService.kt:187`) and on every launch (`MainActivity.kt:123`). The cost would be that a rotated token is unknown to the server until the WebView next opens signed in, and alarms in between go to a dead token. That is the 2026-10-05 → 10-08 silent-alarm shape `FcmRegistrar.kt:11-14` was written to stop. So neither `subscribe_fcm` nor the J14 cross-user dedupe was changed, and `verify_jwt` stays false.
Pinned by `docs/qc-evidence/probes/push-auth.probe.test.ts` (O: 2 pass + 1 todo):
- own-user subscribe (anon key, as the APK sends it) is accepted;
- **KNOWN GAP**: a cross-user subscribe is accepted, takes over the owner's FCM row, and the dedupe deletes other users' rows for that token;
- `todo`: "cross-user refused with 401".

**The fork: how should device registration prove who is registering?**

| Option | What actually happens | Cost / what you lose | What it makes easy later | What it makes hard later |
|---|---|---|---|---|
| **A. Android sends the user's access token** (recommended) | `FcmRegistrar.kt` sends `EncryptedPrefs "supabase_access_token"` (already stored; `SupabaseTaskClient.kt:43` uses it) instead of the anon key. The function then verifies with `auth.getUser` and requires `user.id === userId` for `subscribe_fcm` and the dedupe, and refuses with 401 otherwise | An APK release first, and enforcement only after it ships. A rotation while the stored JWT is expired fails until the next app open, so that window comes back for expired sessions only | Closes C2-SEC1 completely. Matches the web callers | Needs a refresh-token path in native code to fully cover background rotation |
| B. Enforce now, accept the native break | Server-side change only | Background token rotations stop registering until the WebView opens. Risks the 10-05 silent-alarm shape | Simplest code | Real alarm misses in the meantime |
| C. Soft gate: refuse only when it conflicts | Anon-key callers may register only if no other user already holds that `fcm_token` and the user has no FCM row with a different token. The dedupe runs only for a verified-JWT caller | No APK change | Narrows takeover of an existing device, but a first-time or unverified takeover is still possible | Two rules to reason about. Not a real closure |
| D. Leave as is | Nothing | The gap stays. Tokens reaching a hijacked device can change tasks for 7 days | — | — |

Cause → effect: pick A, so the APK proves identity, so a stranger's device can no longer join the owner's id, so alarm tokens reach only the owner's phones. Pick B, so the same holds, but native re-registration 401s, so rotated tokens go dead until the next open, so alarms can be missed. Pick C, so obvious takeovers are refused, but a fresh unverified registration still lands.
Reversible: all four are code-only and revertible. A needs an APK build to take effect, and the server half must not ship before the APK, or it becomes B.

## What will no longer be in place (once merged and deployed)
- send-push-notification will no longer mint an action token for a task whose `user_id` is not the push's `userId`. That push is still delivered, without Done/Doing buttons.
- send-push-notification will no longer mint an action token for a caller that is neither the service-role key nor the push's own signed-in user. Pushes from such callers (none found today) arrive without buttons.
- So an unauthenticated caller can no longer mint a token on demand for any task (POST send-push `{userId, data:{taskId}}`).

## Still in place (not changed here)
- **An unauthenticated caller can still register a device under another user's id** (`subscribe_fcm`) and receive that user's alarm pushes, with their tokens, from the scheduler. See Fix 2 / the owner's fork.
- J14's dedupe still lets anyone who knows a device's FCM token delete other users' rows for it.
- send-push itself is still callable by anyone with any `userId` and arbitrary title/body (push spam to a user's devices; pre-existing). It is not gated, because browsers call it.
- Related, not in scope: `execute-tool` is also `verify_jwt = false` with `userId` from the body (`register_push_token`, `send_push`), so it is a second registration route. Not changed.

---

## Fix 2 — registration: Option A (owner, 2026-10-27: "Phone registration ... approved with your recommendation ... options A")

### What changed
**App — android-bridge-template, branch `claude_fcm-register-with-session`** (`6a11b68` code, `894154e` build trigger + ledger):
- `FcmRegistrar.kt` now sends `Authorization: Bearer <supabase_access_token>` (the stored login) and keeps `apikey: <anon>`. The anon key is never the bearer.
- On a 401 it refreshes ONCE through `SupabaseTaskClient.refreshAccessToken`, then retries ONCE with the new token. That is the existing refresh path with its 30s concurrency guard, made `internal` (it was `private`). No second refresh mechanism was written.
- Signed out (no access token): nothing is sent. One log line: `FCM_REGISTER native skipped: no session token (signed out)`.
- Huddle APK: no change in behaviour. Its web side never stores `supabase_url`/`supabase_anon_key`/`supabase_user_id`, so `register()` still returns at the first missing key (O: journey's `src/App.tsx:63-67` / `src/hooks/useAuth.tsx:161-165` are the only writers of those keys).
- Tests (O): `app/src/test/java/com/bridgetemplate/util/FcmRegistrarAuthTest.kt`, 9 JVM tests of the pure helpers `registrationBearer` / `postWithSessionRetry`. Android CI (`./gradlew testDebugUnitTest assembleDebug`) **success** on `6a11b68` (run 40551301622) and `894154e` (run 40554062191). This container has no Android SDK, so Gradle was not run locally.

**Server — journey-voice, this branch** (`62c53ce`, `64d2af7`):
- `_shared/push-auth.ts` `callerIsUser(req, client, userId)` returns true only when `auth.getUser(bearer)` resolves to exactly `userId`. It reuses `mintCaller` with no service-role branch.
- `manage-push-subscription` `subscribe_fcm`: `callerIsUser` must be true, otherwise **401 before any write**. The J14 cross-user dedupe sits inside the same branch after the gate, so it only runs for a verified owner. `verify_jwt` stays `false`. `subscribe` / `unsubscribe` (browser web-push) are unchanged; see "Still in place".
- `execute-tool` `register_push_token`: it needs `mintCaller != 'none'`, otherwise **401 before the tool runs**. This **deliberately differs from manage-push**: it also accepts the service-role key. Its only caller is huddle-proxy (`supabase/functions/huddle-proxy/index.ts:198-208`), which checks `JOURNEY_PROXY_TOKEN` (`:128`), resolves the user server-side, and calls with `Bearer <service-role key>`. Requiring a user JWT there would break Huddle's phone registration. The gate covers this one tool only.
- Web callers still pass (O, read): `src/utils/bridgeFcmRegistration.ts:41` (started from `src/App.tsx` with `session.user.id`) and `src/hooks/useNotifications.tsx:82` (`userId: user.id`) call `supabase.functions.invoke`, which sends the session access token (supabase-js 2.110.0, see STEP 1). They send their own id, so they pass. `useNotifications.tsx:408/432` are `subscribe`/`unsubscribe`, which are not gated.
- Harness (`docs/qc-evidence/probes/harness.ts`): a `_shared` module that imports supabase-js from esm.sh (`call-context-builder.ts`, pulled in by execute-tool) now gets a stubbed copy. Modules without a remote import are used as before.

### Tests (O)
- `supabase/functions/manage-push-subscription/index.auth.test.ts` (7):
  - own JWT accepted;
  - another user's JWT → 401, no write;
  - anon key → 401, no write;
  - no bearer → 401, no write;
  - service-role key / forged JWT / JWT only in `apikey` / no `Bearer` prefix → 401;
  - dedupe refuses without a matching JWT (the other user's row survives, no delete issued);
  - dedupe still runs for the verified owner.
- `supabase/functions/execute-tool/index.register-auth.test.ts` (4):
  - service role registers;
  - own JWT registers;
  - other JWT / anon / no bearer / forged → 401, nothing written;
  - the gate does not refuse other tools.
- `_shared/push-auth.test.ts`: +1 (`callerIsUser`).
- Probe `push-auth.probe.test.ts`: the KNOWN GAP is now a real assertion (cross-user → 401, both rows untouched). The `todo` is removed. 3 pass, 0 todo.
- `npm test` **324/324** (312 before + 12).

### Mutations (O, `mutate.sh`, anchors in files; every one restored = HEAD, tree clean)
| mutation | caught by | outcome |
|---|---|---|
| manage-push gate → `if (false)` | "ANOTHER user's valid JWT is refused with 401" | FIRED |
| same | "J14 dedupe: refused without a matching JWT" | FIRED |
| `callerIsUser` → `return true` | unit "callerIsUser: only this user's own JWT" | FIRED |
| same | handler "the anon key as bearer is refused with 401" | FIRED |
| execute-tool gate → `if (false)` | "another user's JWT, the anon key, no bearer -> 401" | FIRED |
| execute-tool gate without `toolName === 'register_push_token'` | "the gate is scoped to register_push_token" | FIRED |
| execute-tool gate with `''` for the service key | "service-role caller (huddle-proxy) registers the device" | FIRED |
| Kotlin `registrationBearer` falls back to the anon key (throwaway branch `claude_fcm-mutprobe-bearer`, CI) | `FcmRegistrarAuthTest` | PENDING (CI run in progress) |

### APK version, and the ORDER (this is the part that can silence alarms)
- New app: **TaskOS (journey) 1.0.13**. The android-bridge-template branch bumps `_buildTriggeredAt` in `configs/54beaa01-…/bridge.config.json`. When that branch is merged to `main`, `build-apk.yml` builds and signs `taskos-v1.0.13.apk` (`_buildNumber` 12 + 1; `versionCode` = the run number, above 162, so it installs over 1.0.12). It uploads the APK to the bridge-apks blob and writes `_apkDownloadUrl` back into the config.
- **Order:**
  1. Merge android-bridge-template `claude_fcm-register-with-session`.
  2. The owner installs 1.0.13 and opens it once while signed in.
  3. Confirm a `fcm_token_registered` activity_log row with `source: native` after the install.
  4. **Only then** merge PR #65 (this branch) and let the edge functions deploy.
- If #65 deploys first, every app older than 1.0.13 gets 401 on background re-registration (`onNewToken`, launch). A token Firebase rotates while the app is closed then stays unknown to the server, and alarms go to a dead token. That is the 2026-10-05 → 10-08 silent-alarm shape. The WebView's own registration (user JWT) still works whenever the app is opened signed in.

## What will no longer be in place
- A registration that does not carry the matching user's login is refused. `subscribe_fcm` needs that user's own JWT. `register_push_token` needs that user's JWT or the service-role key (huddle-proxy).
- The Android app versions before 1.0.13 can no longer re-register in the background. Their native registrar sends the anon key and now gets 401. Only the WebView path, while open and signed in, registers them.
- J14's cross-user dedupe can no longer be triggered by an unverified caller.

## Still in place after Option A (observed, not changed)
- A rotation while the stored session token is expired and the refresh token is also dead (long signed-out or revoked session) fails until the next signed-in app open. That is Option A's stated cost.
- `manage-push-subscription` `subscribe` / `unsubscribe` (browser web-push) still trust `body.userId`. `unsubscribe` deletes **all** of that user's `push_subscriptions` rows, FCM included. Not in this brief's scope.
- `execute-tool` as a whole is still `verify_jwt = false` with `userId` from the body for every other tool (`send_push`, task reads/writes). Only `register_push_token` is gated here.

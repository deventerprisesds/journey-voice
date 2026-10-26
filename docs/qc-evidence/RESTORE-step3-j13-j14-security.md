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

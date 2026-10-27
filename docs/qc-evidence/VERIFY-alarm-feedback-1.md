# VERIFY-alarm-feedback-1

WHAT: independent verification of the alarm Feedback button (android-bridge-template PR #12, journey-voice PR #72).
WHY: claims made by the implementing session must be checked from the code, tests and GitHub API.
SUPERSEDES: nothing. SUPERSEDED-BY: nothing (current).
EVIDENCE: android head 1937986 (claude/charming-fermi-00wrlr), journey head a58a658 (claude/charming-fermi-00wrlr). Started 2026-10-27 21:24 UTC.

## Claims

### A1 Layout: CONFIRMED
activity_alarm_confirm.xml: `alarm_buttons` LinearLayout wraps btn_confirm..status text; a horizontal row holds `btn_feedback` (weight 1) beside `btn_dismiss` (weight 1). `feedback_panel` (gone by default) holds btn_feedback_up "👍 Good", btn_feedback_down "👎 Not good", EditText `feedback_note` android:maxLength="1500", btn_feedback_save_dismiss "Save & dismiss", btn_feedback_back "Back", btn_feedback_save "Save, keep alarm".
The overlay inflates the SAME layout (AlarmOverlayWindow.kt:37), so `view.findViewById(R.id.btn_feedback)` at :70 is non-null (no NPE).

### A2 Opening the panel: CONFIRMED
AlarmConfirmActivity.openFeedback: `silenceRing(this, tag)` then `feedbackFor = alarmFeedbackContext(payload, tag, title, body, taskId, app, firedAt)` and a captured DISMISS intent for that tag.
Note: `firedAt` is `boundAt` = when the screen was BOUND, not when the alarm actually fired (name is misleading; minor).

### A3 Repeat alarms: CONFIRMED for the code path, with a coverage caveat
onNewIntent (:78-85): same tag as `feedbackFor` -> silenceRing; bind() only hides alarm_save_status when feedbackFor==null, never touches feedback_note / feedback_panel / alarm_buttons visibility; EXTRA_OPEN_FEEDBACK is ignored while feedbackFor!=null.
Caveat: with the screen ON and overlay permission granted, a re-fire goes through NotificationEngine.fire confirmed branch (NotificationEngine.kt:95-125) = AlarmOverlayWindow.show + startForegroundService(AlarmSoundService). It never reaches onNewIntent, so the ring is NOT auto-silenced and the overlay covers the panel. The draft survives (the overlay's Feedback button re-enters via onNewIntent, same tag -> silence). Not a loss path, but "re-silences" only holds for activity-delivered repeats.

### A4 Saving: CONFIRMED
saveFeedback: `canSaveFeedback(rating, note)` (rating != null || note.isNotBlank()) else shows "Pick 👍 or 👎, or write a note" and returns. dismiss=true sends the DISMISS intent captured at open (tag of the alarm the feedback is about), and finishes after 900ms only if `intent.getStringExtra("tag") == ctx.tag` and bindGen is unchanged. dismiss=false -> closeFeedback (panel GONE, alarm_buttons VISIBLE). btn_feedback_back -> closeFeedback; OnBackPressedCallback closes the panel while feedbackFor != null, otherwise falls through to the default back.
Side note: CalendarAlarmReceiver ACTION_DISMISS does `stopService(AlarmSoundService)` with no tag check (CalendarAlarmReceiver.kt:73), so Save & dismiss for alarm A also silences a newer alarm B's ring. That is how Dismiss already behaved.

### A5 Overlay hand-off: CONFIRMED
AlarmOverlayWindow.kt:70-85: silenceRing, dismiss overlay, startActivity(AlarmConfirmActivity, NEW_TASK|CLEAR_TOP, extras incl. EXTRA_OPEN_FEEDBACK=true). bind() :141-144 opens the panel when the extra is set and no panel is open, then removes the extra.

### A6 Persistence under 10KB: REFUTED (not bounded in the worst case)
WorkManager 2.9.0 (app/build.gradle.kts:62) throws IllegalStateException from Data.Builder.build() above 10240 bytes. Simulated with the 2.9.0 format (ObjectOutputStream: writeInt, then writeUTF(key) and writeObject(value); scratchpad wm/Sim.java), a 1500-char 3-byte note plus a realistic token, URL and alarm JSON:
- empty title/body: 5271 B
- 40/150 chars title/body: 5841 B
- 300/900 chars title/body: 8871 B
- 1000/2500 chars title/body: 15771 B -> over the limit
Nothing caps the alarm `title`/`body` that go into `feedbackAlarmJson` (AlarmFeedbackContract.kt feedbackAlarmJson; the server caps them at 300 only AFTER receipt). FCM's ~4KB data limit bounds pushed alarms (about 8.8KB at worst), but alarms scheduled by the web app through JavascriptBridge.kt:57/71 (`NotificationEngine.fire` / `AlarmRepeater.schedule` with arbitrary JSON) have no such cap. Threshold: about 4969 bytes of title+body (about 1650 three-byte chars or about 4900 ASCII chars).
Failure scenario: a web-scheduled alarm with a long description in `body`, plus a long note -> `AlarmFeedbackWorker.enqueue` (called un-wrapped from saveFeedback on the main thread) throws -> the alarm screen crashes and the feedback is lost. Fix direction (not prescriptive): truncate title/body in feedbackAlarmJson, or wrap the enqueue call.

### A7 Routing: CONFIRMED
classifyFeedbackSend + chooseFeedbackRoute + doWork: token+url -> ACTION_ENDPOINT (op "feedback"); 401 or (400 && reason=="bad_op") on the endpoint with a login -> FALLBACK_JWT -> insertAlarmFeedback in the same run; without a login -> retryOrGiveUp; route NONE -> retryOrGiveUp; GIVE_UP when attempt+1 >= 60 or age > 14 days; 408/429/5xx/-1 (HTTP_NETWORK_ERROR = -1, AlarmActionContract.kt:34, and insertAlarmFeedback returns -1 on network failure) -> retry; any other 4xx (malformed 400, 403, 404) -> GIVE_UP.
Live check: deployed alarm-action v41 (Supabase get_edge_function) has no feedback op and returns 400 {reason:"bad_op"}, so the fallback assumption holds today.
Note: with 30s exponential backoff capped at WorkManager's 5h maximum, the 60 attempts run out after about 10-11 days, before the 14-day age limit.
Note: a JWT-route 403 (RLS mismatch, e.g. a stale supabase_user_id after switching accounts) -> GIVE_UP, which drops the feedback with a trace line only.

### A8 Login insert: CONFIRMED
POST {url}/rest/v1/activity_log with apikey + Bearer, Prefer return=minimal, body {user_id, activity_type:"alarm_feedback", status:"completed", metadata}. Dedupe GET `activity_log?select=id&activity_type=eq.alarm_feedback&metadata->>feedbackId=eq.<URLEncoded uuid>` is valid PostgREST JSON-path filter syntax (URLEncoder is a no-op on a UUID; `->>` sent raw, as curl does). On a 401, refreshAccessToken() and retry once with the new token. doGetArray signature matches (SupabaseTaskClient.kt:636).
Live schema (read-only query): activity_type text, status text, metadata jsonb, only a PK constraint; RLS "Users can insert their own activity" (authenticated, auth.uid()=user_id) and a SELECT policy for own rows -> the insert and the dedupe read are both permitted.

### A9 Tests: CONFIRMED (pure logic only)
AlarmFeedbackContractTest has 19 tests: canSave, note trim/cap, context parsing, metadata shape, routes, every classify branch, age/attempt limits, reason parsing. Activity, Worker and SupabaseTaskClient code are NOT unit-tested (UI/HTTP).

### A10 CI: CONFIRMED
40583203818 (pull_request) and 40583159124 (push): completed/success, head_sha 7269eba. The PR head 1937986 is 4 commits later; `git diff --stat 7269eba 1937986` touches only .claude/actions.md, .gitignore and two bridge.config.json files, with no source changes.

### A11 Mutation proof: CONFIRMED
Commit 5ee83fd: 1 file, +1/-1, AlarmFeedbackContract.kt `retryOrGiveUp` -> `FeedbackOutcome.GIVE_UP` in the bad_op/401 no-login branch. Run 40584754655 conclusion failure; job 122473144140 log: "AlarmFeedbackContractTest > a server that predates op feedback with no login keeps it queued, not dropped FAILED ... AlarmFeedbackContractTest.kt:88" and "95 tests completed, 1 failed".

### S1 Token-only identity: CONFIRMED
index.ts feedback block: user_id = claims.userId, metadata.taskId = claims.taskId; `body.taskId` is never read. Probe test 1 asserts taskId comes from the token; it plants taskId only inside `alarm`, not at top level, but the code has no read of it either way.

### S2 Idempotent: CONFIRMED
Select by user_id + activity_type + metadata->>feedbackId; any match -> 200 {duplicate:true}, no insert. Probe "a retry with the same feedbackId" passes. No unique index exists, so two truly concurrent requests could both insert (a duplicate, not a loss).

### S3 Refusals: CONFIRMED
bad_feedback_id / bad_rating / empty_feedback -> 400 (all checked before the token); forged -> 401 bad_token; graceSec = TRACE_GRACE_SEC = 30 days, and the probe with a token expired 3 days ago -> 200; note trimmed and sliced to 2000.

### S4 Trigger: CONFIRMED (SQL logic; not applied live)
BEFORE INSERT ... WHEN (new.activity_type = 'alarm_feedback'); the whole body sits inside BEGIN ... EXCEPTION WHEN OTHERS THEN NULL; END; RETURN NEW, so it cannot fail the insert; the task is read `where t.id = v_task_id and t.user_id = new.user_id`, gated by a UUID regex. All 13 task columns it reads exist live (information_schema query). activity_type is text with no check constraint, so the WHEN clause is safe.

### S5 Probe tests: CONFIRMED
Ran in this worktree: `node --experimental-strip-types --test docs/qc-evidence/probes/*.probe.test.ts` -> tests 21, pass 21, fail 0.

### S6 CI: CONFIRMED
40583221133 (pull_request) and 40583165300 (push): "Checks", completed/success, head_sha 0a2a60e. The current head a58a658 differs only in .claude/actions.md and .gitignore.

## Other defects found (not on the claim list)
- D1 (medium, misattribution): while the panel is open for alarm A, a NEW alarm B (different tag) re-binds alarm_title/alarm_body above the panel to B (AlarmConfirmActivity.kt:107-108), but feedbackFor stays A. The panel never names which alarm it is about, so the owner sees B's title, types feedback about B, and it is stored against A's task.
- D2 (low, draft loss): the activity is android:noHistory="true" (AndroidManifest.xml). Leaving the screen mid-typing (home or app switch) finishes the activity, and nothing saves the unsent draft.
- D3 (low): `firedAt` = time the screen was bound, not when the alarm fired.
- D4: see the A6 crash/loss path.
- D5: see the A7 note (JWT-route 403 -> GIVE_UP drops the feedback).

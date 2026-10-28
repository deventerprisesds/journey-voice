# VERIFY-alarm-feedback-2

WHAT: loop-2 independent verification of the alarm Feedback fix (android-bridge-template 799736f on claude/charming-fermi-00wrlr; journey-voice claude/charming-fermi-00wrlr).
WHY: loop 1 (VERIFY-alarm-feedback-1.md) REFUTED A6 and found D1-D5; this loop re-checks the fix.
SUPERSEDES: nothing (VERIFY-alarm-feedback-1.md stays the loop-1 record). SUPERSEDED-BY: nothing (current).
EVIDENCE: commit 799736f full patch (GitHub API), Supabase read-only queries on wwxgajrtmslzklnyplah, probe suite run. Started 2026-10-28 16:36 UTC.

## Claims

### S5 Probe suite: CONFIRMED
`node --experimental-strip-types --test docs/qc-evidence/probes/*.probe.test.ts` -> tests 21, pass 21, fail 0.

### Server: snapshot trigger LIVE: CONFIRMED
Read-only query: supabase_migrations.schema_migrations has version 20261027160000 name alarm_feedback_task_snapshot; pg_trigger has trg_snapshot_alarm_feedback_task on public.activity_log, function snapshot_alarm_feedback_task, tgenabled 'O' (enabled).

### A6 Persistence under 10 KB (full re-derivation): CONFIRMED for well-formed text; residual edge cases fail closed
Read: AlarmFeedbackContract.kt feedbackAlarmJson (each field `take(300)`), feedbackQueueBytes = (UTF-8 of alarm.toString()+note+token+url)*3/2+512, fitFeedbackForQueue drops body, title, deepLink, then shrinks the note by 3/4 steps; AlarmFeedbackWorker.enqueue stores feedbackId, rating, note, taskId, token, url, alarm.toString(), feedbackAt via workDataOf (Data.Builder.build() serializes and throws IllegalStateException above 10240 bytes; androidx Data_.kt main: build() -> toByteArrayInternalV1; V0 = ObjectOutputStream writeInt/writeUTF/writeObject).
Bound argument: both formats write strings as modified UTF-8. Per char, modified UTF-8 / UTF-8 is 1 (ASCII), 1 (2- and 3-byte BMP), 1.5 (supplementary: 6 vs 4), 2 (U+0000: 2 vs 1). JSON escapes U+0000 in the alarm string, so for well-formed text 1.5x is a true upper bound on the four estimated strings; the other keys/values (about 270 bytes V0 incl. the boxed Long) fit inside the +512 and the 1240-byte gap to 10240.
Simulation (scratchpad wm2/Fit.java, Android JSONStringer escaping, V0 and V1 sizes):
- all fields + note emoji (the unit-test shape): est 8102, note 1500->1125 chars, V0 7650 fits
- all CJK: V0 5697 fits; NUL-filled note: V0 9099 fits (2x NUL ratio absorbed by slack)
- lone surrogates in the alarm fields (UTF-8 encodes '?' = 1 byte, modified UTF-8 = 3): est 8831, V0 11510 OVER
- taskId of 1500 emoji (taskId is not in the estimate and not capped): V0 12114 OVER
- token of 7000 chars (even an empty note does not fit): V0 11025 OVER
In every OVER case enqueue throws inside saveFeedback's runCatching -> "Couldn't save — try again", panel and draft kept (no crash), but that feedback can never be saved. Reaching them needs a web-scheduled alarm (JavascriptBridge scheduleAlarm) with lone surrogates, a non-UUID huge taskId, or a multi-KB token; FCM payloads (UTF-8, ~4 KB) cannot carry lone surrogates.
Over-trim (no data at risk of crash, but note text lost needlessly): emoji case cuts the note to 1125 chars at an actual 7650 bytes; control-char alarm fields (escaped to \u00XX, 6 ASCII bytes each) cut the note to 0 chars at an actual 7875 bytes. Both need contrived alarm text.

### Crash-proof save: CONFIRMED
AlarmConfirmActivity.saveFeedback: `runCatching { AlarmFeedbackWorker.enqueue(...) }`; on failure it traces, shows "Couldn't save — try again" and returns BEFORE closeFeedback, so feedbackFor, the note EditText and the panel stay. Success path unchanged (closeFeedback, then the captured DISMISS, finish only if the screen still shows ctx.tag).

### D1 header names the alarm: CONFIRMED
openFeedback sets feedback_header (new id in activity_alarm_confirm.xml) from feedbackFor.title (take 80), else "How was this scheduled?". bind() for a newer alarm never touches feedback_header or feedbackFor.

### D4 / A7 login 403 retries: CONFIRMED
classifyFeedbackSend: `http == 401 || (route == JWT_INSERT && http == 403) -> retryOrGiveUp`; an endpoint 403 still GIVE_UP. FEEDBACK_MAX_ATTEMPTS 60 -> 100. New unit test `a login refused by row security keeps it queued`.

### A3/A4 re-check: CONFIRMED (reduced depth)
onNewIntent unchanged (same tag -> silenceRing, then bind); saveFeedback canSave gate and dismiss logic unchanged apart from the runCatching wrapper.

### Ring suppression (feedbackOpenTag): CONFIRMED for the four named lifecycle cases; NEW DEFECT D7
Set: openFeedback (AlarmConfirmActivity.kt:227). Cleared: closeFeedback (:245) — reached from Back, the Back button, Save keep alarm and Save & dismiss (cleared before the 900 ms finish); onDestroy (:68, only if this instance has a panel open, so a second instance cannot clear another's). noHistory finish -> onDestroy clears. Process death -> the static resets to null (fails open = rings). A different alarm's bind leaves it on the panel's own tag, which is correct; only a fire for that same tag is skipped. Rotation recreates the activity (no configChanges) -> old onDestroy clears it (fails open; the panel and draft are lost, see D6).
D7 (low-medium): the skip at NotificationEngine.kt:93-97 `return true` CONSUMES the ring instead of deferring it. A confirmed fire is one-shot (CalendarAlarmReceiver ACTION_CONFIRM schedules maxTimes 1; the confirmed branch returns before any repeat is scheduled), and the skip neither reschedules nor clears `confirmed`. Scenario: alarm T's gate screen is up, the owner opens Feedback, then taps Confirm on T's notification in the shade (silenceRing does not cancel the notification; the receiver does not finish the activity) -> confirmed=true, re-fire in 5 min -> panel still open -> "GATE→ALARM skipped" -> the alarm the owner just confirmed never rings. While the screen is asleep a noHistory activity is not finished, so a panel left open with the screen off keeps the flag set for as long as it sits there.
D6 (low, outside the claimed radius): AlarmConfirmActivity has no configChanges/screenOrientation in AndroidManifest.xml, so rotating the phone mid-feedback recreates the screen with the panel closed.

### CI on 799736f: CONFIRMED
Run 40589486945 "Android CI (compile + unit tests)", push, head_sha 799736f, completed/success.

### Size-guard mutation: CONFIRMED (with a caveat)
eef1003 (branch claude_mut-feedback-fit): 1 file, +1 (`if (true) return a to note` in fitFeedbackForQueue). Job 122489667839 log: "99 tests completed, 1 failed", "AlarmFeedbackContractTest > worst-case emoji alarm and note still fit WorkManager's 10 KB input FAILED", AssertionError at :118. The parent being 799736f was not checked via the compare API (the sandbox refused that call). Caveat: the test asserts the ESTIMATE <= 9000, not the real serialized Data size, so it cannot catch an estimate that is wrong (see A6's lone-surrogate and taskId cases).

## NOT REACHED (the 30-minute budget ran out)
- Review of journey .github/workflows/apply-supabase-migration.yml for injection or unsafe input handling.
- S1-S4, S6 re-check on journey claude/charming-fermi-00wrlr (the S5 suite still passes 21/21).
- A1, A2, A5, A8-A11 reduced re-check (only the 799736f diff was read; it does not touch their lines apart from the A7 classify change).

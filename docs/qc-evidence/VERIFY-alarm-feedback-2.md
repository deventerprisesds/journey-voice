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

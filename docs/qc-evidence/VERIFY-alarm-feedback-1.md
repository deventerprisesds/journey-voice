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

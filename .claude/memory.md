# Project Memory — journey-voice
Last updated: 2026-08-02

## get_tasks now honors the advertised `query` param (fuzzy title search) — 2026-08-02
`getTasks` (`supabase/functions/execute-tool/index.ts`) previously IGNORED the `query`/`keyword` param
its own tool schema (`_shared/tool-definitions.ts`) advertised. On the large real board (234 tasks, 208
DONE) the legacy terminal `.order('start_time', {ascending:true, nullsFirst:false}).limit(50)` truncates
unscheduled/DONE tasks out of the top 50, so an agent couldn't resolve them BY NAME to then update them.
- **Fix (additive, executor-only):** when `args.query`/`args.keyword` is non-empty → tokenize, sanitize
  each token to alphanumerics only (`replace(/[^a-z0-9]/g,'')` — this is what makes the PostgREST `.or()`
  string injection-proof: no `,`/`(`/`)`/`.`/`*` can survive), drop stopwords + <2-char tokens, then
  `query.or(tokens.map(t=>\`title.ilike.*${t}*\`).join(','))`, SKIP the time_filter branch, order
  `created_at` desc, limit 50. Status/category filters still AND-compose. Zero significant tokens (e.g.
  "the task") → returns EMPTY (not a board dump). Absent/empty query → byte-identical legacy path.
- **Both consumers inherit it with zero extra work:** journey's own assistant AND Huddle (which fetches
  journey's tool catalog dynamically and proxies `get_tasks` through this same executor). No schema edit.
- **Proven (real rows, user `a3378f93-…`):** "Prepare investor pitch" (DONE, unscheduled) is ABSENT from
  the legacy top-50 but PRESENT via `query:"investor pitch"`; injection token collapses to a harmless
  single alnum ILIKE; query+status AND-composes. Deployed via `deploy-supabase-functions.yml` run
  30753410276 ("Deploy single function → success"). Chosen over a parallel Huddle-side fuzzy search
  (the "extend, don't duplicate" call).


## Purpose
journey is the primary life-assistant app (voice + chat, Iris the voice agent). It owns the OUTBOUND
half of the journey→Huddle task-sync mirror (see `CLAUDE.md`), and its `RealtimeVoiceAssistant.ts` is
the org's reference implementation for a live, barge-in voice agent.

## Voice architecture — OpenAI Realtime + ElevenLabs voices DO compose (reference impl lives HERE)
`src/utils/RealtimeVoiceAssistant.ts` is the canonical example, referenced across the org (Huddle's 1:1
`useVoiceCallRealtime.ts` is a lighter variant). The key fact, often re-litigated: you are NOT forced to
choose between OpenAI Realtime and your own ElevenLabs voices. Only OpenAI's *native end-to-end
speech-to-speech* is OpenAI-voice-only. Iris runs both together:

- **Realtime in text mode** — `modalities:['text']`; OpenAI generates the reply as **text**, not native
  speech-to-speech audio.
- **OpenAI's own audio track is muted** — `RealtimeVoiceAssistant.ts:~598` comments "OpenAI still sends
  audio via RTC track even with modalities:['text']" and disables that track in ElevenLabs mode.
- **Native turn-taking + barge stay OpenAI's** — on `input_audio_buffer.speech_started` it sends
  `response.cancel` (`:~897`) + `pauseAgendaForTangent`. Real interruption, not a freeze/re-speak hack.
- **ElevenLabs voices the text** — on `response.text.done` → `playElevenLabsAudio(text)` → the
  `elevenlabs-tts` edge function with that agent's `elevenlabsVoiceId` → MP3 → a **unified audio queue**
  that plays both OpenAI PCM and ElevenLabs MP3 sequentially.
- The `ttsProvider: 'openai' | 'elevenlabs'` field selects the path; server sends `tts_config` with the
  provider + `elevenlabs_voice_id`.

**The "one voice per session / voice can't change mid-session" limit is MOOT** in this pattern — the
voice comes from ElevenLabs per `playElevenLabsAudio` call, not the Realtime session — so distinct
per-agent voices are free. `gpt-realtime-2` (May 2026) did not change the native-S2S-is-OpenAI-voice-only
constraint. (OpenAI's own docs 403 the CCR WebFetch tool; confirm Realtime specifics by reading this
file / the SDK source, not web search alone.)

**Two roles Realtime can play — pick deliberately:**
- **AS BRAIN** (what Iris does here): the Realtime model generates the reply from its own
  instructions/thread. Lowest latency, but it REPLACES any app-side routing/snapshot/owner-awareness.
- **AS EAR ONLY** (Huddle `useVoiceCallRealtime`): `create_response:false` — Realtime does VAD/STT/barge
  only and never generates a reply; every utterance routes through the app's OWN pipeline (semantic
  router + agent snapshot + tools), ElevenLabs voices it. Keeps all app-side intelligence. Choose this
  when routing/snapshots/ownership must be preserved (Huddle's multi-agent ceremony needs this).

## Related
- Huddle side of the task-sync mirror + agent brains: `deventerpriseds-org/huddle-extension-app`.
- Supabase project ref, edge-function deploy, and the outbound task-sync trigger facts: see `CLAUDE.md`.

## Scheduling redesign — faithful dryRun harness (IN PROGRESS 2026-08-11)
Goal: test the scheduler by running the REAL pipeline verbatim (incl. the batch-calendar-scheduler AI
slotter — user is firm the AI is a MUST; deterministic keyword rules would be a REGRESSION). Approach:
add `dryRun` to `nightly-schedule-builder` that runs the full pipeline but performs ZERO writes; the AI
slotter is READ-ONLY (verified: no update/insert/upsert/delete — all writes are caller-side), so dryRun
fires the real AI and just collects the returned slots into `dryRunPlan` instead of persisting.
FIDELITY TRAP (R3, handled): the candidate pool filters `is_scheduled=false`, which is set by the
rollover/future-clear WRITES we skip in dryRun. So dryRun must (a) still SELECT the would-clear tasks and
add their ids to `dryRunClearedIds`, (b) drop the `is_scheduled=false` filter in the candidate + busy
queries, (c) exclude `dryRunClearedIds` from busy-slot capacity. Assert fidelity at the DETERMINISTIC
layer (task→day/window/tier/inclusion/archival), NOT exact AI minutes (non-deterministic by design).
Owner for validation: a3378f93 (rich custom config), project wwxgajrtmslzklnyplah. 20 ACs written by an
independent subagent. NOT the toy sim (that was scrapped — invented weights/no-AI/wrong owner; the
"stacked at 20:00" was a toy artifact, prod works). Redesign logic changes (composite-sort switch +
same-day flexibility nudge) come AFTER dryRun reproduces the live board.

## ⚙️ DEPLOYED: nightly-schedule-builder `dryRun` mode (2026-08-11) — REVERT + DISCOVERY NOTE
**What shipped:** `nightly-schedule-builder` now accepts `{dryRun:true}` → runs the FULL real pipeline
(incl. the read-only batch-calendar-scheduler AI slotter) with ZERO writes, returns the computed `plan`.
Commits `1697014` (scaffold) + `d113cc6` (impl) on branch `claude/huddle-journey-integration-xokgv1`,
PR deventerprisesds/journey-voice#26. Deployed to the LIVE journey project (ref wwxgajrtmslzklnyplah).
**The non-dryRun path is BYTE-IDENTICAL** (every change is an `if(!dryRun)` guard / conditional query
chain / `dryRun?collect:write` branch), so the nightly cron + every existing caller behave exactly as
before. This is why deploying was low-risk.
**HOW TO FIND IT LATER:** grep `dryRun` in `supabase/functions/nightly-schedule-builder/index.ts`, or
search memory for "faithful dryRun harness".
**HOW TO REVERT (if any unforeseen issue):**
  1. Code: `git revert d113cc6 1697014` on the branch (main was never touched — the PR is unmerged), OR
     close PR #26.
  2. Live function: redeploy the pre-change version by dispatching `deploy-supabase-functions.yml` with
     `ref=main, function_name=nightly-schedule-builder` (main still has the original). The dryRun path is
     opt-in + read-only, so leaving it deployed is harmless if reverting isn't urgent.
**Suspect this change if:** the nightly build ever behaves oddly → confirm by checking whether callers
pass `dryRun` (only an explicit `{dryRun:true}` invocation changes behavior; cron never sets it).

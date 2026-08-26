# Project Memory — journey-voice
Last updated: 2026-08-26

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


## Scheduling architecture map + temporary-caveats design — 2026-08-26 (DESIGN, not implemented)

**journey owns scheduling.** Huddle owns agents + prioritizing. Both apps must run independently
OR integrated; when integrated there is exactly ONE driver (journey), and Huddle retains an
equivalent engine for journey-off. (Standing owner constraint, 2026-08-26.)

**The ONE core module:** `supabase/functions/_shared/scheduling-defaults.ts` → `resolveConfig(userConfig)`
returns `{ timeWindows, categoryMappings }`. Four consumers: `nightly-schedule-builder`,
`batch-calendar-scheduler`, `execute-tool` (`find_open_slots`, 2 call sites), `smart-calendar-scheduler`.
Frontend mirror `src/config/schedulingRules.ts`; store `public.user_scheduling_prefs` (JSONB `config`),
loaded by `schedulingService.ts::loadUserSchedulingConfig` (cached per user).

**Named time windows** (the correct term — NOT "fan windows", which is Huddle's separate confirm-ask
ping concept): `morning` 06–09 M–F | `business_hours` 09–17 M–F | `after_work` 17–22 M–F |
`evening` **19–22 all 7 days** | `flexible` 09–22 all 7 | `weekends` 10–20 Sat/Sun.

**Per-task resolution (nightly-schedule-builder):** `getKeywordWindowOverride(title, contextRules.keywords)`
BEATS `getPreferredWindows(category, categoryMappings)`, both bounded by `getActiveWindows(timeWindows, dow)`.

**ALREADY BUILT:** Settings → Scheduling ships an editable "Keyword Detection Rules" section
(`src/components/SchedulingSettings.tsx:575`) with add/edit/delete over
`contextRules.keywords[kw] = [timeWindow, status]`. `research → evening` is addable TODAY, no code.
Only the *temporary/expiring* part is missing.

**Two gaps found (both open, neither fixed):**
1. Keyword rules bind on the NIGHTLY path only. Full `contextRules` sweep across `supabase/functions/`
   + `src/`: consumers are `nightly-schedule-builder`, `schedulingService.extractSchedulingContext`,
   `dailyReviewPipeline` QC_VIOLATIONS, and the settings editor. `execute-tool` /
   `batch-calendar-scheduler` / `smart-calendar-scheduler` call only `resolveConfig`, which does NOT
   return `contextRules` — so keyword rules do not apply on ad-hoc/agent scheduling paths.
2. Frontend↔backend drift: `after_work.days` = `[1,2,3,4,5]` in `_shared/scheduling-defaults.ts` but
   `[1,2,3,4,5,6]` (incl. Saturday) in `src/config/schedulingRules.ts`, despite "must stay in sync".

**Proposed model** (full note: `.claude/design-scheduling-caveats.md`): a `caveats` JSONB array on the
existing `user_scheduling_prefs` row — a READ-TIME overlay never written into the config, so clearing a
caveat restores prior behaviour with zero migration. `resolveConfig(userConfig, now)` filters expired
ones (no cron) and returns active caveats; applied where the keyword override already applies.
Precedence **caveat > keyword > category default**. Placing it in the shared module is also what closes
gap 1. Huddle-integrated reads/writes via `invokeJourneyTool` (no second copy); Huddle-standalone
overlays the same caveat shape on its own `resolveConfirmFanWindows`/`resolveJobCadence`.

**Open fork for the owner:** does a caveat RE-PLACE already-scheduled tasks (nightly rebuild moves
research off 10am) or apply only to newly-scheduled ones? Not answerable from code — needs the owner.

## Hardening — 2026-08-26: answered a scheduling question from the wrong app
Asked to design temporary scheduling caveats, the session traced ONLY `huddle-extension-app` and closed
by asking the owner whether "evening" meant 18–22 or 20–22 — a fact sitting in journey's
`_shared/scheduling-defaults.ts` (`evening` = 19–22, all 7 days). It also failed to lead with
ALREADY BUILT. Root cause: the sweep was scoped to the repo the request was PHRASED in ("workflows for
the huddle app") rather than the SUBSYSTEM it was ABOUT (scheduling); then an unresearched fact was
raised as if it were a fork in intent.
**Guards:** (1) in a multi-app session, grep EVERY attached repo for the domain noun before designing,
and state which app OWNS the subsystem as a finding; (2) never turn a discoverable fact into a question
to the owner — discovering it IS the work; (3) ALREADY BUILT is a verdict and goes first, so grep the
settings UI + config schema before proposing a mechanism. Full row: `.claude/accuracy-log.md`.

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

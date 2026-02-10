# Master Debug Tracking Sheet

## Purpose
Track all issues, attempted fixes, outcomes, and lessons learned to ensure progressive debugging and avoid repeating failed approaches.

---

## Active Issues

| ID | Problem | Status | Root Cause |
|----|---------|--------|------------|
| CLIP-01 | Time ranges cut off in Today's Schedule ("6:00 -" instead of "6:00 - 9:00") | FIXED | ScrollArea enforces overflow-hidden at root; internal flex layouts overflow horizontally |
| NAV-01 | Top-right assistant button hidden | FIXED | Demo badge positioned at same location (top-4 right-4) |
| NAV-02 | No floating assistant button | REGRESSED | Was removed when refactoring desktop toggle button |
| VOICE-03 | Phone lookup matches demo user, routes to wrong bridge | FIXING | `.ilike('%4434150606%')` matches both real (+14434150606) and demo (4434150606). `.maybeSingle()` errors silently, falls to demo user with Cloudflare bridge. |
| VOICE-04 | ElevenLabs failures produce zero audio output | FIXING | When ElevenLabs returns quota/API error, no fallback audio was sent. User hears silence. |
| VOICE-05 | Semantic VAD not triggering responses in text-only mode | INVESTIGATING | OpenAI's semantic VAD with `modalities: ["text"]` and `create_response: true` may not reliably trigger responses. Need more tracing data. |

---

## Attempted Fixes Log

| Issue ID | Attempt | Date | Outcome | Why It Failed/Succeeded |
|----------|---------|------|---------|-------------------------|
| CLIP-01 | Remove `overflow-hidden` from time window container (line 374) | 2026-01-29 | FAILED | ScrollArea component has `overflow-hidden` baked into its root element - cannot be overridden from children |
| CLIP-01 | Enable horizontal scrolling with ScrollBar orientation="horizontal" | 2026-01-30 | SUCCESS | Added horizontal scrollbar and min-w-max to content container |
| NAV-01 | Add assistant button to top header | 2026-01-29 | PARTIAL | Button added but Demo badge covered it |
| NAV-01 | Move Demo badge to center | 2026-01-30 | SUCCESS | Badge now centered, no longer overlaps assistant button |
| VOICE-03 | Two-step phone lookup excluding demo user ID | 2026-02-10 | PENDING | Exact match first (excluding demo), then fuzzy match (excluding demo), then demo fallback |
| VOICE-04 | Announce ElevenLabs errors via OpenAI audio | 2026-02-10 | PENDING | On ElevenLabs failure, use OpenAI `response.create` with `modalities: ["audio"]` to speak the error description |
| VOICE-05 | Added VAD tracing logs (speech_started, speech_stopped, session config) | 2026-02-10 | PENDING | Log-only changes to gather data for investigation |

---

## Lessons Learned

1. **ScrollArea overflow-hidden is immutable**: The Radix ScrollArea component applies `overflow-hidden` at the root level. Fix must be internal layout changes, not CSS overrides.

2. **Fixed position conflicts**: Multiple fixed-position elements at the same coordinates (top-4 right-4) will overlap. Always check for existing fixed elements before adding new ones.

3. **Flex overflow prevention pattern**: Use `min-w-0` on flex containers that should shrink, `truncate` on text that can be cut, and `flex-shrink-0` on elements that must remain visible.

4. **Supabase Realtime requires explicit publication registration**: Creating a frontend subscription (`.channel().on('postgres_changes')`) does NOT automatically enable events. The table must be added to the `supabase_realtime` publication via `ALTER PUBLICATION`. Always verify with `pg_publication_tables` query.

5. **`.maybeSingle()` returns null when multiple rows match**: It silently discards ALL results. Always exclude known duplicate records (demo user) from phone lookup queries.

6. **Every routing decision must be logged**: Include resolved userId, bridge mode, and whether the demo user was used. Without `[ROUTING-TRACE]` logs, debugging call routing is impossible.

7. **Fallbacks must announce failures audibly — never be silent**: When ElevenLabs or any TTS fails, use OpenAI audio to speak the error to the user. The user needs to know what broke, not experience mysterious silence.

8. **Semantic VAD + text-only modalities is under investigation**: OpenAI's semantic VAD with `modalities: ["text"]` may not reliably trigger responses. Added tracing for `speech_started`, `speech_stopped`, and session config to gather evidence before implementing a fix.

---

## Pending Solutions

### CLIP-01: Time Range Clipping

**Correct approach**: Restructure time window header so content never exceeds container width:

- Wrap in `justify-between` layout
- Left group: `min-w-0` (can shrink) with `truncate` on label
- Right group (time range): `flex-shrink-0 whitespace-nowrap` (never shrinks)

This prioritizes time visibility over label length.

### NAV-02: Floating Button

Re-add the floating button that was accidentally removed:

- Position: `fixed right-4 bottom-4 z-50`
- Size: `h-12 w-12 rounded-full`
- Behavior: Opens Comms panel on click

### VOICE-05: Semantic VAD Investigation

**Current status**: Added tracing logs to capture:
- `[VAD-TRACE]` for `speech_started` and `speech_stopped` events with timestamps
- `[OPENAI-SESSION]` for session config (modalities, turn_detection)
- `responseCreateCount` tracking

**Next steps after data collection**:
- If VAD events fire but no `response.create` is auto-triggered, the issue is in OpenAI's semantic VAD with text-only mode
- If VAD events don't fire at all, the issue is audio format or buffering
- Potential fix: Add a fallback timer that announces the issue rather than silently forcing a response

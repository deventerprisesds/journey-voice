

## Recommendation: Start with 3 Core Docs, Then Layer

Generating all 10 at once risks shallow coverage. I recommend building them in priority order across 3 rounds:

### Round 1 — Foundation (do now)
1. **`docs/ARCHITECTURE.md`** — System diagram, tech stack, data flow between frontend → Supabase → Edge Functions → Cloudflare → Twilio/OpenAI. This is the "map" everything else references.
2. **`docs/VOICE_SYSTEM.md`** — Most complex subsystem, most active development. Covers WebRTC path, Twilio phone path, barge-in/echo fingerprinting, TTS pipeline, VAD handling, all recent fixes.
3. **`docs/DECISION_LOG.md`** — Why we chose echo fingerprinting over word-count, why event-driven disconnect over timeout, ElevenLabs vs OpenAI TTS tradeoffs. This captures institutional knowledge that DEBUG_TRACKER doesn't.

### Round 2 — Backend (next session)
4. `docs/EDGE_FUNCTIONS.md` — Catalog of 30+ functions
5. `docs/CLOUDFLARE_WORKER.md` — Twilio ↔ OpenAI bridge
6. `docs/DATABASE_SCHEMA.md` — Tables, RLS policies, roles

### Round 3 — Features (when stable)
7. `docs/TASK_MANAGEMENT.md`
8. `docs/CALENDAR_INTEGRATION.md`
9. `docs/NOTIFICATIONS.md`
10. `docs/COMMS_CONSOLE.md`

### Why This Order
- Architecture doc is the prerequisite for everything else
- Voice system is where 80% of bugs and complexity live — documenting it now prevents re-investigation
- Decision log captures reasoning that only exists in chat history today — highest risk of being lost

I'd generate the 3 Round 1 docs now by reading through the codebase systematically.


# Edge Functions Catalog

> **Last updated:** 2026-03-08  
> **Total functions:** 33  
> **Runtime:** Deno (Supabase Edge Functions)  
> **Global version:** Defined in `supabase/functions/_shared/config.ts` → `GLOBAL_VERSION`

---

## Shared Infrastructure

All edge functions import from `supabase/functions/_shared/`:

| File | Purpose |
|------|---------|
| `config.ts` | `GLOBAL_VERSION`, CORS headers, health check helper, voice config (source of truth), bridge endpoints, filler config |
| `tool-definitions.ts` | Single source of truth for all AI tool schemas (propagates to phone, voice, chat) |
| `tool-executor.ts` | Centralized tool dispatch via `execute-tool`; includes session-level safety net for `hang_up` |
| `persona.ts` | System prompt builder for Iris voice assistant |
| `call-session.ts` | Call session lifecycle management |
| `call-context-builder.ts` | Builds context for scheduled/ad-hoc calls |
| `session-manager.ts` | Pre-connect session management |
| `audio-codec.ts` | μ-law ↔ PCM16 codec, resampling |
| `tts-manager.ts` | ElevenLabs TTS with sentence buffering |
| `timezone.ts` | Timezone utilities |
| `agenda-wrapper.ts` | Agenda item parsing and state tracking |

---

## Function Catalog

### Voice & Phone

| Function | JWT | Purpose |
|----------|-----|---------|
| `twilio-voice-handler` | ✗ | TwiML webhook for inbound/outbound calls. Routes to Cloudflare or Supabase bridge based on `BRIDGE_ENDPOINTS` config. Handles pre-connect session creation. |
| `twilio-realtime-bridge` | ✗ | WebSocket bridge: Twilio Media Streams ↔ OpenAI Realtime API. Legacy path (replaced by Cloudflare for production). |
| `twilio-scheduled-call` | ✗ | Initiates outbound Twilio calls with pre-connect session data. Called by cron or notification system. |
| `conversation-relay-handler` | ✗ | Twilio ConversationRelay WebSocket handler (alternative to Media Streams). Uses Deepgram STT + Google Journey TTS. |
| `elevenlabs-tts` | ✗ | Proxies text→speech requests to ElevenLabs API. Returns base64 μ-law audio. Used by Cloudflare worker and Supabase bridge. |
| `generate-realtime-token` | ✗ | Generates ephemeral OpenAI Realtime API token for in-app WebRTC voice sessions. Includes persona prompt, tools, and RAG context. |

### AI & Chat

| Function | JWT | Purpose |
|----------|-----|---------|
| `hybrid-assistant-api` | ✗ | Main chat endpoint. Routes between OpenAI Assistants API (threaded) and direct completions. Supports tool execution within conversation. |
| `send-chat-message` | ✗ | Delivers scheduled/delayed chat messages. Used by voice tools for "message me in 5 minutes" requests. |
| `ai-task-parser` | ✗ | Parses natural language into structured task objects using GPT. Handles multi-task extraction, date parsing, category inference. |
| `execute-tool` | ✗ | Universal tool execution endpoint. All AI interfaces (voice, phone, chat) route tool calls here. Also serves `/definitions` for tool schema discovery. |
| `classify-task-topic` | ✗ | Classifies tasks into topic groups using AI embeddings/heuristics. |

### Calendar & Scheduling

| Function | JWT | Purpose |
|----------|-----|---------|
| `calendar-integration-manager` | ✓ | OAuth flow manager for Google/Outlook calendar connections. Handles auth, token storage, calendar list retrieval. |
| `calendar-token-manager` | ✗ | Refreshes expired OAuth tokens for calendar connections. Called before any calendar API request. |
| `calendar-delta-sync` | ✗ | Incremental sync of external calendar events using sync tokens. Handles creates, updates, deletes. |
| `smart-calendar-scheduler` | ✗ | AI-powered scheduling: finds optimal time slots based on existing events, preferences, and task priorities. |
| `batch-calendar-scheduler` | ✗ | Schedules multiple tasks at once using the smart scheduler. |

### Notifications

| Function | JWT | Purpose |
|----------|-----|---------|
| `notification-scheduler` | ✗ | Cron-triggered: generates upcoming notifications based on task due dates and reminder preferences. |
| `notification-delivery` | ✗ | Dispatches notifications across channels (push, Slack, email, phone). |
| `send-unified-notification` | ✗ | Single entry point for sending a notification through all configured channels. |
| `send-push-notification` | ✗ | Web Push API delivery using VAPID keys. |
| `generate-vapid-keys` | ✗ | Generates VAPID key pair for push notification setup. |
| `get-vapid-key` | ✗ | Returns public VAPID key for client-side push subscription. |
| `manage-push-subscription` | ✗ | CRUD for browser push subscription endpoints. |
| `notification-callback` | ✗ | Handles notification interaction callbacks (dismissed, snoozed, acted-on). |
| `send-slack-notification` | ✗ | Delivers messages via Slack webhook. |
| `generate-task-reminders` | ✗ | Generates reminder notifications for upcoming tasks. |

### Data Sync

| Function | JWT | Purpose |
|----------|-----|---------|
| `sync-google-sheets` | ✗ | Syncs assignments from Google Sheets (primary program). |
| `sync-mit-sheets` | ✗ | Syncs assignments from Google Sheets (MIT program). |
| `external-db-query` | ✗ | Queries external databases for cross-system data access. |
| `test-external-db` | ✗ | Health check for external database connectivity. |

### Knowledge & RAG

| Function | JWT | Purpose |
|----------|-----|---------|
| `sync-assistant-knowledge` | ✗ | Syncs knowledge chunks to assistant's vector store for RAG retrieval. |
| `sync-assistant-tools` | ✗ | Updates OpenAI Assistant's tool definitions from `tool-definitions.ts`. |
| `rag-context-retrieval` | ✗ | Retrieves relevant context from embeddings for voice/chat sessions. |
| `generate-embeddings` | ✗ | Generates vector embeddings for conversation messages and knowledge chunks. |
| `web-search` | ✗ | Proxies web search queries to Tavily API. Returns structured results for AI consumption. |

### Assistants & Webhooks

| Function | JWT | Purpose |
|----------|-----|---------|
| `assistant-actions-webhook` | ✗ | OpenAI Actions webhook endpoint (GPT Actions schema in `public/openapi-actions.json`). |

### Development & Testing

| Function | JWT | Purpose |
|----------|-----|---------|
| `ping` | ✗ | Health check endpoint. Returns version and timestamp. |
| `create-test-task` | ✗ | Creates a test task for development/debugging. |
| `create-quick-test-task` | ✗ | Simplified test task creation. |

---

## Tool Execution Flow

All AI tool calls follow the same pattern regardless of interface:

```
Voice/Phone/Chat → execute-tool edge function → tool-specific logic → Supabase DB
```

The `execute-tool` function:
1. Receives `{ toolName, args, userId, context }` 
2. Routes to the appropriate handler (task CRUD, calendar, notifications, etc.)
3. Returns structured JSON result
4. Also serves `GET /definitions` for tool schema discovery

### Tool Safety Net

The `tool-executor.ts` shared module tracks which tools were called per session. On `hang_up`, if `send_chat_message` was never called during a phone session with call context, it automatically fires a fallback message to preserve conversation continuity.

---

## Adding a New Edge Function

1. Create `supabase/functions/{name}/index.ts`
2. Import shared config: `import { corsHeaders, handleCorsOptions, createHealthResponse } from "../_shared/config.ts"`
3. Add to `supabase/config.toml` with `verify_jwt` setting
4. If it's a tool: add definition to `_shared/tool-definitions.ts`, then run `sync-assistant-tools`

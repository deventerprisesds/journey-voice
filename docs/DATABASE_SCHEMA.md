# Database Schema Reference

> **Last updated:** 2026-03-08  
> **Source of truth:** `src/integrations/supabase/types.ts` (auto-generated from Supabase)  
> **Project ID:** `wwxgajrtmslzklnyplah`

---

## Core Task Management

### `tasks`
Primary task table. Used across Kanban, Focus View, Calendar, and all AI interfaces.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `title` | text | |
| `description` | text | nullable |
| `status` | enum `task_status` | BACKLOG, TODO, READY, UP_NEXT, DOING, DONE, BLOCKED, PLANNING |
| `priority` | text | LOW, MEDIUM, HIGH, URGENT |
| `category` | text | LIFE, CAREER, VENTURES, EDUCATION, PROF_EDUCATION, PERSONAL |
| `due_date` | date | nullable |
| `start_time` / `end_time` | timestamptz | For scheduled time blocks |
| `estimate_minutes` | int | nullable |
| `board_id` | uuid FK → `boards` | |
| `user_id` | uuid | |
| `is_scheduled` | boolean | |
| `reminder_minutes` | int | nullable |
| `external_event_id` | text | Links to calendar event |
| `scheduling_context` | jsonb | AI scheduling metadata |
| `assignment_url` / `assignment_id` | text | Links to academic assignments |

### `boards`
Kanban board containers.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `name` | text | |
| `color` | text | nullable |
| `user_id` | uuid | |
| `position` | int | Ordering |
| `is_default` | boolean | |

### `columns`
Board columns with status mapping.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `name` | text | |
| `board_id` | uuid FK → `boards` | |
| `position` | int | |
| `status` | enum `task_status` | Maps column to task status |

### `checklist_items`
Sub-tasks within a task (defined in frontend `types/task.ts`, not in DB types — may be separate table or embedded).

---

## Calendar & Scheduling

### `calendar_connections`
OAuth connections to external calendars (Google, Outlook).

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `user_id` | uuid | |
| `provider` | text | google, outlook, office365 |
| `provider_account_email` | text | |
| `access_token` / `refresh_token` | text | Encrypted tokens |
| `expires_at` | timestamptz | Token expiry |
| `scope` / `scopes` | text / text[] | OAuth scopes granted |
| `sync_token` | text | For delta sync |
| `purposes` | text[] | What the connection is used for |
| `connected_services` | jsonb | |
| `service_type` | text | |

### `external_calendar_events`
Synced events from external calendars.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `user_id` | uuid | |
| `connection_id` | uuid FK → `calendar_connections` | |
| `external_event_id` | text | Provider's event ID |
| `title`, `description`, `location` | text | |
| `start_time` / `end_time` | timestamptz | |
| `is_all_day` | boolean | |
| `source_task_id` | uuid FK → `tasks` | For task→calendar sync |
| `calendar_id` | text | Which calendar within the account |

---

## Voice & Communication

### `assistants`
AI assistant configurations (Iris and custom assistants).

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `user_id` | uuid | |
| `name` | text | |
| `openai_assistant_id` | text | OpenAI Assistants API ID |
| `voice_id` | text | ElevenLabs voice |
| `persona_prompt` | text | System prompt |
| `tools_enabled` | jsonb | Which tools this assistant can use |
| `orb_color` / `orb_animation` | text | UI customization |
| `is_default` / `is_active` | boolean | |

### `ai_threads`
Conversation threads linking to OpenAI threads.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | Internal thread ID |
| `user_id` | uuid | |
| `openai_thread_id` | text | OpenAI's thread ID |
| `assistant_id` | uuid FK → `assistants` | nullable |
| `mode` | text | voice, phone, chat |

### `conversation_messages`
All messages across all interfaces (chat, voice, phone).

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `user_id` | uuid | |
| `thread_id` | uuid FK → `ai_threads` | nullable |
| `assistant_id` | uuid FK → `assistants` | nullable |
| `role` | text | user, assistant, system |
| `content` | text | |
| `source` | text | chat, voice, phone, cloudflare_phone |
| `audio_transcript` | text | nullable |
| `voice_session_id` | text | nullable |
| `metadata` | jsonb | call_sid, message_index, etc. |

### `conversation_agenda`
Agenda items for structured voice calls.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `thread_id` | uuid FK → `ai_threads` | |
| `user_id` | uuid | |
| `item_text` | text | |
| `item_index` | int | Order |
| `status` | text | pending, in_progress, paused, completed |
| `source` | text | Where the item came from |
| `paused_for` | text | Why paused (tangent query) |

### `call_sessions`
Phone call session records.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `call_sid` | text | Twilio Call SID |
| `user_id` | uuid | |
| `direction` | text | inbound, outbound |
| `from_number` / `to_number` | text | |
| `stream_sid` | text | |
| `tts_provider` | text | openai, elevenlabs |
| `greeting_latency_ms` | int | |
| `duration_seconds` | int | |

### `call_messages`
Detailed message log per phone call (higher fidelity than conversation_messages).

| Column | Type | Notes |
|--------|------|-------|
| `call_session_id` | uuid FK → `call_sessions` | |
| `role` | text | |
| `content` | text | |
| `message_index` | int | |
| `tool_name` / `tool_input` / `tool_output` | text/jsonb | |
| `latency_ms` / `audio_duration_ms` | int | |

---

## Notifications

### `scheduled_notifications`
(Referenced via `notification_trace` view and `delivery_logs` FK)

### `delivery_logs`
Tracks notification delivery attempts per channel.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `notification_id` | uuid FK → `scheduled_notifications` | |
| `channel` | enum `notification_channel` | push, slack, email, phone |
| `delivered_at` / `failed_at` | timestamptz | |
| `failure_reason` | text | |

---

## Academic / Assignments

### `assignments`
Primary assignment table (synced from Google Sheets).

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `user_id` | uuid | |
| `title` | text | |
| `course_id` | uuid FK → `courses` | nullable |
| `program_id` | uuid FK → `programs` | nullable |
| `due_date` | date | |
| `status` / `priority` / `type` | text | |
| `assignment_url` | text | |
| `sheet_row_number` | int | For Google Sheets sync |

### `assignments_mit`
Separate table for MIT program assignments (same schema, different sync source).

### `courses`
Academic courses with optional OneDrive/OneNote integration.

### `programs`
Academic program containers (e.g., MBA, MIT).

### Related Tables
- `assignment_artifacts` — Generated content per assignment
- `assignment_outlines` — Structured outlines
- `assignment_requirements` — Extracted requirements with completion tracking
- `assignment_user_context` — User-provided context and instructions
- `assignment_history` / `assignments_mit_history` — Change tracking
- `case_study_analyses` — Case study workflow state

---

## Knowledge & RAG

### `conversation_embeddings`
Vector embeddings for conversation retrieval.

### `assistant_knowledge_chunks`
Knowledge base content with embeddings per assistant.

### `extracted_content`
Rich extracted content from course materials (key concepts, frameworks, case studies, etc.).

### `core_learnings` / `core_insights`
Structured learning artifacts per course.

---

## Observability

### `activity_log`
Stage-by-stage activity tracking for voice calls and system operations.

| Column | Type | Notes |
|--------|------|-------|
| `user_id` | uuid | |
| `activity_type` | text | phone_outbound, phone_inbound, etc. |
| `session_id` | text | Call SID or session ID |
| `status` | text | started, connected, completed, error |
| `stage` | text | cf_ws_start, cf_greeting_sent, etc. |
| `metadata` | jsonb | Telemetry data |

### `error_log`
Structured error tracking.

| Column | Type | Notes |
|--------|------|-------|
| `source` | text | cloudflare_worker, edge_function, frontend |
| `error_type` | text | |
| `error_message` | text | |
| `component` | text | |
| `context` | jsonb | Worker version, stage, etc. |

---

## Views

### `notification_trace`
Joins `scheduled_notifications` with `tasks` for debugging notification pipelines.

---

## Key Patterns

### No FK to `auth.users`
User references use `user_id uuid` without foreign keys to Supabase's `auth.users` table. Profile data stored in a separate `profiles` table.

### RLS
Row-Level Security enabled on user-facing tables. Policies typically: `auth.uid() = user_id`.

### Timestamps
All tables use `created_at` / `updated_at` with defaults. Voice tables add `started_at` / `ended_at`.

### JSONB for Flexibility
`metadata`, `scheduling_context`, `tools_enabled`, `connected_services` use JSONB for schema-flexible data.

### Enum Types
- `task_status`: BACKLOG, TODO, READY, UP_NEXT, DOING, DONE, BLOCKED, PLANNING
- `notification_channel`: push, slack, email, phone
- `learning_type`: Used by `core_learnings`

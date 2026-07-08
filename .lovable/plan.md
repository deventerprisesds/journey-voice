Rename the app from Journey Voice to TaskOS across user-facing product strings, leaving the published domain and Android deep-link scheme untouched to avoid OAuth breakage.

## Scope

- **Rename:** Title, meta tags, in-app UI, bridge config, notification strings, MCP title, and docs.
- **Keep unchanged:**
  - Published domain `journey-voice.lovable.app` and all hostname checks (`src/App.tsx`, `src/hooks/useAuth.tsx`, `src/utils/bootTrace.ts`, `src/utils/dailyReviewPipeline.ts`, `src/components/DailyReviewModal.tsx`, `src/pages/Auth.tsx`).
  - Android OAuth deep-link scheme `journey-voice://auth`.
  - Google "Journey" TTS voice product references (`docs/VOICE_SYSTEM.md`, `supabase/functions/_shared/config.ts`).
  - Support email address tied to the current domain.

## Default tagline

"TaskOS — your task and schedule operating system."  
I will use this in `index.html` and `public/bridge.config.json` unless you reply with a different one.

## Changes

### 1. Head metadata (`index.html`)
- Update `<title>`, `<meta name="description">`, `<meta name="author">`, `og:title`, `twitter:title`.
- Leave `og:url` and canonical logic pointing at `journey-voice.lovable.app` (domain unchanged).

### 2. Bridge / native app config (`public/bridge.config.json`)
- Change `appName` and `widget.name` to "TaskOS".
- Keep `baseUrl` as `https://journey-voice.lovable.app`.

### 3. In-app UI
- `src/components/MainLayout.tsx`:
  - Expanded sidebar title: "TaskOS" (was "Journey").
  - Collapsed sidebar initial: "T" (was "J").
  - Mobile header title: "TaskOS".
- `src/components/NotificationSettings.tsx`:
  - Test message title: "💬 TaskOS".
  - Android Calendar description: "Requires the TaskOS Android app."

### 4. MCP server
- `src/lib/mcp/index.ts` and `supabase/functions/mcp/index.ts`:
  - Update MCP title to "TaskOS — Tasks & Schedule".
  - Optionally update MCP name identifier to `taskos-mcp`.
- Regenerate `.lovable/mcp/manifest.json` via `app_mcp_server--extract_mcp_manifest`.

### 5. Edge function user-facing strings
- `supabase/functions/send-android-calendar-event/index.ts`: error message "install the TaskOS app first".
- `supabase/functions/send-unified-notification/index.ts`: "Task reminder from TaskOS" / "Reminder from TaskOS".
- Leave support `mailto:` unchanged because the domain is unchanged.

### 6. Docs
- `docs/ARCHITECTURE.md`: rename "Journey" platform references to "TaskOS".
- Leave `docs/VOICE_SYSTEM.md` "Google Journey voices" references as-is (product name, not app name).

### 7. Project metadata
- `package.json`: change `name` to `taskos`.

## Verification

- Grep for remaining `Journey Voice` / `Journey` brand strings to confirm only domain/host, TTS voice, and docs product references remain.
- Run typecheck/build to ensure no broken imports.
- Regenerate the MCP manifest and confirm it lists the advertised tools.
- Spot-check the preview for the new sidebar title and page title.
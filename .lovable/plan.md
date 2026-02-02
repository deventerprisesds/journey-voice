
Objective (what we will change)
- Make /debug usable even when Supabase auth initialization is hung (currently /debug is blocked by the same “Initializing your session” gate).
- Ensure every production attempt produces backend-visible evidence in your existing `error_log` table, even if `supabase.auth.getSession()` never resolves.
- Let us answer: “Did the browser reach Supabase REST? Auth? How long did DNS/TLS take? Did the app hang inside supabase-js or in network?”

What we learned from your report + replay
- On `journey-voice.lovable.app/debug`, you still see the “Loading… Initializing your session” screen with a Boot ID (example from replay: `ML4OI6LD-FDE5KN`).
- That means the debug page is currently not helpful, because the app must complete auth init before you can see diagnostics.
- Also, I currently do not see any `error_log` entries coming from the production hostname, which strongly suggests our current logging path (BootTrace → `supabase.from('error_log').insert(...)`) is not reliable in the failing scenario (likely because the underlying supabase-js / auth layer is what’s hanging).

Root issue (diagnostics architecture)
- Both:
  1) auth initialization (AuthProvider) and
  2) backend logging (BootTrace DB insert)
  currently depend on supabase-js.
- If supabase-js is the thing hanging (storage lock, internal mutex, auth exchange deadlock, or a fetch that never resolves), then:
  - /debug can’t open (because AuthProvider keeps “loading”)
  - and logs never reach `error_log` (because the logger uses the same library that is stuck)
- We need a logging “escape hatch” that does NOT depend on supabase-js.

Solution approach (no removals; additive + bypasses)
A) “Debug-route bypass” so /debug always loads
- Add a safe bypass: when `window.location.pathname.startsWith('/debug')`, AuthProvider will NOT run the normal `initAuthV2/initAuthV1` flow.
- Instead it will:
  - set `loading=false` immediately,
  - set `user/session=null`,
  - mark a BootTrace step like `debug_bypass_auth_init`,
  - and allow Debug UI to render.
- This does not change behavior for any other route; it only prevents the debug route from being blocked by the auth initializer.

B) Replace backend logging transport with a “direct REST fetch” transport (supabase-js independent)
- Implement a small logging utility that writes to `error_log` via `fetch()` directly to:
  - `https://wwxgajrtmslzklnyplah.supabase.co/rest/v1/error_log`
  - using the anon key in headers.
- This avoids any internal supabase-js locking/hanging and gives us backend traces even when auth init is broken.
- Update BOTH:
  - `src/utils/bootTrace.ts` (BootTrace logging)
  - `src/hooks/useAuth.tsx` (logAuthError)
  to use this new transport in addition to (or instead of) `supabase.from(...).insert(...)`.
- Keep the existing supabase-js insert path as a fallback (not removed), but prefer direct REST for reliability.

C) Add explicit “connectivity probes” on /debug (and log results to backend)
On /debug we will add buttons that run and display:
1) REST probe:
   - `GET /rest/v1/` (or a lightweight known table HEAD/OPTIONS) with a 3–5s timeout
2) Auth probe:
   - `GET /auth/v1/health` (or another safe auth endpoint) with a 3–5s timeout
3) Edge function probe (optional but very useful):
   - `supabase.functions.invoke('test-external-db')` or a new tiny `ping` edge function (no secrets, verify_jwt=false) so we can see function edge logs.
Each probe will:
- record a BootTrace step (start/done/error),
- show latency + error in the UI,
- send a structured row to `error_log` via the direct REST logger.

D) Add global “hard failure capture” (frontend → backend)
Add global listeners (minimal, privacy-safe):
- `window.onerror`
- `unhandledrejection`
Log only:
- error message
- stack (truncated)
- current URL
- Boot ID
- userAgent
- network hints:
  - `navigator.onLine`
  - `navigator.connection.effectiveType` (when available)
These will go through the direct REST logger so they still show up during auth hangs.

E) Make it easy for you to report an attempt (no “context id” required)
- On the loader (ProtectedRoute loading screen) and on the error card, you already see Boot ID.
- We will ensure that the Boot ID is also written to backend as the very first thing the app does (via direct REST logger), so you can simply tell me:
  - “Boot ID: XXXXX”
  and I can query the DB and reconstruct the attempt.
- In other words: the Boot ID becomes the correlation key; no separate context id is needed.

Implementation steps (files)
1) Add a new logging utility (frontend)
- Create `src/utils/directLog.ts` (name flexible):
  - `logErrorLogRow({ component, error_type, error_message, context })`
  - Uses `fetch` + timeout + best-effort (never throws).
  - Adds standard context fields automatically (origin, pathname, userAgent, boot_id).
2) Update BootTrace DB logging
- Edit `src/utils/bootTrace.ts`:
  - Replace `supabase.from('error_log').insert(...)` inside `logToDatabase()` with the new direct logger.
  - Keep the existing behavior of “significantSteps only”.
3) Update AuthProvider error logging
- Edit `src/hooks/useAuth.tsx`:
  - Update `logAuthError` to use the direct logger.
  - Add the /debug bypass:
    - if pathname starts with `/debug`, skip initAuth and immediately set loading false.
4) Upgrade Debug page so it’s useful without auth
- Edit `src/pages/Debug.tsx`:
  - Remove dependency on “auth must be initialized” by ensuring it still renders meaningful content when `user=null` and `session=null`.
  - Add the probes (REST/Auth/Functions) + UI for results.
  - Add “Send test log” button that writes a known row to `error_log` so we can confirm backend visibility instantly.
5) (Optional) Add a tiny `ping` edge function for a second logging channel
- Create `supabase/functions/ping/index.ts`
  - No secrets.
  - Logs request info (origin, userAgent) in edge logs.
  - Returns JSON `{ ok: true, timestamp }`.
  - This gives us Supabase Edge logs even if DB insert fails for any reason.
- Update `supabase/config.toml` to set `verify_jwt=false` for this function.
6) Ensure ProtectedRoute provides a direct link that does not depend on router state
- Small tweak: “Debug Page” button can use `window.location.href = '/debug'` in addition to navigate(), so even if router state is weird, it hard-navigates.

How we will use the backend to trace your attempts
- After you reproduce on production:
  1) Read the Boot ID shown on the loader card.
  2) Send me the Boot ID.
- I will query `error_log` filtering by `context.boot_id` and reconstruct:
  - whether we could hit REST endpoints,
  - whether auth endpoints were reachable,
  - whether the hang is a supabase-js internal deadlock vs. network stall,
  - and the exact last successful step.

Success criteria
- Visiting `journey-voice.lovable.app/debug` always shows the debug dashboard (even if auth init is broken).
- Every page load produces at least one backend `error_log` row with:
  - `component=BootTrace`, `error_message=app_start`, and the Boot ID
- After a failing attempt, we can identify the failure class:
  - “Auth endpoint unreachable”
  - “REST reachable but auth hanging”
  - “supabase-js internal deadlock / storage lock”
  - “service worker / caching interference”
  - “routing/redirect issue”
…and we can then target the fix without further guesswork.

Risk / rollback
- No code removal.
- Changes are additive and scoped:
  - /debug bypass only affects `/debug`
  - logging changes only add an alternate transport
- If anything is noisy, we can restrict logging to production-only and/or only on failures.
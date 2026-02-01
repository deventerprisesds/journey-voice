
<context>
User-facing problems to resolve:
1) Published app loads forever at startup (user sees the “Loading...” screen).
2) Errors aren’t surfaced with clear messages; user suspects “race issues”.
3) Publishing/build sometimes fails with a generic “Publishing failed” message (no actionable detail).

What I observed in the codebase:
- The “Loading...” UI shown in the session replay matches `src/components/ProtectedRoute.tsx` (it renders while `useAuth().loading === true`).
- `src/hooks/useAuth.tsx` initializes auth by awaiting `supabase.auth.getSession()` without any `try/catch` and without any timeout. If that promise hangs (network stall, blocked request, storage issue) or throws, `loading` can remain `true` forever → `ProtectedRoute` renders “Loading...” indefinitely.
- There is no user-facing error state for auth initialization failures/timeouts.
- `src/components/ErrorBoundary.tsx` references `process.env.NODE_ENV` which is not the recommended pattern for Vite and can cause runtime issues (and makes error rendering fragile). Even if it’s not the direct cause of the startup hang, it undermines “errors should be visible” goals.

Key principle to follow (per project memory):
- Prefer explicit user-facing error notifications over silent fallbacks.
</context>

<root-cause-hypothesis>
The “published loads forever” symptom is most consistent with `AuthProvider` never transitioning `loading` to `false` due to:
- a hung `supabase.auth.getSession()` call (network/cors/adblock/service hiccup), or
- an exception during auth initialization (storage access, unexpected runtime error),
and because we do not handle that failure path, the UI stays stuck in the loading gate without any explanation.

This also explains “why it’s sudden”: a recent update likely changed auth init behavior (e.g., adding preview/demo mode logic) and removed/avoided a “setLoading(false)” in failure scenarios, turning transient failures into indefinite hangs.
</root-cause-hypothesis>

<plan>
<step number="1" title="Make auth initialization fail-safe (no infinite loading)">
Update `src/hooks/useAuth.tsx`:
- Add `initError: string | null` state (stored in context) to represent “auth initialization failed/timed out”.
- Wrap the entire `initAuth()` logic in `try/catch/finally`.
  - In `catch`, set:
    - `initError` with a human-readable message
    - `loading` to `false`
    - `session/user` to `null` (so the app can route to `/auth` instead of being stuck)
    - `isAdmin/isDemoMode` to safe defaults
- Add a timeout guard around `supabase.auth.getSession()`:
  - Use `Promise.race([getSessionPromise, timeoutPromise])`
  - If timeout triggers (e.g., 8–12 seconds), treat it as an init error (but recover UI).
- Add a `retryAuth()` function in the AuthContext:
  - Allows the UI to retry initialization after a temporary outage without full page refresh.

Why this fixes the “forever loading”:
- Even if Supabase session fetch stalls, we will stop blocking the UI, show a clear message, and allow retry/sign-in.

</step>

<step number="2" title="Surface startup/auth failures to the user (explicit, actionable)">
Update `src/components/ProtectedRoute.tsx`:
- If `loading === true`: keep showing Loading, but add a “still loading?” helper after a short delay (optional) OR keep minimal.
- If `initError` exists: show a user-facing error screen instead of redirect loops or silent loading:
  - Title: “Can’t start the app”
  - Description: short, actionable (e.g., “We couldn’t connect to the authentication service. Please retry, refresh, or sign in again.”)
  - Buttons:
    - “Retry” (calls `retryAuth()`)
    - “Go to Sign In” (navigate to `/auth`)
    - “Refresh Page” (optional)
This directly addresses “Why aren’t errors handled and providing messages?”

</step>

<step number="3" title="Log auth init failures into the existing unified error visibility system">
Update `src/hooks/useAuth.tsx`:
- On init failure/timeout, insert into `error_log` (table already used by `RealtimeVoiceAssistant`), with:
  - `source: 'chat'` (or 'frontend')
  - `component: 'AuthProvider'`
  - `error_type: 'auth_init_timeout' | 'auth_init_failed'`
  - `message`
  - metadata: `origin`, `hostname`, `userAgent`, and (if available) any Supabase error codes
This gives you backend visibility for “published hangs” without relying on users to open console.

</step>

<step number="4" title="Harden ErrorBoundary so it can’t crash while trying to show errors">
Update `src/components/ErrorBoundary.tsx`:
- Replace `process.env.NODE_ENV === 'development'` with `import.meta.env.DEV` (Vite-native).
- Ensure any optional debug rendering is guarded so it never throws.
This improves stability and ensures that when errors do happen, the error UI itself doesn’t fail.

</step>

<step number="5" title="Validation: confirm fix in both Preview and Published">
After implementation:
- Verify in Preview:
  - App loads past ProtectedRoute.
  - Comms Console + Tasks route work.
- Verify in Published:
  - If not signed in: it should go to `/auth` quickly (no indefinite “Loading...”).
  - If signed in but Supabase is temporarily unavailable: it should show the explicit error screen with Retry.
- Check Supabase `recent_errors` / `error_log` for `AuthProvider` events to confirm instrumentation.

</step>
</plan>

<files-to-change>
1) `src/hooks/useAuth.tsx`
- Add init error state + timeout + try/catch + retry function
- Insert error events into `error_log` on failure

2) `src/components/ProtectedRoute.tsx`
- Render explicit error UI when auth init fails
- Add Retry / Sign-in actions

3) `src/components/ErrorBoundary.tsx`
- Replace `process.env.NODE_ENV` with `import.meta.env.DEV`

(Any additional small helper component will be created only if needed; otherwise keep changes localized.)

</files-to-change>

<acceptance-criteria>
- Published app no longer stays on “Loading...” indefinitely.
- When auth/session initialization fails, user sees a clear message and can take action (Retry / Sign in).
- Auth init failures are captured in `error_log` for debugging.
- ErrorBoundary is safe in production builds and won’t throw due to `process` references.

</acceptance-criteria>

<risks-and-mitigations>
- Risk: Timeout could route users to /auth even if the session would have loaded with a little more time.
  - Mitigation: Keep timeout conservative (8–12s) and provide “Retry” to recover quickly; preserve any existing session if it arrives later via `onAuthStateChange`.
- Risk: `error_log` insert could fail if network is down.
  - Mitigation: Catch and console log (best-effort logging, never block UI).

</risks-and-mitigations>

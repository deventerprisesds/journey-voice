
# Root Cause Analysis & Fix: Infinite Loading on Published Site

## Problem Summary
The published app at `journey-voice.lovable.app` gets stuck on the "Loading... Initializing your session" screen. The user reports this started after calendar OAuth integration was added and affects Private/Incognito mode on the published site.

## Diagnostic Findings

After thorough code review, I identified **two potential causes** and **one definite bug fix** needed:

### Issue 1: Service Worker Cache Interference (High Probability)
The `public/sw.js` uses a **cache-first strategy** that intercepts ALL fetch requests:

```javascript
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        return response || fetch(event.request);  // Returns cache if exists
      }
    )
  );
});
```

**Problem**: This can cache Supabase auth API responses. If a stale or malformed auth response is cached, `supabase.auth.getSession()` may return incorrect data or hang waiting for a valid response.

**Evidence**: 
- The SW caches paths designed for Create React App (`/static/js/bundle.js`) not Vite (`/assets/`)
- Cache-first strategies are known to cause auth issues in SPAs

### Issue 2: OAuth Callback Cleanup Not Fully Isolated (Medium Probability)
While we fixed the `useOAuthCallback` hook to only process `state === 'google' || state === 'outlook'`, the hook still runs on Calendar and Settings pages. If the user navigates to these pages with leftover URL parameters from a previous OAuth flow, it could interfere.

### Issue 3: Missing `useMemo` for `isPreviewEnvironment` (Low but Real Bug)
The current code:
```typescript
const isPreviewEnvironment = isDevelopmentMode();  // Called every render
```

While this shouldn't cause infinite loops (boolean comparison is by value), it's inefficient and could interact poorly with React StrictMode double-renders.

## Proposed Solution

### Step 1: Exclude Auth Requests from Service Worker Cache
Update `public/sw.js` to bypass caching for Supabase and authentication-related requests:

```javascript
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Never cache auth/API requests - always fetch from network
  if (url.hostname.includes('supabase.co') ||
      url.pathname.includes('/auth/') ||
      event.request.method !== 'GET') {
    event.respondWith(fetch(event.request));
    return;
  }
  
  // For other requests, use cache-first strategy
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        return response || fetch(event.request);
      }
    )
  );
});
```

### Step 2: Memoize `isPreviewEnvironment` to Prevent Unnecessary Recalculations
Update `src/hooks/useAuth.tsx`:

```typescript
// Before
const isPreviewEnvironment = isDevelopmentMode();

// After
const isPreviewEnvironment = useMemo(() => isDevelopmentMode(), []);
```

### Step 3: Add Diagnostic Logging for Production Issues
Add console logs that will help debug future issues:

```typescript
console.log('[Auth] Environment:', {
  hostname: window.location.hostname,
  isPreviewEnvironment,
  timestamp: new Date().toISOString()
});
```

### Step 4: Clear URL Parameters After Supabase Auth Completes
In `src/pages/Auth.tsx`, ensure URL parameters are cleaned after successful authentication to prevent interference with other OAuth flows.

## Files to Modify

| File | Changes |
|------|---------|
| `public/sw.js` | Add network-first for Supabase/auth requests; update cache paths for Vite |
| `src/hooks/useAuth.tsx` | Wrap `isDevelopmentMode()` in `useMemo`; add diagnostic logging |
| `src/pages/Auth.tsx` | Clean URL params after successful OAuth |

## Expected Outcome
- Auth requests will always go to network, never served from stale cache
- Published site will load correctly in both normal and Private/Incognito modes
- Better diagnostic logging for future debugging

## Technical Note on Service Worker Behavior
Service Workers persist even in Incognito mode for the duration of the browsing session. If the user:
1. Visited the site previously
2. A broken auth response was cached
3. They now open in Incognito

The SW could still serve that cached response. The fix ensures auth requests are NEVER cached.

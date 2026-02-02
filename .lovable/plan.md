
# Fix: Stale App Version After Publishing

## Root Cause Analysis

Your project has **TWO caching layers** that are causing the stale version issue:

### 1. Service Worker Cache-First Strategy (Primary Culprit)

**File:** `public/sw.js` (lines 54-61)

```javascript
// For other requests, use cache-first strategy
event.respondWith(
  caches.match(event.request)
    .then((response) => {
      // Return cached version or fetch from network
      return response || fetch(event.request);
    }
  )
);
```

This means:
- When you publish a new version, the SW continues serving **old cached assets** (HTML, JS, CSS)
- The SW only fetches from network if cache misses
- `Ctrl+Shift+R` forces the browser to bypass cache, but **the SW still intercepts** and serves from its cache
- The SW install event caches `/` and `/assets/` but **doesn't update existing caches** until `skipWaiting()` is called

### 2. Missing Service Worker Update Detection

The current implementation lacks:
- No `updatefound` listener to detect when a new SW version is available
- No automatic `skipWaiting()` trigger on page load
- The user must manually unregister the SW from the Debug page to get updates

---

## Solution

### Fix 1: Add Network-First Strategy for HTML/Document Requests

Update the SW to use **network-first for navigation requests** (HTML documents) so the app shell always loads fresh:

**File:** `public/sw.js`

```javascript
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Never cache auth/API requests
  if (url.hostname.includes('supabase.co') ||
      url.hostname.includes('supabase.in') ||
      url.pathname.includes('/auth/') ||
      url.pathname.includes('/rest/') ||
      url.pathname.includes('/functions/') ||
      event.request.method !== 'GET') {
    event.respondWith(fetch(event.request));
    return;
  }
  
  // NETWORK-FIRST for navigation (HTML) requests - ensures fresh app shell
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Cache the fresh response for offline use
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
          return response;
        })
        .catch(() => {
          // Fallback to cache only if network fails (offline)
          return caches.match(event.request);
        })
    );
    return;
  }
  
  // Cache-first for static assets (JS, CSS, images)
  event.respondWith(
    caches.match(event.request)
      .then((response) => response || fetch(event.request))
  );
});
```

### Fix 2: Auto-Update Service Worker on New Version

Update the registration to detect updates and activate them immediately:

**File:** `src/hooks/useNotifications.tsx` - Update `registerServiceWorker`:

```typescript
const registerServiceWorker = async () => {
  try {
    const registration = await navigator.serviceWorker.register('/sw.js', {
      updateViaCache: 'none' // Force browser to check for SW updates
    });
    console.log('Service Worker registered:', registration);
    
    // Check for updates on page load
    registration.update();
    
    // Listen for new SW waiting
    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      if (newWorker) {
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // New version available - activate it immediately
            console.log('New Service Worker version available, activating...');
            newWorker.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      }
    });
    
    // Reload page when new SW takes over
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        console.log('New Service Worker activated, reloading page...');
        window.location.reload();
      }
    });
    
    // Get existing subscription
    const existingSubscription = await registration.pushManager.getSubscription();
    setSubscription(existingSubscription);
    
    if (existingSubscription) {
      await syncSubscriptionWithBackend(existingSubscription);
    }
  } catch (error) {
    console.error('Service Worker registration failed:', error);
  }
};
```

### Fix 3: Bump Cache Version on Each Deploy

Add a version identifier to the cache name so old caches are automatically cleared:

**File:** `public/sw.js`

```javascript
// Increment this on each deploy to bust old caches
const CACHE_VERSION = 'v3'; // Bump this when publishing
const CACHE_NAME = `task-manager-${CACHE_VERSION}`;
```

---

## Summary of Changes

| File | Change |
|------|--------|
| `public/sw.js` | Network-first for navigation, cache-first for assets, versioned cache name |
| `src/hooks/useNotifications.tsx` | Add SW update detection and auto-reload on new version |

---

## Why Ctrl+Shift+R Doesn't Work

Even with hard refresh:
1. Browser bypasses **browser cache**
2. But the **Service Worker still intercepts** the request
3. SW returns cached response from its own cache (IndexedDB-backed)
4. Only unregistering the SW or the SW detecting an update can fix this

## Immediate Workaround

Until this fix is deployed, users can clear the stale version by:
1. Going to `/debug` 
2. Clicking "Unregister SW"
3. Clicking "Clear Storage"
4. Hard refresh

Or in DevTools:
1. Application tab > Service Workers > Unregister
2. Application tab > Storage > Clear site data

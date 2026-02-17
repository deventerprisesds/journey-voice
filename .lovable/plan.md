

# Custom Notification Icons

## What Changes

Replace the default favicon in push notifications with the Iris logo so notifications show your branded icon in the notification shade.

## Icon Selection

- **Main icon** (192x192): The blue Iris logo on transparent background (`Screenshot_2026-02-05_141220.png`) -- this shows as the large icon in the notification panel and works well on both light and dark backgrounds
- **Badge** (72x72): The white Iris logo on transparent background (`Screenshot_2026-01-28_140309-removebg-preview.png`) -- this is the small monochrome icon in the Android status bar

## Changes

### 1. Copy Icon Assets to `public/icons/`

```
public/icons/iris-icon-192.png   <-- blue logo (from Screenshot_2026-02-05_141220.png)
public/icons/iris-badge-72.png   <-- white logo (from Screenshot_2026-01-28_140309-removebg-preview.png)
```

### 2. Update Push Payload (`send-push-notification/index.ts`)

Line 127-128:
```
icon: '/favicon.ico'   -->  icon: '/icons/iris-icon-192.png'
badge: '/favicon.ico'   -->  badge: '/icons/iris-badge-72.png'
```

### 3. Update Service Worker Fallbacks (`public/sw.js`)

Update all fallback icon/badge references from `/favicon.ico` to the new paths, and bump `CACHE_VERSION` from `v5` to `v6`.

## Files Changed

| File | Change |
|------|--------|
| `public/icons/iris-icon-192.png` | New -- blue Iris logo for notification icon |
| `public/icons/iris-badge-72.png` | New -- white Iris logo for status bar badge |
| `send-push-notification/index.ts` | Update icon and badge paths |
| `public/sw.js` | Update fallback icon paths, bump cache to v6 |

## Note on Ringtones

Custom notification sounds are not supported by the Web Push API on Android Chrome -- the device always plays the default notification tone. This is a browser limitation. A native app wrapper (Capacitor) would be needed for custom ringtones.


// Service Worker for Push Notifications
// Increment this on each deploy to bust old caches
const CACHE_VERSION = 'v4';
const CACHE_NAME = `task-manager-${CACHE_VERSION}`;
const urlsToCache = [
  '/',
  '/assets/'
];

// Install event - cache resources
self.addEventListener('install', (event) => {
  console.log('Service Worker installing, version:', CACHE_VERSION);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('Service Worker activating, version:', CACHE_VERSION);
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Fetch event - use network-first for navigation, cache-first for assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Never cache auth/API requests - always fetch from network
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
      .then((response) => {
        return response || fetch(event.request);
      })
  );
});

// Push event - handle incoming push notifications
self.addEventListener('push', (event) => {
  console.log('Push event received:', event);
  
  let notificationData = {};
  
  if (event.data) {
    try {
      notificationData = event.data.json();
    } catch (e) {
      notificationData = {
        title: 'Task Reminder',
        body: event.data.text() || 'You have a task due soon!',
        icon: '/favicon.ico',
        badge: '/favicon.ico'
      };
    }
  } else {
    notificationData = {
      title: 'Task Manager',
      body: 'You have a new notification!',
      icon: '/favicon.ico',
      badge: '/favicon.ico'
    };
  }

  const notificationOptions = {
    body: notificationData.body,
    icon: notificationData.icon || '/favicon.ico',
    badge: notificationData.badge || '/favicon.ico',
    data: notificationData.data || {},
    actions: notificationData.actions || [
      {
        action: 'view',
        title: 'View Task',
        icon: '/favicon.ico'
      },
      {
        action: 'dismiss',
        title: 'Dismiss',
        icon: '/favicon.ico'
      }
    ],
    requireInteraction: notificationData.requireInteraction || false,
    silent: false,
    vibrate: [200, 100, 200],
    tag: notificationData.tag || 'task-notification'
  };

  event.waitUntil(
    self.registration.showNotification(
      notificationData.title || 'Task Manager',
      notificationOptions
    )
  );
});

// Notification click event - handle user interactions with deep linking
self.addEventListener('notificationclick', (event) => {
  console.log('Notification clicked:', event);
  
  event.notification.close();

  if (event.action === 'dismiss') {
    return;
  }

  const notificationData = event.notification.data || {};
  
  // Determine URL based on notification data
  let urlToOpen = '/tasks?view=focus';
  
  // Handle chat/check-in notifications - open with Comms Console
  if (notificationData.openCommsConsole || 
      notificationData.type === 'chat_message' || 
      notificationData.type === 'scheduled_checkin') {
    urlToOpen = '/tasks?view=focus&openComms=true';
  } else if (notificationData.taskId) {
    urlToOpen = `/tasks?task=${notificationData.taskId}`;
  }

  console.log('Opening URL:', urlToOpen, 'with data:', notificationData);

  event.waitUntil(
    clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    }).then((clientList) => {
      // Check if app is already open
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          // Navigate client to the correct page if needed
          if (notificationData.openCommsConsole) {
            client.navigate(urlToOpen);
          }
          // Post message to open Comms Console
          client.postMessage({
            type: 'NOTIFICATION_CLICKED',
            data: notificationData
          });
          return client.focus();
        }
      }
      
      // Open new window if app is not open
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

// Background sync event - handle offline actions
self.addEventListener('sync', (event) => {
  console.log('Background sync event:', event.tag);
  
  if (event.tag === 'background-sync') {
    event.waitUntil(
      // Handle background sync tasks
      Promise.resolve()
    );
  }
});

// Message event - handle messages from the app
self.addEventListener('message', (event) => {
  console.log('Service Worker received message:', event.data);
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

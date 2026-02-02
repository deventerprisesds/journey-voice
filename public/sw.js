// Service Worker for Push Notifications
const CACHE_NAME = 'task-manager-v2';
const urlsToCache = [
  '/',
  '/assets/'
];

// Install event - cache resources
self.addEventListener('install', (event) => {
  console.log('Service Worker installing');
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
  console.log('Service Worker activating');
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

// Fetch event - serve from cache when offline
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Never cache auth/API requests - always fetch from network
  // This prevents stale Supabase auth responses from causing infinite loading
  if (url.hostname.includes('supabase.co') ||
      url.hostname.includes('supabase.in') ||
      url.pathname.includes('/auth/') ||
      url.pathname.includes('/rest/') ||
      url.pathname.includes('/functions/') ||
      event.request.method !== 'GET') {
    event.respondWith(fetch(event.request));
    return;
  }
  
  // For other requests, use cache-first strategy
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Return cached version or fetch from network
        return response || fetch(event.request);
      }
    )
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

// Notification click event - handle user interactions
self.addEventListener('notificationclick', (event) => {
  console.log('Notification clicked:', event);
  
  event.notification.close();

  if (event.action === 'dismiss') {
    return;
  }

  // Handle different actions
  let urlToOpen = '/';
  
  if (event.notification.data && event.notification.data.taskId) {
    urlToOpen = `/?task=${event.notification.data.taskId}`;
  } else if (event.action === 'view') {
    urlToOpen = '/';
  }

  event.waitUntil(
    clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    }).then((clientList) => {
      // Check if app is already open
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.postMessage({
            type: 'NOTIFICATION_CLICKED',
            data: event.notification.data
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
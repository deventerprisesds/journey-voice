import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

// Android bridge types injected by JavascriptBridge.kt
declare global {
  interface Window {
    __BRIDGE_PLATFORM__?: string;
    AndroidBridge?: {
      notify: (jsonPayload: string) => void;
      getFcmToken: () => string;
      isBridgeApp: () => boolean;
    };
  }
}

// window.AndroidBridge is registered via addJavascriptInterface() before page load — reliable at module eval time.
// window.__BRIDGE_PLATFORM__ is set via evaluateJavascript() which races with React bundle evaluation.
// User-agent is set before page load and is the most reliable fallback.
const isAndroidBridge = typeof window !== 'undefined' && (
  !!window.AndroidBridge ||
  navigator.userAgent.includes('BridgeApp/') ||
  window.__BRIDGE_PLATFORM__ === 'android'
);

interface NotificationSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export const useNotifications = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isSupported, setIsSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isAndroidBridge) {
      // Android bridge always supports notifications — no service worker needed
      setIsSupported(true);
      setPermission('granted');
      return;
    }

    const supported = 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
    setIsSupported(supported);
    if (supported) {
      setPermission(Notification.permission);
    }
  }, []);

  useEffect(() => {
    if (isAndroidBridge) {
      // Register FCM token with backend when user is available
      if (user) registerFcmToken();
      return;
    }

    if (isSupported && user) {
      registerServiceWorker();
    }
  }, [isSupported, user]);

  // ── Android: register FCM token with backend ────────────────────────────────

  const registerFcmToken = async () => {
    if (!user || !window.AndroidBridge) return;
    const token = window.AndroidBridge.getFcmToken();
    if (!token) return;

    try {
      await supabase.functions.invoke('manage-push-subscription', {
        body: { action: 'subscribe_fcm', fcmToken: token, userId: user.id }
      });
      // Mark as subscribed so the UI reflects the correct state
      setSubscription({ endpoint: `fcm:${token}` } as any);
    } catch (err) {
      console.error('[useNotifications] Failed to register FCM token:', err);
    }
  };

  // ── Web: service worker registration ───────────────────────────────────────

  const registerServiceWorker = async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', {
        updateViaCache: 'none'
      });
      console.log('Service Worker registered:', registration);

      registration.update();

      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              console.log('New Service Worker version available, activating...');
              newWorker.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        }
      });

      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshing) {
          refreshing = true;
          console.log('New Service Worker activated, reloading page...');
          window.location.reload();
        }
      });

      const existingSubscription = await (registration as any).pushManager.getSubscription();
      setSubscription(existingSubscription);

      if (existingSubscription) {
        await syncSubscriptionWithBackend(existingSubscription);
      }
    } catch (error) {
      console.error('Service Worker registration failed:', error);
    }
  };

  // ── requestPermission ───────────────────────────────────────────────────────

  const requestPermission = async (): Promise<boolean> => {
    if (isAndroidBridge) {
      // Android handles notification permission at install time
      setPermission('granted');
      return true;
    }

    if (!isSupported) {
      toast({
        title: "Not supported",
        description: "Push notifications are not supported in this browser",
        variant: "destructive",
      });
      return false;
    }

    try {
      const permission = await Notification.requestPermission();
      setPermission(permission);

      if (permission === 'granted') {
        toast({
          title: "Notifications enabled",
          description: "You'll now receive task reminders",
        });
        return true;
      } else {
        toast({
          title: "Notifications blocked",
          description: "You can enable them later in your browser settings",
          variant: "destructive",
        });
        return false;
      }
    } catch (error) {
      console.error('Error requesting notification permission:', error);
      toast({
        title: "Error",
        description: "Failed to request notification permission",
        variant: "destructive",
      });
      return false;
    }
  };

  // ── subscribe ───────────────────────────────────────────────────────────────

  const subscribe = async (): Promise<boolean> => {
    if (isAndroidBridge) {
      await registerFcmToken();
      toast({
        title: "Notifications enabled",
        description: "You'll receive native Android task reminders",
      });
      return true;
    }

    if (!isSupported || permission !== 'granted' || !user) return false;

    setIsLoading(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const vapidPublicKey = await getVapidPublicKey();

      const existingSubscription = await (registration as any).pushManager.getSubscription();
      if (existingSubscription) {
        console.log('[useNotifications] Removing existing subscription before re-subscribing');
        try {
          await existingSubscription.unsubscribe();
          await removeSubscriptionFromBackend();
        } catch (unsubError) {
          console.warn('[useNotifications] Could not unsubscribe old subscription:', unsubError);
        }
      }

      const pushSubscription = await (registration as any).pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey).buffer as ArrayBuffer
      });

      setSubscription(pushSubscription);

      const success = await syncSubscriptionWithBackend(pushSubscription);
      if (success) {
        toast({
          title: "Subscribed to notifications",
          description: "You'll receive task reminders and updates",
        });
        return true;
      } else {
        throw new Error('Failed to sync subscription with backend');
      }
    } catch (error) {
      console.error('[useNotifications] Error subscribing to push notifications:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast({
        title: "Subscription failed",
        description: `Push subscription error: ${errorMessage}`,
        variant: "destructive",
      });
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  // ── unsubscribe ─────────────────────────────────────────────────────────────

  const unsubscribe = async (): Promise<boolean> => {
    if (isAndroidBridge) {
      await removeSubscriptionFromBackend();
      setSubscription(null);
      toast({ title: "Unsubscribed", description: "You'll no longer receive push notifications" });
      return true;
    }

    if (!subscription || !user) return false;

    setIsLoading(true);
    try {
      const success = await subscription.unsubscribe();
      if (success) {
        await removeSubscriptionFromBackend();
        setSubscription(null);
        toast({ title: "Unsubscribed", description: "You'll no longer receive push notifications" });
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error unsubscribing from push notifications:', error);
      toast({
        title: "Unsubscription failed",
        description: "Failed to unsubscribe from push notifications",
        variant: "destructive",
      });
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  // ── forceResubscribe ────────────────────────────────────────────────────────

  const forceResubscribe = async (): Promise<boolean> => {
    if (isAndroidBridge) {
      await registerFcmToken();
      toast({ title: "Push refreshed", description: "FCM token re-registered" });
      return true;
    }

    if (!user) {
      toast({ title: "Not logged in", description: "Please log in to enable notifications", variant: "destructive" });
      return false;
    }

    setIsLoading(true);
    try {
      console.log('[useNotifications] Starting force resubscribe...');
      await removeSubscriptionFromBackend();

      const registration = await navigator.serviceWorker.ready;
      const existingSub = await (registration as any).pushManager.getSubscription();
      if (existingSub) {
        try {
          await existingSub.unsubscribe();
          console.log('[useNotifications] Successfully unsubscribed existing subscription');
        } catch (e) {
          console.warn('[useNotifications] Failed to unsubscribe existing:', e);
        }
      }
      setSubscription(null);

      try {
        const cacheNames = await caches.keys();
        for (const name of cacheNames) await caches.delete(name);
        console.log('[useNotifications] Cleared', cacheNames.length, 'caches');
      } catch (e) {
        console.warn('[useNotifications] Failed to clear caches:', e);
      }

      if (Notification.permission !== 'granted') {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') throw new Error('Notification permission denied');
      }

      const vapidPublicKey = await getVapidPublicKey();
      const pushSubscription = await (registration as any).pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey).buffer as ArrayBuffer
      });

      setSubscription(pushSubscription);
      const success = await syncSubscriptionWithBackend(pushSubscription);

      if (success) {
        toast({ title: "Push refreshed", description: "Successfully refreshed push notification registration" });
        return true;
      } else {
        throw new Error('Failed to sync new subscription with backend');
      }
    } catch (error) {
      console.error('[useNotifications] Force resubscribe failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast({ title: "Refresh failed", description: `Could not refresh push subscription: ${errorMessage}`, variant: "destructive" });
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  // ── sendTestNotification ────────────────────────────────────────────────────

  const sendTestNotification = async () => {
    if (isAndroidBridge && window.AndroidBridge) {
      window.AndroidBridge.notify(JSON.stringify({
        channel: 'task-reminders',
        title: '🧪 Test Notification',
        body: 'Native Android notification working correctly.',
        deepLink: '/',
        tag: 'test'
      }));
      toast({ title: "Test sent", description: "Check your Android notification shade" });
      return;
    }

    if (!user || !subscription) {
      toast({ title: "Not subscribed", description: "Please subscribe to notifications first", variant: "destructive" });
      return;
    }

    try {
      const { error } = await supabase.functions.invoke('send-unified-notification', {
        body: {
          userId: user.id,
          title: '🧪 Test Notification',
          body: 'This is a test notification from your task management app.',
          channels: ['EMAIL'],
          data: { type: 'test' }
        }
      });

      if (error) throw error;

      toast({ title: "Test notification sent", description: "Check your unified webhook for the test notification." });
    } catch (error) {
      console.error('Error sending test notification:', error);
      toast({ title: "Test failed", description: "Failed to send test notification", variant: "destructive" });
    }
  };

  // ── backend helpers ─────────────────────────────────────────────────────────

  const getVapidPublicKey = async (): Promise<string> => {
    const { data, error } = await supabase.functions.invoke('get-vapid-key');
    if (error || !data?.vapidPublicKey) throw new Error('Failed to fetch VAPID key');
    return data.vapidPublicKey;
  };

  const syncSubscriptionWithBackend = async (pushSubscription: PushSubscription): Promise<boolean> => {
    if (!user) return false;
    try {
      const { error } = await supabase.functions.invoke('manage-push-subscription', {
        body: {
          action: 'subscribe',
          subscription: {
            endpoint: pushSubscription.endpoint,
            keys: {
              p256dh: arrayBufferToBase64(pushSubscription.getKey('p256dh')!),
              auth: arrayBufferToBase64(pushSubscription.getKey('auth')!)
            }
          },
          userId: user.id
        }
      });
      if (error) { console.error('Error syncing subscription:', error); return false; }
      return true;
    } catch (error) {
      console.error('Error syncing subscription with backend:', error);
      return false;
    }
  };

  const removeSubscriptionFromBackend = async (): Promise<boolean> => {
    if (!user) return false;
    try {
      const { error } = await supabase.functions.invoke('manage-push-subscription', {
        body: { action: 'unsubscribe', userId: user.id }
      });
      if (error) { console.error('Error removing subscription:', error); return false; }
      return true;
    } catch (error) {
      console.error('Error removing subscription from backend:', error);
      return false;
    }
  };

  return {
    isSupported,
    permission,
    subscription: !!subscription,
    isLoading,
    isAndroidBridge,
    requestPermission,
    subscribe,
    unsubscribe,
    forceResubscribe,
    sendTestNotification
  };
};

// ── Utility functions ───────────────────────────────────────────────────────

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const binary = Array.from(bytes, byte => String.fromCharCode(byte)).join('');
  return window.btoa(binary);
}

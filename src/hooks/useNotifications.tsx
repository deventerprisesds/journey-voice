import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

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
    // Check if notifications are supported
    const supported = 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
    setIsSupported(supported);
    
    if (supported) {
      setPermission(Notification.permission);
    }
  }, []);

  useEffect(() => {
    if (isSupported && user) {
      // Register service worker and get existing subscription
      registerServiceWorker();
    }
  }, [isSupported, user]);

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
        // Sync subscription with backend
        await syncSubscriptionWithBackend(existingSubscription);
      }
    } catch (error) {
      console.error('Service Worker registration failed:', error);
    }
  };

  const requestPermission = async (): Promise<boolean> => {
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

  const subscribe = async (): Promise<boolean> => {
    if (!isSupported || permission !== 'granted' || !user) {
      return false;
    }

    setIsLoading(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      
      // Fetch current VAPID public key from backend
      const vapidPublicKey = await getVapidPublicKey();
      
      // Check for existing subscription with potentially different VAPID key
      // This handles VAPID key rotation gracefully
      const existingSubscription = await registration.pushManager.getSubscription();
      
      if (existingSubscription) {
        // Always unsubscribe first to handle VAPID key changes
        // PushManager.subscribe() throws if applicationServerKey differs from existing subscription
        console.log('[useNotifications] Removing existing subscription before re-subscribing');
        try {
          await existingSubscription.unsubscribe();
          await removeSubscriptionFromBackend();
        } catch (unsubError) {
          console.warn('[useNotifications] Could not unsubscribe old subscription:', unsubError);
          // Continue anyway - the new subscribe call will either work or fail gracefully
        }
      }
      
      // Create new subscription with current VAPID key
      const pushSubscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey).buffer as ArrayBuffer
      });

      setSubscription(pushSubscription);
      
      // Send subscription to backend
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
      console.error('[useNotifications] Error details:', errorMessage);
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

  const unsubscribe = async (): Promise<boolean> => {
    if (!subscription || !user) {
      return false;
    }

    setIsLoading(true);
    try {
      // Unsubscribe from push manager
      const success = await subscription.unsubscribe();
      
      if (success) {
        // Remove subscription from backend
        await removeSubscriptionFromBackend();
        setSubscription(null);
        
        toast({
          title: "Unsubscribed",
          description: "You'll no longer receive push notifications",
        });
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

  /**
   * Force resubscribe - clears all stale data and creates fresh subscription
   * Use when VAPID keys have changed or subscription is in a bad state
   */
  const forceResubscribe = async (): Promise<boolean> => {
    if (!user) {
      toast({
        title: "Not logged in",
        description: "Please log in to enable notifications",
        variant: "destructive",
      });
      return false;
    }

    setIsLoading(true);
    try {
      console.log('[useNotifications] Starting force resubscribe...');
      
      // 1. Remove all backend subscriptions for this user
      console.log('[useNotifications] Step 1: Removing backend subscriptions...');
      await removeSubscriptionFromBackend();
      
      // 2. Get current SW registration and unsubscribe from any push
      console.log('[useNotifications] Step 2: Unsubscribing from push manager...');
      const registration = await navigator.serviceWorker.ready;
      const existingSub = await registration.pushManager.getSubscription();
      if (existingSub) {
        try {
          await existingSub.unsubscribe();
          console.log('[useNotifications] Successfully unsubscribed existing subscription');
        } catch (e) {
          console.warn('[useNotifications] Failed to unsubscribe existing:', e);
        }
      }
      setSubscription(null);
      
      // 3. Clear the service worker cache to bust any stale data
      console.log('[useNotifications] Step 3: Clearing service worker caches...');
      try {
        const cacheNames = await caches.keys();
        for (const name of cacheNames) {
          await caches.delete(name);
        }
        console.log('[useNotifications] Cleared', cacheNames.length, 'caches');
      } catch (e) {
        console.warn('[useNotifications] Failed to clear caches:', e);
      }
      
      // 4. Ensure permission is still granted
      if (Notification.permission !== 'granted') {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          throw new Error('Notification permission denied');
        }
      }
      
      // 5. Now subscribe fresh with current VAPID key
      console.log('[useNotifications] Step 4: Creating fresh subscription...');
      const vapidPublicKey = await getVapidPublicKey();
      console.log('[useNotifications] Got VAPID key:', vapidPublicKey.substring(0, 20) + '...');
      
      const pushSubscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey).buffer as ArrayBuffer
      });
      
      console.log('[useNotifications] New subscription created:', pushSubscription.endpoint.substring(0, 50) + '...');
      setSubscription(pushSubscription);
      
      // 6. Sync with backend
      console.log('[useNotifications] Step 5: Syncing with backend...');
      const success = await syncSubscriptionWithBackend(pushSubscription);
      
      if (success) {
        console.log('[useNotifications] Force resubscribe completed successfully!');
        toast({
          title: "Push refreshed",
          description: "Successfully refreshed push notification registration",
        });
        return true;
      } else {
        throw new Error('Failed to sync new subscription with backend');
      }
    } catch (error) {
      console.error('[useNotifications] Force resubscribe failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast({
        title: "Refresh failed",
        description: `Could not refresh push subscription: ${errorMessage}`,
        variant: "destructive",
      });
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const getVapidPublicKey = async (): Promise<string> => {
    try {
      const { data, error } = await supabase.functions.invoke('get-vapid-key');
      
      if (error) {
        console.error('Error fetching VAPID key:', error);
        throw new Error('Failed to fetch VAPID key');
      }
      
      if (!data?.vapidPublicKey) {
        throw new Error('VAPID key not configured on server');
      }
      
      return data.vapidPublicKey;
    } catch (error) {
      console.error('Failed to get VAPID public key:', error);
      throw error;
    }
  };

  const syncSubscriptionWithBackend = async (pushSubscription: PushSubscription): Promise<boolean> => {
    if (!user) return false;

    try {
      const subscriptionData = {
        endpoint: pushSubscription.endpoint,
        keys: {
          p256dh: arrayBufferToBase64(pushSubscription.getKey('p256dh')!),
          auth: arrayBufferToBase64(pushSubscription.getKey('auth')!)
        }
      };

      // Call edge function to save subscription (pass userId explicitly per project pattern)
      const { error } = await supabase.functions.invoke('manage-push-subscription', {
        body: {
          action: 'subscribe',
          subscription: subscriptionData,
          userId: user.id
        }
      });

      if (error) {
        console.error('Error syncing subscription:', error);
        return false;
      }

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
        body: {
          action: 'unsubscribe',
          userId: user.id
        }
      });

      if (error) {
        console.error('Error removing subscription:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error removing subscription from backend:', error);
      return false;
    }
  };

  const sendTestNotification = async () => {
    if (!user || !subscription) {
      toast({
        title: "Not subscribed",
        description: "Please subscribe to notifications first",
        variant: "destructive",
      });
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

      if (error) {
        throw error;
      }

      toast({
        title: "Test notification sent",
        description: "Check your unified webhook for the test notification.",
      });
    } catch (error) {
      console.error('Error sending test notification:', error);
      toast({
        title: "Test failed",
        description: "Failed to send test notification",
        variant: "destructive",
      });
    }
  };

  return {
    isSupported,
    permission,
    subscription: !!subscription,
    isLoading,
    requestPermission,
    subscribe,
    unsubscribe,
    forceResubscribe,
    sendTestNotification
  };
};

// Utility functions
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const binary = Array.from(bytes, byte => String.fromCharCode(byte)).join('');
  return window.btoa(binary);
}
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
      const registration = await navigator.serviceWorker.register('/sw.js');
      console.log('Service Worker registered:', registration);
      
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
      
      // Generate VAPID public key or use existing one
      const vapidPublicKey = await getVapidPublicKey();
      
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
      console.error('Error subscribing to push notifications:', error);
      toast({
        title: "Subscription failed",
        description: "Failed to subscribe to push notifications",
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

  const getVapidPublicKey = async (): Promise<string> => {
    // In a real implementation, you'd get this from your backend
    // For demo purposes, we'll use a placeholder key
    // You should generate actual VAPID keys for production
    return 'BMqSvZPiJJXKVQr-8xI6U7VS_F3ZzXqj2x7tLuenJnyE8I_7xNcNSfXgzNhx3VXRn0wXOJNTWZW9CqZG4AQ5P-w';
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

      // Call edge function to save subscription
      const { error } = await supabase.functions.invoke('manage-push-subscription', {
        body: {
          action: 'subscribe',
          subscription: subscriptionData
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
          action: 'unsubscribe'
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
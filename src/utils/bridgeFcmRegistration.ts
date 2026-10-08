// Registers the Android bridge's FCM device token with journey's push store on EVERY app open.
//
// WHY: registration used to live only in useNotifications(), which is mounted by
// NotificationSettings alone — so after an app install/update rotated the token, the server kept the
// dead one (FCM 404 UNREGISTERED) until the user happened to open Settings → Notifications, and every
// full-screen alarm in between was silently dropped (2026-10-05 → 10-08). It also read the token once
// with no retry, while the bridge fetches it asynchronously.
//
// Same retry shape as Huddle's working version (huddle-extension-app HuddleView.tsx). Non-fatal.
import { supabase } from '@/integrations/supabase/client';

type Bridge = { getFcmToken?: () => string };

const ATTEMPTS = 10;
const INTERVAL_MS = 1500;
const done = new Set<string>(); // `${userId}:${token}` registered during this page load

export function registerBridgeFcmToken(userId: string): () => void {
  const bridge = (window as unknown as { AndroidBridge?: Bridge }).AndroidBridge;
  if (!userId || typeof bridge?.getFcmToken !== 'function') return () => {};

  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const attempt = async (n: number) => {
    if (cancelled) return;
    let token = '';
    try {
      token = bridge.getFcmToken?.() ?? '';
    } catch {
      token = '';
    }
    if (!token) {
      if (n + 1 < ATTEMPTS) timer = setTimeout(() => void attempt(n + 1), INTERVAL_MS);
      return;
    }
    const key = `${userId}:${token}`;
    if (done.has(key)) return;
    done.add(key);
    try {
      await supabase.functions.invoke('manage-push-subscription', {
        body: { action: 'subscribe_fcm', fcmToken: token, userId, source: 'web' },
      });
    } catch (err) {
      done.delete(key); // let the next app open retry
      console.warn('[bridgeFcmRegistration] register failed:', err);
    }
  };

  void attempt(0);
  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
}

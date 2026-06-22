import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface BridgeDiagnostics {
  isAndroidBridge: boolean;
  windowAndroidBridgePresent: boolean;
  bridgePlatformFlag: string | null;
  userAgentHasBridgeApp: boolean;
  userAgent: string;
  jsBundle: string;
  apkVersion: string | null;
  apkCapabilities: Record<string, unknown> | null;
  fcmTokenPresent: boolean;
  fcmTokenPrefix: string | null;
  pushSubEndpoint: string | null;
  loggedAt: string | null;
}

export function useBridgeDiagnostics(): BridgeDiagnostics | null {
  const { user } = useAuth();
  const [diag, setDiag] = useState<BridgeDiagnostics | null>(null);

  useEffect(() => {
    if (!user) return;

    const run = async () => {
      // Collect raw signals
      const windowAndroidBridgePresent = typeof window !== 'undefined' && !!window.AndroidBridge;
      const bridgePlatformFlag = typeof window !== 'undefined' ? (window.__BRIDGE_PLATFORM__ ?? null) : null;
      const userAgentHasBridgeApp = typeof navigator !== 'undefined' && navigator.userAgent.includes('BridgeApp/');
      const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';
      const isAndroidBridge = windowAndroidBridgePresent || userAgentHasBridgeApp || bridgePlatformFlag === 'android';

      // Bundle identity — Vite sets import.meta.url on every module
      const jsBundle = (import.meta as any).url ?? 'unknown';

      // APK capabilities (only present when bridge is live)
      let apkCapabilities: Record<string, unknown> | null = null;
      let apkVersion: string | null = null;
      if (windowAndroidBridgePresent && window.AndroidBridge) {
        try {
          const raw = (window.AndroidBridge as any).getCapabilities?.();
          if (raw) {
            apkCapabilities = JSON.parse(raw);
            apkVersion = (apkCapabilities?.version as string) ?? null;
          }
        } catch { /* bridge not ready yet */ }
      }

      // FCM token
      let fcmTokenPresent = false;
      let fcmTokenPrefix: string | null = null;
      if (windowAndroidBridgePresent && window.AndroidBridge) {
        try {
          const token = window.AndroidBridge.getFcmToken?.() ?? '';
          fcmTokenPresent = token.length > 0;
          fcmTokenPrefix = token.length > 0 ? token.slice(0, 20) : null;
        } catch { /* ignore */ }
      }

      // Latest push sub endpoint from DB
      let pushSubEndpoint: string | null = null;
      try {
        const { data } = await supabase
          .from('push_subscriptions')
          .select('endpoint')
          .eq('user_id', user.id)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        pushSubEndpoint = data?.endpoint ?? null;
      } catch { /* ignore */ }

      const loggedAt = new Date().toISOString();

      // Write to DB — gives us a permanent record per load
      try {
        await supabase.from('bridge_diagnostics').insert({
          user_id: user.id,
          is_android_bridge: isAndroidBridge,
          user_agent: userAgent,
          js_bundle: jsBundle,
          window_android_bridge_present: windowAndroidBridgePresent,
          bridge_platform_flag: bridgePlatformFlag,
          apk_version: apkVersion,
          apk_capabilities: apkCapabilities,
          fcm_token_present: fcmTokenPresent,
          fcm_token_prefix: fcmTokenPrefix,
          push_sub_endpoint: pushSubEndpoint,
        });
      } catch { /* non-fatal */ }

      setDiag({
        isAndroidBridge,
        windowAndroidBridgePresent,
        bridgePlatformFlag,
        userAgentHasBridgeApp,
        userAgent,
        jsBundle,
        apkVersion,
        apkCapabilities,
        fcmTokenPresent,
        fcmTokenPrefix,
        pushSubEndpoint,
        loggedAt,
      });
    };

    run();
  }, [user]);

  return diag;
}

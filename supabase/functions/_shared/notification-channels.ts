// WHAT:       the ONE canonical notification-channel vocabulary + the ONE honest
//             delivery-outcome summariser, shared by every edge function and the app.
// WHY:        two live defects measured 2026-09-13 against this branch --
//             (F3) `send-unified-notification` matches UPPERCASE channel names
//             ('PUSH' :597, 'SLACK' :831, 'OUTLOOK_EVENT' :450) while
//             `notification-delivery:240` sent lowercase `commsMode`, so every
//             special-cased branch was unreachable from that caller; and
//             (F2) `send-unified-notification:649`
//             `result.success = channelSuccesses.length > 0 || result.errors.length === 0`
//             reported success for a partial fan-out AND for a fan-out that attempted
//             ZERO channels, which `notification-delivery` then stored as
//             `deliverySuccess = true`.
// SUPERSEDES: nothing (no prior channel-vocabulary module existed -- verified by
//             `grep -rn "OUTLOOK_EVENT" supabase/functions/`, which found only
//             inline string literals at each call site).
// SUPERSEDED-BY: nothing -- current
// EVIDENCE:   .claude/AC-digest-delivery.md findings F2/F3; guards in
//             src/utils/notificationChannels.test.ts (AC-CH-1..4).

/**
 * Canonical channel names. UPPERCASE was chosen by evidence, not preference:
 * every other caller in the repo already sends UPPERCASE
 * (NotificationSettings.tsx:543/558/571/611, NotificationStatusDashboard.tsx:183
 * `channel.toUpperCase()`, useNotifications.tsx:382, execute-tool 1539/1753/1785/1828/1883)
 * and `user_preferences.channels` stores UPPERCASE (`['EMAIL']`, `['PUSH']`).
 * Only notification-delivery's scheduled-call path sent lowercase.
 */
export const CANONICAL_CHANNELS = [
  'EMAIL',
  'SLACK',
  'PUSH',
  'OUTLOOK_EVENT',
  'GOOGLE_EVENT',
  'APP_MESSAGE',
  'PHONE',
] as const;

export type CanonicalChannel = (typeof CANONICAL_CHANNELS)[number];

/**
 * Every spelling seen in the wild maps to exactly one canonical name.
 * Keys are lowercased before lookup, so 'Email'/'EMAIL'/'email' all resolve.
 * `CommsMode` values ('phone' | 'app_message' | 'slack' | 'email') are included
 * so a stored scheduled-call row needs no migration.
 */
const CHANNEL_ALIASES: Record<string, CanonicalChannel> = {
  email: 'EMAIL',
  mail: 'EMAIL',
  slack: 'SLACK',
  push: 'PUSH',
  app_message: 'APP_MESSAGE',
  'app-message': 'APP_MESSAGE',
  appmessage: 'APP_MESSAGE',
  chat: 'APP_MESSAGE',
  phone: 'PHONE',
  call: 'PHONE',
  voice: 'PHONE',
  outlook_event: 'OUTLOOK_EVENT',
  outlook: 'OUTLOOK_EVENT',
  google_event: 'GOOGLE_EVENT',
  google: 'GOOGLE_EVENT',
  gcal: 'GOOGLE_EVENT',
};

/** Returns the canonical name, or null for an unrecognised channel. Never throws. */
export function toCanonicalChannel(raw: unknown): CanonicalChannel | null {
  if (typeof raw !== 'string') return null;
  const key = raw.trim().toLowerCase();
  if (!key) return null;
  return CHANNEL_ALIASES[key] ?? null;
}

/** Normalise a caller's channel list: canonicalise, drop unknowns, dedupe, preserve order. */
export function normalizeChannels(raw: unknown): CanonicalChannel[] {
  const list = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const out: CanonicalChannel[] = [];
  for (const item of list) {
    const c = toCanonicalChannel(item);
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

/**
 * The key a channel's result is stored under in `channelResults`.
 * send-unified-notification already lowercases (`channel.toLowerCase()` :880/:908/:918/:926)
 * and uses `outlook`/`google` for the calendar channels (:469, :523) -- matched here so
 * this module reads the results the sender actually writes rather than a second shape.
 */
export function channelResultKey(channel: CanonicalChannel): string {
  if (channel === 'OUTLOOK_EVENT') return 'outlook';
  if (channel === 'GOOGLE_EVENT') return 'google';
  return channel.toLowerCase();
}

export type DeliveryOutcome = 'success' | 'partial' | 'failed';

export interface PerChannelOutcome {
  channel: CanonicalChannel;
  success: boolean;
  /** Why it is not a success. 'not_reported' = the sender returned no result for it. */
  error?: string;
}

export interface DeliverySummary {
  outcome: DeliveryOutcome;
  perChannel: PerChannelOutcome[];
  attempted: number;
  succeeded: number;
  failed: number;
  reason: string;
}

interface RawChannelResult {
  success?: boolean;
  error?: string;
  details?: unknown;
}

/**
 * The single honest answer to "did this notification get delivered?".
 *
 * Rules, each one closing a measured way the old code lied:
 *  - a transport error (non-2xx / thrown invoke) is `failed`, whatever the body says;
 *  - ZERO channels requested is `failed`, never success -- this is the vacuous pass at
 *    send-unified-notification:649 (`|| result.errors.length === 0`);
 *  - a requested channel with NO entry in channelResults counts as NOT delivered
 *    ('absent evidence is not_applicable, never pass');
 *  - all requested channels succeeded => `success`;
 *  - at least one succeeded and at least one did not => `partial`, NEVER success.
 *    This is F2: a fan-out where email failed and slack succeeded returned HTTP 200,
 *    so `functions.invoke` reported no error and the caller stored success.
 */
export function summarizeDelivery(
  requestedChannels: unknown,
  channelResults: Record<string, RawChannelResult | undefined> | null | undefined,
  transportError?: string | null,
): DeliverySummary {
  const requested = normalizeChannels(requestedChannels);

  if (requested.length === 0) {
    return {
      outcome: 'failed',
      perChannel: [],
      attempted: 0,
      succeeded: 0,
      failed: 0,
      reason: transportError
        ? `transport error: ${transportError}`
        : 'no channels were requested, so nothing was delivered',
    };
  }

  const results = channelResults ?? {};
  const perChannel: PerChannelOutcome[] = requested.map((channel) => {
    if (transportError) {
      return { channel, success: false, error: `transport error: ${transportError}` };
    }
    const entry = results[channelResultKey(channel)];
    if (!entry || typeof entry.success !== 'boolean') {
      return { channel, success: false, error: 'not_reported' };
    }
    return entry.success
      ? { channel, success: true }
      : { channel, success: false, error: entry.error ?? 'channel reported failure' };
  });

  const succeeded = perChannel.filter((c) => c.success).length;
  const failed = perChannel.length - succeeded;

  let outcome: DeliveryOutcome;
  if (succeeded === perChannel.length) outcome = 'success';
  else if (succeeded > 0) outcome = 'partial';
  else outcome = 'failed';

  const failedNames = perChannel.filter((c) => !c.success).map((c) => `${c.channel}(${c.error})`);
  const reason =
    outcome === 'success'
      ? `all ${succeeded} channel(s) delivered`
      : transportError
        ? `transport error: ${transportError}`
        : `${succeeded}/${perChannel.length} delivered; not delivered: ${failedNames.join(', ')}`;

  return { outcome, perChannel, attempted: perChannel.length, succeeded, failed, reason };
}

/** True only when every requested channel was delivered. Used to gate HTTP 200 vs 207. */
export function isFullDelivery(summary: DeliverySummary): boolean {
  return summary.outcome === 'success';
}

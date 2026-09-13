// WHAT:       the pure rules for a scheduled call's multi-select delivery channels — which ones are
//             currently selected, and what toggling one does.
// WHY:        these two rules lived inside `VoiceAssistantSettings.tsx` as closures over React state,
//             so nothing could test them. A verifier named this as the ONE claim it could neither
//             mutation-prove nor cover: "handleToggleCallCommsMode has no test." Both rules are
//             load-bearing — the fallback is what keeps an untouched legacy row behaving exactly as
//             before, and the last-channel floor is what stops a call being saved with no delivery
//             method at all, which would schedule happily and then deliver nowhere.
// SUPERSEDES: nothing (the component keeps the same behaviour; it now imports it)
// SUPERSEDED-BY: nothing -- current
// EVIDENCE:   src/utils/commsModes.test.ts; .claude/VERIFY-digest-delivery-loop2.md finding 3.

import type { CommsMode, ScheduledCall } from '@/services/schedulingService';

/**
 * The delivery methods a call is actually sent on.
 *
 * `commsModes` (multi-select) is the new shape; `commsMode` (scalar) is what every EXISTING stored
 * row has, so it stays the fallback. `notification-delivery/index.ts:172-182` resolves the identical
 * precedence server-side — array first, scalar second, `'phone'` last — so an untouched row behaves
 * exactly as it did before this control became multi-select. Those two implementations must agree;
 * if one changes, change both.
 */
export function selectedCommsModes(
  call: Pick<ScheduledCall, 'commsMode' | 'commsModes'>,
): CommsMode[] {
  return call.commsModes && call.commsModes.length > 0
    ? call.commsModes
    : [call.commsMode || 'phone'];
}

/**
 * Toggle one channel on or off, returning the NEW call (or the same object when the toggle is a
 * no-op). Pure: no React state, no mutation of the input.
 *
 * Two rules that are not obvious from the signature:
 *  - Unchecking the LAST channel is refused. A call with no delivery method still schedules, still
 *    fires, and then delivers nowhere — indistinguishable from a broken sender.
 *  - The scalar `commsMode` is kept in step with the head of the array, so an older reader (or
 *    `scheduleNextOccurrence`, which preserves `comms_mode` onto tomorrow's row) can never resurrect
 *    a channel the user just turned off.
 */
export function toggleCommsMode<T extends Pick<ScheduledCall, 'commsMode' | 'commsModes'>>(
  call: T,
  mode: CommsMode,
  on: boolean,
): T {
  const current = selectedCommsModes(call);
  const next = on
    ? [...new Set([...current, mode])]
    : current.filter((m) => m !== mode);
  if (next.length === 0) return call;
  return { ...call, commsModes: next, commsMode: next[0] };
}

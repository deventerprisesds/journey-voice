import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CANONICAL_CHANNELS,
  toCanonicalChannel,
  normalizeChannels,
  channelResultKey,
  summarizeDelivery,
  isFullDelivery,
} from '../../supabase/functions/_shared/notification-channels.ts';

/**
 * Guards for AC-CH-1..4 of .claude/AC-digest-delivery.md (findings F2, F3).
 *
 * F3 (measured): send-unified-notification matches UPPERCASE channel names
 * ('OUTLOOK_EVENT' :450, 'PUSH' :597, 'GOOGLE_EVENT' :783, 'SLACK' :831) while
 * notification-delivery:240 sent `channels: [commsMode]` with CommsMode lowercase
 * ('phone'|'app_message'|'slack'|'email'), and twilio-voice-handler:1757 sent
 * `fallbackMode === 'email' ? 'email' : 'SLACK'`. Every special-cased branch was
 * unreachable from those two callers.
 *
 * F2 (measured): send-unified-notification:649
 *   result.success = channelSuccesses.length > 0 || result.errors.length === 0
 * was true for a PARTIAL fan-out and for one that attempted ZERO channels, and
 * :659 `status: result.success ? 200 : 207` therefore returned 200 for a partial —
 * so `functions.invoke` reported no error and notification-delivery stored
 * `deliverySuccess = true` for a notification the user never received.
 */

const SENDER = 'supabase/functions/send-unified-notification/index.ts';
const DELIVERY = 'supabase/functions/notification-delivery/index.ts';
const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf-8');

describe('AC-CH-1 — one canonical channel vocabulary', () => {
  it('every CommsMode value resolves to a canonical channel the sender can match', () => {
    // CommsMode from src/services/schedulingService.ts:42
    for (const mode of ['phone', 'app_message', 'slack', 'email'] as const) {
      const canonical = toCanonicalChannel(mode);
      assert.ok(canonical, `CommsMode '${mode}' must map to a canonical channel`);
      assert.ok(
        (CANONICAL_CHANNELS as readonly string[]).includes(canonical),
        `'${mode}' -> '${canonical}' is not canonical`,
      );
      assert.equal(canonical, canonical.toUpperCase(), 'canonical names are UPPERCASE');
    }
    assert.equal(toCanonicalChannel('email'), 'EMAIL');
    assert.equal(toCanonicalChannel('slack'), 'SLACK');
  });

  it('case and duplicates collapse to one canonical list', () => {
    assert.deepEqual(normalizeChannels(['email', 'EMAIL', 'Email', 'slack']), ['EMAIL', 'SLACK']);
    assert.deepEqual(normalizeChannels(['nonsense']), []);
    assert.deepEqual(normalizeChannels(null), []);
    assert.deepEqual(normalizeChannels('slack'), ['SLACK']);
  });

  it('every channel literal the sender branches on is in the canonical vocabulary', () => {
    const src = read(SENDER);
    const literals = new Set(
      [...src.matchAll(/channels\.includes\('([A-Z_]+)'\)/g)].map((m) => m[1]),
    );
    assert.ok(literals.size >= 3, `expected the sender to branch on several channels, saw ${[...literals]}`);
    for (const lit of literals) {
      assert.ok(
        (CANONICAL_CHANNELS as readonly string[]).includes(lit),
        `sender branches on '${lit}', which is not in CANONICAL_CHANNELS`,
      );
    }
  });

  it('the sender canonicalises its input instead of trusting the caller (F3)', () => {
    const src = read(SENDER);
    assert.match(
      src,
      /const channels = normalizeChannels\(rawChannels\)/,
      'send-unified-notification must normalise channels at entry, or a lowercase caller silently misses every branch',
    );
  });

  it('notification-delivery no longer forwards a raw lowercase commsMode as a channel (F3)', () => {
    const src = read(DELIVERY);
    assert.doesNotMatch(
      src,
      /channels:\s*\[commsMode\]/,
      'the exact F3 defect: `channels: [commsMode]` sends lowercase to an UPPERCASE matcher',
    );
    assert.match(src, /channels: unifiedChannels/, 'it must send the normalised channel list');
    assert.match(src, /normalizeChannels\(unifiedModes\)/, 'and build that list through the shared normaliser');
  });
});

describe('AC-CH-2 — multi-select fans out to every selected channel', () => {
  it('three selected channels produce three per-channel outcomes with real booleans', () => {
    const summary = summarizeDelivery(
      ['email', 'PUSH', 'slack'],
      { email: { success: true }, push: { success: true }, slack: { success: true } },
    );
    assert.equal(summary.attempted, 3);
    assert.deepEqual(
      summary.perChannel.map((c) => c.channel).sort(),
      ['EMAIL', 'PUSH', 'SLACK'],
    );
    // The AC's stated trap: keys can be pre-seeded. Assert a real boolean per channel.
    for (const c of summary.perChannel) assert.equal(typeof c.success, 'boolean');
    assert.equal(summary.outcome, 'success');
  });

  it('a requested channel with NO reported result counts as NOT delivered, never as a pass', () => {
    // 'absent evidence is not_applicable, never pass'
    const summary = summarizeDelivery(['email', 'slack'], { slack: { success: true } });
    assert.equal(summary.outcome, 'partial');
    const email = summary.perChannel.find((c) => c.channel === 'EMAIL');
    assert.equal(email?.success, false);
    assert.equal(email?.error, 'not_reported');
  });

  it('notification-delivery reads a MODES array and still honours the stored scalar', () => {
    const src = read(DELIVERY);
    assert.match(src, /liveCall\?\.commsModes/, 'must read the multi-select array');
    assert.match(src, /liveCall\?\.commsMode \?\? callConfig\.comms_mode/, 'must keep the scalar fallback for existing rows');
    assert.match(src, /commsModes\.filter\(\(m\) => m === 'slack' \|\| m === 'email'\)/, 'slack+email must fan out in ONE invoke');
  });
});

describe('AC-CH-3/AC-CH-4 — a partial fan-out is NEVER recorded as a success (F2)', () => {
  it('email fails, push succeeds => partial, and NOT full delivery', () => {
    const summary = summarizeDelivery(
      ['EMAIL', 'PUSH'],
      { email: { success: false, error: 'SMTP 550' }, push: { success: true } },
    );
    assert.equal(summary.outcome, 'partial');
    assert.equal(isFullDelivery(summary), false, 'partial must not gate a success claim');
    assert.equal(summary.perChannel.find((c) => c.channel === 'PUSH')?.success, true, 'the healthy channel still delivered');
    assert.equal(summary.perChannel.find((c) => c.channel === 'EMAIL')?.success, false);
    assert.match(summary.reason, /EMAIL/, 'the reason must name the channel that did not deliver');
  });

  it('ZERO channels attempted with zero errors must not count as delivered (the vacuous pass at :649)', () => {
    const summary = summarizeDelivery([], {});
    assert.equal(summary.outcome, 'failed');
    assert.equal(isFullDelivery(summary), false);
    assert.equal(summary.attempted, 0);
  });

  it('a transport error is failed whatever the body claims', () => {
    const summary = summarizeDelivery(['EMAIL'], { email: { success: true } }, 'non-2xx');
    assert.equal(summary.outcome, 'failed');
    assert.equal(summary.perChannel[0].success, false);
  });

  it('all channels delivered => success', () => {
    const summary = summarizeDelivery(['EMAIL', 'SLACK'], { email: { success: true }, slack: { success: true } });
    assert.equal(summary.outcome, 'success');
    assert.equal(isFullDelivery(summary), true);
  });

  it('result keys match the keys the sender actually writes', () => {
    assert.equal(channelResultKey('OUTLOOK_EVENT'), 'outlook');
    assert.equal(channelResultKey('GOOGLE_EVENT'), 'google');
    assert.equal(channelResultKey('EMAIL'), 'email');
  });

  it('the sender gates success on FULL delivery, not on "at least one" (F2)', () => {
    const src = read(SENDER);
    assert.doesNotMatch(
      src,
      /result\.success = channelSuccesses\.length > 0 \|\| result\.errors\.length === 0/,
      'the exact F2 defect expression must not return',
    );
    assert.match(src, /result\.success = isFullDelivery\(deliverySummary\)/);
  });

  it('notification-delivery does not treat "no invoke error" as delivered (F2)', () => {
    const src = read(DELIVERY);
    // The defect: `if (unifiedError) {...} else { deliverySuccess = true }` — a 2xx partial
    // took the else branch.
    assert.doesNotMatch(src, /deliverySuccess = true/, 'success must not be inferred from the absence of a transport error');
    assert.match(src, /summarizeDelivery\(\s*unifiedChannels/, 'it must summarise the per-channel body instead');
    // The stored row must be able to say "partial".
    assert.match(src, /summary\.outcome === 'partial'/);
    assert.match(src, /failure_reason: `partial: \$\{summary\.reason\}`/, 'a partial row must carry a non-null failure_reason so no query reads it as clean success');
  });

  it('the unified body is RENDERED, not the raw phone script interpolated (F-script-leak)', () => {
    const src = read(DELIVERY);
    // THE DEFECT, measured: notification-delivery built every channel's body as
    //   `Time for your ${name.toLowerCase()}. ${callConfig.context || ''}`
    // and `context` is the phone script the assistant reads aloud, so a Morning Kickstart
    // EMAIL arrived reading "BRANCH 1... Greet: Hello Sir". renderScheduledCall keeps the
    // script for `phone` and returns a human sentence for read channels; digestContent.test
    // proves that behaviour, and this proves the delivery function actually calls it.
    assert.doesNotMatch(
      src,
      /body: `Time for your \$\{[^`]*\}\. \$\{callConfig\.context/,
      'the exact leak: the phone script interpolated straight into the unified body',
    );
    // WIDENED 2026-09-14, and deliberately widened rather than relaxed. This used to require the
    // literal `body: renderScheduledCall({...}).body`, which pinned ONE function name rather than
    // the invariant — and that turned out to protect the wrong thing. renderScheduledCall's
    // read-channel branch is `${subject}.`, so satisfying this assertion produced four real emails
    // whose entire content was "Time for your morning kickstart." The script was gone; so was
    // everything worth reading. A guard that a hollow implementation passes is not protecting the
    // reader.
    //
    // The invariant is TWO things, and both are asserted now:
    //   1. the body is produced by a RENDERER, never the raw context (the anti-leak half, above);
    //   2. whatever body is sent is CHECKED by containsCallScript before it goes (the half the
    //      old name-pin only implied by proxy).
    assert.match(
      src,
      /body: (?:briefingBody|renderScheduledCall\(|renderBriefingBody\()/,
      'the unified invoke body must come from a renderer, never from callConfig.context',
    );
    assert.match(
      src,
      /containsCallScript\(/,
      'the delivered body must be leak-checked, whichever renderer produced it',
    );
    assert.match(src, /from "\.\.\/_shared\/digest-content\.ts"/);
  });

  it('the unified body is not merely the one-line render (F-hollow-email)', () => {
    // The 2026-09-14 regression, guarded at its own level. The owner received four emails reading
    // exactly one sentence and said: "each email had exactly one sentence... this proves nothing."
    // The delivery function must fetch the window's tasks and render a briefing; the thin render
    // is a FALLBACK for a detected leak, never the normal path.
    const src = read(DELIVERY);
    assert.match(src, /getTasksForWindow\(/, 'the briefing must read the real scheduled tasks');
    assert.match(src, /renderBriefingBody\(\{/, 'the normal path renders a briefing, not a sentence');
    // THE ASSERTION THAT ACTUALLY BITES, added after mutate.sh reported the first two INERT.
    // Reinstating the defect — building the briefing and then sending the one-line render anyway —
    // left both greps above satisfied, because a renderer that is CALLED but whose output is
    // DISCARDED still appears in the source. That is not a hypothetical: renderBriefingBody sat in
    // this repo with zero callers for a day for exactly that reason. So pin what is SENT.
    assert.match(
      src,
      /body: briefingBody,/,
      'the unified invoke must SEND the briefing — calling the renderer and discarding it is the bug',
    );
    // ...and the thin render must remain reachable ONLY as the leak fallback.
    assert.match(
      src,
      /containsCallScript\(briefingBody\)[\s\S]{0,400}?briefingBody = renderScheduledCall\(/,
      'renderScheduledCall is the fallback for a detected leak, not the normal path',
    );
  });
});

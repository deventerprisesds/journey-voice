// =============================================================================
// WHAT:       executable proof for the digest SOURCE switch and the Huddle stand-up pull.
// WHY:        the owner's ruling, verbatim: "by default it should be pulling from whatever the
//             source app is unless integrated and if integrated journey would be the switch so in
//             our case it should be using journey" (2026-09-13). Plus the third digest: "the output
//             of Terry's stand-up which is currently in chat only."
// EVIDENCE:   the Huddle half is huddle-extension-app scripts/standup-deliver-mode.test.ts.
// Run: npm test   (node --experimental-strip-types --test src/utils/*.test.ts)
// =============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isHuddleIntegrated,
  resolveDigestSource,
  HUDDLE_STANDUP_URL_DEFAULT,
} from '../../supabase/functions/_shared/digest-source.ts';
import {
  fetchHuddleStandup,
  toStandupPayload,
  standupDigestIsEmpty,
  loadStandupDigestPayload,
} from '../../supabase/functions/_shared/digest-source-standup.ts';
import { MissingDeepLinkBaseError } from '../../supabase/functions/_shared/digest-content.ts';

const CONTENT = {
  produced: [{ title: 'Pricing one-pager', agent: 'Terry Locke' }],
  blocked: [{ title: 'Vendor contract', reason: 'waiting on your signature' }],
  inReview: [{ title: 'Q3 deck', agent: 'Finn Reid' }],
  // ALREADY ranked by Huddle's rankTasks -- position IS the rank.
  priorities: [{ title: 'Ship the API' }, { title: 'Call the bank' }],
  brief: 'Yesterday the team shipped the pricing one-pager.',
};

const OPTS = { date: '2026-09-13', timezone: 'America/New_York', deepLink: 'https://j.example/priorities' };

/** An env stub, so nothing here depends on the process's real environment. */
const envOf = (vars: Record<string, string>) => ({ get: (k: string) => vars[k] });

/** A fetch stub that records what it was called with and returns a canned response. */
function stubFetch(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const seen: { url: string; init: any }[] = [];
  const impl = (async (url: any, opts: any) => {
    seen.push({ url: String(url), init: opts });
    return {
      ok: init.ok !== false,
      status: init.status ?? 200,
      json: async () => body,
    } as any;
  }) as unknown as typeof fetch;
  return { impl, seen };
}

describe('the source switch (owner ruling, 2026-09-13)', () => {
  it('integration requires BOTH an endpoint and the shared token', () => {
    assert.equal(isHuddleIntegrated({ huddleUrl: 'https://h', proxyToken: 'tok' }), true);
    // A URL with no token cannot authenticate; a token with no URL has nowhere to go. Neither
    // half alone is an integration, and treating either as one half-works silently.
    assert.equal(isHuddleIntegrated({ huddleUrl: 'https://h', proxyToken: '' }), false);
    assert.equal(isHuddleIntegrated({ huddleUrl: '', proxyToken: 'tok' }), false);
    assert.equal(isHuddleIntegrated({ huddleUrl: '   ', proxyToken: '  ' }), false);
    assert.equal(isHuddleIntegrated({}), false);
  });

  it('STANDALONE journey answers every digest from itself', () => {
    for (const d of ['daily_brief', 'meetings', 'standup'] as const) {
      assert.equal(resolveDigestSource(d, false), 'journey', `${d} standalone`);
    }
  });

  it('INTEGRATED, journey still owns the day plan and the calendar', () => {
    // The ruling is "journey would be the switch... in our case it should be using journey".
    // Routing journey's OWN data through a network hop to Huddle and back would be the bug.
    assert.equal(resolveDigestSource('daily_brief', true), 'journey');
    assert.equal(resolveDigestSource('meetings', true), 'journey');
  });

  it('INTEGRATED, only the stand-up comes from Huddle (it owns the agents)', () => {
    assert.equal(resolveDigestSource('standup', true), 'huddle');
  });
});

describe('the Huddle stand-up pull', () => {
  it('asks Huddle NOT to deliver — the load-bearing argument', async () => {
    const { impl, seen } = stubFetch({ ok: true, digest: CONTENT });
    await fetchHuddleStandup({
      userEmail: 'owner@example.com', timeZone: 'America/New_York', proxyToken: 'tok', fetchImpl: impl,
    });
    assert.equal(seen.length, 1);
    const body = JSON.parse(seen[0].init.body);
    // Omitting this makes the pull double-post the stand-up in Terry's DM AND advance Huddle's
    // change gate, silencing the real stand-up later the same morning.
    assert.equal(body.deliver, false, 'the pull MUST set deliver:false');
    assert.equal(body.caller.entra_email, 'owner@example.com');
    assert.equal(seen[0].init.headers['x-webhook-secret'], 'tok', 'reuses JOURNEY_PROXY_TOKEN, no new secret');
    assert.equal(seen[0].url, HUDDLE_STANDUP_URL_DEFAULT);
  });

  it('a non-2xx from Huddle degrades to null, it does not throw', async () => {
    const { impl } = stubFetch({}, { ok: false, status: 503 });
    const r = await fetchHuddleStandup({
      userEmail: 'o@e.com', timeZone: 'UTC', proxyToken: 'tok', fetchImpl: impl,
    });
    assert.equal(r, null);
  });

  it('a transport failure degrades to null — Huddle being down must not cost the day plan', async () => {
    const impl = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    const r = await fetchHuddleStandup({
      userEmail: 'o@e.com', timeZone: 'UTC', proxyToken: 'tok', fetchImpl: impl,
    });
    assert.equal(r, null);
  });

  it('priority ORDER from Huddle is preserved as the rank, never re-sorted', () => {
    const p = toStandupPayload(CONTENT, OPTS);
    // Huddle ranked these with rankTasks, the one prioritization brain its agents read. A second
    // sort on this side could disagree with what the user sees in Huddle.
    assert.deepEqual(p.priorities, [
      { title: 'Ship the API', rank: 1 },
      { title: 'Call the bank', rank: 2 },
    ]);
  });

  it('maps every section and keeps the deep link', () => {
    const p = toStandupPayload(CONTENT, OPTS);
    assert.equal(p.kind, 'standup');
    assert.equal(p.date, OPTS.date);
    assert.equal(p.timezone, OPTS.timezone);
    assert.equal(p.deepLink, OPTS.deepLink);
    assert.deepEqual(p.produced, [{ title: 'Pricing one-pager', agent: 'Terry Locke' }]);
    assert.deepEqual(p.blocked, [{ title: 'Vendor contract', reason: 'waiting on your signature' }]);
    assert.deepEqual(p.inReview, [{ title: 'Q3 deck', agent: 'Finn Reid' }]);
  });

  it('an all-empty stand-up is empty; one populated section is not', () => {
    const empty = toStandupPayload(
      { produced: [], blocked: [], inReview: [], priorities: [], brief: '' }, OPTS);
    assert.equal(standupDigestIsEmpty(empty), true);
    for (const key of ['produced', 'blocked', 'inReview', 'priorities'] as const) {
      const one = toStandupPayload(
        { produced: [], blocked: [], inReview: [], priorities: [], brief: '',
          [key]: [{ title: 'something', reason: null }] } as any, OPTS);
      assert.equal(standupDigestIsEmpty(one), false, `${key} alone must count as reportable`);
    }
  });
});

describe('loadStandupDigestPayload', () => {
  const ENV = envOf({ APP_BASE_URL: 'https://j.example' });

  it('returns the payload on a good pull', async () => {
    const { impl } = stubFetch({ ok: true, digest: CONTENT });
    const p = await loadStandupDigestPayload({
      userEmail: 'o@e.com', date: OPTS.date, timezone: OPTS.timezone,
      proxyToken: 'tok', env: ENV, fetchImpl: impl,
    });
    assert.ok(p);
    assert.equal(p!.kind, 'standup');
    assert.equal(p!.deepLink, 'https://j.example/priorities');
  });

  it("Huddle's own change gate (skipped) is a legitimate nothing-to-report, not an empty email", async () => {
    const { impl } = stubFetch({ ok: true, skipped: true, reason: 'nothing_to_report' });
    const p = await loadStandupDigestPayload({
      userEmail: 'o@e.com', date: OPTS.date, timezone: OPTS.timezone,
      proxyToken: 'tok', env: ENV, fetchImpl: impl,
    });
    assert.equal(p, null);
  });

  it('an unset APP_BASE_URL falls back to the published host, and Huddle IS called', async () => {
    // Was: "stops the run before Huddle is ever called". The unset case no longer exists —
    // buildDeepLink defaults to public/bridge.config.json's host. A BAD override still throws
    // before the network call, which the localhost case below still proves.
    const { impl, seen } = stubFetch({ ok: true, digest: CONTENT });
    const p = await loadStandupDigestPayload({
      userEmail: 'o@e.com', date: OPTS.date, timezone: OPTS.timezone,
      proxyToken: 'tok', env: envOf({}), fetchImpl: impl,
    });
    assert.ok(p);
    assert.equal(p!.deepLink, 'https://journey-voice.lovable.app/priorities');
    assert.equal(seen.length, 1, 'Huddle is reached now that a link can always be built');
  });

  it('a localhost base URL is rejected the same way a missing one is', async () => {
    const { impl } = stubFetch({ ok: true, digest: CONTENT });
    await assert.rejects(
      () => loadStandupDigestPayload({
        userEmail: 'o@e.com', date: OPTS.date, timezone: OPTS.timezone,
        proxyToken: 'tok', env: envOf({ APP_BASE_URL: 'http://localhost:5173' }), fetchImpl: impl,
      }),
      MissingDeepLinkBaseError,
    );
  });
});

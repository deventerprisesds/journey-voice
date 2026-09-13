// =============================================================================
// WHAT:       executable proof for the per-user digest run — most importantly, that EVERY planned
//             digest produces exactly one outcome row, on every path, including the paths that
//             send nothing.
// WHY:        loop 1 of verification REFUTED "all three digests are wired": the stand-up was
//             silently dropped when standalone via a `continue` with no outcome row, so a run
//             reported two digests where three were planned. Loop 2 confirmed the fix and then
//             named the remaining exposure: the loop lived in an edge function nothing imports, so
//             the fix was undefended behaviour — "cheaply extractable", and it was. These tests are
//             what stop that defect returning, since it is invisible to a reading of one branch.
// EVIDENCE:   .claude/VERIFY-digest-delivery-loop1.md CLAIM 1a; loop2 challenge (2).
// Run: npm test
// =============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  runDigestsForUser,
  digestRunIsComplete,
  type DigestRunDeps,
  type DigestOutcome,
} from '../../supabase/functions/_shared/digest-run.ts';
import type { DigestPlan } from '../../supabase/functions/_shared/digest-delivery.ts';

const PLAN: DigestPlan = {
  userId: 'u1',
  timezone: 'America/New_York',
  date: '2026-09-14',
  channels: ['email'],
  digests: ['daily_brief', 'meetings', 'standup'],
};

const payload = (kind: string) => ({ kind, deepLink: 'https://j.example/priorities' }) as never;

class FatalConfigError extends Error {}

/** Deps where everything succeeds; override one field per test. */
function deps(over: Partial<DigestRunDeps> = {}): DigestRunDeps {
  return {
    loadDailyBrief: async () => payload('daily_brief'),
    loadMeetings: async () => payload('meetings'),
    resolveUserEmail: async () => 'owner@example.com',
    loadStandup: async () => payload('standup'),
    deliver: async (_u, p) => [{ digest: (p as never as { kind: string }).kind, channels: ['EMAIL'], ok: true }],
    isFatalConfigError: (e) => e instanceof FatalConfigError,
    ...over,
  };
}

const kinds = (o: DigestOutcome[]) => o.map((x) => x.digest).sort();

describe('every planned digest accounts for itself — THE invariant', () => {
  it('all three deliver on the happy path', async () => {
    const out = await runDigestsForUser(PLAN, true, deps());
    assert.deepEqual(kinds(out), ['daily_brief', 'meetings', 'standup']);
    assert.ok(digestRunIsComplete(PLAN, out));
  });

  it('STANDALONE: the stand-up still produces a row — the exact defect loop 1 refuted', async () => {
    // integrated=false → resolveDigestSource("standup") is "journey", there is no journey-side
    // stand-up producer, and the old code `continue`d with NO row. A report showing two digests
    // where three were planned reads as a bug and hides one.
    const out = await runDigestsForUser(PLAN, false, deps());
    assert.equal(out.length, 3, JSON.stringify(out));
    assert.ok(digestRunIsComplete(PLAN, out), 'a planned digest emitted no outcome row');
    const standup = out.find((o) => o.digest === 'standup')!;
    assert.equal(standup.ok, true, 'not having a Huddle is not a failure');
    assert.equal(standup.error, 'standup_requires_huddle');
    assert.deepEqual(standup.channels, [], 'nothing was sent');
  });

  it('an EMPTY result from every loader still yields one row each', async () => {
    const out = await runDigestsForUser(
      PLAN, true,
      deps({ loadDailyBrief: async () => null, loadMeetings: async () => null, loadStandup: async () => null }),
    );
    assert.ok(digestRunIsComplete(PLAN, out));
    assert.deepEqual(
      out.map((o) => o.error).sort(),
      ['empty_day', 'no_meetings', 'nothing_to_report'],
    );
    assert.ok(out.every((o) => o.ok), 'an empty day is not a failure');
  });

  it('a THROWING loader still yields one row, and does not abort the others', async () => {
    const out = await runDigestsForUser(
      PLAN, true,
      deps({ loadMeetings: async () => { throw new Error('calendar exploded'); } }),
    );
    assert.ok(digestRunIsComplete(PLAN, out), 'a throwing digest must still be accounted for');
    const m = out.find((o) => o.digest === 'meetings')!;
    assert.equal(m.ok, false);
    assert.match(m.error!, /calendar exploded/);
    // The other two are unaffected — one bad digest does not cost the user their day plan.
    assert.ok(out.find((o) => o.digest === 'daily_brief')!.ok);
    assert.ok(out.find((o) => o.digest === 'standup')!.ok);
  });

  it('a missing user email fails the stand-up alone, with a row', async () => {
    const out = await runDigestsForUser(PLAN, true, deps({ resolveUserEmail: async () => null }));
    assert.ok(digestRunIsComplete(PLAN, out));
    const s = out.find((o) => o.digest === 'standup')!;
    assert.equal(s.ok, false);
    assert.equal(s.error, 'no_user_email');
  });

  it('EVERY combination of empty/throw/standalone still accounts for all three', async () => {
    // Brute force, because the defect was one uncovered branch out of many that all look fine
    // individually. 2 (integrated) x 3 (loader outcome) x 3 (which loader) = every shape.
    const modes = ['ok', 'null', 'throw'] as const;
    for (const integrated of [true, false]) {
      for (const target of ['loadDailyBrief', 'loadMeetings', 'loadStandup'] as const) {
        for (const mode of modes) {
          const over: Partial<DigestRunDeps> = {};
          if (mode === 'null') (over as never as Record<string, unknown>)[target] = async () => null;
          if (mode === 'throw') (over as never as Record<string, unknown>)[target] = async () => { throw new Error('x'); };
          const out = await runDigestsForUser(PLAN, integrated, deps(over));
          assert.ok(
            digestRunIsComplete(PLAN, out),
            `integrated=${integrated} ${target}=${mode} produced ${JSON.stringify(kinds(out))}`,
          );
        }
      }
    }
  });
});

describe('fail closed, and only on the config error', () => {
  it('a fatal config error propagates — it must never be recorded as one bad digest', async () => {
    // A deploy with no APP_BASE_URL cannot build an absolute link. Sending a dead relative path to a
    // human is worse than sending nothing, so the whole run fails rather than degrading quietly.
    await assert.rejects(
      () => runDigestsForUser(PLAN, true, deps({
        loadDailyBrief: async () => { throw new FatalConfigError('APP_BASE_URL unset'); },
      })),
      FatalConfigError,
    );
  });

  it('an ordinary error does NOT propagate', async () => {
    const out = await runDigestsForUser(PLAN, true, deps({
      loadDailyBrief: async () => { throw new Error('transient'); },
    }));
    assert.equal(out.length, 3);
  });
});

describe('digestRunIsComplete', () => {
  it('is false when a planned digest has no row — it is not vacuous', async () => {
    assert.equal(digestRunIsComplete(PLAN, []), false);
    assert.equal(
      digestRunIsComplete(PLAN, [{ digest: 'daily_brief', channels: [], ok: true }]),
      false,
    );
    assert.equal(
      digestRunIsComplete(PLAN, PLAN.digests.map((d) => ({ digest: d, channels: [], ok: true }))),
      true,
    );
  });
});

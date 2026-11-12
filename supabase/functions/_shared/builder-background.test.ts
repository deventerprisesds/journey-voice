// WHAT:       Tests for builder-background.ts and its wiring into nightly-schedule-builder's request handler.
// WHY:        Week runs were cut off by the gateway's 150s limit (504, 2026-11-11 and 2026-11-12).
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   function_edge_logs 2026-11-12 05:02:33 POST 504 nightly-schedule-builder.
// Run: node --experimental-strip-types --no-warnings --test supabase/functions/_shared/builder-background.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runsInBackground } from './builder-background.ts';

describe('builder runs week builds in the background', () => {
  it('BG-1 week runs (cron, rebuild tool, no body) go to the background; single-day runs do not', () => {
    for (const b of [undefined, null, {}, { userId: 'u', triggerSource: 'cron' }, { singleDay: false }, { singleDay: 'true' }]) {
      assert.equal(runsInBackground(b), true, JSON.stringify(b));
    }
    assert.equal(runsInBackground({ userId: 'u', singleDay: true }), false);
  });

  it('BG-2 the handler answers 202 and hands the build to EdgeRuntime.waitUntil before returning', () => {
    const src = readFileSync(new URL('../nightly-schedule-builder/index.ts', import.meta.url), 'utf8');
    const serveAt = src.indexOf('serve(async (req) => {');
    const branch = src.indexOf('if (runsInBackground(parsed))', serveAt);
    const wait = src.indexOf('EdgeRuntime.waitUntil(work)', branch);
    const accepted = src.indexOf('status: 202', branch);
    const fg = src.indexOf('return buildSchedules(replay());', branch);
    assert.ok(serveAt > 0 && branch > serveAt, 'background branch is inside the request handler');
    assert.ok(wait > branch && accepted > wait && fg > accepted, 'waitUntil, then 202, then the foreground path');
    assert.ok(!/await buildSchedules/.test(src.slice(branch, fg)), 'the background branch never awaits the build');
  });
});

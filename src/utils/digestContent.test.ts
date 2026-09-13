// =============================================================================
// WHAT:       executable proof for the shared digest content builder.
// WHY:        AC-digest-delivery.md A (AC-BUILD-*), B (AC-REND-*), D (AC-TZ-*),
//             E (AC-LINK-*). AC-REND-1 is Tier 1 -- an email must never contain
//             a phone-call script.
// EVIDENCE:   .claude/IMPL-digest-builder.md
// Run: npm test   (node --experimental-strip-types --test src/utils/*.test.ts)
// =============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDailyBriefPayload,
  buildMeetingsDigestPayload,
  meetingsDigestIsEmpty,
  buildDeepLink,
  MissingDeepLinkBaseError,
  renderDigest,
  renderScheduledCall,
  containsCallScript,
  CallScriptLeakError,
  canonicalChannel,
  shouldSendAtLocalHour,
  localClockParts,
  PUSH_MAX_CHARS,
  DAILY_DIGEST_LOCAL_HOUR,
  WEEKLY_DIGEST_LOCAL_HOUR,
  WEEKLY_DIGEST_LOCAL_WEEKDAY,
} from '../../supabase/functions/_shared/digest-content.ts';

const LINK = 'https://journey.example.org/priorities';

function scheduleItem(title, startLocal) {
  return {
    taskId: title, title, start: null, end: null, startLocal,
    window: 'business_hours', category: 'CAREER', priority: 'HIGH',
    status: 'TODO', score: null, isAuto: false, pushedCount: 0,
    isPriority: false, priorityRank: null,
  };
}

function ctxWith(overrides = {}) {
  return {
    date: '2026-09-13', timezone: 'America/New_York', isWeekend: false,
    currentWindow: 'business_hours', schedule: [], gaps: [], priorityLane: [],
    rolledOver: [], overdue: [], pendingAssignments: [], calendarHolds: [],
    ...overrides,
  };
}

// --------------------------------------------------------------------------
describe('AC-BUILD-2 — schedule / priorityLane / calendarHolds', () => {
  it('returns 3 schedule, 2 priorities in rank ASC, 1 calendar hold', () => {
    const ctx = ctxWith({
      schedule: [scheduleItem('A', '9:00 AM'), scheduleItem('B', '10:00 AM'), scheduleItem('C', '11:00 AM')],
      // DELIBERATELY SHUFFLED -- the AC's stated trap is a pre-ordered DB result.
      priorityLane: [
        { id: 'p2', title: 'Second', rank: 2, scheduledToday: false },
        { id: 'p1', title: 'First', rank: 1, scheduledToday: true },
      ],
      calendarHolds: [{ id: 'h1', title: 'Hold', start: '', end: '', startLocal: '2:00 PM', endLocal: '3:00 PM' }],
    });
    const p = buildDailyBriefPayload(ctx, { deepLink: LINK });
    assert.equal(p.schedule.length, 3);
    assert.equal(p.priorityLane, undefined, 'payload must not re-export the raw lane name');
    assert.equal(p.priorities.length, 2);
    assert.deepEqual(p.priorities.map((x) => x.rank), [1, 2]);
    assert.deepEqual(p.priorities.map((x) => x.title), ['First', 'Second']);
    assert.equal(p.calendarHolds.length, 1);
  });

  it('null ranks sort LAST, not as rank 0', () => {
    const ctx = ctxWith({
      priorityLane: [
        { id: 'x', title: 'Unranked', rank: null, scheduledToday: false },
        { id: 'y', title: 'Ranked', rank: 3, scheduledToday: false },
      ],
    });
    const p = buildDailyBriefPayload(ctx, { deepLink: LINK });
    assert.deepEqual(p.priorities.map((x) => x.title), ['Ranked', 'Unranked']);
  });

  it('does not mutate the caller’s DayContext array', () => {
    const lane = [
      { id: 'b', title: 'B', rank: 2, scheduledToday: false },
      { id: 'a', title: 'A', rank: 1, scheduledToday: false },
    ];
    buildDailyBriefPayload(ctxWith({ priorityLane: lane }), { deepLink: LINK });
    assert.deepEqual(lane.map((x) => x.title), ['B', 'A']);
  });
});

// --------------------------------------------------------------------------
describe('AC-BUILD-3 — empty state is explicit, never "undefined"', () => {
  for (const ch of ['email', 'push', 'slack', 'app_message']) {
    it(`${ch}: renders real text with no undefined/[object Object]/NaN`, () => {
      const p = buildDailyBriefPayload(ctxWith(), { deepLink: LINK });
      const r = renderDigest(p, ch);
      assert.match(r.body, /\S/);
      assert.doesNotMatch(r.body, /undefined|\[object Object\]|NaN|null/);
      assert.match(r.subject, /\S/);
    });
  }
  it('email empty state names the empty sections explicitly', () => {
    const r = renderDigest(buildDailyBriefPayload(ctxWith(), { deepLink: LINK }), 'email');
    assert.match(r.body, /nothing scheduled/);
    assert.match(r.body, /no priorities ranked/);
  });
});

// --------------------------------------------------------------------------
describe('AC-BUILD-4 — priority ORDER identical across channels', () => {
  it('email and push agree on the leading priority', () => {
    const ctx = ctxWith({
      priorityLane: [
        { id: 'c', title: 'Charlie', rank: 3, scheduledToday: false },
        { id: 'a', title: 'Alpha', rank: 1, scheduledToday: false },
        { id: 'b', title: 'Bravo', rank: 2, scheduledToday: false },
      ],
    });
    const p = buildDailyBriefPayload(ctx, { deepLink: LINK });
    const emailBody = renderDigest(p, 'email').body;
    const pushBody = renderDigest(p, 'push').body;
    const emailOrder = ['Alpha', 'Bravo', 'Charlie'].map((t) => emailBody.indexOf(t));
    assert.deepEqual(emailOrder, [...emailOrder].sort((x, y) => x - y));
    assert.match(pushBody, /Alpha/);
    // Same payload object feeds both -> order cannot diverge by construction.
    assert.deepEqual(p.priorities.map((x) => x.title), ['Alpha', 'Bravo', 'Charlie']);
  });
});

// --------------------------------------------------------------------------
describe('AC-REND-1 (Tier 1) — a phone script must never reach a read channel', () => {
  // The real shape of a call_configs.context value.
  const REAL_SCRIPT =
    'BRANCH 1: morning check-in.\nGreet: Hello Sir, how did you sleep?\n' +
    'IF THEY say tired, skip to BRANCH 2.\nStage 2: read the schedule aloud.';

  it('detector recognises the real script', () => {
    assert.equal(containsCallScript(REAL_SCRIPT), true);
  });

  it('email body does NOT contain the raw context string (identity, not keyword)', () => {
    const r = renderScheduledCall({ callName: 'Morning Check-in', context: REAL_SCRIPT, channel: 'email' });
    assert.equal(r.body.includes(REAL_SCRIPT), false);
    assert.doesNotMatch(r.body, /BRANCH \d|Greet:|Hello Sir/i);
    assert.match(r.body, /morning check-in/i);
  });

  for (const ch of ['app_message', 'push', 'slack']) {
    it(`${ch} body excludes the script too`, () => {
      const r = renderScheduledCall({ callName: 'Morning Check-in', context: REAL_SCRIPT, channel: ch });
      assert.equal(r.body.includes(REAL_SCRIPT), false);
      assert.equal(containsCallScript(r.body), false);
    });
  }

  it('phone DOES keep the script — it is the right artifact there', () => {
    const r = renderScheduledCall({ callName: 'Morning Check-in', context: REAL_SCRIPT, channel: 'phone' });
    assert.equal(r.body.includes(REAL_SCRIPT), true);
  });

  it('a script smuggled into a digest payload throws rather than shipping', () => {
    const ctx = ctxWith({ priorityLane: [{ id: 's', title: 'Greet: Hello Sir', rank: 1, scheduledToday: false }] });
    const p = buildDailyBriefPayload(ctx, { deepLink: LINK });
    assert.throws(() => renderDigest(p, 'email'), CallScriptLeakError);
  });
});

// --------------------------------------------------------------------------
describe('AC-REND-2 — per-channel renderers produce different bodies', () => {
  const p = buildDailyBriefPayload(
    ctxWith({
      schedule: [scheduleItem('Standup', '9:00 AM')],
      priorityLane: [{ id: 'a', title: 'Ship the digest', rank: 1, scheduledToday: true }],
    }),
    { deepLink: LINK },
  );

  it('email !== push, push is truncated, email carries the link', () => {
    const email = renderDigest(p, 'email');
    const push = renderDigest(p, 'push');
    assert.notEqual(email.body, push.body);
    assert.ok(push.body.length <= PUSH_MAX_CHARS, `push was ${push.body.length}`);
    assert.match(email.body, /https?:\/\//);
  });

  it('all four read channels are pairwise distinct', () => {
    const bodies = ['email', 'push', 'slack', 'app_message'].map((c) => renderDigest(p, c).body);
    assert.equal(new Set(bodies).size, 4);
  });

  it('push truncation is word-safe and bounded on a long lane', () => {
    const long = buildDailyBriefPayload(
      ctxWith({ priorityLane: [{ id: 'l', title: 'x'.repeat(900), rank: 1, scheduledToday: false }] }),
      { deepLink: LINK },
    );
    const push = renderDigest(long, 'push');
    assert.ok(push.body.length <= PUSH_MAX_CHARS);
    assert.match(push.body, /…$/);
  });
});

// --------------------------------------------------------------------------
describe('AC-REND-3 — email has a schedule item, a priority, and EXACTLY ONE deep link', () => {
  it('counts exactly one priorities URL', () => {
    const p = buildDailyBriefPayload(
      ctxWith({
        schedule: [scheduleItem('Design review', '11:00 AM')],
        priorityLane: [{ id: 'a', title: 'Ship the digest', rank: 1, scheduledToday: true }],
      }),
      { deepLink: LINK },
    );
    const body = renderDigest(p, 'email').body;
    assert.match(body, /Design review/);
    assert.match(body, /Ship the digest/);
    assert.equal((body.match(/https?:\/\/\S*priorit/g) || []).length, 1);
  });
});

// --------------------------------------------------------------------------
describe('AC-REND-4 — HTML is escaped', () => {
  it('a <script> title does not reach the html body unescaped', () => {
    const p = buildDailyBriefPayload(
      ctxWith({ priorityLane: [{ id: 'x', title: '<script>alert(1)</script> Tom & Jerry', rank: 1, scheduledToday: false }] }),
      { deepLink: LINK },
    );
    const r = renderDigest(p, 'email');
    assert.doesNotMatch(r.html, /<script>/);
    assert.match(r.html, /&lt;script&gt;/);
    assert.match(r.html, /&amp;/);
    assert.equal(r.contentType, 'text/plain');
  });
});

// --------------------------------------------------------------------------
describe('AC-TZ-1 — 8am means the USER’S 8am', () => {
  it('12:05 UTC (08:05 ET) => true; 08:05 UTC (04:05 ET) => false', () => {
    const tz = 'America/New_York';
    assert.equal(shouldSendAtLocalHour(new Date('2026-09-13T12:05:00Z'), tz, DAILY_DIGEST_LOCAL_HOUR), true);
    assert.equal(shouldSendAtLocalHour(new Date('2026-09-13T08:05:00Z'), tz, DAILY_DIGEST_LOCAL_HOUR), false);
  });
  it('inverts the OLD behaviour: raw UTC getHours()===8 gave the opposite answers', () => {
    assert.equal(new Date('2026-09-13T08:05:00Z').getUTCHours(), 8); // old: true
    assert.equal(new Date('2026-09-13T12:05:00Z').getUTCHours(), 12); // old: false
  });
  it('only the first 15 minutes of the local hour fire', () => {
    const tz = 'America/New_York';
    assert.equal(shouldSendAtLocalHour(new Date('2026-09-13T12:14:59Z'), tz, 8), true);
    assert.equal(shouldSendAtLocalHour(new Date('2026-09-13T12:15:00Z'), tz, 8), false);
  });
});

// --------------------------------------------------------------------------
describe('AC-TZ-2 — each timezone gets exactly one digest per UTC day', () => {
  it('96 ticks across a day: NY once, LA once, each at local 08', () => {
    const zones = ['America/New_York', 'America/Los_Angeles', 'Europe/London', 'Asia/Tokyo'];
    for (const tz of zones) {
      let fired = 0;
      const localHours = [];
      for (let i = 0; i < 96; i++) {
        const t = new Date(Date.UTC(2026, 8, 13, 0, 0, 0) + i * 15 * 60000);
        if (shouldSendAtLocalHour(t, tz, DAILY_DIGEST_LOCAL_HOUR)) {
          fired++;
          localHours.push(localClockParts(t, tz).hour);
        }
      }
      assert.equal(fired, 1, `${tz} fired ${fired} times`);
      assert.deepEqual(localHours, [8], `${tz} fired at local hour ${localHours}`);
    }
  });

  it('weekly: Sunday 9am local, exactly once across the week', () => {
    const tz = 'America/New_York';
    let fired = 0;
    const stamps = [];
    for (let i = 0; i < 96 * 7; i++) {
      const t = new Date(Date.UTC(2026, 8, 13, 0, 0, 0) + i * 15 * 60000);
      if (shouldSendAtLocalHour(t, tz, WEEKLY_DIGEST_LOCAL_HOUR, WEEKLY_DIGEST_LOCAL_WEEKDAY)) {
        fired++;
        const p = localClockParts(t, tz);
        stamps.push([p.weekday, p.hour]);
      }
    }
    assert.equal(fired, 1);
    assert.deepEqual(stamps, [[0, 9]]);
  });
});

// --------------------------------------------------------------------------
describe('AC-TZ-4 — DST: offset resolved per-date, not cached', () => {
  it('fires at local 08 on both sides of the 2026-11-01 US transition', () => {
    const tz = 'America/New_York';
    // 2026-10-31 is EDT (UTC-4) -> 08:00 local = 12:00 UTC
    assert.equal(shouldSendAtLocalHour(new Date('2026-10-31T12:05:00Z'), tz, 8), true);
    // 2026-11-02 is EST (UTC-5) -> 08:00 local = 13:00 UTC
    assert.equal(shouldSendAtLocalHour(new Date('2026-11-02T13:05:00Z'), tz, 8), true);
    // A hardcoded -4 would fire here on 11-02; it must not.
    assert.equal(shouldSendAtLocalHour(new Date('2026-11-02T12:05:00Z'), tz, 8), false);
    // A hardcoded -5 would fire here on 10-31; it must not.
    assert.equal(shouldSendAtLocalHour(new Date('2026-10-31T13:05:00Z'), tz, 8), false);
  });
  it('exactly one fire on the DST transition day itself', () => {
    const tz = 'America/New_York';
    let fired = 0;
    for (let i = 0; i < 100; i++) {
      const t = new Date(Date.UTC(2026, 10, 1, 0, 0, 0) + i * 15 * 60000);
      if (shouldSendAtLocalHour(t, tz, 8)) fired++;
    }
    assert.equal(fired, 1);
  });
});

// --------------------------------------------------------------------------
describe('AC-TZ-5 — NULL timezone falls back and STILL sends', () => {
  for (const tz of [null, undefined, '']) {
    it(`timezone=${JSON.stringify(tz)} behaves as America/New_York and sends once`, () => {
      let fired = 0;
      for (let i = 0; i < 96; i++) {
        const t = new Date(Date.UTC(2026, 8, 13, 0, 0, 0) + i * 15 * 60000);
        if (shouldSendAtLocalHour(t, tz, DAILY_DIGEST_LOCAL_HOUR)) fired++;
      }
      assert.equal(fired, 1, 'the user must not be skipped for missing config');
      assert.equal(shouldSendAtLocalHour(new Date('2026-09-13T12:05:00Z'), tz, 8), true);
    });
  }
});

// --------------------------------------------------------------------------
describe('AC-LINK-1 — deep link fails CLOSED', () => {
  it('builds an absolute URL from a configured base', () => {
    assert.equal(buildDeepLink('https://journey.example.org'), 'https://journey.example.org/priorities');
    assert.equal(buildDeepLink('https://journey.example.org/'), 'https://journey.example.org/priorities');
  });
  for (const bad of [undefined, null, '', '   ', '/priorities', 'journey.example.org', 'http://localhost:5173', 'http://127.0.0.1:3000']) {
    it(`THROWS on ${JSON.stringify(bad)} — no relative/localhost/undefined link ever ships`, () => {
      assert.throws(() => buildDeepLink(bad), MissingDeepLinkBaseError);
    });
  }
  it('never yields the string "undefined/priorities"', () => {
    let out = null;
    try { out = buildDeepLink(undefined); } catch { /* expected */ }
    assert.equal(out, null);
  });
});

describe('AC-LINK-3 — the same absolute URL in every channel that carries one', () => {
  it('email, slack and app_message carry byte-identical URLs', () => {
    const p = buildDailyBriefPayload(ctxWith(), { deepLink: LINK });
    const urls = ['email', 'slack', 'app_message']
      .map((c) => (renderDigest(p, c).body.match(/https?:\/\/\S*?priorities/) || [])[0]);
    assert.deepEqual(urls, [LINK, LINK, LINK]);
  });
});

// --------------------------------------------------------------------------
describe('meetings payload — the interface the classifier agent fills', () => {
  const mk = (id, localDate, withPerson, start) => ({
    id, title: `Meeting ${id}`, start, end: null, startLocal: '10:00 AM',
    localDate, location: null, attendees: [], withPerson, showAs: 'busy',
  });

  it('AC-MTG-4: suppressed entirely when nothing is with a person', () => {
    const p = buildMeetingsDigestPayload(
      [mk('solo', '2026-09-13', false, '2026-09-13T14:00:00Z')],
      { date: '2026-09-13', timezone: 'America/New_York', deepLink: LINK },
    );
    assert.equal(meetingsDigestIsEmpty(p), true);
  });

  it('unclassified (withPerson=null) is EXCLUDED, not assumed true', () => {
    const p = buildMeetingsDigestPayload(
      [mk('unknown', '2026-09-13', null, '2026-09-13T14:00:00Z')],
      { date: '2026-09-13', timezone: 'America/New_York', deepLink: LINK },
    );
    assert.equal(p.today.length, 0);
    assert.equal(meetingsDigestIsEmpty(p), true);
  });

  it('AC-MTG-5: grouped BY DAY, days with none omitted, ascending', () => {
    const p = buildMeetingsDigestPayload(
      [
        mk('d6', '2026-09-19', true, '2026-09-19T14:00:00Z'),
        mk('d0', '2026-09-13', true, '2026-09-13T14:00:00Z'),
        mk('d2', '2026-09-15', true, '2026-09-15T14:00:00Z'),
        mk('skip', '2026-09-16', false, '2026-09-16T14:00:00Z'),
      ],
      { date: '2026-09-13', timezone: 'America/New_York', deepLink: LINK },
    );
    assert.deepEqual(p.byDay.map((d) => d.localDate), ['2026-09-13', '2026-09-15', '2026-09-19']);
    assert.equal(p.byDay.length, 3);
    assert.equal(p.today.length, 1);
  });
});

// --------------------------------------------------------------------------
describe('canonicalChannel — one rendering vocabulary (AC-CH-1 support)', () => {
  it('normalises case and aliases', () => {
    assert.equal(canonicalChannel('SLACK'), 'slack');
    assert.equal(canonicalChannel('Email'), 'email');
    assert.equal(canonicalChannel('app'), 'app_message');
    assert.equal(canonicalChannel('PUSH'), 'push');
    assert.equal(canonicalChannel('voice'), 'phone');
  });
  it('returns null for an unknown channel rather than guessing', () => {
    assert.equal(canonicalChannel('OUTLOOK_EVENT'), null);
    assert.equal(canonicalChannel(''), null);
  });
});

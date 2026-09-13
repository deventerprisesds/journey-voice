// =============================================================================
// WHAT:       Executable guards for the meetings digest SOURCE
//             (`supabase/functions/_shared/digest-source-meetings.ts`).
// WHY:        AC-MTG-2 names organiser-based classification as THE trap: the owner organises
//             their own solo focus blocks, so `organizer_email` marks every hold a meeting.
//             AC-MTG-4 names the empty-state email; AC-MTG-5 names silent day merging;
//             "absent evidence is never a pass" names the unclassified row. Each is a test
//             here, not a note. Every one is mutation-proved -- see
//             .claude/IMPL-digest-source-meetings.md for the verbatim results.
// EVIDENCE:   .claude/IMPL-digest-source-meetings.md
// Run: npm test   (node --experimental-strip-types --test src/utils/*.test.ts)
// =============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadMeetingsDigestPayload,
  classifyWithPerson,
  attendeeEvidence,
  resolveOwnerEmails,
  toDigestMeeting,
  MEETING_EVENT_COLUMNS,
} from '../../supabase/functions/_shared/digest-source-meetings.ts';
import { MissingDeepLinkBaseError } from '../../supabase/functions/_shared/digest-content.ts';

const OWNER = 'von.ellis@enterpriseds.io';
const TZ = 'America/New_York';
const LINK = 'https://journey.example.org';
// 08:00 ET. today = 2026-09-15, +2 = 2026-09-17, +6 = 2026-09-21, +15 = out of horizon.
const NOW = new Date('2026-09-15T12:00:00Z');

const USER = 'user-a';

// --------------------------------------------------------------------------
// A fake supabase client that actually APPLIES the filters it is handed, so the horizon
// window this module computes is exercised rather than assumed. Anything it cannot honour
// it records, so a test can assert on the real call shape.
// --------------------------------------------------------------------------
function fakeClient(opts: any = {}) {
  const events = opts.events ?? [];
  const calls: any[] = [];

  function rowsFor(state: any) {
    if (state.table === 'external_calendar_events') {
      return events.filter((e: any) => {
        if (state.eq.user_id !== undefined && e.user_id !== state.eq.user_id) return false;
        if (state.gte.start_time && !(e.start_time >= state.gte.start_time)) return false;
        if (state.lt.start_time && !(e.start_time < state.lt.start_time)) return false;
        return true;
      });
    }
    if (state.table === 'calendar_connections') return opts.connections ?? [];
    if (state.table === 'profiles') return opts.profile ? [opts.profile] : [];
    if (state.table === 'notification_prefs') {
      return opts.notificationPrefs ? [opts.notificationPrefs] : [];
    }
    return [];
  }

  return {
    calls,
    from(table: string) {
      const state: any = { table, eq: {}, gte: {}, lt: {}, columns: null };
      calls.push(state);
      const builder: any = {
        select(cols: string) { state.columns = cols; return builder; },
        eq(col: string, v: any) { state.eq[col] = v; return builder; },
        gte(col: string, v: any) { state.gte[col] = v; return builder; },
        lt(col: string, v: any) { state.lt[col] = v; return builder; },
        limit() { return builder; },
        maybeSingle() {
          const r = rowsFor(state);
          return Promise.resolve({ data: r[0] ?? null, error: null });
        },
        then(res: any, rej: any) {
          return Promise.resolve({ data: rowsFor(state), error: null }).then(res, rej);
        },
      };
      return builder;
    },
  };
}

/** A row in the real `external_calendar_events` column shape. */
function evt(over: any = {}) {
  return {
    id: over.id ?? over.title ?? 'e',
    user_id: USER,
    title: 'Untitled',
    start_time: '2026-09-15T14:00:00Z',
    end_time: '2026-09-15T15:00:00Z',
    location: null,
    show_as: 'busy',
    is_all_day: false,
    // The owner organises EVERYTHING on their own calendar -- solo holds included.
    organizer_email: OWNER,
    attendees: [],
    ...over,
  };
}

const withOther = (email: string, name: string | null = null) => [
  { email: OWNER, self: true },
  name ? { email, name } : { email },
];

const baseOpts = { now: NOW, timezone: TZ, ownerEmails: [OWNER], appBaseUrl: LINK };

// --------------------------------------------------------------------------
describe('AC-MTG-2 — the organiser trap: a solo focus block is NOT a meeting', () => {
  it('a solo block the user organised is absent from the payload', async () => {
    const client = fakeClient({
      events: [
        evt({ title: 'Focus block', attendees: [] }),
        evt({
          id: 'sync',
          title: 'EDS Team Sync',
          start_time: '2026-09-15T18:00:00Z',
          attendees: withOther('teammate@enterpriseds.io'),
        }),
      ],
    });
    const p = await loadMeetingsDigestPayload(client, USER, baseOpts);
    assert.ok(p, 'payload should exist — there is one real meeting');
    const titles = p!.today.map((m) => m.title);
    assert.deepEqual(titles, ['EDS Team Sync']);
    assert.equal(
      titles.includes('Focus block'),
      false,
      'organiser-derived classification would put the solo hold here',
    );
    assert.equal(JSON.stringify(p).includes('Focus block'), false);
  });

  it('the organiser is IDENTICAL on both rows, so organiser alone cannot separate them', () => {
    const solo = evt({ title: 'Focus block' });
    const real = evt({ title: 'EDS Team Sync', attendees: withOther('teammate@enterpriseds.io') });
    assert.equal(solo.organizer_email, real.organizer_email);
    assert.equal(classifyWithPerson(solo as any, [OWNER]), false);
    assert.equal(classifyWithPerson(real as any, [OWNER]), true);
  });

  it('a calendar of nothing but solo holds sends NOTHING (not an empty-state email)', async () => {
    const client = fakeClient({
      events: [evt({ title: 'Focus block' }), evt({ id: 'h', title: 'Haircut' })],
    });
    assert.equal(await loadMeetingsDigestPayload(client, USER, baseOpts), null);
  });
});

// --------------------------------------------------------------------------
describe('AC-MTG-3 — a real second attendee IS a meeting', () => {
  it('includes the meeting, its attendees, and marks the owner isSelf', async () => {
    const client = fakeClient({
      events: [
        evt({
          title: 'Call with Travis Wagner',
          attendees: withOther('travis.wagner@example.com', 'Travis Wagner'),
          location: 'Zoom',
        }),
      ],
    });
    const p = await loadMeetingsDigestPayload(client, USER, baseOpts);
    assert.ok(p);
    assert.equal(p!.today.length, 1);
    const m = p!.today[0];
    assert.equal(m.title, 'Call with Travis Wagner');
    assert.equal(m.withPerson, true);
    assert.equal(m.location, 'Zoom');
    assert.equal(m.localDate, '2026-09-15');
    assert.equal(m.attendees.length, 2);
    assert.deepEqual(m.attendees.map((a) => a.isSelf), [true, false]);
    assert.equal(p!.deepLink, `${LINK}/priorities`);
  });

  it('owner-by-ADDRESS only (the Graph case, no self flag) is still not a second person', async () => {
    const client = fakeClient({
      events: [evt({ title: 'Solo, address-matched', attendees: [{ email: 'VON.ELLIS@EnterpriseDS.io' }] })],
    });
    assert.equal(await loadMeetingsDigestPayload(client, USER, baseOpts), null);
  });

  it('a free/OOF event with a real attendee is excluded (showAs is a stated rule)', async () => {
    const client = fakeClient({
      events: [evt({ title: 'Held slot', show_as: 'free', attendees: withOther('x@y.com') })],
    });
    assert.equal(await loadMeetingsDigestPayload(client, USER, baseOpts), null);
  });
});

// --------------------------------------------------------------------------
describe('absent evidence is never a pass — the unclassified row', () => {
  it('a row with NO attendee data classifies as null, not false and not true', () => {
    assert.equal(attendeeEvidence(evt({ attendees: null })), null);
    assert.equal(classifyWithPerson(evt({ attendees: null }) as any, [OWNER]), null);
    // An EMPTY array is evidence ("nobody else"), not absent evidence.
    assert.notEqual(classifyWithPerson(evt({ attendees: [] }) as any, [OWNER]), null);
  });

  it('the unclassified row is EXCLUDED from the payload rather than assumed', async () => {
    const client = fakeClient({
      events: [
        evt({ id: 'legacy', title: 'Legacy row, capture never ran', attendees: null }),
        evt({ id: 'real', title: 'Real meeting', attendees: withOther('t@e.io') }),
      ],
    });
    const p = await loadMeetingsDigestPayload(client, USER, baseOpts);
    assert.ok(p);
    assert.deepEqual(p!.today.map((m) => m.title), ['Real meeting']);
  });

  it('a calendar of ONLY unclassified rows sends nothing', async () => {
    const client = fakeClient({ events: [evt({ attendees: null }), evt({ id: 'b', attendees: 'not json' })] });
    assert.equal(await loadMeetingsDigestPayload(client, USER, baseOpts), null);
  });
});

// --------------------------------------------------------------------------
describe('AC-MTG-5 — days with no person-meetings are omitted from byDay', () => {
  it('only the days that have person-meetings appear, ascending', async () => {
    const client = fakeClient({
      events: [
        evt({ id: 'd0', title: 'Today sync', attendees: withOther('a@b.io') }),
        // +1 has ONLY a solo hold -- the day must not survive on its own.
        evt({ id: 'd1solo', title: 'Gym', start_time: '2026-09-16T14:00:00Z', attendees: [] }),
        evt({ id: 'd2', title: 'Vendor call', start_time: '2026-09-17T16:00:00Z', attendees: withOther('v@x.com') }),
        evt({ id: 'd6', title: 'Quarterly review', start_time: '2026-09-21T14:00:00Z', attendees: withOther('boss@x.com') }),
      ],
    });
    const p = await loadMeetingsDigestPayload(client, USER, baseOpts);
    assert.ok(p);
    assert.deepEqual(p!.byDay.map((d) => d.localDate), ['2026-09-15', '2026-09-17', '2026-09-21']);
    assert.equal(p!.byDay.length, 3, 'no empty day is carried');
    assert.equal(p!.today.length, 1);
    assert.equal(p!.date, '2026-09-15');
    assert.equal(p!.timezone, TZ);
  });

  it('an event beyond the 7-day horizon is never read (the query window bounds it)', async () => {
    const client = fakeClient({
      events: [evt({ id: 'far', title: 'Next month', start_time: '2026-09-30T14:00:00Z', attendees: withOther('a@b.io') })],
    });
    assert.equal(await loadMeetingsDigestPayload(client, USER, baseOpts), null);
    const q = client.calls.find((c: any) => c.table === 'external_calendar_events');
    assert.equal(q.columns, MEETING_EVENT_COLUMNS);
    assert.equal(q.eq.user_id, USER, 'the query is user-scoped — no cross-user leakage');
    // today 00:00 ET = 04:00Z; horizon end = start of 2026-09-22 ET = 04:00Z.
    assert.equal(q.gte.start_time, '2026-09-15T04:00:00.000Z');
    assert.equal(q.lt.start_time, '2026-09-22T04:00:00.000Z');
  });

  it("a late-evening meeting buckets by the OWNER'S local day, not UTC", async () => {
    // 01:00Z on the 16th is 21:00 ET on the 15th. The day key must be the owner's.
    // NOTE: the bucketing itself is `groupMeetingsByDay` in meetings.ts (proved by its own
    // suite); this asserts the COMPOSED result, so no mutation is claimed for it here --
    // the code that could break it is not in this lane's file.
    const client = fakeClient({
      events: [evt({ id: 'late', title: 'Late call', start_time: '2026-09-16T01:00:00Z', attendees: withOther('a@b.io') })],
    });
    const p = await loadMeetingsDigestPayload(client, USER, baseOpts);
    assert.ok(p);
    assert.deepEqual(p!.byDay.map((d) => d.localDate), ['2026-09-15']);
    assert.equal(p!.today.length, 1, '21:00 ET on the 15th is TODAY, not tomorrow');
  });

  it('day +6 IS inside the horizon', async () => {
    const client = fakeClient({
      events: [evt({ id: 'd6', title: 'Quarterly review', start_time: '2026-09-21T14:00:00Z', attendees: withOther('boss@x.com') })],
    });
    const p = await loadMeetingsDigestPayload(client, USER, baseOpts);
    assert.ok(p);
    assert.deepEqual(p!.byDay.map((d) => d.localDate), ['2026-09-21']);
    assert.equal(p!.today.length, 0, 'nothing today, but the digest still sends');
  });
});

// --------------------------------------------------------------------------
describe('AC-MTG-4 — empty means null, never an empty-state email', () => {
  it('no rows at all -> null', async () => {
    assert.equal(await loadMeetingsDigestPayload(fakeClient({ events: [] }), USER, baseOpts), null);
  });
});

// --------------------------------------------------------------------------
describe('AC-LINK-1 — the deep link fails CLOSED', () => {
  it('throws on a localhost base rather than mailing a dead link', async () => {
    const client = fakeClient({ events: [evt({ attendees: withOther('a@b.io') })] });
    await assert.rejects(
      () => loadMeetingsDigestPayload(client, USER, { ...baseOpts, appBaseUrl: 'http://localhost:5173' }),
      MissingDeepLinkBaseError,
    );
  });
});

// --------------------------------------------------------------------------
describe('owner "self" set comes from real sources, not an assumption', () => {
  it('unions profiles.email and every calendar_connections.provider_account_email', async () => {
    const client = fakeClient({
      profile: { email: 'Von.Ellis@EnterpriseDS.io' },
      connections: [{ provider_account_email: 'von@gmail.com' }, { provider_account_email: 'von@gmail.com' }],
    });
    assert.deepEqual(await resolveOwnerEmails(client, USER), ['von.ellis@enterpriseds.io', 'von@gmail.com']);
    const profileCall = client.calls.find((c: any) => c.table === 'profiles');
    assert.equal(profileCall.eq.user_id, USER, 'profiles is keyed on user_id, not id');
  });

  it('a second connected mailbox is recognised as self, so its solo hold is not a meeting', async () => {
    const client = fakeClient({
      profile: { email: OWNER },
      connections: [{ provider_account_email: 'von@gmail.com' }],
      events: [evt({ title: 'Personal hold', attendees: [{ email: 'von@gmail.com' }] })],
    });
    const p = await loadMeetingsDigestPayload(client, USER, { now: NOW, timezone: TZ, appBaseUrl: LINK });
    assert.equal(p, null);
  });
});

// --------------------------------------------------------------------------
describe('toDigestMeeting — shape the renderer consumes', () => {
  it('maps the real columns and formats the local start time', () => {
    const m = toDigestMeeting(
      evt({ id: 'x1', title: 'Call', start_time: '2026-09-15T18:00:00Z', attendees: withOther('t@e.io', 'T') }),
      { localDate: '2026-09-15', withPerson: true, timezone: TZ, ownerEmails: [OWNER] },
    );
    assert.equal(m.id, 'x1');
    assert.equal(m.start, '2026-09-15T18:00:00Z');
    assert.equal(m.startLocal, '2:00 PM');
    assert.equal(m.showAs, 'busy');
    assert.deepEqual(m.attendees[1], { name: 'T', email: 't@e.io', isSelf: false });
  });
});

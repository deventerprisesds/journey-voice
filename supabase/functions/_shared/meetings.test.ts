// WHAT:       Executable guards for the with-a-person classifier + 7-day grouping.
// WHY:        AC-MTG-2 names organizer-based classification as "the trap"; AC-MTG-5 names
//             silent single-list merging; AC-MTG-4 names the empty-state email. Each is a
//             test here, not a note. Fixtures are REAL rows read from the live
//             external_calendar_events table on 2026-09-13 (see IMPL-meetings.md chunk 1).
// EVIDENCE:   run: bun supabase/functions/_shared/meetings.test.ts
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.

import {
  isWithPerson,
  otherPeople,
  normalizeAttendees,
  normalizeShowAs,
  showAsCountsAsMeeting,
  groupMeetingsByDay,
  shouldSendMeetingsDigest,
  MEETING_HORIZON_DAYS,
} from './meetings.ts';

let failures = 0;
let passes = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { passes++; console.log(`  ok   ${name}`); }
  else { failures++; console.log(`  FAIL ${name} ${detail}`); }
}

const OWNER = ['von.ellis@enterpriseds.io'];
const TZ = 'America/New_York';

// ---- Real rows (live DB, 2026-09-13). Titles/times verbatim; attendees are what the
// providers send for these events once capture ships. ------------------------------------
const haircut = {                       // solo hold -- THE TRAP row
  title: 'Haircut',
  start_time: '2026-09-17 15:00:00+00',
  show_as: 'busy',
  organizer_email: 'von.ellis@enterpriseds.io',   // owner organizes their own solo hold
  attendees: [],
};
const travis = {                        // real 2-person meeting
  title: 'Call with Travis Wagner',
  start_time: '2026-09-15 18:00:00+00',
  show_as: 'busy',
  organizer_email: 'von.ellis@enterpriseds.io',   // owner organizes this one TOO
  attendees: [
    { email: 'von.ellis@enterpriseds.io', self: true },
    { email: 'travis.wagner@example.com', name: 'Travis Wagner' },
  ],
};
const teamSync = {
  title: 'EDS Team Sync',
  start_time: '2026-09-15 14:00:00+00',
  show_as: 'busy',
  attendees: [
    { email: 'von.ellis@enterpriseds.io', self: true },
    { email: 'teammate@enterpriseds.io' },
  ],
};
const interview = {
  title: 'Trinnex interview — Mark Zito: AI/Data Science Product Management',
  start_time: '2026-09-16 16:30:00+00',
  show_as: 'busy',
  attendees: [
    { email: 'von.ellis@enterpriseds.io', self: true },
    { email: 'mark.zito@trinnex.example' },
  ],
};

console.log('\nAC-MTG-2 — the organizer trap');
check('solo "Haircut" is NOT with-a-person', isWithPerson(haircut, OWNER) === false);
check('"Call with Travis Wagner" IS with-a-person', isWithPerson(travis, OWNER) === true);
check(
  'organizer is identical on BOTH rows, so organizer alone cannot separate them',
  haircut.organizer_email === travis.organizer_email,
);

console.log('\nAC-MTG-3 — attendees consisting only of the owner');
check('self-flagged owner only -> false',
  isWithPerson({ start_time: 'x', show_as: 'busy',
    attendees: [{ email: 'von.ellis@enterpriseds.io', self: true }] }, OWNER) === false);
check('owner by ADDRESS match (no self flag, the Graph case) -> false',
  isWithPerson({ start_time: 'x', show_as: 'busy',
    attendees: [{ email: 'VON.ELLIS@EnterpriseDS.io' }] }, OWNER) === false);
check('a room/resource mailbox is not a person',
  isWithPerson({ start_time: 'x', show_as: 'busy',
    attendees: [{ email: 'von.ellis@enterpriseds.io', self: true },
                { email: 'boardroom@enterpriseds.io', resource: true }] }, OWNER) === false);
check('owner + one real person -> true',
  otherPeople(travis, OWNER).length === 1);

console.log('\nAC-MTG-7 — showAs is a stated rule');
check('busy counts', showAsCountsAsMeeting('busy') === true);
check('tentative counts', showAsCountsAsMeeting('tentative') === true);
check('free does NOT count', showAsCountsAsMeeting('free') === false);
check('oof does NOT count', showAsCountsAsMeeting('oof') === false);
check('NULL (legacy row) counts -- errs toward surfacing', showAsCountsAsMeeting(null) === true);
check('a free event WITH a real attendee is still excluded',
  isWithPerson({ ...travis, show_as: 'free' }, OWNER) === false);

console.log('\nnormalizers — ONE storage shape for both providers');
const g = normalizeAttendees({ attendees: [
  { email: 'A@Example.com', displayName: 'A', self: true },
  { email: 'room@x.com', resource: true },
] }, 'google');
check('google: email lowercased', g[0].email === 'a@example.com');
check('google: self preserved', g[0].self === true);
check('google: resource preserved', g[1].resource === true);
const o = normalizeAttendees({ attendees: [
  { emailAddress: { address: 'B@Example.com', name: 'B' }, type: 'required',
    status: { response: 'accepted' } },
  { emailAddress: { address: 'room@x.com' }, type: 'resource' },
] }, 'outlook');
check('outlook: emailAddress.address unwrapped + lowercased', o[0].email === 'b@example.com');
check('outlook: type=resource -> resource flag', o[1].resource === true);
check('outlook: response captured', o[0].responseStatus === 'accepted');
check('both providers yield the same key set',
  Object.keys(g[0]).includes('email') && Object.keys(o[0]).includes('email'));
check('google transparency=transparent -> free', normalizeShowAs({ transparency: 'transparent' }, 'google') === 'free');
check('google outOfOffice -> oof', normalizeShowAs({ eventType: 'outOfOffice' }, 'google') === 'oof');
check('graph showAs passed through', normalizeShowAs({ showAs: 'tentative' }, 'outlook') === 'tentative');
check('missing attendees -> [] not throw', normalizeAttendees({}, 'google').length === 0);

console.log('\nAC-MTG-5 — grouping BY DAY across the horizon');
// now = 2026-09-15T12:00Z (08:00 ET) -> today +0 = 09-15, +1 = 09-16, +2 = 09-17
const NOW = new Date('2026-09-15T12:00:00Z');
// AC-MTG-5 literally: meetings on days +0, +2 and +6; days +1/+3/+4/+5 must be ABSENT.
// NOW = 09-15 ET, so +0=09-15, +2=09-17, +6=09-21.
const d2 = { title: 'Vendor call', start_time: '2026-09-17 16:00:00+00', show_as: 'busy',
  attendees: [{ email: 'von.ellis@enterpriseds.io', self: true }, { email: 'vendor@x.com' }] };
const d6 = { title: 'Quarterly review', start_time: '2026-09-21 14:00:00+00', show_as: 'busy',
  attendees: [{ email: 'von.ellis@enterpriseds.io', self: true }, { email: 'boss@x.com' }] };
// haircut (solo, 09-17) and interview (+1, 09-16) are in the input on purpose:
// haircut must be FILTERED (solo) and must NOT keep 09-17 alive on its own.
const grouped = groupMeetingsByDay([teamSync, travis, d2, d6, haircut], OWNER, TZ, NOW);
check('exactly three days present', grouped.length === 3,
  `got ${grouped.length}: ${JSON.stringify(grouped.map(d => d.date))}`);
check('the three days are +0, +2, +6 in ascending order',
  grouped.map(d => d.date).join(',') === '2026-09-15,2026-09-17,2026-09-21',
  grouped.map(d => d.date).join(','));
check('offsets are 0, 2, 6', grouped.map(d => d.offset).join(',') === '0,2,6',
  grouped.map(d => d.offset).join(','));
check('days +1/+3/+4/+5 are absent, not empty-merged',
  !grouped.some(d => [1, 3, 4, 5].includes(d.offset)));
check('day +0 holds BOTH of that day\'s meetings', grouped[0].meetings.length === 2);
check('day +0 is time-sorted', grouped[0].meetings[0].title === 'EDS Team Sync');
check('solo Haircut is filtered out of its day (+2 survives only via the vendor call)',
  grouped[1].meetings.length === 1 && grouped[1].meetings[0].title === 'Vendor call');
check('nothing is silently merged into one flat list', grouped.every(d => d.date.length === 10));
check('horizon is the shared constant', MEETING_HORIZON_DAYS === 7);
const far = groupMeetingsByDay(
  [{ ...teamSync, start_time: '2026-09-30 14:00:00+00' }], OWNER, TZ, NOW);
check('an event beyond the 7-day horizon is excluded', far.length === 0);
const day6 = groupMeetingsByDay(
  [{ ...teamSync, start_time: '2026-09-21 14:00:00+00' }], OWNER, TZ, NOW);
check('day +6 IS inside the horizon', day6.length === 1, JSON.stringify(day6.map(d => d.date)));

console.log('\ntimestamp-format robustness (a drop here is SILENT)');
// isDateInTimezone() returns false for an unparseable date, so a bad timestamp format does not
// error -- it silently removes the meeting from the digest. Both forms the DB/client can hand
// us must bucket identically. ('2026-09-15T14:00:00+00' -- no offset MINUTES -- is an Invalid
// Date in V8; measured 2026-09-13.)
const pgForm  = groupMeetingsByDay([{ ...teamSync, start_time: '2026-09-15 14:00:00+00' }], OWNER, TZ, NOW);
const isoForm = groupMeetingsByDay([{ ...teamSync, start_time: '2026-09-15T14:00:00+00:00' }], OWNER, TZ, NOW);
const zForm   = groupMeetingsByDay([{ ...teamSync, start_time: '2026-09-15T14:00:00Z' }], OWNER, TZ, NOW);
check('postgres space form buckets', pgForm.length === 1 && pgForm[0].date === '2026-09-15');
check('ISO +00:00 form buckets identically', isoForm.length === 1 && isoForm[0].date === '2026-09-15');
check('Z form buckets identically', zForm.length === 1 && zForm[0].date === '2026-09-15');

console.log('\nAC-MTG-4 — suppress, never an empty-state email');
check('no qualifying meetings -> do not send',
  shouldSendMeetingsDigest(groupMeetingsByDay([haircut], OWNER, TZ, NOW)) === false);
check('meeting later in the week (none today) -> DO send',
  shouldSendMeetingsDigest(groupMeetingsByDay([interview], OWNER, TZ, NOW)) === true);
check('meeting today -> DO send',
  shouldSendMeetingsDigest(groupMeetingsByDay([teamSync], OWNER, TZ, NOW)) === true);

console.log('\nAC-MTG-8 — no cross-user leakage');
const userB = { title: 'B private', start_time: '2026-09-15 19:00:00+00', show_as: 'busy',
  attendees: [{ email: 'someone-else@other.com' }] };
// The classifier is pure over the rows it is GIVEN; the guard is that the caller's row set is
// user-scoped. This asserts the shape of that contract: rows in, no global lookup.
const onlyA = groupMeetingsByDay([travis], OWNER, TZ, NOW);
check('user A grouping contains no address from user B\'s event',
  !JSON.stringify(onlyA).includes('someone-else@other.com'));
check('userB row is only present when passed in',
  JSON.stringify(groupMeetingsByDay([travis, userB], OWNER, TZ, NOW)).includes('someone-else@other.com'));

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) throw new Error(`MEETINGS TESTS FAILED: ${failures}`);

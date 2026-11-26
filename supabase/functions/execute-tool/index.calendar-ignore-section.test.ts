// WHAT:       Tests get_my_config(section:"calendar_ignore") through the REAL execute-tool handler: it returns the
//             owner's calendar-ignore rules (phrases, tentative, categories, ownerEmails) and nothing else.
// WHY:        Owner 2026-11-26 (option A): Huddle READS the owner's TaskOS ignore settings and applies the same
//             decision instead of keeping its own hardcoded rule. This section is the one narrow read it uses.
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   huddle-extension-app .claude/ac-huddle-calendar-ignore.md AC-1, AC-2, AC-3.
// Run: node --experimental-strip-types --no-warnings --test supabase/functions/execute-tool/index.calendar-ignore-section.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ENV, setDb, loadHandler, post, makeClient, type Db } from '../../../docs/qc-evidence/probes/harness.ts';
import { loadIgnoreRules } from '../_shared/calendar-ignore.ts';

const U = '44444444-4444-4444-8444-444444444444';
const auth = { authorization: `Bearer ${ENV.SUPABASE_SERVICE_ROLE_KEY}`, apikey: 'public-anon-key' };
let handler: (r: Request) => Promise<Response>;
test.before(async () => { handler = await loadHandler('execute-tool'); });

const call = async (args: Record<string, unknown>) => {
  const r = await handler(post({ toolName: 'get_my_config', userId: U, args }, auth));
  return { status: r.status, body: await r.json() };
};
const dbWith = (config: unknown): Db => ({
  user_scheduling_prefs: [{ user_id: U, config }],
  profiles: [{ user_id: U, email: ' Dev@Example.io ' }],
  calendar_connections: [{ user_id: U, provider_account_email: 'Von.Ellis@Work.example' }],
  call_sessions: [{ user_id: U, started_at: '2026-11-01' }],
  scheduled_notifications: [{ user_id: U, title: 'x', delivered_at: null, failed_at: null }],
});

test('CIS-1 (AC-1) returns exactly the four rule fields, equal to loadIgnoreRules for that user', async () => {
  const config = { calendarIgnoreTitles: [' Work Block ', 'Focus'], calendarIgnoreTentative: false, calendarIgnoreCategories: ['Purple category', 'purple CATEGORY'] };
  setDb(dbWith(config));
  const r = await call({ section: 'calendar_ignore' });
  assert.equal(r.status, 200);
  assert.equal(r.body.success, true);
  assert.deepEqual(Object.keys(r.body.result).sort(), ['categories', 'ownerEmails', 'phrases', 'tentative']);
  const direct = await loadIgnoreRules(makeClient(dbWith(config)), U);
  assert.deepEqual(r.body.result, { phrases: direct.phrases, tentative: direct.tentative, categories: direct.categories, ownerEmails: direct.ownerEmails });
  assert.deepEqual(r.body.result, { phrases: ['work block', 'focus'], tentative: false, categories: ['purple category'], ownerEmails: ['dev@example.io', 'von.ellis@work.example'] });
  for (const k of ['call_history', 'topic_groups', 'pending_notifications', 'scheduling_config', 'my_profile', 'calendar_connections']) assert.equal(k in r.body.result, false, k);
});

test('CIS-2 (AC-2) absent config = journey defaults; malformed fields take their own defaults', async () => {
  setDb(dbWith(undefined));
  let r = await call({ section: 'calendar_ignore' });
  assert.deepEqual([r.body.result.phrases, r.body.result.tentative, r.body.result.categories], [['work block'], true, []]);
  setDb(dbWith({ calendarIgnoreCategories: 'Purple category', calendarIgnoreTitles: 'nope', calendarIgnoreTentative: 'false' }));
  r = await call({ section: 'calendar_ignore' });
  assert.deepEqual([r.body.result.phrases, r.body.result.tentative, r.body.result.categories], [['work block'], true, []]);
  setDb(dbWith({ calendarIgnoreTitles: [] }));
  r = await call({ section: 'calendar_ignore' });
  assert.deepEqual(r.body.result.phrases, [], 'an emptied list stays empty');
});

test('CIS-3 (AC-2) the section resolves through _shared/calendar-ignore.ts, not a second parser', () => {
  const src = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  assert.match(src, /import \{ loadIgnoreRules \} from "\.\.\/_shared\/calendar-ignore\.ts";/);
  const branch = src.slice(src.indexOf("if (section === 'calendar_ignore')"), src.indexOf("if (section === 'full_config')"));
  assert.match(branch, /await loadIgnoreRules\(supabase, userId\)/);
  assert.doesNotMatch(branch, /calendarIgnore(Titles|Tentative|Categories)/, 'no config field parsed inline');
});

test('CIS-4 additive: other sections and unknown sections behave as before', async () => {
  setDb(dbWith({}));
  const r = await call({ section: 'my_profile' });
  assert.equal(r.body.success, true);
  assert.ok('my_profile' in r.body.result);
  const bad = await call({ section: 'nope' });
  assert.equal(bad.body.success, false);
  assert.match(String(bad.body.error), /Unknown section: nope/);
});

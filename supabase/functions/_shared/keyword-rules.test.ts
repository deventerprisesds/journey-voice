// WHAT:       Guards the shared keyword rule: a keyword whose lane is a category steers only tasks in that
//             category; every other keyword behaves exactly as before.
// WHY:        Owner 2026-11-03: extend the keywords to point at a lane, never remove them. Before, the
//             scheduler read only the window, so "Work on Nexus application" (VENTURES) was pulled into
//             business hours by "work", and "Morning workout" got business hours because "work" is tested first.
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   docs/qc-evidence/AC-job-category.md section 3 (spelling table S-1..S-33).
// Run: node --experimental-strip-types --test supabase/functions/_shared/keyword-rules.test.ts
//
// The keyword map is the owner's LIVE map, captured with its stored order (Postgres jsonb sorts object keys
// by length, then bytewise). A map typed in code order would test a precedence production never uses.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { matchKeywordRule } from './keyword-rules.ts';

const entries: Array<[string, [string, string]]> = JSON.parse(
  readFileSync(new URL('./fixtures/owner-keywords-2026-11-04.json', import.meta.url), 'utf8'),
);

// The relabel this change ships: the 13 work-sounding keywords move from CAREER to JOB; interview stays CAREER.
const RELABEL_TO_JOB = ['work', 'email', 'reply', 'respond', 'message', 'call', 'meeting', 'follow_up',
  'review', 'budget', 'invoice', 'contract', 'office'];
const LIVE: Record<string, [string, string]> = Object.fromEntries(entries);
const AFTER: Record<string, [string, string]> = Object.fromEntries(
  entries.map(([k, [w, lane]]) => [k, [w, RELABEL_TO_JOB.includes(k) ? 'JOB' : lane]]),
);

const WEEKDAY = ['morning', 'business_hours', 'after_work', 'evening'];
const SATURDAY = ['weekends'];

function pick(title: string, category: unknown, keywords = AFTER, active = WEEKDAY) {
  const m = matchKeywordRule(title, keywords, { category, activeWindowNames: active });
  return m ? `${m.keyword}->${m.window}` : 'none';
}

describe('fixture is in stored (jsonb) order', () => {
  it('K0 keys sort by length then bytes, exactly as Postgres stores them', () => {
    const keys = entries.map(([k]) => k);
    const sorted = [...keys].sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
    assert.deepEqual(keys, sorted);
    assert.equal(keys.length, 46);
  });
});

describe('spelling table (owner map after the JOB relabel, a weekday unless stated)', () => {
  const rows: Array<[string, string, unknown, string]> = [
    ['S-1', 'Morning workout', 'LIFE', 'morning->morning'],
    ['S-2', 'Workout at the gym', 'LIFE', 'workout->morning'],
    ['S-3', 'Finish homework', 'PROF_EDUCATION', 'homework->after_work'],
    ['S-4', 'Finish homework', 'EDUCATION', 'homework->after_work'],          // EDUCATION counts as PROF_EDUCATION
    ['S-5', 'Networking event', 'CAREER', 'none'],
    ['S-6', 'Networking event', 'JOB', 'work->business_hours'],              // in-category substring kept
    ['S-7', 'Recall the library book', 'LIFE', 'none'],
    ['S-8', 'Recall Trinnex invoice', 'JOB', 'call->business_hours'],        // call sorts before invoice
    ['S-9', 'Email the dentist', 'LIFE', 'dentist->business_hours'],         // skip email, KEEP scanning
    ['S-10', 'Email recruiter about Acme role', 'CAREER', 'none'],
    ['S-11', 'Prep for interview with Acme', 'CAREER', 'interview->business_hours'],
    ['S-12', 'Prep for interview with Acme', 'JOB', 'none'],
    ['S-13', 'Reply to Huddle beta users', 'VENTURES', 'none'],
    ['S-14', 'Go to post office', 'LIFE', 'post_office->business_hours'],    // '_' still reads as a space
    ['S-15', 'Text mom', 'LIFE', 'text->business_hours'],
    ['S-15b', 'Write context doc', 'JOB', 'none'],
    ['S-16', 'Morning standup', 'JOB', 'morning->morning'],                  // lane 'flexible' is not a category
    ['S-19', 'Go to the mall', 'PERSONAL', 'mall->after_work'],              // PERSONAL counts as LIFE
    ['S-20', 'Fix bug', 'JOB', 'none'],
    ['S-22', 'Dinner with the Trinnex team', 'JOB', 'none'],
    ['S-23', 'Lunch with Trinnex team', 'JOB', 'none'],
    ['S-24', 'Budget review', 'LIFE', 'none'],
    ['S-25', 'Side project kickoff call', 'VENTURES', 'side->after_work'],   // skip call, reach side
    ['S-26', 'Follow-up with Trinnex PM', 'JOB', 'none'],                    // hyphen is not '_'
    ['S-27', 'Follow up with Trinnex PM', 'JOB', 'follow_up->business_hours'],
    ['S-28', 'WORK ON OPS DECK', 'JOB', 'work->business_hours'],
    ['S-29', 'Study for MIT exam', 'PROF_EDUCATION', 'study->evening'],
    ['S-30', 'Study for MIT exam', 'LIFE', 'none'],
    ['S-31', 'Homework review', 'PROF_EDUCATION', 'homework->after_work'],   // skips work AND review
    ['S-33', 'Plan appointment', 'LIFE', 'none'],                            // 'flexible' window never applies
    ['V-1', 'Work on Nexus application', 'VENTURES', 'none'],                // the owner's reported case
    ['J-1', 'Reply to my manager\'s email', 'JOB', 'email->business_hours'],    // email sorts before reply
  ];
  for (const [id, title, cat, want] of rows) {
    it(`${id} "${title}" [${cat}] -> ${want}`, () => assert.equal(pick(title, cat), want));
  }

  it('S-21 a keyword whose window is closed today is passed over (Saturday)', () => {
    assert.equal(pick('Email the dentist', 'LIFE', AFTER, SATURDAY), 'none');
  });
  it('S-17 a lane that is not a category ("TODO") applies to every category', () => {
    assert.equal(pick('Focus block', 'JOB', { focus: ['morning', 'TODO'] }), 'focus->morning');
  });
  it('S-18 the lane compare ignores case: "job" is the JOB category', () => {
    const map = { work: ['business_hours', 'job'], workout: ['morning', 'LIFE'] };
    assert.equal(pick('Workout', 'LIFE', map as any), 'workout->morning');
  });
  it('S-32 keywords under 3 characters never match', () => {
    assert.equal(pick('Go home', 'LIFE', { go: ['after_work', 'LIFE'] } as any), 'none');
  });
  it('H-1 a name-hint row (Flexible window) never moves a task', () => {
    assert.equal(pick('Ship Huddle push notifications', 'VENTURES', { huddle: ['flexible', 'VENTURES'] } as any), 'none');
  });
});

describe('unchanged behaviour', () => {
  it('U-1 a caller that does not know the category gets the old, ungated answer', () => {
    assert.equal(matchKeywordRule('Work on Nexus application', AFTER)?.keyword, 'work');
    assert.equal(matchKeywordRule('Morning workout', AFTER)?.keyword, 'work');
  });
  it('U-2 with the CURRENT live lanes (before the relabel) a CAREER task keeps every work keyword', () => {
    assert.equal(pick('Email recruiter about Acme role', 'CAREER', LIVE), 'email->business_hours');
  });
  it('U-3 empty inputs return null', () => {
    assert.equal(matchKeywordRule('', AFTER, { category: 'LIFE' }), null);
    assert.equal(matchKeywordRule('Text mom', null, { category: 'LIFE' }), null);
  });
});

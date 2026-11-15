// WHAT:       Tests: a course with class sessions on the calendar counts as current (assignment-intake.ts).
// WHY:        Owner 2026-11-15: "You can not determine a course to be inactive by assignments alone. If it has
//             lectures obviously it's active." Since 2026-11-09 the sync listed only MGT-782 while MGT-702 met Tue 19:00.
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   activity_log nightly_assignment_sync current_courses ["MGT-782"] 11-09..11-15.
// Run: node --experimental-strip-types --no-warnings --test supabase/functions/_shared/course-active.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { currentCourseKeys, courseCodesInTitles, normalizeCourseCode, planAssignmentSync } from './assignment-intake.ts';

const row = (id: string, code: string, due: string | null, status = 'active') =>
  ({ id, course_id: `c-${code}`, title: id, status, due_date: due, courses: { id: `c-${code}`, name: code, code } }) as any;
const rows = [row('cp2', 'MGT-702', '2026-11-09T04:59:59Z'), row('paper', 'MGT-782', '2026-12-10T04:59:59Z')];

describe('a course with lectures is active', () => {
  it('CA-1 calendar titles yield course codes, in any spelling', () => {
    assert.deepEqual(courseCodesInTitles(['MGT-702-W1 (202711)', 'MGT-782-W1 (202711)', 'Haircut', 'Platform Weekly']).sort(), ['MGT702', 'MGT782']);
    assert.equal(normalizeCourseCode('mgt 702'), 'MGT702');
    assert.equal(normalizeCourseCode('Lunch'), null);
  });
  it('CA-2 the real case: MGT-702 has no dated work left but meets Tuesdays -> current', () => {
    const without = currentCourseKeys(rows, '2026-11-15', 'America/New_York');
    assert.deepEqual([...without], ['c-MGT-782']);
    const withLectures = currentCourseKeys(rows, '2026-11-15', 'America/New_York', ['MGT702']);
    assert.deepEqual([...withLectures].sort(), ['c-MGT-702', 'c-MGT-782']);
  });
  it('CA-3 the plan reports the lecture course as current', () => {
    const plan = planAssignmentSync({ rows, tasks: [], todayISO: '2026-11-15', timezone: 'America/New_York', boardId: 'b', userId: 'u', nowISO: '2026-11-15T15:00:00Z', lectureCourseCodes: ['MGT702'] });
    assert.deepEqual([...plan.currentCourses].sort(), ['MGT-702', 'MGT-782']);
  });
  it('CA-4 the sync reads calendar class sessions and passes them to the plan', () => {
    const src = readFileSync(new URL('../nightly-assignment-sync/index.ts', import.meta.url), 'utf8');
    assert.match(src, /from\('external_calendar_events'\)/);
    assert.match(src, /lectureCourseCodes,\n\s*\}\);/);
  });
});

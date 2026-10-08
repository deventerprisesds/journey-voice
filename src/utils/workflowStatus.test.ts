// =============================================================================
// WHAT:       Executable proof that a CATEGORY can never be accepted as a workflow status.
// WHY:        This is the one assertion that would have caught the live defect. 11 rows carried
//             `status = VENTURES` because `smart-calendar-scheduler` returned
//             `mapping.defaultStatus` (a category) and `taskScheduling.ts` wrote it to
//             `tasks.status`. Reading the code is weaker than running it, and the distinction
//             cannot be type-checked: `task_status` contains LIFE/CAREER/PROF_EDUCATION/VENTURES
//             as well as the real lanes, so TypeScript is happy either way.
// EVIDENCE:   .claude/accuracy-log.md (2026-10-08); journey PRs #28/#29/#30.
// Run: npm test
// =============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  asWorkflowStatus,
  defaultStatusForNewTask,
  isWorkflowStatus,
  WORKFLOW_STATUSES,
} from './workflowStatus.ts';

// The four category names that are ALSO members of the task_status enum. These are the ones a
// type check cannot catch, so they are the whole point of the guard.
const CATEGORY_SHAPED_STATUSES = ['LIFE', 'CAREER', 'PROF_EDUCATION', 'VENTURES'];

// Categories that are NOT in task_status at all — Postgres rejects these outright, which is how
// task creation failed silently rather than landing in the wrong lane.
const CATEGORIES_NOT_IN_ENUM = ['EDUCATION', 'PERSONAL'];

describe('workflow status guard', () => {
  it('accepts every real workflow lane', () => {
    for (const s of WORKFLOW_STATUSES) {
      assert.equal(asWorkflowStatus(s), s, `${s} should be accepted`);
      assert.equal(isWorkflowStatus(s), true);
    }
  });

  it('REJECTS a category that happens to be in the task_status enum', () => {
    // The defect: all four of these are valid `task_status` values and valid `Task['status']`
    // under TypeScript, so only a runtime list can refuse them.
    for (const c of CATEGORY_SHAPED_STATUSES) {
      assert.equal(asWorkflowStatus(c), null, `${c} is a CATEGORY and must not be a status`);
      assert.equal(isWorkflowStatus(c), false);
    }
  });

  it('REJECTS a category that is not in the enum at all', () => {
    for (const c of CATEGORIES_NOT_IN_ENUM) {
      assert.equal(asWorkflowStatus(c), null, `${c} must not be a status`);
    }
  });

  it('does not silently admit a category by omission — the list excludes exactly those four', () => {
    // Guards the guard: if someone "completes" WORKFLOW_STATUSES from the enum, this fails.
    for (const c of CATEGORY_SHAPED_STATUSES) {
      assert.equal(
        WORKFLOW_STATUSES.includes(c as never), false,
        `WORKFLOW_STATUSES must not contain the category ${c}`,
      );
    }
    assert.equal(WORKFLOW_STATUSES.length, 9, 'nine workflow lanes; the four categories are out');
  });

  it('rejects non-strings and near-misses rather than throwing', () => {
    for (const bad of [null, undefined, 42, {}, [], '', 'backlog', 'Backlog', 'UP NEXT', 'UPNEXT']) {
      assert.equal(asWorkflowStatus(bad), null, `${JSON.stringify(bad)} must be rejected`);
    }
  });

  it('a new task is UP_NEXT when dated and BACKLOG when not', () => {
    // journey's own server-side rule (execute-tool/index.ts:1482), restated once so the several
    // client writers stop inventing their own.
    assert.equal(defaultStatusForNewTask({ dated: true }), 'UP_NEXT');
    assert.equal(defaultStatusForNewTask({ dated: false }), 'BACKLOG');
  });
});

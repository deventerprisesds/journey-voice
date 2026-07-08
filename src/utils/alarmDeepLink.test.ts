import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { alarmDeepLink } from './alarmDeepLink.ts';

/**
 * Regression tests for alarm notification deep-link construction.
 *
 * Shade/HUN tap must open the specific task, not the generic tasks list.
 * The web app reads `?task=<uuid>` on /calendar, /tasks, and /dashboard pages
 * and opens the matching task detail panel.
 *
 * Run: node --import tsx --test src/utils/alarmDeepLink.test.ts
 */

describe('alarmDeepLink', () => {
  it('single task with ID → calendar with task query param', () => {
    assert.equal(
      alarmDeepLink('abc-123-def'),
      '/calendar?task=abc-123-def'
    );
  });

  it('real UUID format', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    assert.equal(alarmDeepLink(uuid), `/calendar?task=${uuid}`);
  });

  it('null taskId → calendar root (batched alarms)', () => {
    assert.equal(alarmDeepLink(null), '/calendar');
  });

  it('undefined taskId → calendar root', () => {
    assert.equal(alarmDeepLink(undefined), '/calendar');
  });

  it('empty string taskId → calendar root', () => {
    assert.equal(alarmDeepLink(''), '/calendar');
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { batchLine } from './batch-line.ts';

test('an overdue nag is labelled overdue in a bundle, not due', () => {
  assert.equal(
    batchLine({ notification_type: 'overdue_reminder', title: 'Task Overdue (63 days)', body: '"Fix the Nexus assignments section" was due 63 days ago' }),
    '"Fix the Nexus assignments section" is overdue',
  );
});

test('a due reminder is still labelled due', () => {
  assert.equal(batchLine({ notification_type: 'due_reminder', title: 'Due', body: '"Pay rent" is due today' }), '"Pay rent" is due');
});

test('other types keep their text', () => {
  assert.equal(batchLine({ notification_type: 'scheduled_start_now', title: '', body: 'Your task "Gym" is starting now' }), '"Gym" is starting now');
  assert.equal(batchLine({ notification_type: 'scheduled_reminder', title: 'Call Mom', body: 'at 5' }), 'Call Mom: at 5');
  assert.equal(batchLine({ notification_type: 'task_start_reminder', title: '', body: 'Your task "X" starts in 15 minutes' }), 'Your task "X" starts in 15 minutes');
});

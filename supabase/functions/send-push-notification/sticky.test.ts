// WHAT:       Proves send-push-notification forwards Huddle's opt-in `sticky` flag to the Android bridge
//             in the FCM data payload, and only when the caller asked for it.
// WHY:        Owner, 2026-10-27: "the push should stick until I dismiss". FCM data is an allow-list
//             (fcmData), so a flag Huddle sets never reaches the phone unless it is listed here.
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   huddle-extension-app .claude/actions.md ACT:instant-email-alerts.
//
// The function is a Deno.serve handler with network side effects, so this reads the source of the
// fcmData object rather than invoking it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
const start = src.indexOf('const fcmData: Record<string, string> = {');
const block = start < 0 ? '' : src.slice(start, src.indexOf('};', start));

test('fcmData forwards sticky only when it was asked for', () => {
  assert.ok(block, 'fcmData object not found');
  assert.match(block, /\.\.\.\(data\?\.sticky === true \|\| data\?\.sticky === 'true' \? \{ sticky: 'true' \} : \{\}\)/);
});

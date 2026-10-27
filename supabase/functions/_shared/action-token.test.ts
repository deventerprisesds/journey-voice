// WHAT: Tests for the signed single-task action token used by phone alarm Done/Doing buttons.
// WHY:  The token is the only thing standing between an unauthenticated POST and a task status
//       change, so tampering, expiry and prefix handling must be pinned, not assumed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mintActionToken, verifyActionToken, isUuid, b64urlEncode, b64urlDecode } from './action-token.ts';

const SECRET = 'test-service-role-key';
const U = '113eec07-017c-44e5-8679-6a35e3a1197c';
const T = '9f3c2a10-1111-4222-8333-444455556666';
const NOW = 1_800_000_000;

test('round trip returns the user and task it was minted for', async () => {
  const tok = await mintActionToken(U, T, { nowSec: NOW, secret: SECRET });
  const v = await verifyActionToken(tok, { nowSec: NOW + 60, secret: SECRET });
  assert.ok(v);
  assert.equal(v.userId, U);
  assert.equal(v.taskId, T);
  assert.equal(v.expired, false);
});

test('a token signed with a different key is rejected', async () => {
  const tok = await mintActionToken(U, T, { nowSec: NOW, secret: 'other-key' });
  assert.equal(await verifyActionToken(tok, { nowSec: NOW, secret: SECRET }), null);
});

test('swapping the task id in the body breaks the signature', async () => {
  const tok = await mintActionToken(U, T, { nowSec: NOW, secret: SECRET });
  const [p, , sig] = tok.split('.');
  const forged = b64urlEncode(new TextEncoder().encode(JSON.stringify({ u: U, t: 'someone-elses-task', exp: NOW + 999 })));
  assert.equal(await verifyActionToken(`${p}.${forged}.${sig}`, { nowSec: NOW, secret: SECRET }), null);
});

test('a flipped signature byte is rejected', async () => {
  const tok = await mintActionToken(U, T, { nowSec: NOW, secret: SECRET });
  const [p, body, sig] = tok.split('.');
  const bytes = b64urlDecode(sig); bytes[0] ^= 1;
  assert.equal(await verifyActionToken(`${p}.${body}.${b64urlEncode(bytes)}`, { nowSec: NOW, secret: SECRET }), null);
});

test('expired tokens are rejected unless inside the grace window', async () => {
  const tok = await mintActionToken(U, T, { nowSec: NOW, ttlSec: 100, secret: SECRET });
  assert.equal(await verifyActionToken(tok, { nowSec: NOW + 101, secret: SECRET }), null);
  const graced = await verifyActionToken(tok, { nowSec: NOW + 101, graceSec: 3600, secret: SECRET });
  assert.ok(graced);
  assert.equal(graced.expired, true);
  assert.equal(await verifyActionToken(tok, { nowSec: NOW + 100 + 3601, graceSec: 3600, secret: SECRET }), null);
});

test('wrong prefix, wrong shape and garbage are rejected', async () => {
  const tok = await mintActionToken(U, T, { nowSec: NOW, secret: SECRET });
  assert.equal(await verifyActionToken(tok.replace(/^v1/, 'v2'), { nowSec: NOW, secret: SECRET }), null);
  assert.equal(await verifyActionToken('v1.only-two', { nowSec: NOW, secret: SECRET }), null);
  assert.equal(await verifyActionToken('', { nowSec: NOW, secret: SECRET }), null);
  assert.equal(await verifyActionToken('v1.!!!.@@@', { nowSec: NOW, secret: SECRET }), null);
});

test('isUuid accepts task ids and rejects the strings the phone has historically sent', () => {
  assert.equal(isUuid(T), true);
  for (const bad of ['', 'null', 'undefined', 'test-task-001', 'rem-123']) assert.equal(isUuid(bad), false);
});

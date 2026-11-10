import test from 'node:test';
import assert from 'node:assert/strict';
import { shapeDownloads, isBlobLink, DOWNLOAD_APPS } from './app-downloads.ts';

const SIGNED = 'https://acct.blob.core.windows.net/bridge-apks/x/taskos-v1.0.18.apk?sv=1&sig=abc';

test('rows come back in tab order, one per app, even when bridge-builder omits one', () => {
  const rows = shapeDownloads([{ appId: DOWNLOAD_APPS[0].appId, found: true, version: '1.0.18', builtAt: '2026-11-08T00:00:00Z', sizeBytes: 9, downloadUrl: SIGNED }]);
  assert.deepEqual(rows.map(r => r.key), ['taskos', 'huddle']);
  assert.equal(rows[0].found, true);
  assert.equal(rows[0].version, '1.0.18');
  assert.equal(rows[1].found, false);
  assert.equal(rows[1].downloadUrl, null);
});

test('only a signed https blob link is passed through', () => {
  assert.equal(isBlobLink(SIGNED), true);
  assert.equal(isBlobLink('https://acct.blob.core.windows.net/bridge-apks/x.apk'), false); // unsigned -> 409
  assert.equal(isBlobLink('http://acct.blob.core.windows.net/a?sig=1'), false);
  assert.equal(isBlobLink('https://evil.example/a?sig=1'), false);
  assert.equal(isBlobLink('https://acct.blob.core.windows.net.evil.example/a?sig=1'), false);
  const rows = shapeDownloads([{ appId: DOWNLOAD_APPS[1].appId, found: true, version: '1.0.17', downloadUrl: 'javascript:alert(1)' }]);
  assert.equal(rows[1].found, false);
});

test('garbage input gives two empty rows, never a throw', () => {
  for (const bad of [null, undefined, 'x', {}, [null, 3]]) assert.equal(shapeDownloads(bad).length, 2);
});

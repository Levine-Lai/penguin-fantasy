import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotDigest } from '../scripts/snapshot-digest.mjs';

test('snapshot versions agree across Windows/Linux checkout formatting but detect changed data', () => {
  const linux = '{\n  "gw": 9,\n  "points": 2\n}\n';
  assert.equal(snapshotDigest(linux), snapshotDigest(linux.replaceAll('\n', '\r\n')));
  assert.equal(snapshotDigest(linux), snapshotDigest('{"gw":9,"points":2}'));
  assert.notEqual(snapshotDigest(linux), snapshotDigest('{"gw":9,"points":3}'));
});

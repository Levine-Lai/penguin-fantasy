import { createHash } from 'node:crypto';

// Git checkouts use different line endings on Windows and Linux.
export function snapshotDigest(json) {
  return createHash('sha256').update(JSON.stringify(JSON.parse(json))).digest('hex');
}

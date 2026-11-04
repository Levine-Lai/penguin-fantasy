import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { snapshotDigest } from './snapshot-digest.mjs';

const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const snapshot = snapshotDigest(await readFile('app/static-fpl-data.json', 'utf8'));
await writeFile('out/release.json', JSON.stringify({ commit, snapshot }) + '\n');
console.log(`Release: ${commit}; snapshot: ${snapshot}`);

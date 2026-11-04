import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const snapshot = createHash('sha256').update(await readFile('app/static-fpl-data.json')).digest('hex');
await writeFile('out/release.json', JSON.stringify({ commit, snapshot }) + '\n');
console.log(`Release: ${commit}; snapshot: ${snapshot}`);

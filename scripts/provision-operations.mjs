import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { passwordHash } from '../cloudflare/fpl-proxy/src/operations.ts';

// Run once on the owner's machine. Nothing in .private is committed or bundled.
const directory = resolve('.private');
await mkdir(directory, { recursive: true });
const path = resolve(directory, 'operations-secrets.json');
let config;
try { config = JSON.parse(await readFile(path, 'utf8')); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  const password = randomBytes(24).toString('base64url');
  config = { password, SESSION_SECRET: randomBytes(32).toString('base64url'), OPS_PROXY_SECRET: randomBytes(32).toString('base64url'), ADMIN_PASSWORD_HASH: await passwordHash(password, randomBytes(16).toString('hex')) };
  await writeFile(path, JSON.stringify(config), { mode: 0o600, flag: 'wx' });
}
await writeFile(resolve(directory, 'admin-access.txt'), `企鹅杯后台\n地址：https://penguin-fantasy.pages.dev/admin/\n管理员密码：${config.password}\n\n请保存在你自己的密码管理器中，不要发给玩家。\n玩家口令在后台逐人生成。\n`, { mode: 0o600 });
async function command(args, input) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [resolve('node_modules/wrangler/bin/wrangler.js'), ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdin.end(input);
    child.on('error', () => reject(new Error('Unable to start Wrangler')));
    child.on('close', code => code === 0 ? resolvePromise() : reject(new Error(`Wrangler secret provisioning failed (${code}); credentials retained locally`)));
  });
}
await command(['secret', 'bulk', '--config', 'cloudflare/fpl-proxy/wrangler.jsonc'], JSON.stringify({ SESSION_SECRET: config.SESSION_SECRET, OPS_PROXY_SECRET: config.OPS_PROXY_SECRET, ADMIN_PASSWORD_HASH: config.ADMIN_PASSWORD_HASH }));
console.log('Worker secrets configured.');
await command(['pages', 'secret', 'put', 'OPS_PROXY_SECRET', '--project-name', 'penguin-fantasy'], config.OPS_PROXY_SECRET + '\n');
console.log('Pages proxy secret configured. Administrator access saved in .private/admin-access.txt.');

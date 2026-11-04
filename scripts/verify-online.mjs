import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// Read-only checks. Keep API access behind the shared Pages proxy.
const expectedCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const expectedSnapshot = createHash('sha256').update(await readFile('app/static-fpl-data.json')).digest('hex');
const sites = ['https://levine-lai.github.io/penguin-fantasy/', 'https://penguin-fantasy.pages.dev/'];
async function read(url, json = false) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return json ? response.json() : response.text();
}
for (const site of sites) {
  const version = await read(`${site}release.json?v=${expectedCommit}`, true);
  if (version.commit !== expectedCommit || version.snapshot !== expectedSnapshot) throw new Error(`${site}: 部署版本或快照与本地提交不同`);
  const home = await read(site);
  if (!home.includes('PENGUIN CUP')) throw new Error(`${site}: 首页内容不匹配`);
  const rules = await read(`${site}rules/`);
  if (!rules.includes('冰渊')) throw new Error(`${site}: 规则页内容不匹配`);
  const assets = [...new Set([...home.matchAll(/(?:src|href)="([^" ]+\.(?:js|css))"/g)].map(match => new URL(match[1], site).href))];
  if (!assets.length) throw new Error(`${site}: 未找到前端资源`);
  const contents = await Promise.all(assets.map(asset => read(asset)));
  if (!contents.some(text => text.includes('penguin-fantasy.pages.dev'))) throw new Error(`${site}: 缺少公共代理地址`);
  console.log(`通过：首页、规则页、${assets.length} 个资源、公共代理 ${site}`);
}
const api = 'https://penguin-fantasy.pages.dev/api';
await read(`${api}/health`, true);
const status = await read(`${api}/status`, true);
const league = await read(`${api}/league`, true);
if (!league.ready || !league.teams?.length) throw new Error('当前名单尚未就绪');
const history = await read(`${api}/history`, true);
const gw = Math.max(...history.snapshots.map(snapshot => snapshot.gw));
const round = await read(`${api}/gw/${gw}`, true);
if (!round.ready) throw new Error(`GW${gw} 数据尚未就绪`);
console.log(`通过：health、status、league、history、GW${gw}；当前 ${league.teams.length} 人；状态字段 ${Object.keys(status).join(', ')}`);

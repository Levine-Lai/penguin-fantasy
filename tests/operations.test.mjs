import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { handleOperations, signSession, readSession, submitDuel, settleDuels, passwordHash, beijingDay } from '../cloudflare/fpl-proxy/src/operations.ts';

const schema = await readFile(new URL('../cloudflare/fpl-proxy/migrations/0001_operations.sql', import.meta.url), 'utf8');
const origin = 'https://penguin-fantasy.pages.dev';
function database() {
  const sqlite = new DatabaseSync(':memory:'); sqlite.exec(schema);
  const wrap = (query, values = []) => ({
    bind(...args) { return wrap(query, args); },
    async first() { return sqlite.prepare(query).get(...values) ?? null; },
    async all() { return { results: sqlite.prepare(query).all(...values) }; },
    async run() { return { meta: sqlite.prepare(query).run(...values) }; },
  });
  return { sqlite, prepare: query => wrap(query), async batch(statements) {
    sqlite.exec('BEGIN');
    try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } };
}
async function setup() {
  const db = database();
  const members = Array.from({ length: 12 }, (_, index) => ({ entryId: index + 1, teamName: `Player ${index + 1}` }));
  const cache = new Map([
    ['league:roster', members],
    ['fpl:bootstrap', { value: { events: [{ id: 9, deadline_time: new Date(Date.now() + 86400000).toISOString() }] } }],
  ]);
  const env = { OPS_DB: db, SESSION_SECRET: 'session-test-secret', OPS_PROXY_SECRET: 'proxy-secret', ADMIN_PASSWORD_HASH: await passwordHash('correct-password', 'test-salt'), FPL_CACHE: { async get(key) { return cache.get(key) ?? null; } } };
  const admin = await signSession(env.SESSION_SECRET, { role: 'admin', exp: Date.now() + 100000 });
  const request = async (path, method = 'GET', input, options = {}) => handleOperations(new Request(origin + '/api' + path, {
    method, headers: { origin, 'x-penguin-proxy-key': env.OPS_PROXY_SECRET, 'x-penguin-client-ip': '127.0.0.1',
      ...(input !== undefined ? { 'content-type': 'application/json' } : {}), ...options },
    ...(input !== undefined ? { body: JSON.stringify(input) } : {}),
  }), env);
  const adminHeaders = { cookie: `__Host-penguin_admin=${admin}` };
  return { db, env, cache, request, adminHeaders };
}

test('signed sessions reject tampering, wrong secrets and expiry', async () => {
  const token = await signSession('secret', { role: 'admin', exp: 1000 });
  assert.equal((await readSession('secret', token, 500)).role, 'admin');
  assert.equal(await readSession('wrong', token, 500), null);
  assert.equal(await readSession('secret', token + 'x', 500), null);
  assert.equal(await readSession('secret', token, 1000), null);
});

test('administrator endpoints reject anonymous users, wrong origins and wrong passwords', async () => {
  const { request } = await setup();
  assert.equal((await request('/admin/overview')).status, 401);
  assert.equal((await request('/admin/announcements', 'POST', { title: 'x', body: 'y', day: beijingDay() })).status, 401);
  assert.equal((await request('/admin/login', 'POST', { password: 'wrong' })).status, 401);
  assert.equal((await request('/admin/login', 'POST', { password: 'correct-password' }, { origin: 'https://evil.example' })).status, 403);
  const login = await request('/admin/login', 'POST', { password: 'correct-password' });
  assert.equal(login.status, 200);
  assert.match(login.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Strict/);
  assert.equal(login.headers.get('cache-control'), 'no-store');
});

test('one atomic insert limits each GW to five groups and excludes duplicate participants', async () => {
  const db = database();
  const submitted = await Promise.all(Array.from({ length: 6 }, (_, index) => submitDuel(db, 9, index * 2 + 1, index * 2 + 2)));
  assert.equal(submitted.filter(Boolean).length, 5);
  assert.equal(await submitDuel(db, 9, 1, 12), false);
  assert.equal(await submitDuel(db, 9, 12, 12), false);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM duels').first()).count, 5);
});

test('five season challenges are enforced while draws and deleted challenges refund a right', async () => {
  const db = database();
  for (let gw = 9; gw <= 13; gw++) assert.equal(await submitDuel(db, gw, 1, 2), true);
  assert.equal(await submitDuel(db, 14, 1, 3), false);
  await db.prepare("UPDATE duels SET settled_at='done',challenger_score=5,target_score=5 WHERE gw=9").run();
  assert.equal(await submitDuel(db, 14, 1, 3), true);
  assert.equal(await submitDuel(db, 15, 1, 4), false);
  await db.prepare("UPDATE duels SET deleted_at='removed' WHERE gw=10").run();
  assert.equal(await submitDuel(db, 15, 1, 4), true);
});

test('deleted duels free capacity, disappear publicly, and retain an audit trail', async () => {
  const { db, request, adminHeaders } = await setup();
  for (let i = 0; i < 5; i++) assert.equal(await submitDuel(db, 9, i * 2 + 1, i * 2 + 2), true);
  const row = await db.prepare('SELECT id FROM duels LIMIT 1').first();
  assert.equal((await request(`/admin/duels/${row.id}`, 'DELETE', { reason: '取消误提交' })).status, 401);
  assert.equal((await request(`/admin/duels/${row.id}`, 'DELETE', { reason: '取消误提交' }, adminHeaders)).status, 200);
  assert.equal(await submitDuel(db, 9, 11, 12), true);
  assert.equal((await db.prepare('SELECT deleted_at FROM duels WHERE id=?').bind(row.id).first()).deleted_at !== null, true);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action='remove_duels'").first()).count, 1);
});

test('announcements use Beijing dates and are removed immediately from the public feed', async () => {
  const { request, adminHeaders } = await setup();
  assert.equal(beijingDay(Date.parse('2026-10-18T16:00:00Z')), '2026-10-19');
  const created = await request('/admin/announcements', 'POST', { title: '<script>text only</script>', body: '今日通知', day: beijingDay() }, adminHeaders);
  const { id } = await created.json();
  assert.equal(created.status, 201);
  let feed = await (await request('/community')).json();
  assert.equal(feed.announcements.length, 1);
  assert.equal(feed.announcements[0].body, '今日通知');
  await request(`/admin/announcements/${id}`, 'DELETE', { reason: '测试结束' }, adminHeaders);
  feed = await (await request('/community')).json();
  assert.equal(feed.announcements.length, 0);
});

test('visits are idempotent, filter unknown IDs and keep private activity behind admin auth', async () => {
  const { db, request, adminHeaders } = await setup();
  const visit = { id: crypto.randomUUID(), visitorId: crypto.randomUUID(), sessionId: crypto.randomUUID(), kind: 'pageview', path: '/', entryId: 99999 };
  assert.equal((await request('/visits', 'POST', visit)).status, 200);
  await request('/visits', 'POST', visit);
  const rows = await db.prepare('SELECT * FROM visits').all();
  assert.equal(rows.results.length, 1);
  assert.equal(rows.results[0].entry_id, null);
  const overview = await (await request('/admin/overview', 'GET', undefined, adminHeaders)).json();
  assert.equal(overview.stats.views, 1);
  assert.equal(overview.stats.visitors, 1);
  assert.equal((await request('/admin/overview')).status, 401);
});

test('FPL ID login needs no code, keeps registration private and locks at DDL', async () => {
  const { request, adminHeaders, cache } = await setup();
  assert.equal((await request('/player/session', 'POST', { entryId: 9999 })).status, 403);
  assert.equal((await request('/duels', 'POST', { targetId: 2, gw: 9 })).status, 401);
  const login = await (await request('/player/session', 'POST', { entryId: 1 })).json();
  const playerHeaders = { authorization: `Bearer ${login.token}` };
  await request('/admin/arena', 'POST', { gw: 9, open: true }, adminHeaders);
  assert.equal((await request('/duels', 'POST', { targetId: 2, gw: 9 }, playerHeaders)).status, 201);
  const mine = await (await request('/duels/mine', 'GET', undefined, playerHeaders)).json();
  assert.equal(mine.submitted, true);
  assert.equal('duels' in mine, false);
  assert.equal(mine.remaining, 4);
  assert.equal((await (await request('/community')).json()).duels.length, 0);
  assert.equal('count' in (await (await request('/community')).json()).arena, false);
  assert.equal((await request('/duels', 'POST', { targetId: 3, gw: 9 }, playerHeaders)).status, 409);
  const overview = await (await request('/admin/overview', 'GET', undefined, adminHeaders)).json();
  const first = overview.duels[0];
  assert.equal((await request(`/duels/${first.id}`, 'DELETE', {}, playerHeaders)).status, 405);
  assert.equal((await request('/duels', 'PUT', { targetId: 3, gw: 9 }, playerHeaders)).status, 405);
  assert.equal((await request(`/admin/duels/${first.id}`, 'DELETE', { reason: '允许重新选择' }, adminHeaders)).status, 200);
  assert.equal((await (await request('/duels/mine', 'GET', undefined, playerHeaders)).json()).submitted, false);
  assert.equal((await request('/duels', 'POST', { targetId: 3, gw: 9 }, playerHeaders)).status, 201);
  cache.set('fpl:bootstrap', { value: { events: [{ id: 9, deadline_time: new Date(Date.now() - 10000).toISOString() }] } });
  assert.equal((await request('/duels', 'POST', { targetId: 3, gw: 9 }, playerHeaders)).status, 409);
  assert.equal((await (await request('/community')).json()).duels.length, 1);
  cache.set('league:roster', [{ entryId: 2, teamName: 'Player 2' }]);
  assert.equal((await request('/duels/mine', 'GET', undefined, playerHeaders)).status, 403);
});

test('settlement waits for final snapshots, is idempotent, and deletion reverses derived results', async () => {
  const { db, env, cache, request, adminHeaders } = await setup();
  await submitDuel(db, 9, 1, 2);
  const snapshot = { gw: 9, finished: false, teams: [{ entryId: 1, captainPoints: 10 }, { entryId: 2, captainPoints: 8 }] };
  cache.set('snapshot:gw:9', snapshot);
  await settleDuels(env);
  assert.equal((await db.prepare('SELECT * FROM duels').first()).settled_at, null);
  snapshot.finished = true;
  await settleDuels(env); await settleDuels(env);
  const duel = await db.prepare('SELECT * FROM duels').first();
  assert.equal(duel.challenger_delta, 1); assert.equal(duel.target_delta, -1);
  assert.equal((await (await request('/community')).json()).results.length, 1);
  await request(`/admin/duels/${duel.id}`, 'DELETE', { reason: '管理员取消' }, adminHeaders);
  assert.equal((await (await request('/community')).json()).results.length, 0);
});

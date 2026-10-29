import { arenaWindow, selectRound, selectDueRounds } from '../cloudflare/fpl-proxy/src/duel-rules.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { database } from './helpers/operations-db.mjs';
import { commitRound, publicationRevision, publishedHistory, publishedRound, PublicationConflict } from '../cloudflare/fpl-proxy/src/publication.ts';
import { handleOperations, signSession, readSession, submitDuel, settleDuels, passwordHash, beijingDay } from '../cloudflare/fpl-proxy/src/operations.ts';
import worker, { publishDailySnapshot, captureDueCaptainPicks } from '../cloudflare/fpl-proxy/src/index.ts';

const origin = 'https://penguin-fantasy.pages.dev';
async function setup() {
  const db = database();
  const members = Array.from({ length: 12 }, (_, index) => ({ entryId: index + 1, teamName: `Player ${index + 1}` }));
  const cache = new Map([
    ['league:roster', members],
    ['fpl:bootstrap', { value: { events: [{ id: 9, deadline_time: new Date(Date.now() + 6 * 3600000).toISOString() }] } }],
  ]);
  for (const gw of [9, 10]) cache.set(`picks:gw:${gw}`, { checkedEntryIds: members.map(m => m.entryId), picksByEntry: Object.fromEntries(members.map(m => [m.entryId, { captainId: m.entryId + 100 }])) });
  const env = { OPS_DB: db, LEAGUE_ID: '511690', SESSION_SECRET: 'session-test-secret', OPS_PROXY_SECRET: 'proxy-secret', ADMIN_PASSWORD_HASH: await passwordHash('correct-password', 'test-salt'), FPL_CACHE: { async get(key) { return cache.get(key) ?? null; }, async put(key, value) { cache.set(key, JSON.parse(value)); } } };
  const admin = await signSession(env.SESSION_SECRET, { role: 'admin', exp: Date.now() + 100000 });
  const request = async (path, method = 'GET', input, options = {}) => handleOperations(new Request(origin + '/api' + path, {
    method, headers: { origin, 'x-penguin-proxy-key': env.OPS_PROXY_SECRET, 'x-penguin-client-ip': '127.0.0.1',
      ...(input !== undefined ? { 'content-type': 'application/json' } : {}), ...options },
    ...(input !== undefined ? { body: JSON.stringify(input) } : {}),
  }), env);
  const adminHeaders = { cookie: `__Host-penguin_admin=${admin}` };
  return { db, env, cache, request, adminHeaders };
}

test('admin duel pagination exposes history beyond 300 rows and keeps the round count independent of pages', async () => {
  const { db, request, adminHeaders } = await setup();
  const ids = [];
  for (let index = 0; index < 302; index++) {
    const id = crypto.randomUUID(); ids.push(id);
    await db.prepare('INSERT INTO duels(id,gw,challenger_id,target_id,created_at) VALUES (?,?,?,?,?)')
      .bind(id, 9, 1, 2, '2026-10-01T00:00:00Z').run();
  }
  const seen = [];
  for (let page = 0; page < 7; page++) {
    const data = await (await request(`/admin/overview?duelPage=${page}`, 'GET', undefined, adminHeaders)).json();
    assert.deepEqual(data.duelPagination, { page, pageSize: 50, total: 302 });
    assert.equal(data.arena.count, 302);
    seen.push(...data.duels.map(row => row.id));
  }
  assert.equal(new Set(seen).size, 302);
  assert.deepEqual(seen, ids.toReversed());
  assert.equal((await request(`/admin/duels/${ids[0]}`, 'DELETE', { reason: 'old row remains manageable' }, adminHeaders)).status, 200);
  const active = await (await request('/admin/overview?duelPage=999', 'GET', undefined, adminHeaders)).json();
  assert.deepEqual(active.duelPagination, { page: 6, pageSize: 50, total: 301 });
  assert.equal(active.arena.count, 301); assert.equal(active.duels.length, 1);
  const removed = await (await request('/admin/overview?duelPage=6&includeRemoved=true', 'GET', undefined, adminHeaders)).json();
  assert.equal(removed.duelPagination.total, 302); assert.equal(removed.arena.count, 301);
  assert.ok(removed.duels.some(row => row.id === ids[0] && row.deleted_at));
  const fractional = await (await request('/admin/overview?page=0.5&duelPage=0.5', 'GET', undefined, adminHeaders)).json();
  assert.equal(fractional.page, 0); assert.equal(fractional.duelPagination.page, 0);
});

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

test('atomic registrations allow more than five groups and exclude duplicate participants', async () => {
  const db = database();
  const submitted = await Promise.all(Array.from({ length: 6 }, (_, index) => submitDuel(db, 9, index * 2 + 1, index * 2 + 2)));
  assert.equal(submitted.filter(Boolean).length, 6);
  assert.equal(await submitDuel(db, 9, 1, 12), false);
  assert.equal(await submitDuel(db, 9, 12, 12), false);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM duels').first()).count, 6);
});

test('five season challenges count draws while deleted challenges refund a right', async () => {
  const db = database();
  for (let gw = 9; gw <= 13; gw++) assert.equal(await submitDuel(db, gw, 1, 2), true);
  assert.equal(await submitDuel(db, 14, 1, 3), false);
  await db.prepare("UPDATE duels SET settled_at='done',challenger_score=5,target_score=5 WHERE gw=9").run();
  assert.equal(await submitDuel(db, 14, 1, 3), false);
  await db.prepare("UPDATE duels SET deleted_at='removed' WHERE gw=10").run();
  assert.equal(await submitDuel(db, 14, 1, 3), true);
  assert.equal(await submitDuel(db, 15, 1, 4), false);
  await db.prepare("UPDATE duels SET deleted_at='removed' WHERE gw=11").run();
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

test('only explicit valid player logins are recorded; pageviews, logout and restored sessions are ignored', async () => {
  const { db, request, adminHeaders } = await setup();
  const visit = { id: crypto.randomUUID(), visitorId: crypto.randomUUID(), sessionId: crypto.randomUUID(), kind: 'pageview', path: '/', entryId: 99999 };
  assert.equal((await request('/visits', 'POST', visit)).status, 200);
  await request('/visits', 'POST', visit);
  assert.equal((await db.prepare('SELECT * FROM visits').all()).results.length, 0);
  assert.equal((await db.prepare('SELECT * FROM player_logins').all()).results.length, 0);
  const login = { id: crypto.randomUUID(), kind: 'identify', entryId: 1 };
  assert.equal((await request('/visits', 'POST', login)).status, 200);
  await request('/visits', 'POST', login);
  await request('/visits', 'POST', { ...login, id: crypto.randomUUID(), entryId: null });
  await request('/player/session', 'POST', { entryId: 1 });
  await request('/player/session', 'POST', { entryId: 1 });
  assert.equal((await db.prepare('SELECT * FROM player_logins').all()).results.length, 1);
  const overview = await (await request('/admin/overview', 'GET', undefined, adminHeaders)).json();
  assert.equal('stats' in overview, false);
  assert.equal('total' in overview, false);
  assert.equal(overview.players.length, 1);
  assert.equal(overview.activity.length, 1);
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
  assert.deepEqual(mine.challenge, { targetId: 2, targetName: 'Player 2' });
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
  assert.equal((await (await request('/community')).json()).duels.length, 0);
  cache.set('league:roster', [{ entryId: 2, teamName: 'Player 2' }]);
  assert.equal((await request('/duels/mine', 'GET', undefined, playerHeaders)).status, 403);
});

test('private status reveals only the signed-in player outgoing challenge and clears deleted submissions', async () => {
  const { request, db } = await setup();
  await submitDuel(db, 9, 1, 2);
  await submitDuel(db, 9, 3, 4);
  const getMine = async entryId => {
    const { token } = await (await request('/player/session', 'POST', { entryId })).json();
    return (await request('/duels/mine', 'GET', undefined, { authorization: `Bearer ${token}` })).json();
  };
  assert.deepEqual((await getMine(1)).challenge, { targetId: 2, targetName: 'Player 2' });
  assert.equal((await getMine(2)).challenge, null);
  assert.equal((await getMine(5)).challenge, null);
  assert.equal((await (await request('/community')).json()).duels.length, 0);
  assert.equal((await request('/duels/mine')).status, 401);
  await db.prepare("UPDATE duels SET deleted_at='removed' WHERE challenger_id=1").run();
  const removed = await getMine(1);
  assert.equal(removed.submitted, false);
  assert.equal(removed.challenge, null);
});

test('atomic rejection returns participation or season-limit reasons without a round capacity limit', async () => {
  const { request, db, adminHeaders } = await setup();
  await request('/admin/arena', 'POST', { gw: 9, open: true }, adminHeaders);
  const reject = async (entryId, targetId, message) => {
    const { token } = await (await request('/player/session', 'POST', { entryId })).json();
    const response = await request('/duels', 'POST', { gw: 9, targetId }, { authorization: `Bearer ${token}` });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, message);
  };
  await submitDuel(db, 9, 1, 2);
  await reject(1, 3, '你本轮已提交挑战，不可重复报名');
  await reject(2, 3, '你已在本轮对阵中，不能再次发起挑战');
  await reject(3, 1, '该玩家已在本轮对阵中，请选择其他挑战对象');
  for (let gw = 10; gw <= 14; gw++) await submitDuel(db, gw, 11, 12);
  await reject(11, 12, '你的五次主动挑战权已用完');
  for (let entry = 3; entry <= 9; entry += 2) await submitDuel(db, 9, entry, entry + 1);
  const { token } = await (await request('/player/session', 'POST', { entryId: 12 })).json();
  assert.equal((await request('/duels', 'POST', { gw: 9, targetId: 11 }, { authorization: `Bearer ${token}` })).status, 201);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM duels WHERE gw=9').first()).count, 6);
});

test('settlement waits for final snapshots, is idempotent, and deletion reverses derived results', async () => {
  const { db, env, cache, request, adminHeaders } = await setup();
  cache.get('fpl:bootstrap').value.events[0].deadline_time = new Date(Date.now() - 10000).toISOString();
  await submitDuel(db, 9, 1, 2);
  const snapshot = { gw: 9, finished: false, officialFinalized: true, teams: [{ entryId: 1, captainPoints: 10 }, { entryId: 2, captainPoints: 8 }] };
  cache.set('snapshot:gw:9', snapshot);
  await settleDuels(env);
  assert.equal((await db.prepare('SELECT * FROM duels').first()).settled_at, null);
  snapshot.finished = true;
  await settleDuels(env); await settleDuels(env);
  snapshot.duelResults = await settleDuels(env);
  cache.set('snapshot:history', [snapshot]);
  const duel = await db.prepare('SELECT * FROM duels').first();
  assert.equal(duel.challenger_delta, 1); assert.equal(duel.target_delta, -1);
  assert.equal((await (await request('/community')).json()).results.length, 1);
  await request(`/admin/duels/${duel.id}`, 'DELETE', { reason: '管理员取消' }, adminHeaders);
  assert.equal((await (await request('/community')).json()).results.length, 0);
});

test('score corrections replace deltas without refunding equal-score duels and are audited only once', async () => {
  const { db, env, cache, request, adminHeaders } = await setup();
  cache.get('fpl:bootstrap').value.events[0].deadline_time = new Date(Date.now() - 10000).toISOString();
  await submitDuel(db, 9, 1, 2);
  const snapshot = { gw: 9, finished: true, officialFinalized: true, teams: [{ entryId: 1, captainPoints: 10 }, { entryId: 2, captainPoints: 8 }] };
  cache.set('snapshot:gw:9', snapshot);
  await settleDuels(env, snapshot);
  snapshot.teams[0].captainPoints = 7;
  await settleDuels(env, snapshot); await settleDuels(env, snapshot);
  let row = await db.prepare('SELECT * FROM duels').first();
  assert.equal(row.challenger_score, 7); assert.equal(row.challenger_delta, -1); assert.equal(row.target_delta, 1);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action='correct_duel'").first()).count, 1);
  snapshot.teams[0].captainPoints = 8;
  await settleDuels(env, snapshot);
  snapshot.duelResults = await settleDuels(env, snapshot);
  cache.set('snapshot:history', [snapshot]);
  const { token } = await (await request('/player/session', 'POST', { entryId: 1 })).json();
  assert.equal((await (await request('/duels/mine', 'GET', undefined, { authorization: `Bearer ${token}` })).json()).remaining, 4);
  const feed = await (await request('/community')).json();
  assert.equal(feed.results[0].challenger_delta, 0);
  assert.equal(feed.results[0].target_delta, 0);
  row = await db.prepare('SELECT * FROM duels').first();
  await request(`/admin/duels/${row.id}`, 'DELETE', { reason: 'removed' }, adminHeaders);
  snapshot.teams[0].captainPoints = 20;
  await settleDuels(env, snapshot);
  assert.equal((await (await request('/community')).json()).results.length, 0);
  assert.equal((await db.prepare('SELECT * FROM duels').first()).challenger_score, 8);
});

test('atomic insert rechecks both ends of the twelve-hour window', async () => {
  for (const boundary of ['deadline', 'opening']) {
    const { db, env, request, cache } = await setup();
    const { token } = await (await request('/player/session', 'POST', { entryId: 1 })).json();
    const realNow = Date.now;
    let clock = realNow();
    const ddl = clock + 10000;
    cache.set('fpl:bootstrap', { value: { events: [{ id: 9, deadline_time: new Date(ddl).toISOString() }] } });
    db.sqlite.function('julianday', { varargs: true }, (...args) => {
      const value = args[0] === 'now' ? clock : Date.parse(args[0]);
      return (value - (args[1] === '-12 hours' ? 12 * 3600000 : 0)) / 86400000 + 2440587.5;
    });
    const prepare = db.prepare;
    db.prepare = sql => {
      const wrap = statement => ({
        bind(...args) { return wrap(statement.bind(...args)); },
        first: () => statement.first(), all: () => statement.all(),
        async run() {
          if (sql.startsWith('INSERT INTO duels(')) clock = boundary === 'deadline' ? ddl : ddl - 12 * 3600000 - 1;
          return statement.run();
        },
      });
      return wrap(prepare(sql));
    };
    Date.now = () => clock;
    try {
      const result = await handleOperations(new Request(origin + '/api/duels', { method: 'POST', headers: { origin, 'x-penguin-proxy-key': env.OPS_PROXY_SECRET, 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ gw: 9, targetId: 2 }) }), env);
      assert.equal(result.status, 409);
      assert.equal((await prepare('SELECT COUNT(*) AS count FROM duels').first()).count, 0);
    } finally { Date.now = realNow; }
  }
});

async function publicationScenario({ finalized = true, failHistory = false, matchesFinished = true } = {}) {
  const state = await setup();
  const { cache, db } = state;
  const members = cache.get('league:roster');
  const bootstrap = { events: [9, 10].map(id => ({ id, name: `GW${id}`, deadline_time: new Date(Date.now() - (11 - id) * 7 * 86400000).toISOString(), finished: true, data_checked: id === 10 ? finalized : true })), elements: [{ id: 101, web_name: 'A', team: 1 }, { id: 102, web_name: 'B', team: 2 }] };
  cache.set('fpl:bootstrap', { value: structuredClone(bootstrap), cachedAt: new Date().toISOString() });
  cache.get('fpl:bootstrap').value.events[1].data_checked = false; // A fresh check must override stale confirmation flags.
  cache.set('league:roster:cached', { value: members, cachedAt: new Date().toISOString() });
  cache.set('snapshot:history', [{ gw: 8, teams: members.map(m => ({ ...m, captainPoints: 10, captainPickRate: 50 })) }]);
  cache.set('snapshot:gw:9', { gw: 9, finished: true, officialFinalized: true, captainResolutionVersion: 2, teams: members.map(m => ({ ...m, captainPoints: 1 })) });
  for (const gw of [9, 10]) {
    cache.set(`picks:gw:${gw}`, { gw, checkedEntryIds: members.map(m => m.entryId), picksByEntry: Object.fromEntries(members.map(m => [m.entryId, { captainId: m.entryId % 2 ? 101 : 102, viceCaptainId: 102, multiplier: 2 }])), completedAt: new Date().toISOString() });
    await submitDuel(db, gw, 1, 2);
  }
  await db.prepare("UPDATE settings SET value=? WHERE key='arena'").bind(JSON.stringify({ gw: 10, open: false })).run();
  const original = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/bootstrap-static/')) return Response.json(bootstrap);
    if (failHistory && url.pathname.includes('/event/9/live/')) return new Response('historical outage', { status: 503 });
    if (url.pathname.endsWith('/live/')) return Response.json({ elements: [{ id: 101, stats: { total_points: 10, minutes: 90 } }, { id: 102, stats: { total_points: 8, minutes: 90 } }] });
    if (url.pathname.endsWith('/fixtures/')) return Response.json([{ team_h: 1, team_a: 2, started: true, finished: matchesFinished, finished_provisional: matchesFinished }]);
    throw new Error(`Unexpected request ${url.pathname}`);
  };
  return { ...state, restore: () => { globalThis.fetch = original; } };
}

test('historical score failure does not block an officially finalized current-round publication', async () => {
  const { db, env, cache, request, restore } = await publicationScenario({ failHistory: true });
  try {
    const jobs = [];
    await worker.scheduled({ cron: '30 23 * * *', scheduledTime: Date.now() }, env, { waitUntil: job => jobs.push(job) });
    await Promise.all(jobs);
    const current = (await publishedHistory(env)).find(s => s.gw === 10);
    assert.equal(current.officialFinalized, true);
    assert.equal(current.teams[0].captainPoints, 10);
    assert.equal(current.duelResults[0].challenger_score, 10);
    assert.equal(current.duelResults[0].challenger_delta, 1);
    assert.ok((await db.prepare('SELECT * FROM duels WHERE gw=10').first()).settled_at);
    const feed = await (await request('/community')).json();
    assert.equal(feed.duels[0].challenger_score, 10);
    assert.ok(feed.duels[0].settled_at);
    assert.equal(cache.get('sync:status').gw, 10);
  } finally { restore(); }
});

test('unfinished matches remain pending at the daily publication', async () => {
  const { db, env, request, restore } = await publicationScenario({ finalized: false, matchesFinished: false });
  try {
    await publishDailySnapshot(env);
    const current = (await publishedHistory(env)).find(s => s.gw === 10);
    assert.equal(current.finished, false); assert.equal(current.officialFinalized, false);
    assert.deepEqual(current.duelResults, []);
    assert.equal((await db.prepare('SELECT * FROM duels WHERE gw=10').first()).settled_at, null);
    const feed = await (await request('/community')).json();
    assert.equal(feed.duels[0].settled_at, null); assert.equal(feed.duels[0].challenger_score, null);
  } finally { restore(); }
});

test('the first daily update after the last match settles without waiting for data_checked', async () => {
  const { env, db, restore } = await publicationScenario({ finalized: false });
  try {
    const jobs = [];
    await worker.scheduled({ cron: '*/5 * * * *', scheduledTime: Date.now() }, env, { waitUntil: job => jobs.push(job) });
    await Promise.all(jobs);
    assert.equal((await db.prepare('SELECT * FROM duels WHERE gw=9').first()).settled_at, null);
    await publishDailySnapshot(env);
    const snapshot = await publishedRound(env, 10);
    assert.equal(snapshot.officialFinalized, false); assert.equal(snapshot.finished, true);
    assert.ok(snapshot.duelResults[0].settled_at);
  } finally { restore(); }
});

test('a new round waiting for picks never blocks the previous round daily settlement or changes the status GW', async () => {
  const { env, db, cache, restore } = await publicationScenario();
  cache.set('picks:gw:10', {gw:10,checkedEntryIds:[],picksByEntry:{}});
  try {
    await publishDailySnapshot(env);
    assert.ok((await db.prepare('SELECT * FROM duels WHERE gw=9').first()).settled_at);
    assert.equal(await publishedRound(env, 10), null);
    assert.equal(cache.get('sync:status').gw, 10);
    assert.equal(cache.get('sync:status').state, 'waiting_for_picks');
  } finally { restore(); }
});

test('a one-life double loss settles, eliminates, cancels future registrations, and rejects both sides of a challenge', async () => {
  const { env, db, cache, request } = await setup();
  cache.get('fpl:bootstrap').value.events[0].deadline_time = new Date(Date.now()-10000).toISOString();
  await submitDuel(db, 9, 1, 2); await submitDuel(db, 10, 3, 1);
  const snapshot = {gw:9,finished:true,officialFinalized:false,teams:[{entryId:1,captainPoints:2},{entryId:2,captainPoints:8},{entryId:3,captainPoints:8}]};
  await commitRound(env,snapshot,0);
  const lost = await db.prepare('SELECT * FROM duels WHERE gw=9').first();
  assert.ok(lost.settled_at); assert.equal(lost.challenger_delta,-1);
  const future = await db.prepare('SELECT * FROM duels WHERE gw=10').first();
  assert.ok(future.deleted_at); assert.match(future.delete_reason,/淘汰/);
  cache.set('fpl:bootstrap',{value:{events:[{id:9,deadline_time:new Date(Date.now()-10000).toISOString()},{id:10,deadline_time:new Date(Date.now()+6*3600000).toISOString()}]}});
  const tokenFor = async id => (await (await request('/player/session','POST',{entryId:id})).json()).token;
  const deadToken = await tokenFor(1), aliveToken = await tokenFor(3);
  const mine = await (await request('/duels/mine','GET',undefined,{authorization:`Bearer ${deadToken}`})).json();
  assert.equal(mine.hp,0); assert.equal(mine.eliminated,true);
  const fromDead = await request('/duels','POST',{gw:10,targetId:3},{authorization:`Bearer ${deadToken}`});
  assert.equal(fromDead.status,409); assert.match((await fromDead.json()).error,/淘汰/);
  const toDead = await request('/duels','POST',{gw:10,targetId:1},{authorization:`Bearer ${aliveToken}`});
  assert.equal(toDead.status,409); assert.match((await toDead.json()).error,/淘汰/);
  assert.equal((await request('/duels','POST',{gw:10,targetId:4},{authorization:`Bearer ${aliveToken}`})).status,201);
});

test('the atomic signup rejects a health revision that changes between qualification and the insert', async () => {
  const {db,request} = await setup();
  const {token} = await (await request('/player/session','POST',{entryId:1})).json();
  const prepare = db.prepare;
  db.prepare = sql => {
    const wrap = stmt => ({bind(...args){return wrap(stmt.bind(...args));},first:()=>stmt.first(),all:()=>stmt.all(),async run(){
      if(sql.startsWith('INSERT INTO duels(')) await prepare('INSERT INTO published_rounds(gw,revision,snapshot,published_at) VALUES (9,1,?,?)').bind(JSON.stringify({gw:9,teams:[]}),new Date().toISOString()).run();
      return stmt.run();
    }});return wrap(prepare(sql));
  };
  const response = await request('/duels','POST',{gw:9,targetId:2},{authorization:`Bearer ${token}`});
  assert.equal(response.status,409); assert.equal((await prepare('SELECT COUNT(*) AS count FROM duels').first()).count,0);
});

test('failed canonical publication rolls back settlement and corrections without changing reserved rights', async () => {
  const { db, env, request, restore } = await publicationScenario();
  try {
    const { token } = await (await request('/player/session', 'POST', { entryId: 1 })).json();
    const mine = async () => (await request('/duels/mine', 'GET', undefined, { authorization: `Bearer ${token}` })).json();
    const before = await mine();
    const snapshot = { gw: 10, finished: true, officialFinalized: true, teams: [{ entryId: 1, captainPoints: 8 }, { entryId: 2, captainPoints: 8 }] };
    db.sqlite.exec("CREATE TRIGGER fail_publish BEFORE INSERT ON published_rounds BEGIN SELECT RAISE(ABORT,'publication interrupted'); END;");
    await assert.rejects(commitRound(env, snapshot, 0), /publication interrupted/);
    assert.equal((await db.prepare('SELECT * FROM duels WHERE gw=10').first()).settled_at, null);
    assert.equal((await mine()).remaining, before.remaining);
    assert.equal((await publishedHistory(env)).some(round => round.gw === 10), false);
    assert.deepEqual((await (await request('/community')).json()).results, []);
    db.sqlite.exec('DROP TRIGGER fail_publish');
    await commitRound(env, snapshot, 0);
    assert.equal((await mine()).remaining, before.remaining);
    assert.equal((await publishedRound(env, 10)).duelResults[0].challenger_delta, 0);
    db.sqlite.exec("CREATE TRIGGER fail_publish BEFORE INSERT ON published_rounds BEGIN SELECT RAISE(ABORT,'publication interrupted'); END;");
    await assert.rejects(commitRound(env, { ...snapshot, teams: [{ entryId: 1, captainPoints: 10 }, { entryId: 2, captainPoints: 8 }] }, 1), /publication interrupted/);
    assert.equal((await mine()).remaining, before.remaining);
    assert.equal((await db.prepare('SELECT * FROM duels WHERE gw=10').first()).challenger_score, 8);
    assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action='correct_duel'").first()).count, 0);
    assert.equal(await publicationRevision(env, 10), 1);
  } finally { restore(); }
});

test('a failed KV mirror leaves the canonical snapshot and matching public results available', async () => {
  const { env, request, restore } = await publicationScenario();
  const put = env.FPL_CACHE.put;
  env.FPL_CACHE.put = async (key, value) => {
    if (key.startsWith('snapshot:gw:')) throw new Error('mirror unavailable');
    return put(key, value);
  };
  try {
    await publishDailySnapshot(env);
    const current = await publishedRound(env, 10);
    assert.equal(current.teams[0].captainPoints, current.duelResults[0].challenger_score);
    assert.equal((await publishedHistory(env)).find(s => s.gw === 10).publicationRevision, 1);
    const feed = await (await request('/community')).json();
    assert.equal(feed.duels[0].challenger_score, current.teams[0].captainPoints);
    assert.ok(feed.duels[0].settled_at);
  } finally { restore(); }
});

test('concurrent different-round publications preserve both histories', async () => {
  const { db, env, cache } = await setup();
  cache.set('snapshot:history', [{ gw: 8, teams: [] }]);
  cache.set('fpl:bootstrap', { value: { events: [9, 10].map(id => ({ id, deadline_time: new Date(Date.now() - 10000).toISOString() })) } });
  for (const gw of [9, 10]) await submitDuel(db, gw, 1, 2);
  const snapshots = [9, 10].map(gw => ({ gw, finished: true, officialFinalized: true, teams: [{ entryId: 1, captainPoints: gw }, { entryId: 2, captainPoints: 8 }] }));
  await Promise.all(snapshots.map(s => commitRound(env, s, 0)));
  const history = await publishedHistory(env);
  assert.deepEqual(history.map(s => s.gw), [8, 9, 10]);
  for (const snapshot of history.slice(1)) assert.equal(snapshot.duelResults[0].challenger_score, snapshot.teams[0].captainPoints);
});

test('concurrent same-round publication rejects stale scores without refunding a challenge', async () => {
  const { db, env, cache } = await setup();
  cache.get('fpl:bootstrap').value.events[0].deadline_time = new Date(Date.now() - 10000).toISOString();
  await submitDuel(db, 9, 1, 2);
  const snapshot = { gw: 9, finished: true, officialFinalized: true, teams: [{ entryId: 1, captainPoints: 10 }, { entryId: 2, captainPoints: 8 }] };
  const draw = { ...snapshot, teams: [{ entryId: 1, captainPoints: 8 }, { entryId: 2, captainPoints: 8 }] };
  const attempts = await Promise.allSettled([commitRound(env, snapshot, 0), commitRound(env, draw, 0)]);
  assert.equal(attempts[0].status, 'fulfilled');
  assert.equal(attempts[1].status, 'rejected');
  assert.ok(attempts[1].reason instanceof PublicationConflict);
  const saved = await publishedRound(env, 9);
  assert.equal(saved.teams[0].captainPoints, saved.duelResults[0].challenger_score);
  assert.equal(saved.duelResults[0].challenger_score, 10);
  assert.equal((await db.prepare('SELECT * FROM duels').first()).challenger_score, 10);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action='correct_duel'").first()).count, 0);
  await commitRound(env, draw, 1);
  await assert.rejects(commitRound(env, snapshot, 1), PublicationConflict);
  assert.equal(await publicationRevision(env, 9), 2);
  assert.equal((await db.prepare('SELECT * FROM duels').first()).challenger_score, 8);
  assert.equal((await publishedRound(env, 9)).duelResults[0].challenger_score, 8);
  assert.equal(attempts[0].value.duelResults[0].challenger_score, 10);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action='correct_duel'").first()).count, 1);
});


test('automatic windows open exactly twelve hours before each second-stage DDL and roll rounds without admin writes', async () => {
  const { env, cache, request, adminHeaders } = await setup();
  const ddl9 = Date.parse('2026-10-31T11:00:00Z');
  const ddl10 = ddl9 + 7 * 86400000;
  cache.set('fpl:bootstrap', { value: { events: [{ id: 8, deadline_time: new Date(ddl9 - 7 * 86400000).toISOString() }, { id: 9, deadline_time: new Date(ddl9).toISOString() }, { id: 10, deadline_time: new Date(ddl10).toISOString() }, { id: 21, deadline_time: new Date(ddl10 + 7 * 86400000).toISOString() }] } });
  for (const [now, gw, open] of [[ddl9 - 12 * 3600000 - 1, 9, false], [ddl9 - 12 * 3600000, 9, true], [ddl9 - 1, 9, true], [ddl9, 9, false], [ddl10 - 12 * 3600000 - 1, 9, false], [ddl10 - 12 * 3600000, 10, true], [ddl10, 10, false], [ddl10 + 7 * 86400000, 10, false]]) {
    const window = await arenaWindow(env, now);
    assert.equal(window.gw, gw); assert.equal(window.open, open);
    assert.equal(Date.parse(window.deadline) - Date.parse(window.opensAt), 12 * 3600000);
  }
  assert.equal((await request('/admin/arena', 'POST', { gw: 9, open: true }, adminHeaders)).status, 409);
});

async function queueScenario() {
  const state = await setup();
  const members = Array.from({ length: 18 }, (_, i) => ({ entryId: i + 1, teamName: `Player ${i + 1}` }));
  state.cache.set('league:roster', members);
  const picks = { checkedEntryIds: members.map(m => m.entryId), picksByEntry: Object.fromEntries(members.map(m => [m.entryId, { captainId: 100 + m.entryId }])) };
  // First and third applicants share original captains; the second has no readable picks.
  picks.picksByEntry[2] = { captainId: 101 };
  picks.picksByEntry[3] = null;
  picks.picksByEntry[6] = { captainId: 105 };
  state.cache.set('picks:gw:9', picks);
  for (let i = 0; i < 9; i++) {
    assert.equal(await submitDuel(state.db, 9, i * 2 + 1, i * 2 + 2), true);
    // Equal timestamps must retain insertion order instead of UUID ordering.
    await state.db.prepare('UPDATE duels SET created_at=? WHERE challenger_id=?').bind('2026-10-24T00:00:00Z', i * 2 + 1).run();
  }
  return { ...state, picks, close() { state.cache.get('fpl:bootstrap').value.events[0].deadline_time = new Date(Date.now() - 10000).toISOString(); } };
}

test('queue skips same original captains and unavailable picks, selects five later groups, and refunds all excluded registrations', async () => {
  const { db, env, cache, request, close } = await queueScenario();
  const mine = async entryId => {
    const { token } = await (await request('/player/session', 'POST', { entryId })).json();
    return (await request('/duels/mine', 'GET', undefined, { authorization: `Bearer ${token}` })).json();
  };
  assert.equal((await mine(1)).remaining, 4);
  assert.equal(await selectRound(env, 9), false); // No selection or public candidates before DDL.
  assert.equal((await (await request('/community')).json()).duels.length, 0);
  close();
  await Promise.all([selectDueRounds(env), selectDueRounds(env)]);
  const rows = (await db.prepare('SELECT * FROM duels ORDER BY created_at,rowid').all()).results;
  assert.deepEqual(rows.map(r => r.selection_status), ['same_captain', 'missing_captain', 'same_captain', 'selected', 'selected', 'selected', 'selected', 'selected', 'overflow']);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM duel_selections').first()).count, 1);
  for (const id of [1, 3, 5, 17]) assert.equal((await mine(id)).remaining, 5);
  for (const id of [7, 9, 11, 13, 15]) assert.equal((await mine(id)).remaining, 4);
  assert.equal((await mine(1)).submitted, true);
  assert.equal((await mine(1)).selectionStatus, 'same_captain');
  const publicFeed = await (await request('/community')).json();
  assert.equal(publicFeed.arena.count, 5);
  assert.equal(publicFeed.arena.selectionReady, true);
  assert.deepEqual(publicFeed.duels.map(d => d.challenger_id), [7, 9, 11, 13, 15]);
  const snapshot = { gw: 9, finished: true, officialFinalized: true, teams: cache.get('league:roster').map(m => ({ ...m, captainPoints: m.entryId, scoringCaptainId: 999 })) };
  const committed = await commitRound(env, snapshot, 0);
  assert.deepEqual(committed.duelResults.map(d => d.challenger_id), [7, 9, 11, 13, 15]);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM duels WHERE settled_at IS NOT NULL").first()).count, 5);
  for (let gw = 10; gw <= 14; gw++) {
    assert.equal(await submitDuel(db, gw, 1, 2), true); // A same-captain refund leaves all five rights available.
    assert.equal(await submitDuel(db, gw, 17, 18), true); // Overflow also leaves all five available.
    assert.equal(await submitDuel(db, gw, 7, 8), gw < 14); // An actual selected duel still consumes one.
  }
  assert.equal(await submitDuel(db, 15, 1, 2), false);
  assert.equal(await submitDuel(db, 15, 17, 18), false);
  // Stable selection does not change when scoring uses a vice captain or later input changes.
  await selectRound(env, 9);
  assert.deepEqual((await db.prepare("SELECT challenger_id FROM duels WHERE selection_status='selected' ORDER BY created_at,rowid").all()).results.map(r => r.challenger_id), [7, 9, 11, 13, 15]);
});

test('partial picks never skip an earlier unconfirmed registration or consume the selection marker', async () => {
  const { db, env, picks, close } = await queueScenario();
  close();
  picks.checkedEntryIds = picks.checkedEntryIds.filter(id => id !== 1);
  assert.equal(await selectRound(env, 9), false);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM duel_selections').first()).count, 0);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM duels WHERE selection_status='pending'").first()).count, 9);
  picks.checkedEntryIds.push(1);
  db.sqlite.exec("CREATE TRIGGER fail_selection BEFORE INSERT ON duel_selections BEGIN SELECT RAISE(ABORT,'selection interrupted'); END;");
  await assert.rejects(selectRound(env, 9), /selection interrupted/);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM duels WHERE selection_status='pending'").first()).count, 9);
  db.sqlite.exec('DROP TRIGGER fail_selection');
  await selectRound(env, 9);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM duels WHERE selection_status='selected'").first()).count, 5);
});

test('fewer than five eligible groups are all selected and soft-deleted earlier registrations do not take slots', async () => {
  const { db, env, close } = await queueScenario();
  close();
  await db.prepare("UPDATE duels SET deleted_at='removed' WHERE challenger_id IN (7,9)").run();
  await selectRound(env, 9);
  assert.deepEqual((await db.prepare("SELECT challenger_id FROM duels WHERE selection_status='selected' ORDER BY created_at,rowid").all()).results.map(r => r.challenger_id), [11, 13, 15, 17]);
});


test('capture cron finalizes the queue from already locked picks without refetching FPL', async () => {
  const { env, cache, picks, close } = await queueScenario();
  close();
  cache.get('fpl:bootstrap').value.events[0].deadline_time = new Date(Date.now() - 2 * 3600000).toISOString();
  cache.set('league:roster:cached', { value: cache.get('league:roster'), cachedAt: new Date().toISOString() });
  for (const pick of Object.values(picks.picksByEntry)) if (pick) pick.viceCaptainId = 999;
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('locked picks must not be fetched again'); };
  try {
    await captureDueCaptainPicks(env);
    assert.equal(calls, 0);
    assert.equal((await env.OPS_DB.prepare("SELECT COUNT(*) AS count FROM duels WHERE selection_status='selected'").first()).count, 5);
  } finally { globalThis.fetch = original; }
});

test('temporary registration opens before the automatic window, keeps the official DDL, and expires', async () => {
  const { db, cache, env, request } = await setup();
  const ddl = new Date(Date.now() + 48 * 3600000).toISOString();
  cache.set('fpl:bootstrap', { value: { events: [{ id: 9, deadline_time: ddl }] } });
  assert.equal((await arenaWindow(env)).open, false);
  const setting = { gw: 9, opensAt: new Date(Date.now() - 1000).toISOString(), closesAt: new Date(Date.now() + 3600000).toISOString() };
  const write = value => db.prepare("INSERT INTO settings(key,value) VALUES ('arena_test_window',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(value)).run();
  await write(setting);
  const feed = await (await request('/community')).json();
  assert.equal(feed.arena.open, true); assert.equal(feed.arena.deadline, ddl);
  assert.equal(feed.arena.closesAt, setting.closesAt); assert.equal('count' in feed.arena, false);
  assert.deepEqual(feed.duels, []);
  const { token } = await (await request('/player/session', 'POST', { entryId: 1 })).json();
  const headers = { authorization: `Bearer ${token}` };
  assert.equal((await request('/duels', 'POST', { gw: 9, targetId: 2 }, headers)).status, 201);
  assert.equal((await request('/duels', 'POST', { gw: 9, targetId: 3 }, headers)).status, 409);
  const other = await (await request('/player/session', 'POST', { entryId: 3 })).json();
  assert.equal((await request('/duels', 'POST', { gw: 9, targetId: 2 }, { authorization: `Bearer ${other.token}` })).status, 409);
  await write({ ...setting, closesAt: new Date(Date.now() - 100).toISOString() });
  assert.equal((await arenaWindow(env)).open, false);
  assert.equal(await submitDuel(db, 9, 3, 4, 'expired-test', { deadline: ddl }), false);
  assert.equal((await request('/duels', 'POST', { gw: 9, targetId: 4 }, { authorization: `Bearer ${other.token}` })).status, 409);
});

test('temporary registration cannot authorize a different round, future, overlong, or post-DDL window', async () => {
  const { db, env, cache } = await setup();
  const now = Date.now(); const ddl = new Date(now + 48 * 3600000).toISOString();
  cache.set('fpl:bootstrap', { value: { events: [{ id: 9, deadline_time: ddl }] } });
  const valid = { gw: 9, opensAt: new Date(now - 1000).toISOString(), closesAt: new Date(now + 3600000).toISOString() };
  const write = value => db.prepare("INSERT INTO settings(key,value) VALUES ('arena_test_window',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(value)).run();
  for (const value of [{ ...valid, gw: 10 }, { ...valid, opensAt: new Date(now + 60000).toISOString() }, { ...valid, closesAt: new Date(now + 25 * 3600000).toISOString() }]) {
    await write(value); assert.equal((await arenaWindow(env)).open, false);
    assert.equal(await submitDuel(db, 9, 1, 2, crypto.randomUUID(), { deadline: ddl }), false);
  }
  await write(valid);
  assert.equal(await submitDuel(db, 9, 1, 2, 'after-ddl', { deadline: new Date(now - 1000).toISOString() }), false);
  // Revoke after the request's initial open check; the insert must independently reject it.
  assert.equal((await arenaWindow(env)).open, true);
  await db.prepare("DELETE FROM settings WHERE key='arena_test_window'").run();
  assert.equal(await submitDuel(db, 9, 1, 2, 'revoked-test', { deadline: ddl }), false);
});

test('manual test registration stays open without an hourly expiry and retains the official DDL guard', async () => {
  const { db, env, cache } = await setup();
  const now = Date.now(); const ddl = new Date(now + 72 * 3600000).toISOString();
  cache.set('fpl:bootstrap', { value: { events: [{ id: 9, deadline_time: ddl }] } });
  const set = value => db.prepare("INSERT INTO settings(key,value) VALUES ('arena_test_open',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(value)).run();
  await set({ gw: 9, open: true });
  assert.equal((await arenaWindow(env, now + 48 * 3600000)).open, true);
  assert.equal((await arenaWindow(env)).closesAt, undefined);
  assert.equal(await submitDuel(db, 9, 1, 2, 'manual-open', { deadline: ddl }), true);
  assert.equal(await submitDuel(db, 9, 1, 3, 'manual-duplicate', { deadline: ddl }), false);
  assert.equal(await submitDuel(db, 9, 3, 4, 'manual-after-ddl', { deadline: new Date(now - 1000).toISOString() }), false);
  assert.equal((await arenaWindow(env, Date.parse(ddl))).open, false);
  await set({ gw: 10, open: true });
  assert.equal((await arenaWindow(env)).open, false);
  assert.equal(await submitDuel(db, 9, 3, 4, 'wrong-manual-round', { deadline: ddl }), false);
  await set({ gw: 9, open: false });
  assert.equal(await submitDuel(db, 9, 3, 4, 'manual-closed', { deadline: ddl }), false);
});

test('signed personal status includes the authoritative registration window without a public-feed dependency', async () => {
  const { request } = await setup();
  const { token } = await (await request('/player/session', 'POST', { entryId: 1 })).json();
  const response = await request('/duels/mine', 'GET', undefined, { authorization: `Bearer ${token}` });
  const own = await response.json();
  assert.equal(response.status, 200); assert.equal(own.arena.gw, own.gw); assert.equal(own.arena.open, true);
  assert.ok(own.arena.deadline); assert.equal('count' in own.arena, false); assert.equal('duels' in own, false);
  assert.equal((await request('/duels/mine')).status, 401);
});

test('lightweight admin session checks require the HttpOnly administrator cookie', async () => {
  const { request, adminHeaders, env } = await setup();
  assert.equal((await request('/admin/session')).status, 401);
  const response = await request('/admin/session', 'GET', undefined, adminHeaders);
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { authenticated: true });
  const player = await signSession(env.SESSION_SECRET, { role: 'player', entryId: 1, exp: Date.now() + 60000 });
  assert.equal((await request('/admin/session', 'GET', undefined, { cookie: `__Host-penguin_admin=${player}` })).status, 401);
});

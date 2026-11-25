import assert from 'node:assert/strict';
import test from 'node:test';
import { database } from './helpers/operations-db.mjs';
import { handleOperations, signSession, submitDuel } from '../cloudflare/fpl-proxy/src/operations.ts';
import { selectRound } from '../cloudflare/fpl-proxy/src/duel-rules.ts';
import { commitRound, publishedRound } from '../cloudflare/fpl-proxy/src/publication.ts';
import { registerResurrection, selectResurrection } from '../cloudflare/fpl-proxy/src/resurrection.ts';
import { playerHealth } from '../shared/player-health.ts';
import { resurrectionOpensAt, resurrectionClosesAt } from '../shared/resurrection.ts';

async function setup() {
  const db = database();
  const members = Array.from({ length: 40 }, (_, index) => ({ entryId: index + 1, teamName: `Player ${index + 1}` }));
  const prior = { gw: 11, finished: true, officialFinalized: true,
    teams: members.map(member => ({ ...member, captainPoints: member.entryId <= 10 ? 2 : 8 })) };
  const cache = new Map([
    ['league:roster', members], ['snapshot:history', [prior]], ['snapshot:gw:11', prior],
    ['fpl:bootstrap', { value: { events: [
      { id: 11, deadline_time: '2026-11-21T13:30:00Z' },
      { id: 12, deadline_time: '2026-11-28T13:30:00Z' },
      { id: 13, deadline_time: '2026-12-02T18:30:00Z' },
    ] } }],
  ]);
  const env = { OPS_DB: db, SESSION_SECRET: 'test-session', OPS_PROXY_SECRET: 'test-proxy',
    FPL_CACHE: { async get(key) { return cache.get(key) ?? null; } } };
  const request = async (path, entryId, method = 'GET', data) => {
    const token = await signSession(env.SESSION_SECRET, { role: 'player', entryId, exp: Date.now() + 60000 });
    return handleOperations(new Request('https://penguin-fantasy.pages.dev/api' + path, {
      method, headers: { 'content-type': 'application/json', 'x-penguin-proxy-key': env.OPS_PROXY_SECRET, authorization: `Bearer ${token}`, origin: 'https://penguin-fantasy.pages.dev' },
      ...(data ? { body: JSON.stringify(data) } : {}),
    }), env);
  };
  return { env, db, cache, members, prior, request };
}

const opens = Date.parse(resurrectionOpensAt), closes = Date.parse(resurrectionClosesAt);
async function register(env, entryId, side, now = opens) {
  return registerResurrection(env, entryId, side, 0, 0, now);
}

test('registration window has exact Beijing boundaries and excludes simultaneous ordinary duels', async () => {
  const { env, db } = await setup();
  assert.equal(await register(env, 1, 'abyss', opens - 1), false);
  assert.equal(await register(env, 1, 'abyss', opens), true);
  assert.equal(await register(env, 1, 'abyss'), false);
  assert.equal(await submitDuel(db, 12, 11, 1), false);
  assert.equal(await submitDuel(db, 12, 1, 11), false);
  assert.equal(await submitDuel(db, 12, 12, 13), true);
  assert.equal(await register(env, 12, 'ice'), false);
  assert.equal(await register(env, 14, 'ice', closes - 1), true);
  assert.equal(await register(env, 15, 'ice', closes), false);
  const races = await Promise.all([
    register(env, 16, 'ice'), submitDuel(db, 12, 17, 16),
  ]);
  assert.equal(races.filter(Boolean).length, 1);
});

test('the signed endpoint derives the side from settled health and makes repeated submissions idempotent', async () => {
  const { request, db } = await setup();
  const realNow = Date.now;
  Date.now = () => opens;
  try {
    assert.equal((await request('/resurrection', 11, 'POST', { side: 'abyss' })).status, 409);
    assert.equal((await request('/resurrection', 1, 'POST', { side: 'ice' })).status, 409);
    assert.equal((await request('/resurrection', 1, 'POST', { side: 'abyss' })).status, 201);
    assert.equal((await request('/resurrection', 1, 'POST', { side: 'abyss' })).status, 200);
    const own = await (await request('/resurrection/mine', 1)).json();
    assert.equal(own.eliminated, true);
    assert.equal(own.mine.side, 'abyss');
    assert.equal((await db.prepare('SELECT COUNT(*) AS total FROM resurrection_registrations').first()).total, 1);
    assert.equal((await request('/resurrection', 11, 'POST', { side: 'ice' })).status, 201);
    const signed = await (await request('/duels/mine', 11)).json();
    assert.equal(signed.resurrectionLocked, true);
  } finally { Date.now = realNow; }
});

test('8 abyss and 6 ice applicants select the first 6 per side and selection stays frozen', async () => {
  const { env, db } = await setup();
  for (const id of [8, 7, 6, 5, 4, 3, 2, 1]) assert.equal(await register(env, id, 'abyss'), true);
  for (const id of [11, 12, 13, 14, 15, 16]) assert.equal(await register(env, id, 'ice'), true);
  assert.equal(await selectResurrection(env, closes - 1), null);
  const selected = await selectResurrection(env, closes);
  assert.deepEqual(selected.abyss, [8, 7, 6, 5, 4, 3]);
  assert.deepEqual(selected.ice, [11, 12, 13, 14, 15, 16]);
  assert.equal(selected.status, 'selected');
  assert.equal((await db.prepare('SELECT selection_status FROM resurrection_registrations WHERE entry_id=1').first()).selection_status, 'overflow');
  assert.deepEqual(await selectResurrection(env, closes + 1000), selected);
  assert.equal(await submitDuel(db, 12, 17, 11), false);
});

test('fewer than five on either side cancels the challenge and releases ordinary registration', async () => {
  const { env, db } = await setup();
  for (const id of [1, 2, 3, 4, 5]) await register(env, id, 'abyss');
  for (const id of [11, 12, 13, 14]) await register(env, id, 'ice');
  assert.equal((await selectResurrection(env, closes)).status, 'cancelled');
  assert.equal(await submitDuel(db, 12, 11, 12), true);
});

test('both rosters cap at eight players', async () => {
  const { env } = await setup();
  for (const id of [1, 2, 3, 4, 5, 6, 7, 8, 9]) await register(env, id, 'abyss');
  for (const id of [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]) await register(env, id, 'ice');
  const selected = await selectResurrection(env, closes);
  assert.equal(selected.abyss.length, 8);
  assert.equal(selected.ice.length, 8);
});

test('successful resurrection settles atomically once, revives to one life, and replaces ordinary captain health', async () => {
  const { env, db, members, prior } = await setup();
  for (const id of [1, 2, 3, 4, 5]) await register(env, id, 'abyss');
  for (const id of [11, 12, 13, 14, 15]) await register(env, id, 'ice');
  await selectResurrection(env, closes);
  const snapshot = { gw: 12, finished: true, officialFinalized: true,
    teams: members.map(member => ({ ...member, captainPoints: member.entryId <= 10 ? 10 : member.entryId <= 15 ? 2 : 8 })) };
  const pending = await commitRound(env, { ...snapshot, officialFinalized: false }, 0);
  assert.equal(pending.resurrection.status, 'selected');
  assert.equal(playerHealth([prior, pending], 1).hp, 0);
  const saved = await commitRound(env, snapshot, 1);
  assert.equal(saved.resurrection.status, 'success');
  assert.equal(saved.resurrection.abyssScore, 50);
  assert.equal(saved.resurrection.iceScore, 10);
  assert.equal(playerHealth([prior, saved], 1).hp, 1);
  const again = await commitRound(env, snapshot, 2);
  assert.equal(playerHealth([prior, again], 1).hp, 1);
  assert.equal(await submitDuel(db, 13, 1, 16), true);
  await commitRound(env, prior, 0);
  assert.equal((await db.prepare('SELECT deleted_at FROM duels WHERE gw=13').first()).deleted_at, null);
  const tied = await commitRound(env, { ...snapshot, teams: members.map(member => ({ ...member, captainPoints: 10 })) }, 3);
  assert.equal(tied.resurrection.status, 'failed');
  assert.equal(playerHealth([prior, tied], 1).hp, 0);
  assert.equal(playerHealth([prior, tied], 11).hp, 2);
  assert.equal((await publishedRound(env, 12)).resurrection.status, 'failed');
});

test('GW13 accepts more than five different-captain groups while keeping same-captain and per-player limits', async () => {
  const { env, db, cache } = await setup();
  for (const id of [1, 2, 3, 4, 5]) await register(env, id, 'abyss');
  for (const id of [11, 12, 13, 14, 15]) await register(env, id, 'ice');
  await selectResurrection(env, closes);
  const ids = Array.from({ length: 16 }, (_, i) => i + 1);
  const picks = { checkedEntryIds: ids, picksByEntry: Object.fromEntries(ids.map(id => [id, { captainId: id + 100 }])) };
  picks.picksByEntry[2].captainId = 101;
  cache.set('picks:gw:13', picks);
  for (let i = 0; i < 8; i++) assert.equal(await submitDuel(db, 13, i * 2 + 1, i * 2 + 2), true);
  assert.equal(await submitDuel(db, 13, 1, 20), false);
  assert.equal(await selectRound(env, 13, Date.parse('2026-12-03T01:00:00Z')), true);
  const statuses = (await db.prepare('SELECT selection_status FROM duels WHERE gw=13 ORDER BY rowid').all()).results.map(row => row.selection_status);
  assert.deepEqual(statuses, ['same_captain', ...Array(7).fill('selected')]);
  for (const gw of [9, 10, 11, 14]) assert.equal(await submitDuel(db, gw, 3, 20), true);
  assert.equal(await submitDuel(db, 15, 3, 20), false);
});

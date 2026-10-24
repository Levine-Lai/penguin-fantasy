import assert from 'node:assert/strict';
import test from 'node:test';
import { createDuelClient, UncertainSubmission } from '../app/arena/duel-client.ts';

const challenge = { gw: 9, targetId: 2, targetName: 'Target' };
const mine = (submitted = false) => ({ entryId: 1, remaining: submitted ? 4 : 5, gw: 9, submitted, challenge: submitted ? challenge : null });
function mockApi(handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(String(url)).pathname;
    calls.push([path, init]);
    const response = await handler(path, init, calls);
    return response instanceof Response ? response : Response.json(response);
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test('a saved POST stays successful even when subsequent status refresh fails', async () => {
  let saved = false;
  const mock = mockApi(path => {
    if (path.endsWith('/session')) return { token: 'token' };
    if (path.endsWith('/mine')) { if (saved) throw new TypeError('Failed to fetch'); return mine(); }
    saved = true; return { ok: true };
  });
  try {
    const client = createDuelClient(1);
    const accepted = await client.submit(challenge);
    assert.equal(accepted.mine.submitted, true); assert.equal(accepted.mine.challenge.targetId, 2);
    await assert.rejects(client.read(), /Failed to fetch/);
    assert.equal(accepted.mine.submitted, true);
    assert.equal(mock.calls.filter(([p]) => p === '/api/duels').length, 1);
  } finally { mock.restore(); }
});

test('an interrupted POST reconciles the saved duel without replaying it', async () => {
  let saved = false;
  const mock = mockApi(path => {
    if (path.endsWith('/session')) return { token: 'token' };
    if (path.endsWith('/mine')) return mine(saved);
    saved = true; throw new TypeError('Failed to fetch');
  });
  try {
    const accepted = await createDuelClient(1).submit(challenge);
    assert.equal(accepted.mine.submitted, true);
    assert.equal(mock.calls.filter(([p]) => p === '/api/duels').length, 1);
  } finally { mock.restore(); }
});

test('an unknown outcome stays unknown when status cannot be verified and never replays POST', async () => {
  let posted = false;
  const mock = mockApi(path => {
    if (path.endsWith('/session')) return { token: 'token' };
    if (path.endsWith('/mine') && !posted) return mine();
    posted = true; throw new TypeError('Failed to fetch');
  });
  try {
    await assert.rejects(createDuelClient(1).submit(challenge), UncertainSubmission);
    assert.equal(mock.calls.filter(([p]) => p === '/api/duels').length, 1);
  } finally { mock.restore(); }
});

test('expired sessions renew once and concurrent status requests are merged', async () => {
  let logins = 0;
  const mock = mockApi((path, init) => {
    if (path.endsWith('/session')) return { token: `token-${++logins}` };
    if (new Headers(init.headers).get('authorization') === 'Bearer token-1') return Response.json({ error: '请先登录' }, { status: 401 });
    return mine();
  });
  try {
    const client = createDuelClient(1);
    const [a, b] = await Promise.all([client.read(), client.read()]);
    assert.equal(a.token, 'token-2'); assert.equal(b.token, 'token-2'); assert.equal(logins, 2);
    assert.equal(mock.calls.filter(([p]) => p.endsWith('/mine')).length, 2);
  } finally { mock.restore(); }
});

test('a POST 401 renews and checks the saved status before one bounded retry', async () => {
  let posts = 0, logins = 0, reads = 0;
  const mock = mockApi(path => {
    if (path.endsWith('/session')) return { token: `token-${++logins}` };
    if (path.endsWith('/mine')) { reads++; return mine(); }
    if (++posts === 1) return Response.json({ error: '请先登录' }, { status: 401 });
    return { ok: true };
  });
  try {
    assert.equal((await createDuelClient(1).submit(challenge)).mine.submitted, true);
    assert.equal(reads, 2); assert.equal(logins, 2); assert.equal(posts, 2);
  } finally { mock.restore(); }
});

test('a definitive rejection remains a failure without automatic replay', async () => {
  const mock = mockApi(path => path.endsWith('/session') ? { token: 'token' } : path.endsWith('/mine') ? mine() : Response.json({ error: '本轮五组决斗名额已满' }, { status: 409 }));
  try { await assert.rejects(createDuelClient(1).submit(challenge), /名额已满/); }
  finally { mock.restore(); }
});

test('renewal cannot loop when the replacement session is also rejected', async () => {
  const mock = mockApi(path => path.endsWith('/session') ? { token: 'rejected-token' } : Response.json({ error: '请先登录' }, { status: 401 }));
  try {
    await assert.rejects(createDuelClient(1).read(), /请先登录/);
    assert.equal(mock.calls.filter(([p]) => p.endsWith('/session')).length, 2);
    assert.equal(mock.calls.filter(([p]) => p.endsWith('/mine')).length, 2);
  } finally { mock.restore(); }
});

test('renewal observes another tab submission and does not submit a second target', async () => {
  let posts = 0, reads = 0;
  const mock = mockApi(path => {
    if (path.endsWith('/session')) return { token: 'token' };
    if (path.endsWith('/mine')) return ++reads === 1 ? mine() : { ...mine(true), challenge: { targetId: 3, targetName: 'Other target' } };
    posts++; return Response.json({ error: '请先登录' }, { status: 401 });
  });
  try {
    const accepted = await createDuelClient(1).submit(challenge);
    assert.equal(accepted.mine.challenge.targetId, 3);
    assert.equal(posts, 1);
  } finally { mock.restore(); }
});

test('an old in-flight status response cannot erase a subsequently confirmed submission', async () => {
  let mineReads = 0, releaseOldRead, finishPost;
  const mock = mockApi(path => {
    if (path.endsWith('/session')) return { token: 'token' };
    if (path.endsWith('/mine')) {
      if (++mineReads === 2) return new Promise(resolve => { releaseOldRead = () => resolve(mine()); });
      return mine();
    }
    return new Promise(resolve => { finishPost = () => resolve({ ok: true }); });
  });
  try {
    const client = createDuelClient(1);
    const submitting = client.submit(challenge);
    while (!finishPost) await new Promise(resolve => setImmediate(resolve));
    const staleRead = client.read();
    while (!releaseOldRead) await new Promise(resolve => setImmediate(resolve));
    finishPost(); await submitting;
    releaseOldRead();
    assert.equal((await staleRead).mine.submitted, true);
  } finally { mock.restore(); }
});

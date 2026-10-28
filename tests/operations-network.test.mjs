import assert from 'node:assert/strict';
import test from 'node:test';
import { operationsFetch } from '../app/operations-client.ts';
import { onRequest } from '../functions/api/[[path]].js';

test('GET retries a transport timeout once, while writes never replay and expose a readable timeout', async () => {
  const original = globalThis.fetch; let calls = 0;
  try {
    globalThis.fetch = async () => { if (++calls === 1) throw new DOMException('signal timed out', 'TimeoutError'); return Response.json({ ok: true }); };
    assert.deepEqual(await operationsFetch('/community'), { ok: true }); assert.equal(calls, 2);
    calls = 0;
    globalThis.fetch = async () => { calls++; throw new DOMException('signal timed out', 'TimeoutError'); };
    await assert.rejects(operationsFetch('/duels', { method: 'POST', body: '{}' }), /请求超时/); assert.equal(calls, 1);
    calls = 0; const controller = new AbortController(); controller.abort();
    await assert.rejects(operationsFetch('/community', { signal: controller.signal })); assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test('proxy returns complete uncompressed JSON without stale upstream encoding metadata', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(new Headers(init.headers).get('accept-encoding'), 'identity');
      return new Response(JSON.stringify({ arena: { open: true } }), { headers: { 'content-type': 'application/json', 'content-encoding': 'br', 'content-length': '3' } });
    };
    const response = await onRequest({ request: new Request('https://penguin-fantasy.pages.dev/api/community'), params: { path: ['community'] }, env: { OPS_PROXY_SECRET: 'test' } });
    assert.equal(response.headers.get('content-encoding'), null); assert.equal(response.headers.get('content-length'), null);
    assert.match(response.headers.get('cache-control'), /no-store/); assert.match(response.headers.get('cache-control'), /no-transform/);
    assert.deepEqual(await response.json(), { arena: { open: true } });
  } finally { globalThis.fetch = original; }
});

test('proxy preserves no-body semantics for HEAD responses', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(null, { status: 200, headers: { 'content-length': '50' } });
    const response = await onRequest({ request: new Request('https://penguin-fantasy.pages.dev/api/league', { method: 'HEAD' }), params: { path: ['league'] }, env: {} });
    assert.equal(response.body, null); assert.match(response.headers.get('cache-control'), /no-transform/);
  } finally { globalThis.fetch = original; }
});

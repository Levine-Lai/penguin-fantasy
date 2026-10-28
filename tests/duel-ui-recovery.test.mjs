import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { UncertainSubmission } from '../app/arena/duel-client.ts';

// Run actual component event/effect callbacks with deterministic hooks and timers.
function arenaHarness(factory, communityLoader) {
  const source = readFileSync(new URL('../app/arena/live-arena.tsx', import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const previous = { window: globalThis.window, document: globalThis.document };
  const slots = [], timers = new Map(), handlers = new Map();
  let cursor = 0, effects = [], tree, timerId = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(init) { const i = cursor++; slots[i] ??= { value: typeof init === 'function' ? init() : init }; return [slots[i].value, value => { slots[i].value = typeof value === 'function' ? value(slots[i].value) : value; }]; },
    useRef(init) { const i = cursor++; slots[i] ??= { current: init }; return slots[i]; },
    useMemo(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { deps, value: fn() }; return slots[i].value; },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) { const old = slots[i]; slots[i] = { deps }; effects.push(() => { old?.cleanup?.(); slots[i].cleanup = fn(); }); } },
  };
  const add = (name, fn) => { if (!handlers.has(name)) handlers.set(name, new Set()); handlers.get(name).add(fn); };
  const remove = (name, fn) => handlers.get(name)?.delete(fn);
  globalThis.window = { addEventListener: add, removeEventListener: remove, setInterval: () => 1, clearInterval() {}, setTimeout(fn, ms) { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimeout: id => timers.delete(id) };
  globalThis.document = { body: { style: { overflow: '' } }, visibilityState: 'visible', addEventListener: add, removeEventListener: remove };
  const community = { arena: { gw: 9, open: true, deadline: '2099-01-01T00:00:00Z' }, members: [{ entryId: 1, teamName: 'A' }, { entryId: 2, teamName: 'B' }], duels: [], results: [] };
  const operations = { chinaTime: x => x, loadCommunity: communityLoader ?? (async () => { for (const handler of handlers.get('penguin-community-updated') ?? []) handler({ detail: community }); return community; }) };
  const jsx = (type, props) => ({ type, props }), compiled = { exports: {} };
  new Function('require', 'module', 'exports', js)(name => name === 'react' ? react : name === 'react/jsx-runtime' ? { jsx, jsxs: jsx } : name.includes('operations-client') ? operations : name.includes('duel-client') ? { createDuelClient: factory, UncertainSubmission } : { default: new Proxy({}, { get: (_, key) => String(key) }) }, compiled, compiled.exports);
  const render = () => { cursor = 0; effects = []; tree = compiled.exports.default({ player: { entryId: 1, name: 'A', hp: 3 }, players: [{ entryId: 1, name: 'A', hp: 3 }, { entryId: 2, name: 'B', hp: 4 }] }); effects.forEach(fn => fn()); };
  const nodes = type => { const found = []; function walk(node) { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) return node.forEach(walk); if (node.type === type) found.push(node); walk(node.props?.children); } walk(tree); return found; };
  return { render, nodes, timers, async flush() { for (let i = 0; i < 4; i++) { await new Promise(resolve => setImmediate(resolve)); render(); } }, restore() { Object.assign(globalThis, previous); } };
}

test('a recovered confirmed submission removes its obsolete popup and inline error', async () => {
  let submitted = false;
  const h = arenaHarness(id => ({ read: async () => ({ entryId: id, token: 'test', mine: { entryId: id, gw: 9, remaining: 5, submitted, challenge: submitted ? { targetId: 2, targetName: 'B' } : null } }), submit: async () => { throw new UncertainSubmission(); } }));
  try {
    h.render(); await h.flush();
    h.nodes('input').find(node => node.props.type === 'radio').props.onChange({ target: { value: '2' } }); h.render();
    h.nodes('form')[0].props.onSubmit({ preventDefault() {} }); h.render();
    await h.nodes('form')[1].props.onSubmit({ preventDefault() {} }); await h.flush();
    const errorText = () => h.nodes('p').find(node => node.props.id === 'duel-error-detail').props.children;
    assert.match(errorText(), /暂未确认/);
    submitted = true;
    [...h.timers.values()].find(timer => timer.ms === 15000).fn(); await h.flush();
    assert.equal(errorText(), '');
    assert.equal(h.nodes('p').some(node => node.props.role === 'alert'), false);
    assert.ok(h.nodes('p').some(node => node.props.children === '报名已提交，不可修改。'));
  } finally { h.restore(); }
});

function callback(name) {
  const source = readFileSync(new URL('../app/admin/admin-console.tsx', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('admin.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let value;
  function walk(node) { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) value = node.initializer.getText(ast); ts.forEachChild(node, walk); }
  walk(ast); assert.ok(value);
  return ts.transpileModule('const extracted=' + value, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}

test('admin delete keeps its saved result and local removal when overview refresh fails', async () => {
  let data = { duels: [{ id: 'duel', deleted_at: null }], announcements: [] }, notice = '', error = '', saved = false;
  const deps = { setBusy() {}, setError: v => { error = v; }, setNotice: v => { notice = v; }, load: async () => { throw new Error('GET failed'); }, day: '2026-10-22', page: 0, setLoggedIn() {} };
  const run = new Function(...Object.keys(deps), callback('run') + ';return extracted;')(...Object.values(deps));
  const pending = [];
  const removeDeps = { window: { confirm: () => true, prompt: () => 'reason' }, operationsFetch: async () => { saved = true; }, setData: updater => { data = updater(data); }, run: (...args) => { const result = run(...args); pending.push(result); return result; } };
  const remove = new Function(...Object.keys(removeDeps), callback('remove') + ';return extracted;')(...Object.values(removeDeps));
  remove('duels', 'duel', 'A → B'); await Promise.all(pending);
  assert.equal(saved, true); assert.ok(data.duels[0].deleted_at);
  assert.equal(data.duels[0].delete_reason, 'reason');
  assert.match(notice, /已移除/); assert.match(error, /操作已完成/);
});

test('roster search and signed registration do not wait for a stalled community feed', { timeout: 2000 }, async () => {
  let release, submitted = false, writes = 0;
  const arena = { gw: 9, open: true, deadline: '2099-01-01T00:00:00Z' };
  const own = id => ({ entryId: id, token: 'test', mine: { entryId: id, arena, gw: 9, remaining: submitted ? 4 : 5, submitted, challenge: submitted ? { targetId: 2, targetName: 'B' } : null } });
  const ready = new Promise(resolve => { release = resolve; });
  const h = arenaHarness(id => ({ read: async () => { await ready; return own(id); }, submit: async () => { writes++; submitted = true; return own(id); } }), () => new Promise(() => {}));
  try {
    h.render(); await h.flush();
    const search = () => h.nodes('input').find(node => node.props.type === 'search');
    const confirm = () => h.nodes('button').find(node => node.props.className === 'challengeButton');
    assert.equal(h.nodes('input').filter(node => node.props.type === 'radio').length, 1);
    assert.equal(h.nodes('fieldset')[0].props.disabled, false);
    assert.equal(confirm().props.disabled, true);
    search().props.onChange({ target: { value: 'missing' } }); h.render();
    assert.ok(h.nodes('p').some(node => node.props.children === '未找到玩家'));
    search().props.onChange({ target: { value: '2' } }); h.render();
    h.nodes('input').find(node => node.props.type === 'radio').props.onChange({ target: { value: '2' } }); h.render();
    assert.equal(confirm().props.disabled, true);
    release(); await h.flush();
    assert.equal(confirm().props.disabled, false);
    h.nodes('form')[0].props.onSubmit({ preventDefault() {} }); h.render();
    let timer;
    await Promise.race([h.nodes('form')[1].props.onSubmit({ preventDefault() {} }), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Saved signup waited for the public feed')), 250); })]).finally(() => clearTimeout(timer));
    await h.flush(); assert.equal(writes, 1);
    assert.ok(h.nodes('h3').some(node => node.props.children === '决斗情况'));
    assert.equal(h.nodes('button').find(node => node.props.type === 'submit')?.props.disabled, false);
  } finally { h.restore(); }
});

test('a failed signed status never authorizes signup even when the roster is available', async () => {
  const h = arenaHarness(() => ({ read: async () => { throw new Error('请求超时，请稍后重试'); }, submit: async () => assert.fail('Cannot submit without signed status') }), () => new Promise(() => {}));
  try {
    h.render(); await h.flush();
    assert.equal(h.nodes('input').filter(node => node.props.type === 'radio').length, 1);
    assert.equal(h.nodes('button').find(node => node.props.className === 'challengeButton').props.disabled, true);
    assert.ok(h.nodes('p').some(node => node.props.role === 'alert'));
  } finally { h.restore(); }
});

test('a missing public result feed still reports an error after the official DDL', async () => {
  const h = arenaHarness(id => ({ read: async () => ({ entryId: id, token: 'test', mine: { entryId: id, arena: { gw: 9, open: false, deadline: '2000-01-01T00:00:00Z' }, gw: 9, remaining: 5, submitted: false, challenge: null } }) }), async () => { throw new Error('请求超时，请稍后重试'); });
  try { h.render(); await h.flush(); assert.ok(h.nodes('p').some(node => node.props.role === 'alert')); }
  finally { h.restore(); }
});

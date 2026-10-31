import { arenaWindow, selectRound, usedChallengeSql, usesChallenge } from './duel-rules.ts';
import { commitRound, publicationRevision, publishedHistory, publishedRound } from './publication.ts';
import { playerHealth } from '../../../shared/player-health.ts';

export interface OpsStatement {
  bind(...values: unknown[]): OpsStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes?: number } }>;
}
export interface OpsDatabase {
  prepare(sql: string): OpsStatement;
  batch(statements: OpsStatement[]): Promise<unknown[]>;
}
export interface OpsEnv {
  OPS_DB?: OpsDatabase;
  SESSION_SECRET?: string;
  ADMIN_PASSWORD_HASH?: string;
  OPS_PROXY_SECRET?: string;
  FPL_CACHE: { get<T>(key: string, type: 'json'): Promise<T | null> };
}
type Member = { entryId: number; teamName: string };
type Session = { role: 'admin' | 'player'; exp: number; entryId?: number; codeHash?: string };
export type Duel = { id: string; gw: number; challenger_id: number; target_id: number; created_at: string; selection_status: 'pending' | 'selected' | 'same_captain' | 'overflow' | 'missing_captain'; deleted_at: string | null; settled_at: string | null; challenger_score: number | null; target_score: number | null; challenger_delta: number | null; target_delta: number | null };
export type Snapshot = { gw: number; finished?: boolean; officialFinalized?: boolean; duelResults?: Duel[]; publicationRevision?: number; teams: Array<{ entryId: number; captainPoints: number; captainPickRate?: number | null; scoringCaptainName?: string; captainName?: string | null }> };

const canonicalOrigin = 'https://penguin-fantasy.pages.dev';
const origins = new Set([canonicalOrigin, 'https://levine-lai.github.io', 'https://penguin-cup-2627.hazy-lemon-8599.chatgpt.site']);
const encoder = new TextEncoder();
const cookieName = '__Host-penguin_admin';
const idPattern = /^[a-zA-Z0-9_-]{16,80}$/;
class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export function beijingDay(now = Date.now()): string { return new Date(now + 8 * 3600000).toISOString().slice(0, 10); }
function b64(bytes: Uint8Array): string { return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''); }
function unb64(value: string): Uint8Array { return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0)); }
async function mac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))));
}
function same(left: string, right: string): boolean {
  let difference = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) difference |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  return difference === 0;
}
export async function signSession(secret: string, session: Session): Promise<string> {
  const payload = b64(encoder.encode(JSON.stringify(session)));
  return `${payload}.${await mac(secret, payload)}`;
}
export async function readSession(secret: string, token: string, now = Date.now()): Promise<Session | null> {
  try {
    const [payload, signature, extra] = token.split('.');
    if (extra || !payload || !signature || !same(signature, await mac(secret, payload))) return null;
    const session = JSON.parse(new TextDecoder().decode(unb64(payload))) as Session;
    if (!Number.isFinite(session.exp) || session.exp <= now || !['admin', 'player'].includes(session.role)) return null;
    return session;
  } catch { return null; }
}
export async function passwordHash(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: encoder.encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256);
  return `${salt}.${b64(new Uint8Array(bits))}`;
}
function response(data: unknown, request: Request, status = 200, extra: Record<string, string> = {}): Response {
  const origin = request.headers.get('origin') ?? '';
  const headers = {
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'vary': 'Origin',
    ...(origins.has(origin) || /^http:\/\/localhost:\d+$/.test(origin) ? { 'access-control-allow-origin': origin } : {}),
    'access-control-allow-credentials': 'true', 'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
    'access-control-allow-headers': 'Content-Type,Authorization', ...extra,
  };
  return status === 204 ? new Response(null, { status, headers }) : Response.json(data, { status, headers });
}
async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new ApiError(415, '需要 JSON 请求');
  if (Number(request.headers.get('content-length') ?? 0) > 12000) throw new ApiError(413, '内容过长');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, '缺少内容');
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.length;
    if (size > 12000) { await reader.cancel(); throw new ApiError(413, '内容过长'); }
    chunks.push(value);
  }
  try {
    const buffer = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
    const parsed = JSON.parse(new TextDecoder().decode(buffer));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch { throw new ApiError(400, '请求内容无效'); }
}
function text(value: unknown, max: number, required = true): string {
  const result = typeof value === 'string' ? value.trim() : '';
  if ((required && !result) || result.length > max) throw new ApiError(400, `内容不能为空且不能超过 ${max} 字`);
  return result;
}
async function roster(env: OpsEnv): Promise<Member[]> { return await env.FPL_CACHE.get<Member[]>('league:roster', 'json') ?? []; }
async function deadline(env: OpsEnv, gw: number): Promise<string | undefined> {
  const bootstrap = await env.FPL_CACHE.get<{ value: { events: Array<{ id: number; deadline_time: string }> } }>('fpl:bootstrap', 'json');
  return bootstrap?.value.events.find(event => event.id === gw)?.deadline_time;
}
async function limit(env: OpsEnv, request: Request, category: string, max: number, windowMs: number): Promise<void> {
  const db = env.OPS_DB!; const now = Date.now(); const bucket = Math.floor(now / windowMs);
  const ip = request.headers.get('x-penguin-client-ip') ?? request.headers.get('cf-connecting-ip') ?? 'unknown';
  const key = await mac(env.SESSION_SECRET!, `${category}:${ip}:${bucket}`);
  const row = await db.prepare('INSERT INTO rate_limits(key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count')
    .bind(key, now + windowMs).first<{ count: number }>();
  if ((row?.count ?? 0) > max) throw new ApiError(429, '请求过于频繁，请稍后再试');
}
async function adminSession(env: OpsEnv, request: Request): Promise<void> {
  const token = request.headers.get('cookie')?.split(';').map(value => value.trim()).find(value => value.startsWith(cookieName + '='))?.slice(cookieName.length + 1) ?? '';
  const session = await readSession(env.SESSION_SECRET!, token);
  if (session?.role !== 'admin') throw new ApiError(401, '请先登录后台');
}
async function playerSession(env: OpsEnv, request: Request): Promise<number> {
  const session = await readSession(env.SESSION_SECRET!, request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '');
  if (session?.role !== 'player' || !session.entryId) throw new ApiError(401, '请先登录');
  if (!(await roster(env)).some(member => member.entryId === session.entryId)) throw new ApiError(403, '玩家不在当前联赛中');
  return session.entryId;
}
async function audit(db: OpsDatabase, action: string, target: string, detail = ''): Promise<void> {
  await db.prepare('INSERT INTO audit_log VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), action, target, detail, new Date().toISOString()).run();
}
function namedDuels(rows: Duel[], members: Member[]) {
  const names = new Map(members.map(member => [member.entryId, member.teamName]));
  return rows.map(row => ({ ...row, challengerName: names.get(row.challenger_id) ?? `ID ${row.challenger_id}`, targetName: names.get(row.target_id) ?? `ID ${row.target_id}` }));
}
async function captainedDuels(env: OpsEnv, rows: Duel[], members: Member[]) {
  const bootstrap = await env.FPL_CACHE.get<{ value: { events: Array<{ id: number; deadline_time: string }>; elements: Array<{ id: number; web_name: string }> } }>('fpl:bootstrap', 'json');
  const names = new Map((bootstrap?.value.elements ?? []).map(player => [player.id, player.web_name]));
  type Pick = { captainId: number; viceCaptainId?: number };
  const rounds = new Map<number, Record<string, Pick | null>>(await Promise.all([...new Set(rows.map(row => row.gw))].map(async gw => {
    const ddl = bootstrap?.value.events.find(event => event.id === gw)?.deadline_time;
    const readable = ddl && Date.now() >= Date.parse(ddl) + 90 * 60000;
    const picks = readable ? await env.FPL_CACHE.get<{ picksByEntry: Record<string, Pick | null> }>(`picks:gw:${gw}`, 'json') : null;
    return [gw, picks?.picksByEntry ?? {}] as const;
  })));
  const choice = (gw: number, id: number) => {
    const pick = rounds.get(gw)?.[id];
    return pick ? { captainId: pick.captainId, captainName: names.get(pick.captainId) ?? `球员 ${pick.captainId}`,
      viceCaptainId: pick.viceCaptainId ?? null, viceCaptainName: pick.viceCaptainId ? names.get(pick.viceCaptainId) ?? `球员 ${pick.viceCaptainId}` : null } : null;
  };
  return namedDuels(rows, members).map(row => ({ ...row, challengerCaptain: choice(row.gw, row.challenger_id), targetCaptain: choice(row.gw, row.target_id) }));
}
async function healthState(env: OpsEnv) {
  const revision = (await env.OPS_DB!.prepare('SELECT COALESCE(SUM(revision),0) AS revision FROM published_rounds').first<{ revision: number }>())!.revision;
  const removed = (await env.OPS_DB!.prepare('SELECT id FROM duels WHERE deleted_at IS NOT NULL').all<{ id: string }>()).results;
  const history = await publishedHistory(env);
  const removedIds = new Set(removed.map(row => row.id));
  return { revision, removed: removed.length, player: (id: number) => playerHealth(history, id, removedIds) };
}
export async function submitDuel(db: OpsDatabase, gw: number, challengerId: number, targetId: number, id = crypto.randomUUID(), gate?: { deadline: string; health?: { revision: number; removed: number } }): Promise<boolean> {
  const result = await db.prepare(`INSERT INTO duels(id,gw,challenger_id,target_id,created_at)
    SELECT ?,?,?,?,? WHERE ? != ?
    AND NOT EXISTS(SELECT 1 FROM duels WHERE gw=? AND deleted_at IS NULL AND
      (challenger_id IN (?,?) OR target_id IN (?,?)))
    AND (SELECT COUNT(*) FROM duels WHERE challenger_id=? AND gw BETWEEN 9 AND 20 AND deleted_at IS NULL
      AND ${usedChallengeSql})<5
    ${gate ? `AND (julianday('now') >= julianday(?,'-12 hours') OR EXISTS (
      SELECT 1 FROM settings WHERE key='arena_test_open' AND json_valid(value)
      AND json_extract(value,'$.gw')=? AND json_extract(value,'$.open')=1
    ) OR EXISTS (
      SELECT 1 FROM settings WHERE key='arena_test_window' AND json_valid(value)
      AND json_extract(value,'$.gw')=?
      AND julianday(json_extract(value,'$.closesAt')) > julianday(json_extract(value,'$.opensAt'))
      AND julianday(json_extract(value,'$.closesAt')) <= julianday(json_extract(value,'$.opensAt'),'+1 day')
      AND julianday('now') >= julianday(json_extract(value,'$.opensAt'))
      AND julianday('now') < julianday(json_extract(value,'$.closesAt'))
    )) AND julianday('now') < julianday(?)` : ''}
    ${gate?.health ? `AND (SELECT COALESCE(SUM(revision),0) FROM published_rounds)=?
      AND (SELECT COUNT(*) FROM duels WHERE deleted_at IS NOT NULL)=?` : ''}`)
    .bind(id, gw, challengerId, targetId, new Date().toISOString(), challengerId, targetId, gw,
      challengerId, targetId, challengerId, targetId, challengerId, ...(gate ? [gate.deadline, gw, gw, gate.deadline] : []), ...(gate?.health ? [gate.health.revision, gate.health.removed] : [])).run();
  return result.meta.changes === 1;
}
export async function handleOperations(request: Request, env: OpsEnv): Promise<Response | null> {
  const url = new URL(request.url); const path = url.pathname;
  if (!/^\/api\/(admin(?:\/|$)|community$|visits$|player\/session$|duels(?:\/|$))/.test(path)) return null;
  try {
    const origin = request.headers.get('origin');
    if (origin && !origins.has(origin) && !/^http:\/\/localhost:\d+$/.test(origin)) throw new ApiError(403, '来源不受支持');
    if (request.method === 'OPTIONS') return response({}, request, 204);
    if (!env.OPS_DB || !env.SESSION_SECRET || !env.OPS_PROXY_SECRET) throw new ApiError(503, '后台暂未配置完成');
    if (!same(request.headers.get('x-penguin-proxy-key') ?? '', env.OPS_PROXY_SECRET)) throw new ApiError(403, '请通过网站接口访问');
    const db = env.OPS_DB; const now = new Date().toISOString();
    if (path.startsWith('/api/admin/')) {
      if (request.method !== 'GET' && origin !== canonicalOrigin && !/^http:\/\/localhost:\d+$/.test(origin ?? '')) throw new ApiError(403, '请从后台页面操作');
      if (path === '/api/admin/login' && request.method === 'POST') {
        await limit(env, request, 'admin-login', 8, 15 * 60000);
        const input = await body(request); const password = text(input.password, 160);
        const saved = env.ADMIN_PASSWORD_HASH;
        if (!saved) throw new ApiError(503, '管理员密码尚未配置');
        if (!same(await passwordHash(password, saved.split('.')[0]), saved)) throw new ApiError(401, '管理员密码不正确');
        const token = await signSession(env.SESSION_SECRET, { role: 'admin', exp: Date.now() + 8 * 3600000 });
        await audit(db, 'admin_login', 'admin');
        return response({ ok: true }, request, 200, { 'set-cookie': `${cookieName}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800` });
      }
      await adminSession(env, request);
      if (path === '/api/admin/session' && request.method === 'GET') return response({ authenticated: true }, request);
      if (path === '/api/admin/logout' && request.method === 'POST') return response({ ok: true }, request, 200, { 'set-cookie': `${cookieName}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0` });
      if (path === '/api/admin/overview' && request.method === 'GET') {
        const selectedDay = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('day') ?? '') ? url.searchParams.get('day')! : beijingDay();
        const start = new Date(`${selectedDay}T00:00:00+08:00`).toISOString();
        const end = new Date(Date.parse(start) + 86400000).toISOString();
        const pageIndex = (value: string | null) => Math.max(0, Math.min(10000, Math.floor(Number(value) || 0)));
        const page = pageIndex(url.searchParams.get('page'));
        const includeRemoved = url.searchParams.get('includeRemoved') === 'true';
        const duelWhere = includeRemoved ? '' : 'WHERE deleted_at IS NULL';
        const duelPageSize = 50;
        const duelTotal = (await db.prepare(`SELECT COUNT(*) AS count FROM duels ${duelWhere}`).first<{ count: number }>())?.count ?? 0;
        const duelPage = Math.min(pageIndex(url.searchParams.get('duelPage')), Math.max(0, Math.ceil(duelTotal / duelPageSize) - 1));
        const [members, config, duelRows, announcements, activity, players, logs] = await Promise.all([
          roster(env), arenaWindow(env),
          db.prepare(`SELECT * FROM duels ${duelWhere} ORDER BY created_at DESC,rowid DESC LIMIT ? OFFSET ?`).bind(duelPageSize, duelPage * duelPageSize).all<Duel>(),
          db.prepare('SELECT * FROM announcements ORDER BY created_at DESC LIMIT 100').all(),
          db.prepare('SELECT * FROM player_logins WHERE created_at>=? AND created_at<? ORDER BY created_at DESC LIMIT 50 OFFSET ?').bind(start, end, page * 50).all(),
          db.prepare('SELECT entry_id, MIN(created_at) AS firstLogin, MAX(created_at) AS lastLogin FROM player_logins WHERE created_at>=? AND created_at<? GROUP BY entry_id ORDER BY lastLogin DESC').bind(start, end).all(),
          db.prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 50').all(),
        ]);
        const activeCount = (await db.prepare('SELECT COUNT(*) AS count FROM duels WHERE gw=? AND deleted_at IS NULL').bind(config.gw).first<{ count: number }>())?.count ?? 0;
        return response({ day: selectedDay, page, arena: { ...config, deadline: await deadline(env, config.gw), count: activeCount },
          duelPagination: { page: duelPage, pageSize: duelPageSize, total: duelTotal },
          members, duels: await captainedDuels(env, duelRows.results, members), announcements: announcements.results,
          activity: activity.results, players: players.results, logs: logs.results }, request);
      }
      if (path === '/api/admin/arena' && request.method === 'POST') {
        throw new ApiError(409, '报名已改为每轮 DDL 前 12 小时自动开放');
      }
      if (path === '/api/admin/announcements' && request.method === 'POST') {
        const input = await body(request); const title = text(input.title, 60); const content = text(input.body, 2000);
        const day = text(input.day, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(`${day}T00:00:00Z`))) throw new ApiError(400, '日期无效');
        const id = crypto.randomUUID();
        await db.batch([
          db.prepare('INSERT INTO announcements(id,title,body,display_day,created_at) VALUES (?,?,?,?,?)').bind(id, title, content, day, now),
          db.prepare('INSERT INTO audit_log VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), 'publish_announcement', id, title, now),
        ]);
        return response({ ok: true, id }, request, 201);
      }
      const deleteMatch = path.match(/^\/api\/admin\/(duels|announcements)\/([\w-]{16,80})$/);
      if (deleteMatch && request.method === 'DELETE') {
        const input = await body(request); const reason = text(input.reason, 200, false);
        const table = deleteMatch[1]; const id = deleteMatch[2];
        const exists = await db.prepare(`SELECT id FROM ${table} WHERE id=? AND deleted_at IS NULL`).bind(id).first();
        if (!exists) throw new ApiError(404, '记录不存在或已移除');
        await db.batch([
          table === 'duels' ? db.prepare('UPDATE duels SET deleted_at=?,delete_reason=? WHERE id=? AND deleted_at IS NULL').bind(now, reason, id)
            : db.prepare('UPDATE announcements SET deleted_at=? WHERE id=? AND deleted_at IS NULL').bind(now, id),
          db.prepare('INSERT INTO audit_log VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), `remove_${table}`, id, reason, now),
        ]);
        return response({ ok: true }, request);
      }
      throw new ApiError(404, '接口不存在');
    }
    if (path === '/api/community' && request.method === 'GET') {
      const config = await arenaWindow(env); const ddl = await deadline(env, config.gw);
      const [members, duelRows, announcementRows, deleted, history] = await Promise.all([
        roster(env), db.prepare('SELECT * FROM duels WHERE gw=? AND deleted_at IS NULL ORDER BY created_at').bind(config.gw).all<Duel>(),
        db.prepare('SELECT id,title,body,display_day FROM announcements WHERE display_day=? AND deleted_at IS NULL ORDER BY created_at DESC').bind(beijingDay()).all(),
        db.prepare('SELECT id FROM duels WHERE deleted_at IS NOT NULL').all<{ id: string }>(),
        publishedHistory(env),
      ]);
      const removedDuelIds = deleted.results.map(row => row.id);
      const removed = new Set(removedDuelIds);
      const published = (history ?? []).flatMap(snapshot => snapshot.duelResults ?? []).filter(row => !removed.has(row.id));
      const publishedById = new Map(published.map(row => [row.id, row]));
      const selectionReady = duelRows.results.every(row => row.selection_status !== 'pending');
      const publicDuels = duelRows.results.filter(row => row.selection_status === 'selected').map(row => {
        const settled = publishedById.get(row.id);
        return { ...row, settled_at: settled?.settled_at ?? null, challenger_score: settled?.challenger_score ?? null,
          target_score: settled?.target_score ?? null, challenger_delta: settled?.challenger_delta ?? null, target_delta: settled?.target_delta ?? null };
      });
      const revealed = Boolean(ddl && Date.now() >= Date.parse(ddl));
      return response({ arena: { ...config, deadline: ddl, open: config.open && Boolean(ddl) && !revealed, ...(revealed ? { count: publicDuels.length, selectionReady } : {}) },
        duels: revealed ? await captainedDuels(env, publicDuels, members) : [], results: published, removedDuelIds, announcements: announcementRows.results, members }, request);
    }
    if (path === '/api/visits' && request.method === 'POST') {
      await limit(env, request, 'visits', 180, 60000);
      const input = await body(request);
      if (input.kind === 'pageview') return response({ ok: true }, request);
      if (input.kind !== 'identify') throw new ApiError(400, '登录类型无效');
      if (!idPattern.test(String(input.id))) throw new ApiError(400, '登录标识无效');
      const entryId = Number(input.entryId);
      if (!(await roster(env)).some(member => member.entryId === entryId)) return response({ ok: true }, request);
      await db.prepare('INSERT OR IGNORE INTO player_logins VALUES (?,?,?,?)').bind(input.id, entryId,
        /mobile|android|iphone/i.test(request.headers.get('user-agent') ?? '') ? '手机' : '电脑/其他', now).run();
      return response({ ok: true }, request);
    }
    if (path === '/api/player/session' && request.method === 'POST') {
      await limit(env, request, 'player-login', 60, 15 * 60000);
      const input = await body(request); const entryId = Number(input.entryId);
      if (!(await roster(env)).some(member => member.entryId === entryId)) throw new ApiError(403, '玩家不在当前联赛中');
      const token = await signSession(env.SESSION_SECRET, { role: 'player', entryId, exp: Date.now() + 12 * 3600000 });
      return response({ token, entryId }, request);
    }
    if (path === '/api/duels/mine' && request.method === 'GET') {
      const entryId = await playerSession(env, request); const config = await arenaWindow(env);
      const life = (await healthState(env)).player(entryId);
      const rows = await db.prepare('SELECT * FROM duels WHERE deleted_at IS NULL AND (challenger_id=? OR target_id=?) ORDER BY created_at DESC').bind(entryId, entryId).all<Duel>();
      const used = rows.results.filter(row => row.challenger_id === entryId && usesChallenge(row)).length;
      const submitted = rows.results.find(row => row.gw === config.gw && row.challenger_id === entryId);
      const target = submitted ? (await roster(env)).find(member => member.entryId === submitted.target_id) : null;
      return response({ entryId, arena: config, ...life, remaining: Math.max(0, 5 - used), gw: config.gw, selectionStatus: submitted?.selection_status ?? null,
        submitted: Boolean(submitted), challenge: submitted ? { targetId: submitted.target_id, targetName: target?.teamName ?? `ID ${submitted.target_id}` } : null }, request);
    }
    if (path === '/api/duels' && request.method === 'POST') {
      await limit(env, request, 'duel-submit', 20, 60000);
      const entryId = await playerSession(env, request); const input = await body(request);
      const config = await arenaWindow(env); const ddl = await deadline(env, config.gw);
      if (!ddl) throw new ApiError(409, '本轮 DDL 尚未就绪，请稍后再试');
      if (Date.now() >= Date.parse(ddl)) throw new ApiError(409, '本轮报名已截止');
      if (!config.open) throw new ApiError(409, '本轮报名尚未开放');
      const targetId = Number(input.targetId);
      if (Number(input.gw) !== config.gw) throw new ApiError(409, '比赛周已变化，请重新加载');
      const members = await roster(env);
      if (!members.some(member => member.entryId === targetId) || targetId === entryId) throw new ApiError(400, '挑战目标无效');
      const health = await healthState(env);
      if (health.player(entryId).eliminated) throw new ApiError(409, '你已淘汰，不能再参与挑战');
      if (health.player(targetId).eliminated) throw new ApiError(409, '该玩家已淘汰，请选择其他挑战对象');
      const id = crypto.randomUUID();
      if (!await submitDuel(db, config.gw, entryId, targetId, id, { deadline: ddl, health })) {
        const currentConfig = await arenaWindow(env);
        if (currentConfig.gw !== config.gw) throw new ApiError(409, '比赛周已变化，请重新加载');
        if (Date.now() >= Date.parse(ddl)) throw new ApiError(409, '本轮报名已截止');
        if (!currentConfig.open) throw new ApiError(409, '本轮报名尚未开放');
        // Diagnose only after the atomic insert rejects the request; these reads never authorize a write.
        const rows = await db.prepare('SELECT * FROM duels WHERE deleted_at IS NULL AND (gw=? OR challenger_id=?)').bind(config.gw, entryId).all<Duel>();
        const current = rows.results.filter(row => row.gw === config.gw);
        if (current.some(row => row.challenger_id === entryId)) throw new ApiError(409, '你本轮已提交挑战，不可重复报名');
        if (current.some(row => row.target_id === entryId)) throw new ApiError(409, '你已在本轮对阵中，不能再次发起挑战');
        if (current.some(row => row.challenger_id === targetId || row.target_id === targetId)) throw new ApiError(409, '该玩家已在本轮对阵中，请选择其他挑战对象');
        if (rows.results.filter(row => row.challenger_id === entryId && row.gw >= 9 && row.gw <= 20 && usesChallenge(row)).length >= 5) throw new ApiError(409, '你的五次主动挑战权已用完');
        throw new ApiError(409, '报名状态已变化，请重新选择后提交');
      }
      return response({ ok: true, id }, request, 201);
    }
    throw new ApiError(405, '请求方式不支持');
  } catch (error) {
    if (error instanceof ApiError) return response({ error: error.message }, request, error.status);
    console.error('Operations request failed', error instanceof Error ? error.name : 'unknown');
    return response({ error: '服务暂时不可用，请稍后再试' }, request, 503);
  }
}

export async function settleDuels(env: OpsEnv, snapshotOverride?: Snapshot): Promise<Duel[]> {
  if (!env.OPS_DB) return [];
  const rows = await env.OPS_DB.prepare('SELECT DISTINCT gw FROM duels WHERE deleted_at IS NULL AND gw BETWEEN 9 AND 20').all<{ gw: number }>();
  const results: Duel[] = [];
  for (const { gw } of rows.results) {
    if (snapshotOverride && snapshotOverride.gw !== gw) continue;
    const revision = await publicationRevision(env, gw);
    const snapshot = snapshotOverride ?? await publishedRound(env, gw);
    if (!snapshot?.finished || !snapshot.officialFinalized) continue;
    if (!await selectRound(env, gw)) continue;
    const committed = await commitRound(env, snapshot, revision);
    results.push(...committed.duelResults ?? []);
  }
  if (!snapshotOverride) await pruneOperations(env);
  return results;
}

export async function pruneOperations(env: OpsEnv): Promise<void> {
  if (!env.OPS_DB) return;
  await env.OPS_DB.batch([
    env.OPS_DB.prepare('DELETE FROM rate_limits WHERE expires_at<?').bind(Date.now() - 86400000),
    env.OPS_DB.prepare('DELETE FROM visits WHERE created_at<?').bind(new Date(Date.now() - 90 * 86400000).toISOString()),
    env.OPS_DB.prepare('DELETE FROM player_logins WHERE created_at<?').bind(new Date(Date.now() - 90 * 86400000).toISOString()),
  ]);
}

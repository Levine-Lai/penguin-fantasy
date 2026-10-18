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
type Arena = { gw: number; open: boolean };
type Session = { role: 'admin' | 'player'; exp: number; entryId?: number; codeHash?: string };
type Duel = { id: string; gw: number; challenger_id: number; target_id: number; created_at: string; deleted_at: string | null; settled_at: string | null; challenger_score: number | null; target_score: number | null; challenger_delta: number | null; target_delta: number | null };
type Snapshot = { gw: number; finished?: boolean; teams: Array<{ entryId: number; captainPoints: number; scoringCaptainName?: string; captainName: string | null }> };

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
async function arena(db: OpsDatabase): Promise<Arena> {
  const row = await db.prepare("SELECT value FROM settings WHERE key='arena'").first<{ value: string }>();
  return row ? JSON.parse(row.value) : { gw: 9, open: false };
}
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
  if (session?.role !== 'player' || !session.entryId) throw new ApiError(401, '请先验证玩家口令');
  const row = await env.OPS_DB!.prepare('SELECT code_hash FROM player_codes WHERE entry_id=?').bind(session.entryId).first<{ code_hash: string }>();
  if (!row || row.code_hash !== session.codeHash) throw new ApiError(401, '玩家口令已重置，请重新验证');
  return session.entryId;
}
async function audit(db: OpsDatabase, action: string, target: string, detail = ''): Promise<void> {
  await db.prepare('INSERT INTO audit_log VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), action, target, detail, new Date().toISOString()).run();
}
function namedDuels(rows: Duel[], members: Member[]) {
  const names = new Map(members.map(member => [member.entryId, member.teamName]));
  return rows.map(row => ({ ...row, challengerName: names.get(row.challenger_id) ?? `ID ${row.challenger_id}`, targetName: names.get(row.target_id) ?? `ID ${row.target_id}` }));
}
export async function submitDuel(db: OpsDatabase, gw: number, challengerId: number, targetId: number, id = crypto.randomUUID()): Promise<boolean> {
  const result = await db.prepare(`INSERT INTO duels(id,gw,challenger_id,target_id,created_at)
    SELECT ?,?,?,?,? WHERE ? != ?
    AND (SELECT COUNT(*) FROM duels WHERE gw=? AND deleted_at IS NULL)<5
    AND NOT EXISTS(SELECT 1 FROM duels WHERE gw=? AND deleted_at IS NULL AND
      (challenger_id IN (?,?) OR target_id IN (?,?)))
    AND (SELECT COUNT(*) FROM duels WHERE challenger_id=? AND gw BETWEEN 9 AND 20 AND deleted_at IS NULL
      AND (settled_at IS NULL OR challenger_score != target_score))<5`)
    .bind(id, gw, challengerId, targetId, new Date().toISOString(), challengerId, targetId, gw, gw,
      challengerId, targetId, challengerId, targetId, challengerId).run();
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
      if (path === '/api/admin/logout' && request.method === 'POST') return response({ ok: true }, request, 200, { 'set-cookie': `${cookieName}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0` });
      if (path === '/api/admin/overview' && request.method === 'GET') {
        const selectedDay = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('day') ?? '') ? url.searchParams.get('day')! : beijingDay();
        const start = new Date(`${selectedDay}T00:00:00+08:00`).toISOString();
        const end = new Date(Date.parse(start) + 86400000).toISOString();
        const page = Math.max(0, Math.min(10000, Number(url.searchParams.get('page')) || 0));
        const [members, config, duelRows, announcements, stats, total, activity, players, logs, codes] = await Promise.all([
          roster(env), arena(db),
          db.prepare('SELECT * FROM duels ORDER BY created_at DESC LIMIT 300').all<Duel>(),
          db.prepare('SELECT * FROM announcements ORDER BY created_at DESC LIMIT 100').all(),
          db.prepare(`SELECT SUM(kind='pageview') AS views, COUNT(DISTINCT CASE WHEN kind='pageview' THEN visitor_id END) AS visitors,
            COUNT(DISTINCT CASE WHEN kind='pageview' THEN session_id END) AS sessions,
            SUM(kind IN ('identify','verified_login')) AS logins FROM visits WHERE created_at>=? AND created_at<?`).bind(start, end).first(),
          db.prepare("SELECT COUNT(*) AS views FROM visits WHERE kind='pageview'").first(),
          db.prepare('SELECT * FROM visits WHERE created_at>=? AND created_at<? ORDER BY created_at DESC LIMIT 50 OFFSET ?').bind(start, end, page * 50).all(),
          db.prepare(`SELECT entry_id, MAX(created_at) AS lastSeen, COUNT(*) AS events,
            MAX(CASE WHEN kind='verified_login' THEN created_at END) AS lastVerified,
            MAX(CASE WHEN kind='identify' THEN created_at END) AS lastIdentified
            FROM visits WHERE entry_id IS NOT NULL AND created_at>=? AND created_at<? GROUP BY entry_id ORDER BY lastSeen DESC`).bind(start, end).all(),
          db.prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 50').all(),
          db.prepare('SELECT entry_id, updated_at FROM player_codes').all(),
        ]);
        return response({ day: selectedDay, page, stats, total, arena: { ...config, deadline: await deadline(env, config.gw) },
          members, duels: namedDuels(duelRows.results, members), announcements: announcements.results,
          activity: activity.results, players: players.results, logs: logs.results, codes: codes.results }, request);
      }
      if (path === '/api/admin/arena' && request.method === 'POST') {
        const input = await body(request); const gw = Number(input.gw);
        if (!Number.isInteger(gw) || gw < 9 || gw > 20 || typeof input.open !== 'boolean') throw new ApiError(400, '请选择 GW9–GW20');
        if (input.open && Date.now() >= Date.parse(await deadline(env, gw) ?? '1970-01-01')) throw new ApiError(400, '该轮 DDL 已过或时间未就绪');
        await db.batch([
          db.prepare("INSERT INTO settings VALUES ('arena',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify({ gw, open: input.open })),
          db.prepare('INSERT INTO audit_log VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), 'arena_settings', String(gw), JSON.stringify({ open: input.open }), now),
        ]);
        return response({ ok: true }, request);
      }
      if (path === '/api/admin/player-code' && request.method === 'POST') {
        const input = await body(request); const entryId = Number(input.entryId);
        if (!(await roster(env)).some(member => member.entryId === entryId)) throw new ApiError(400, '玩家不在当前联赛中');
        const code = b64(crypto.getRandomValues(new Uint8Array(15)));
        const codeHash = await mac(env.SESSION_SECRET, `player:${entryId}:${code}`);
        await db.batch([
          db.prepare('INSERT INTO player_codes VALUES (?,?,?) ON CONFLICT(entry_id) DO UPDATE SET code_hash=excluded.code_hash, updated_at=excluded.updated_at').bind(entryId, codeHash, now),
          db.prepare('INSERT INTO audit_log VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), 'reset_player_code', String(entryId), '', now),
        ]);
        return response({ entryId, code }, request);
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
      const config = await arena(db); const ddl = await deadline(env, config.gw);
      const [members, duelRows, announcementRows, results] = await Promise.all([
        roster(env), db.prepare('SELECT * FROM duels WHERE gw=? AND deleted_at IS NULL ORDER BY created_at').bind(config.gw).all<Duel>(),
        db.prepare('SELECT id,title,body,display_day FROM announcements WHERE display_day=? AND deleted_at IS NULL ORDER BY created_at DESC').bind(beijingDay()).all(),
        db.prepare('SELECT gw,challenger_id,target_id,challenger_delta,target_delta FROM duels WHERE deleted_at IS NULL AND settled_at IS NOT NULL').all(),
      ]);
      const revealed = Boolean(ddl && Date.now() >= Date.parse(ddl));
      return response({ arena: { ...config, deadline: ddl, open: config.open && Boolean(ddl) && !revealed, count: duelRows.results.length },
        duels: revealed ? namedDuels(duelRows.results, members) : [], results: results.results, announcements: announcementRows.results, members }, request);
    }
    if (path === '/api/visits' && request.method === 'POST') {
      await limit(env, request, 'visits', 180, 60000);
      const input = await body(request);
      if (!idPattern.test(String(input.id)) || !idPattern.test(String(input.visitorId)) || !idPattern.test(String(input.sessionId))) throw new ApiError(400, '访问标识无效');
      if (!['pageview', 'identify'].includes(String(input.kind))) throw new ApiError(400, '访问类型无效');
      const pathValue = text(input.path, 200);
      if (!pathValue.startsWith('/') || pathValue.startsWith('//') || /[?#\u0000-\u001f]/.test(pathValue)) throw new ApiError(400, '页面路径无效');
      const entryId = Number(input.entryId);
      const member = (await roster(env)).find(item => item.entryId === entryId);
      await db.prepare('INSERT OR IGNORE INTO visits VALUES (?,?,?,?,?,?,?,?)').bind(input.id, input.visitorId, input.sessionId, member?.entryId ?? null,
        input.kind, pathValue, /mobile|android|iphone/i.test(request.headers.get('user-agent') ?? '') ? '手机' : '电脑/其他', now).run();
      return response({ ok: true }, request);
    }
    if (path === '/api/player/session' && request.method === 'POST') {
      await limit(env, request, 'player-login', 12, 15 * 60000);
      const input = await body(request); const entryId = Number(input.entryId); const code = text(input.code, 80);
      const row = await db.prepare('SELECT code_hash FROM player_codes WHERE entry_id=?').bind(entryId).first<{ code_hash: string }>();
      if (!row || !same(row.code_hash, await mac(env.SESSION_SECRET, `player:${entryId}:${code}`))) throw new ApiError(401, 'FPL ID 或玩家口令不正确');
      if (!(await roster(env)).some(member => member.entryId === entryId)) throw new ApiError(403, '玩家不在当前联赛中');
      const token = await signSession(env.SESSION_SECRET, { role: 'player', entryId, codeHash: row.code_hash, exp: Date.now() + 12 * 3600000 });
      await db.prepare('INSERT INTO visits VALUES (?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(), idPattern.test(String(input.visitorId)) ? input.visitorId : crypto.randomUUID(),
        idPattern.test(String(input.sessionId)) ? input.sessionId : crypto.randomUUID(), entryId, 'verified_login', '/arena/', '验证登录', now).run();
      return response({ token, entryId }, request);
    }
    if (path === '/api/duels/mine' && request.method === 'GET') {
      const entryId = await playerSession(env, request); const config = await arena(db);
      const rows = await db.prepare('SELECT * FROM duels WHERE deleted_at IS NULL AND (challenger_id=? OR target_id=?) ORDER BY created_at DESC').bind(entryId, entryId).all<Duel>();
      const used = rows.results.filter(row => row.challenger_id === entryId && (row.settled_at === null || row.challenger_score !== row.target_score)).length;
      return response({ entryId, remaining: Math.max(0, 5 - used), gw: config.gw, duels: namedDuels(rows.results, await roster(env)) }, request);
    }
    if (path === '/api/duels' && request.method === 'POST') {
      await limit(env, request, 'duel-submit', 20, 60000);
      const entryId = await playerSession(env, request); const input = await body(request);
      const config = await arena(db); const ddl = await deadline(env, config.gw);
      if (!config.open || !ddl || Date.now() >= Date.parse(ddl)) throw new ApiError(409, '当前轮报名未开放或 DDL 已过');
      const targetId = Number(input.targetId);
      if (Number(input.gw) !== config.gw) throw new ApiError(409, '比赛周已变化，请重新加载');
      const members = await roster(env);
      if (!members.some(member => member.entryId === targetId) || targetId === entryId) throw new ApiError(400, '挑战目标无效');
      const id = crypto.randomUUID();
      if (!await submitDuel(db, config.gw, entryId, targetId, id)) throw new ApiError(409, '名额已满、双方已在本轮对阵中，或你的决斗权已用完');
      return response({ ok: true, id }, request, 201);
    }
    throw new ApiError(405, '请求方式不支持');
  } catch (error) {
    if (error instanceof ApiError) return response({ error: error.message }, request, error.status);
    console.error('Operations request failed', error instanceof Error ? error.name : 'unknown');
    return response({ error: '服务暂时不可用，请稍后再试' }, request, 503);
  }
}

export async function settleDuels(env: OpsEnv): Promise<void> {
  const db = env.OPS_DB; if (!db) return;
  const pending = await db.prepare('SELECT * FROM duels WHERE deleted_at IS NULL AND settled_at IS NULL LIMIT 100').all<Duel>();
  const groups = new Set(pending.results.map(row => row.gw));
  for (const gw of groups) {
    const snapshot = await env.FPL_CACHE.get<Snapshot>(`snapshot:gw:${gw}`, 'json');
    if (!snapshot?.finished) continue;
    const scores = new Map(snapshot.teams.map(team => [team.entryId, team.captainPoints]));
    const updates: OpsStatement[] = [];
    for (const duel of pending.results.filter(row => row.gw === gw)) {
      const left = scores.get(duel.challenger_id); const right = scores.get(duel.target_id);
      if (left === undefined || right === undefined) continue;
      const delta = Math.sign(left - right);
      updates.push(db.prepare(`UPDATE duels SET settled_at=?,challenger_score=?,target_score=?,challenger_delta=?,target_delta=?
        WHERE id=? AND settled_at IS NULL AND deleted_at IS NULL`).bind(new Date().toISOString(), left, right, delta, -delta, duel.id));
    }
    if (updates.length) await db.batch(updates);
  }
  await db.batch([
    db.prepare('DELETE FROM rate_limits WHERE expires_at<?').bind(Date.now() - 86400000),
    db.prepare('DELETE FROM visits WHERE created_at<?').bind(new Date(Date.now() - 90 * 86400000).toISOString()),
  ]);
}

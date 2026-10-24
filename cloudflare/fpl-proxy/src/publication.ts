import { selectRound } from './duel-rules.ts';
import type { Duel, OpsEnv, OpsStatement, Snapshot } from './operations.ts';

export class PublicationConflict extends Error {
  constructor(gw: number) { super(`GW${gw} publication changed while scores were being fetched`); }
}

export async function publicationRevision(env: OpsEnv, gw: number): Promise<number> {
  if (!env.OPS_DB) return 0;
  return (await env.OPS_DB.prepare('SELECT revision FROM published_rounds WHERE gw=?').bind(gw).first<{ revision: number }>())?.revision ?? 0;
}

export async function publishedHistory(env: OpsEnv): Promise<Snapshot[]> {
  const legacy = await env.FPL_CACHE.get<Snapshot[]>('snapshot:history', 'json') ?? [];
  if (!env.OPS_DB) return legacy;
  const rows = await env.OPS_DB.prepare('SELECT snapshot FROM published_rounds ORDER BY gw').all<{ snapshot: string }>();
  const merged = new Map(legacy.map(snapshot => [snapshot.gw, snapshot]));
  for (const row of rows.results) { const snapshot = JSON.parse(row.snapshot) as Snapshot; merged.set(snapshot.gw, snapshot); }
  return [...merged.values()].sort((a, b) => a.gw - b.gw);
}

export async function publishedRound(env: OpsEnv, gw: number): Promise<Snapshot | null> {
  const row = env.OPS_DB ? await env.OPS_DB.prepare('SELECT snapshot FROM published_rounds WHERE gw=?').bind(gw).first<{ snapshot: string }>() : null;
  return row ? JSON.parse(row.snapshot) as Snapshot : env.FPL_CACHE.get<Snapshot>(`snapshot:gw:${gw}`, 'json');
}

// One D1 transaction commits frozen scores, matching outcomes, and the rights derived from them.
export async function commitRound(env: OpsEnv, snapshot: Snapshot, expectedRevision: number): Promise<Snapshot> {
  const db = env.OPS_DB;
  if (!db) return { ...snapshot, duelResults: [] };
  await selectRound(env, snapshot.gw);
  const rows = await db.prepare("SELECT * FROM duels WHERE gw=? AND deleted_at IS NULL AND selection_status='selected' ORDER BY created_at,rowid").bind(snapshot.gw).all<Duel>();
  const scores = new Map(snapshot.teams.map(team => [team.entryId, team.captainPoints]));
  const statements: OpsStatement[] = [];
  const results: Duel[] = [];
  const revisionGuard = 'COALESCE((SELECT revision FROM published_rounds WHERE gw=?),0)=?';
  const now = new Date().toISOString();
  for (const row of rows.results) {
    if (snapshot.gw < 9 || snapshot.gw > 20 || !snapshot.finished || !snapshot.officialFinalized) continue;
    const left = scores.get(row.challenger_id), right = scores.get(row.target_id);
    if (left === undefined || right === undefined) continue;
    const delta = Math.sign(left - right);
    const changed = row.challenger_score !== left || row.target_score !== right || row.challenger_delta !== delta || row.target_delta !== -delta || !row.settled_at;
    const settled = { ...row, settled_at: changed ? now : row.settled_at, challenger_score: left, target_score: right, challenger_delta: delta, target_delta: -delta };
    results.push(settled);
    if (!changed) continue;
    if (row.settled_at) statements.push(db.prepare(`INSERT INTO audit_log(id,action,target,detail,created_at)
      SELECT ?,'correct_duel',?,?,? WHERE ${revisionGuard} AND EXISTS(SELECT 1 FROM duels WHERE id=? AND deleted_at IS NULL)`)
      .bind(crypto.randomUUID(), row.id, JSON.stringify({ before: [row.challenger_score, row.target_score], after: [left, right] }), now, snapshot.gw, expectedRevision, row.id));
    statements.push(db.prepare(`UPDATE duels SET settled_at=?,challenger_score=?,target_score=?,challenger_delta=?,target_delta=?
      WHERE id=? AND deleted_at IS NULL AND ${revisionGuard}`)
      .bind(settled.settled_at, left, right, delta, -delta, row.id, snapshot.gw, expectedRevision));
  }
  const published = { ...snapshot, duelResults: results, publicationRevision: expectedRevision + 1 };
  statements.push(db.prepare(`INSERT INTO published_rounds(gw,revision,snapshot,published_at)
    SELECT ?,?,?,? WHERE ${revisionGuard}
    ON CONFLICT(gw) DO UPDATE SET revision=excluded.revision,snapshot=excluded.snapshot,published_at=excluded.published_at`)
    .bind(snapshot.gw, expectedRevision + 1, JSON.stringify(published), now, snapshot.gw, expectedRevision));
  const committed = await db.batch(statements);
  if ((committed.at(-1) as { meta?: { changes?: number } })?.meta?.changes !== 1) throw new PublicationConflict(snapshot.gw);
  // Never re-read mutable duel scores here: these results came from exactly the committed input.
  return published;
}

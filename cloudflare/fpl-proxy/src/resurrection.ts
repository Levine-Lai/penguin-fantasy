import type { OpsEnv, Snapshot } from './operations.ts';
import { resurrectionClosesAt, resurrectionGw, resurrectionOpensAt,
  type ResurrectionRegistration, type ResurrectionResult, type ResurrectionSide } from '../../../shared/resurrection.ts';

export const resurrectionLockSql = `NOT EXISTS (
  SELECT 1 FROM resurrection_registrations WHERE entry_id IN (?,?)
  AND selection_status IN ('pending','selected')
)`;

export async function selectResurrection(env: OpsEnv, now = Date.now()): Promise<ResurrectionResult | null> {
  if (!env.OPS_DB) return null;
  const db = env.OPS_DB;
  const saved = await db.prepare('SELECT selection FROM resurrection_round WHERE gw=12').first<{ selection: string }>();
  if (saved) return JSON.parse(saved.selection) as ResurrectionResult;
  if (now < Date.parse(resurrectionClosesAt)) return null;
  // Registration is closed before selection. The transaction freezes both rosters once.
  await db.batch([
    db.prepare(`WITH counts AS (
      SELECT MIN(8, SUM(side='abyss'), SUM(side='ice')) AS size FROM resurrection_registrations
    ), ranked AS (
      SELECT entry_id, ROW_NUMBER() OVER (PARTITION BY side ORDER BY created_at,id) AS position
      FROM resurrection_registrations
    ) UPDATE resurrection_registrations SET selection_status=CASE
      WHEN (SELECT size FROM counts)<5 THEN 'cancelled'
      WHEN (SELECT position FROM ranked WHERE ranked.entry_id=resurrection_registrations.entry_id)
        <=(SELECT size FROM counts) THEN 'selected' ELSE 'overflow' END
    WHERE NOT EXISTS(SELECT 1 FROM resurrection_round WHERE gw=12)`),
    db.prepare(`INSERT OR IGNORE INTO resurrection_round(gw,selection,selected_at)
      SELECT 12,json_object('gw',12,
        'status',CASE WHEN (SELECT COUNT(*) FROM resurrection_registrations WHERE selection_status='selected')>=10
          THEN 'selected' ELSE 'cancelled' END,
        'abyss',json((SELECT json_group_array(entry_id) FROM
          (SELECT entry_id FROM resurrection_registrations WHERE side='abyss' AND selection_status='selected' ORDER BY created_at,id))),
        'ice',json((SELECT json_group_array(entry_id) FROM
          (SELECT entry_id FROM resurrection_registrations WHERE side='ice' AND selection_status='selected' ORDER BY created_at,id))),
        'abyssScore',NULL,'iceScore',NULL),?`).bind(new Date(now).toISOString()),
  ]);
  const result = await db.prepare('SELECT selection FROM resurrection_round WHERE gw=12').first<{ selection: string }>();
  return result ? JSON.parse(result.selection) as ResurrectionResult : null;
}

export async function registerResurrection(env: OpsEnv, entryId: number, side: ResurrectionSide,
  healthRevision: number, removedCount: number, now = Date.now()): Promise<boolean> {
  const result = await env.OPS_DB!.prepare(`INSERT INTO resurrection_registrations(entry_id,side,created_at)
    SELECT ?,?,? WHERE julianday(?)>=julianday(?) AND julianday(?)<julianday(?)
    AND NOT EXISTS(SELECT 1 FROM resurrection_round WHERE gw=12)
    AND NOT EXISTS(SELECT 1 FROM resurrection_registrations WHERE entry_id=?)
    AND NOT EXISTS(SELECT 1 FROM duels WHERE gw=12 AND deleted_at IS NULL AND (challenger_id=? OR target_id=?))
    AND (SELECT COALESCE(SUM(revision),0) FROM published_rounds)=?
    AND (SELECT COUNT(*) FROM duels WHERE deleted_at IS NOT NULL)=?`)
    .bind(entryId, side, new Date(now).toISOString(), new Date(now).toISOString(), resurrectionOpensAt,
      new Date(now).toISOString(), resurrectionClosesAt, entryId, entryId, entryId, healthRevision, removedCount).run();
  return result.meta.changes === 1;
}

export async function resurrectionState(env: OpsEnv, entryId?: number, now = Date.now(), admin = false) {
  const selection = await selectResurrection(env, now);
  const rows = env.OPS_DB ? (await env.OPS_DB.prepare('SELECT * FROM resurrection_registrations ORDER BY created_at,id')
    .all<ResurrectionRegistration>()).results : [];
  return { gw: resurrectionGw, opensAt: resurrectionOpensAt, closesAt: resurrectionClosesAt,
    open: now >= Date.parse(resurrectionOpensAt) && now < Date.parse(resurrectionClosesAt),
    counts: { abyss: rows.filter(row => row.side === 'abyss').length, ice: rows.filter(row => row.side === 'ice').length },
    selection, registrations: selection || admin ? rows : [], mine: rows.find(row => row.entry_id === entryId) ?? null };
}

export function settleResurrection(selection: ResurrectionResult | null, snapshot: Snapshot): ResurrectionResult | undefined {
  if (!selection || snapshot.gw !== resurrectionGw) return undefined;
  if (selection.status === 'cancelled' || !snapshot.finished || !snapshot.officialFinalized) return selection;
  const scores = new Map(snapshot.teams.map(team => [team.entryId, team.captainPoints]));
  if (![...selection.abyss, ...selection.ice].every(id => scores.has(id))) throw new Error('复生挑战队长数据尚未齐全');
  const sum = (ids: number[]) => ids.reduce((total, id) => total + scores.get(id)!, 0);
  const abyssScore = sum(selection.abyss), iceScore = sum(selection.ice);
  return { ...selection, abyssScore, iceScore, status: abyssScore > iceScore ? 'success' : 'failed' };
}

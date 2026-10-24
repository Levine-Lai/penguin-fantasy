import type { OpsEnv } from './operations.ts';

export type ArenaWindow = { gw: number; open: boolean; deadline?: string; opensAt?: string; nextOpensAt?: string };
type Events = { value: { events: Array<{ id: number; deadline_time: string }> } };
export async function arenaWindow(env: OpsEnv, now = Date.now()): Promise<ArenaWindow> {
  const cached = await env.FPL_CACHE.get<Events>('fpl:bootstrap', 'json');
  const events = (cached?.value.events ?? []).filter(e => e.id >= 9 && e.id <= 20 && Number.isFinite(Date.parse(e.deadline_time)))
    .sort((a, b) => Date.parse(a.deadline_time) - Date.parse(b.deadline_time));
  const next = events.find(e => now < Date.parse(e.deadline_time));
  const previous = events.filter(e => now >= Date.parse(e.deadline_time)).at(-1);
  const event = next && now >= Date.parse(next.deadline_time) - 12 * 3600000 ? next : previous ?? next;
  if (!event) return { gw: 9, open: false };
  const opensAt = new Date(Date.parse(event.deadline_time) - 12 * 3600000).toISOString();
  return { gw: event.id, deadline: event.deadline_time, opensAt,
    nextOpensAt: next ? new Date(Date.parse(next.deadline_time) - 12 * 3600000).toISOString() : undefined,
    open: now >= Date.parse(opensAt) && now < Date.parse(event.deadline_time) };
}

// Pending/selected non-draw challenges reserve a season right; skipped registrations never do.
export const usedChallengeSql = "selection_status IN ('pending','selected') AND (settled_at IS NULL OR challenger_score != target_score)";
export function usesChallenge(row: { selection_status: string; settled_at: string | null; challenger_score: number | null; target_score: number | null }): boolean {
  return ['pending', 'selected'].includes(row.selection_status) && (row.settled_at === null || row.challenger_score !== row.target_score);
}

export async function selectRound(env: OpsEnv, gw: number, now = Date.now()): Promise<boolean> {
  const db = env.OPS_DB;
  if (!db || gw < 9 || gw > 20) return false;
  if (await db.prepare('SELECT gw FROM duel_selections WHERE gw=?').bind(gw).first()) return true;
  const bootstrap = await env.FPL_CACHE.get<Events>('fpl:bootstrap', 'json');
  const deadline = bootstrap?.value.events.find(e => e.id === gw)?.deadline_time;
  if (!deadline || now < Date.parse(deadline)) return false;
  const picks = await env.FPL_CACHE.get<{ checkedEntryIds: number[]; picksByEntry: Record<string, { captainId: number } | null> }>(`picks:gw:${gw}`, 'json');
  if (!picks) return false;
  const rows = await db.prepare('SELECT challenger_id,target_id FROM duels WHERE gw=? AND deleted_at IS NULL').bind(gw).all<{ challenger_id: number; target_id: number }>();
  const checked = new Set(picks.checkedEntryIds);
  if (!rows.results.every(row => checked.has(row.challenger_id) && checked.has(row.target_id))) return false;
  // Selection and the one-time marker share a transaction. SQL ranks the current active rows,
  // so concurrent deletions cannot consume slots and concurrent selection cannot change the result.
  await db.batch([
    db.prepare(`WITH captains AS (
      SELECT id,created_at,rowid AS arrival,
        json_extract(?, '$."' || challenger_id || '".captainId') AS left_id,
        json_extract(?, '$."' || target_id || '".captainId') AS right_id
      FROM duels WHERE gw=? AND deleted_at IS NULL
    ), ranked AS (
      SELECT *,SUM(CASE WHEN left_id IS NOT NULL AND right_id IS NOT NULL AND left_id != right_id THEN 1 ELSE 0 END)
        OVER (ORDER BY created_at,arrival) AS position FROM captains
    ) UPDATE duels SET selection_status=(SELECT CASE
      WHEN left_id IS NULL OR right_id IS NULL THEN 'missing_captain'
      WHEN left_id=right_id THEN 'same_captain'
      WHEN position<=5 THEN 'selected' ELSE 'overflow' END FROM ranked WHERE ranked.id=duels.id)
    WHERE gw=? AND deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM duel_selections WHERE gw=?)`)
      .bind(JSON.stringify(picks.picksByEntry), JSON.stringify(picks.picksByEntry), gw, gw, gw),
    db.prepare('INSERT OR IGNORE INTO duel_selections(gw,selected_at) VALUES (?,?)').bind(gw, new Date(now).toISOString()),
  ]);
  return true;
}

export async function selectDueRounds(env: OpsEnv, now = Date.now()): Promise<void> {
  if (!env.OPS_DB) return;
  const rows = await env.OPS_DB.prepare(`SELECT DISTINCT gw FROM duels WHERE deleted_at IS NULL AND gw BETWEEN 9 AND 20
    AND NOT EXISTS(SELECT 1 FROM duel_selections WHERE duel_selections.gw=duels.gw)`).all<{ gw: number }>();
  for (const { gw } of rows.results) await selectRound(env, gw, now);
}

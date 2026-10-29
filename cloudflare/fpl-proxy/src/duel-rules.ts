import type { OpsEnv } from './operations.ts';

export type ArenaWindow = { gw: number; open: boolean; deadline?: string; opensAt?: string; closesAt?: string; nextOpensAt?: string };
type Events = { value: { events: Array<{ id: number; deadline_time: string }> } };
export async function arenaWindow(env: OpsEnv, now = Date.now()): Promise<ArenaWindow> {
  const cached = await env.FPL_CACHE.get<Events>('fpl:bootstrap', 'json');
  const events = (cached?.value.events ?? []).filter(e => e.id >= 9 && e.id <= 20 && Number.isFinite(Date.parse(e.deadline_time)))
    .sort((a, b) => Date.parse(a.deadline_time) - Date.parse(b.deadline_time));
  const next = events.find(e => now < Date.parse(e.deadline_time));
  const previous = events.filter(e => now >= Date.parse(e.deadline_time)).at(-1);
  const manualSetting = await env.OPS_DB?.prepare("SELECT value FROM settings WHERE key='arena_test_open'").first<{ value: string }>();
  if (manualSetting && next) {
    try {
      const manual = JSON.parse(manualSetting.value) as { gw: number; open: boolean };
      if (manual.open === true && manual.gw === next.id) return { gw: next.id, deadline: next.deadline_time, open: true };
    } catch { /* Invalid overrides cannot open a round. */ }
  }
  // An operator can grant a bounded test window without changing the official DDL.
  const setting = await env.OPS_DB?.prepare("SELECT value FROM settings WHERE key='arena_test_window'").first<{ value: string }>();
  if (setting && next) {
    try {
      const test = JSON.parse(setting.value) as { gw: number; opensAt: string; closesAt: string };
      const start = Date.parse(test.opensAt); const end = Date.parse(test.closesAt);
      if (test.gw === next.id && end > start && end - start <= 24 * 3600000 && now >= start && now < end && now < Date.parse(next.deadline_time)) {
        return { gw: next.id, deadline: next.deadline_time, open: true, opensAt: test.opensAt,
          closesAt: new Date(Math.min(end, Date.parse(next.deadline_time))).toISOString() };
      }
    } catch { /* Invalid settings leave the automatic schedule in control. */ }
  }
  const event = next && now >= Date.parse(next.deadline_time) - 12 * 3600000 ? next : previous ?? next;
  if (!event) return { gw: 9, open: false };
  const opensAt = new Date(Date.parse(event.deadline_time) - 12 * 3600000).toISOString();
  return { gw: event.id, deadline: event.deadline_time, opensAt,
    nextOpensAt: next ? new Date(Date.parse(next.deadline_time) - 12 * 3600000).toISOString() : undefined,
    open: now >= Date.parse(opensAt) && now < Date.parse(event.deadline_time) };
}

// A selected duel consumes a right even on equal scores. Skipped registrations never do.
export const usedChallengeSql = "selection_status IN ('pending','selected')";
export function usesChallenge(row: { selection_status: string; settled_at: string | null; challenger_score: number | null; target_score: number | null }): boolean {
  return ['pending', 'selected'].includes(row.selection_status);
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

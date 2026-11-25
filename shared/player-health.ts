import { resurrectionLife, type ResurrectionResult } from './resurrection.ts';

export type HealthRound = {
  gw: number; finished?: boolean; officialFinalized?: boolean;
  teams: Array<{ entryId: number; captainPoints: number; captainName?: string | null; captainPickRate?: number | null }>;
  duelResults?: Array<{ id: string; challenger_id: number; target_id: number; challenger_delta: number | null; target_delta: number | null; settled_at: string | null }>;
  resurrection?: ResurrectionResult;
};

// Apply each round atomically. Only a finalized GW12 resurrection can revive
// an eliminated player. Corrections/deletions re-derive the whole history.
export function playerHealth(history: HealthRound[], entryId: number, removed: ReadonlySet<string> = new Set()) {
  let hp = 1;
  let eliminatedGw: number | null = null;
  for (const round of [...history].sort((a, b) => a.gw - b.gw)) {
    if (round.gw >= 9 && (!round.finished || !round.officialFinalized)) continue;
    const special = round.gw === 12 ? resurrectionLife(round.resurrection, entryId) : null;
    if (special !== null) {
      if (round.resurrection!.abyss.includes(entryId)) {
        hp = special;
        eliminatedGw = hp > 0 ? null : eliminatedGw ?? round.gw;
      } else if (hp > 0) {
        hp = Math.max(0, hp + special);
        if (hp === 0) eliminatedGw = round.gw;
      }
      continue;
    }
    if (hp === 0) continue;
    const team = round.teams.find(item => item.entryId === entryId);
    if (!team || team.captainName === null) continue;
    const regular = round.gw <= 8
      ? team.captainPoints >= 10 ? (team.captainPickRate != null && team.captainPickRate < 10 ? 2 : 1) : 0
      : round.gw <= 34 ? team.captainPoints >= 10 ? 1 : team.captainPoints <= 3 ? -1 : 0 : 0;
    const duel = round.duelResults?.find(row => row.settled_at && !removed.has(row.id) && (row.challenger_id === entryId || row.target_id === entryId));
    const delta = duel ? (duel.challenger_id === entryId ? duel.challenger_delta : duel.target_delta) ?? 0 : 0;
    hp = Math.max(0, hp + regular + delta);
    if (round.gw >= 9 && hp === 0) eliminatedGw = round.gw;
  }
  return { hp, eliminated: hp === 0, eliminatedGw };
}

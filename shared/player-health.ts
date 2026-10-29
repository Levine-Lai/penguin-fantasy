export type HealthRound = {
  gw: number; finished?: boolean; officialFinalized?: boolean;
  teams: Array<{ entryId: number; captainPoints: number; captainName?: string | null; captainPickRate?: number | null }>;
  duelResults?: Array<{ id: string; challenger_id: number; target_id: number; challenger_delta: number | null; target_delta: number | null; settled_at: string | null }>;
};

// Apply a round's regular and duel changes together. Once eliminated, later
// rounds cannot revive a player. Corrections/deletions re-derive the whole history.
export function playerHealth(history: HealthRound[], entryId: number, removed: ReadonlySet<string> = new Set()) {
  let hp = 1;
  for (const round of [...history].sort((a, b) => a.gw - b.gw)) {
    if (round.gw >= 9 && (!round.finished || !round.officialFinalized)) continue;
    const team = round.teams.find(item => item.entryId === entryId);
    if (!team || team.captainName === null) continue;
    const regular = round.gw <= 8
      ? team.captainPoints >= 10 ? (team.captainPickRate != null && team.captainPickRate < 10 ? 2 : 1) : 0
      : round.gw <= 34 ? team.captainPoints >= 10 ? 1 : team.captainPoints <= 3 ? -1 : 0 : 0;
    const duel = round.duelResults?.find(row => row.settled_at && !removed.has(row.id) && (row.challenger_id === entryId || row.target_id === entryId));
    const delta = duel ? (duel.challenger_id === entryId ? duel.challenger_delta : duel.target_delta) ?? 0 : 0;
    hp = Math.max(0, hp + regular + delta);
    if (round.gw >= 9 && hp === 0) return { hp: 0, eliminated: true, eliminatedGw: round.gw };
  }
  return { hp, eliminated: false, eliminatedGw: null };
}

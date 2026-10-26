import { fallbackGwDeadlines, type GwDeadline } from './current-trial.ts';

export type StageId = 1 | 2 | 3 | 4 | 5;

// Open the next chapter at the final DDL of the preceding chapter,
// including the preparation window before its first scoring gameweek.
export function currentStageAt(now: number, deadlines: GwDeadline[] = fallbackGwDeadlines): StageId {
  const transitions: Array<[number, StageId]> = [[8, 2], [20, 3], [30, 4], [34, 5]];
  return transitions.reduce<StageId>((stage, [gw, next]) => {
    const event = deadlines.find((candidate) => candidate.gw === gw)
      ?? fallbackGwDeadlines.find((candidate) => candidate.gw === gw);
    const deadline = Date.parse(event?.deadlineTime ?? '');
    return Number.isFinite(deadline) && deadline <= now ? next : stage;
  }, 1);
}

export const resurrectionGw = 12;
export const resurrectionOpensAt = '2026-11-26T04:00:00.000Z';
export const resurrectionClosesAt = '2026-11-27T04:00:00.000Z';
export type ResurrectionSide = 'abyss' | 'ice';
export type ResurrectionRegistration = {
  entry_id: number; side: ResurrectionSide; created_at: string;
  selection_status: 'pending' | 'selected' | 'overflow' | 'cancelled';
};
export type ResurrectionResult = {
  gw: 12; status: 'selected' | 'cancelled' | 'success' | 'failed';
  abyss: number[]; ice: number[];
  abyssScore: number | null; iceScore: number | null;
};

export function resurrectionLife(result: ResurrectionResult | undefined, entryId: number): number | null {
  if (!result || (result.status !== 'success' && result.status !== 'failed')) return null;
  if (result.abyss.includes(entryId)) return result.status === 'success' ? 1 : 0;
  if (result.ice.includes(entryId)) return result.status === 'success' ? -1 : 1;
  return null;
}

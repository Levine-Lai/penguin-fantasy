export type DuelSelection = 'pending' | 'selected' | 'same_captain' | 'overflow' | 'missing_captain';
export const duelSelectionLabels: Record<DuelSelection, string> = { pending: '等待队长确认', selected: '已入选', same_captain: '同队长，本轮不计并返还次数', overflow: '未入选前 5 组，不扣次数', missing_captain: '队长数据不可用，不扣次数' };
export const operationsOrigin = 'https://penguin-fantasy.pages.dev';
export type ArenaConfig = { gw: number; open: boolean; count?: number; deadline?: string; opensAt?: string; closesAt?: string; nextOpensAt?: string; selectionReady?: boolean };
export type Announcement = { id: string; title: string; body: string; display_day: string; deleted_at?: string | null };
export type DuelRecord = {
  id: string; gw: number; challenger_id: number; target_id: number; challengerName: string; targetName: string;
  selection_status?: DuelSelection; created_at: string; deleted_at: string | null; delete_reason?: string; settled_at: string | null;
  challenger_score: number | null; target_score: number | null; challenger_delta: number | null; target_delta: number | null;
};
export type Community = {
  arena: ArenaConfig; announcements: Announcement[]; duels: DuelRecord[];
  members: Array<{ entryId: number; teamName: string }>;
  results: Array<{ gw: number; challenger_id: number; target_id: number; challenger_delta: number; target_delta: number }>;
  removedDuelIds?: string[];
};
export type PublishedDuel = Omit<DuelRecord, 'challengerName' | 'targetName'>;
export async function operationsFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('content-type', 'application/json');
  const attempts = (init.method ?? 'GET').toUpperCase() === 'GET' && !init.signal ? 2 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const result = await fetch(`${operationsOrigin}/api${path}`, { ...init, headers, credentials: 'include', signal: init.signal ?? AbortSignal.timeout(20000) });
      if (!result.ok) {
        const data = await result.json().catch(() => ({}));
        const error = new Error(data.error ?? '服务暂时不可用，请稍后重试');
        Object.assign(error, { status: result.status }); throw error;
      }
      return await result.json() as T;
    } catch (reason) {
      const error = reason as Error & { status?: number };
      const timedOut = error.name === 'TimeoutError' || /timed?\s*out|timeout|aborted/i.test(error.message ?? '');
      if (attempt + 1 < attempts && (timedOut || error instanceof TypeError || (error.status ?? 0) >= 500)) {
        await new Promise(resolve => setTimeout(resolve, 350)); continue;
      }
      if (timedOut && !init.signal?.aborted) throw Object.assign(new Error('请求超时，请稍后重试'), { name: 'TimeoutError' });
      throw reason;
    }
  }
  throw new Error('请求失败，请稍后重试');
}
let communityRequest: Promise<Community> | null = null;
export function loadCommunity(): Promise<Community> {
  if (!communityRequest) {
    communityRequest = operationsFetch<Community>('/community').then(data => {
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('penguin-community-updated', { detail: data }));
      return data;
    }).finally(() => { communityRequest = null; });
  }
  return communityRequest;
}
export function visitorIdentity(): { visitorId: string; sessionId: string } {
  const read = (storage: Storage, key: string) => {
    let value = storage.getItem(key);
    if (!value || !/^[\w-]{16,80}$/.test(value)) { value = crypto.randomUUID(); storage.setItem(key, value); }
    return value;
  };
  try { return { visitorId: read(localStorage, 'penguin:visitor:v1'), sessionId: read(sessionStorage, 'penguin:session:v1') }; }
  catch { return { visitorId: crypto.randomUUID(), sessionId: crypto.randomUUID() }; }
}
export function chinaTime(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '—';
}
export function recordPlayerLogin(entryId: number): void {
  void operationsFetch('/visits', { method: 'POST', body: JSON.stringify({ id: crypto.randomUUID(), entryId, kind: 'identify' }) }).catch(() => {});
}

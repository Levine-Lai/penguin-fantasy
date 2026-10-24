import { operationsFetch, type DuelSelection } from '../operations-client.ts';

export type Mine = { entryId: number; remaining: number; selectionStatus?: DuelSelection | null; gw: number; submitted: boolean; challenge: { targetId: number; targetName: string } | null };
export type PlayerSession = { entryId: number; token: string; mine: Mine };
export type Challenge = { gw: number; targetId: number; targetName: string };

export class UncertainSubmission extends Error {
  constructor() { super('提交结果暂未确认，正在核对报名状态，请勿重复提交。'); }
}

export function createDuelClient(entryId: number) {
  let token = '';
  let renewal: Promise<void> | null = null;
  let reading: Promise<PlayerSession> | null = null;
  let revision = 0;
  let accepted: PlayerSession | null = null;
  const renew = () => {
    if (!renewal) renewal = operationsFetch<{ token: string }>('/player/session', {
      method: 'POST', body: JSON.stringify({ entryId }),
    }).then(result => { token = result.token; }).finally(() => { renewal = null; });
    return renewal;
  };
  const read = (): Promise<PlayerSession> => {
    if (!reading) reading = (async () => {
      const startedAtRevision = revision;
      if (!token) await renew();
      let mine: Mine;
      try { mine = await operationsFetch<Mine>('/duels/mine', { headers: { authorization: `Bearer ${token}` } }); }
      catch (reason) {
        if ((reason as { status?: number }).status !== 401) throw reason;
        await renew();
        mine = await operationsFetch<Mine>('/duels/mine', { headers: { authorization: `Bearer ${token}` } });
      }
      if (startedAtRevision < revision && accepted) return { ...accepted, token };
      return { entryId, token, mine };
    })().finally(() => { reading = null; });
    return reading;
  };
  const validate = (session: PlayerSession, challenge: Challenge) => {
    if (session.mine.gw !== challenge.gw) throw new Error('比赛周已变化，请重新选择');
    if (!session.mine.submitted && session.mine.remaining <= 0) throw new Error('你的五次主动挑战权已用完');
  };
  return {
    read,
    async submit(challenge: Challenge): Promise<PlayerSession> {
      let own = await read();
      validate(own, challenge);
      if (own.mine.submitted) return own;
      const post = () => operationsFetch('/duels', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ targetId: challenge.targetId, gw: challenge.gw }) });
      try {
        try { await post(); }
        catch (reason) {
          if ((reason as { status?: number }).status !== 401) throw reason;
          // A 401 did not write a duel. Renew, recheck status, then retry only once.
          await renew(); own = await read(); validate(own, challenge);
          if (own.mine.submitted) return own;
          await post();
        }
      } catch (reason) {
        const status = (reason as { status?: number }).status;
        if (status && status < 500) throw reason;
        // An interrupted POST may have committed; never replay it automatically.
        try {
          const checked = await read();
          if (checked.mine.gw === challenge.gw && checked.mine.submitted) return checked;
        } catch { /* Keep the outcome unknown until a later successful status read. */ }
        throw new UncertainSubmission();
      }
      // A confirmed POST remains successful even if the following GET is unavailable.
      accepted = { entryId, token, mine: { ...own.mine, submitted: true, remaining: Math.max(0, own.mine.remaining - 1), challenge: { targetId: challenge.targetId, targetName: challenge.targetName } } };
      revision += 1;
      return accepted;
    },
  };
}

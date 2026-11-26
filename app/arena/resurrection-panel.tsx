'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { chinaTime, loadCommunity, operationsFetch, type Community, type ResurrectionState } from '../operations-client';
import type { createDuelClient } from './duel-client';
import type { DuelPlayer } from './live-arena';
import { resurrectionClosesAt, resurrectionOpensAt } from '../../shared/resurrection';
import heading from '../components/section-heading.module.css';
import frame from '../test/arena.module.css';
import arena from './live-arena.module.css';
import styles from './resurrection-panel.module.css';

type OwnStatus = ResurrectionState & { entryId: number; eliminated: boolean; ordinaryDuel: boolean };
type Props = {
  player: DuelPlayer | null; players: DuelPlayer[]; community: Community | null;
  client: ReturnType<typeof createDuelClient> | null; onRegistered: () => Promise<void>; assets: CSSProperties;
};
const selectionLabels = { pending: '已报名，等待入选', selected: '已入选', overflow: '未入选，人数超额', cancelled: '人数不足，挑战取消' };

export default function ResurrectionPanel({ player, players, community, client, onRegistered, assets }: Props) {
  const [own, setOwn] = useState<OwnStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const [liveRoster, setLiveRoster] = useState<ResurrectionState | null>(null);
  const confirmDialog = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const identity = player?.entryId;
  const identityRef = useRef(identity);
  useEffect(() => { identityRef.current = identity; }, [identity]);
  const readOwn = useCallback(async () => {
    if (!client) return null;
    const session = await client.read();
    const status = await operationsFetch<OwnStatus>('/resurrection/mine', { headers: { authorization: `Bearer ${session.token}` } });
    if (status.entryId === identityRef.current) { setOwn(status); setUncertain(false); }
    return status;
  }, [client]);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      setOwn(null); setError(''); setUncertain(false);
      void readOwn().catch(() => { if (active) setError('报名状态读取失败，请重试'); });
    });
    return () => { active = false; };
  }, [readOwn]);
  useEffect(() => {
    const next = [resurrectionOpensAt, resurrectionClosesAt].map(Date.parse).find(time => time > Date.now());
    if (!next) return;
    const timer = window.setTimeout(() => {
      setClock(Date.now());
      void Promise.all([loadCommunity(), readOwn()]).catch(() => {});
    }, next - Date.now() + 1000);
    return () => window.clearTimeout(timer);
  }, [clock, readOwn]);
  const status = own?.entryId === identity ? own : null;
  const state = liveRoster ?? community?.resurrection ?? status;
  const selection = community?.resurrection?.result ?? state?.selection;
  const open = clock >= Date.parse(resurrectionOpensAt) && clock < Date.parse(resurrectionClosesAt);
  const side = status?.eliminated ? 'abyss' : 'ice';
  const teamName = side === 'abyss' ? '深渊组' : '冰海组';
  const registered = state?.registrations.find(item => item.entry_id === identity) ?? status?.mine;
  const names = new Map(community?.members.map(item => [item.entryId, item.teamName]));
  for (const item of players) names.set(item.entryId, item.name);
  const refreshRoster = useCallback(async (signal?: AbortSignal) => {
    const latest = await operationsFetch<ResurrectionState>('/resurrection', { signal: signal ?? AbortSignal.timeout(10000) });
    if (!signal?.aborted) setLiveRoster(latest);
  }, []);
  useEffect(() => {
    if (clock < Date.parse(resurrectionOpensAt)) return;
    let active = true;
    let timer: number | undefined;
    const controller = new AbortController();
    const refresh = async () => {
      if (document.visibilityState === 'visible') {
        await refreshRoster(AbortSignal.any([controller.signal, AbortSignal.timeout(10000)])).catch(() => {});
      }
      if (active && Date.now() < Date.parse(resurrectionClosesAt)) timer = window.setTimeout(() => { void refresh(); }, 15000);
    };
    void refresh();
    const visible = () => {
      if (document.visibilityState !== 'visible') return;
      setClock(Date.now());
    };
    document.addEventListener('visibilitychange', visible);
    return () => { active = false; controller.abort(); window.clearTimeout(timer); document.removeEventListener('visibilitychange', visible); };
  }, [clock, refreshRoster]);
  const signedUp = async () => {
    if (!client || !status || !identity || registered || !open || status.ordinaryDuel || submitting.current || uncertain) return;
    submitting.current = true; setBusy(true); setError('');
    try {
      const session = await client.read();
      if (identityRef.current !== identity) return;
      await operationsFetch('/resurrection', {
        method: 'POST', headers: { authorization: `Bearer ${session.token}` }, body: JSON.stringify({ side }),
      });
      // Preserve the acknowledged write even if the subsequent reads fail.
      if (identityRef.current === identity) setOwn({ ...status, mine: {
        entry_id: identity, side, created_at: new Date().toISOString(), selection_status: 'pending',
      } });
      await Promise.allSettled([readOwn(), onRegistered(), refreshRoster()]);
    } catch (reason) {
      if (identityRef.current !== identity) return;
      const code = (reason as { status?: number }).status;
      if (!code || code >= 500) {
        setUncertain(true);
        try {
          const checked = await readOwn();
          if (checked?.mine) await Promise.allSettled([onRegistered(), refreshRoster()]);
          else setError('未查到报名，可重新提交');
        } catch { setError('提交结果待确认，请核对报名状态'); }
      } else setError(reason instanceof Error ? reason.message : '报名失败，请重试');
    } finally { submitting.current = false; setBusy(false); }
  };
  return <section id="resurrection" className={`${frame.arena} ${arena.panel} ${styles.panel}`} style={assets} aria-label="深渊复生">
    <header className={`${heading.heading} ${arena.header}`}>
      <div><small>GW12</small><h2>深渊复生</h2></div>
      <p className={arena.deadline}>报名时间（北京时间）<br />{chinaTime(resurrectionOpensAt)} — {chinaTime(resurrectionClosesAt)}</p>
    </header>
    <div className={styles.teams}>
      {(['abyss', 'ice'] as const).map(team => <section className={`${arena.profile} ${styles.team}`} key={team} aria-label={team === 'abyss' ? '深渊组' : '冰海组'}>
        <h3>{team === 'abyss' ? '深渊组' : '冰海组'}<small>{state?.counts[team] ?? '—'} 人报名</small></h3>
        <p>{team === 'abyss' ? '已淘汰玩家' : '存活玩家'}</p>
        {state?.registrations.some(item => item.side === team) ? <ol className={styles.roster}>
          {state.registrations.filter(item => item.side === team).map(item => <li key={item.entry_id}>
            <span>{names.get(item.entry_id) ?? `FPL ID ${item.entry_id}`}{selection ? <small>{selectionLabels[item.selection_status]}</small> : null}</span>
            <time dateTime={item.created_at}>{chinaTime(item.created_at)}</time>
          </li>)}
        </ol> : null}
        {selection?.[team].length ? <strong className={styles.total}>{selection[team === 'abyss' ? 'abyssScore' : 'iceScore'] ?? '—'} 分</strong> : null}
      </section>)}
    </div>
    {selection?.status === 'cancelled' ? <p role="status">任一组不足 5 人，挑战取消，本轮按常规规则结算。</p>
      : selection?.status === 'success' || selection?.status === 'failed'
        ? <p className={styles.result} role="status">{selection.status === 'success' ? '深渊复生成功 · 深渊组全员以 1 血复活，冰海组各扣 1 血' : '深渊复生失败 · 深渊组继续淘汰，冰海组各加 1 血'}</p>
        : selection ? <p role="status">双方各 {selection.abyss.length} 人入选，等待 GW12 正式结算。</p> : null}
    {registered ? <p className={styles.confirmed} role="status">{player?.name} · {registered.side === 'abyss' ? '深渊组' : '冰海组'} · {selectionLabels[registered.selection_status]}</p>
      : !player ? <p>登录后报名</p>
        : !open ? <p>{clock < Date.parse(resurrectionOpensAt) ? '报名尚未开放' : '报名已截止'}</p>
          : status?.ordinaryDuel ? <p>你已参加 GW12 普通决斗，无法报名。</p>
            : <button className={frame.challengeButton} type="button" disabled={busy || !status || uncertain} onClick={() => confirmDialog.current?.showModal()}>
              <strong>{busy ? '正在提交…' : `报名${teamName}`}</strong>
            </button>}
    <dialog ref={confirmDialog} className={arena.confirmDialog} aria-labelledby="resurrection-confirm-title" aria-describedby="resurrection-confirm-note">
      <form method="dialog" onSubmit={event => {
        if ((event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'confirm') void signedUp();
      }}>
        <h2 id="resurrection-confirm-title">确认报名</h2>
        <p id="resurrection-confirm-note">{player?.name}将报名{teamName}。提交后锁定本轮普通决斗资格。</p>
        <div className={arena.confirmActions}><button type="submit" value="cancel" className={styles.cancel}>取消</button><button type="submit" value="confirm">确认报名</button></div>
      </form>
    </dialog>
    {error ? <p className={styles.error} role="alert">{error}<button type="button" disabled={busy} onClick={() => { setError(''); void readOwn().catch(() => setError('状态读取失败，请稍后重试')); }}>核对报名状态</button></p> : null}
    <details className={styles.rules}><summary>挑战规则</summary>
      <ul>
        <li>截止时按两组较少人数各取前 5–8 人，同组按报名顺序入选。任一组不足 5 人则取消。</li>
        <li>提交后锁定 GW12 普通决斗资格。未入选者恢复普通规则，不消耗主动挑战次数。</li>
        <li>比较双方 GW12 队长基础分总和，副队长替补沿用现有规则，同队长可计分。深渊组须严格高于冰海组，同分算失败。</li>
        <li>入选者 GW12 仅按挑战胜负结算，队长 ≥10 不加血，≤3 不扣血。正式结算前血量不变。</li>
        <li>深渊组胜则全员以 1 血复活，冰海组各扣 1 血；深渊组负则继续淘汰，冰海组各加 1 血。</li>
        <li>挑战开启后，GW13 取消前 5 组限制。个人剩余挑战次数、同队长无效、每人仅一组及报名窗口照常。</li>
      </ul>
    </details>
  </section>;
}

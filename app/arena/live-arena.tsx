'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { chinaTime, loadCommunity, duelSelectionLabels, type Community } from '../operations-client';
import { createDuelClient, UncertainSubmission, type PlayerSession } from './duel-client';
import frame from '../test/arena.module.css';
import styles from './live-arena.module.css';

export type DuelPlayer = { entryId: number; name: string; rank: number | null; hp: number; captainTotal: number };
const siteBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const isFeatured = (name: string) => name === '企鹅' || name === 'SSU - Sakai Moka';

function ConfirmHealth({ hp }: { hp: number }) {
  return <span className={styles.confirmHealth} aria-label={`血量 ${hp}`}>
    <span>血量 {hp}</span>
    <span className={styles.confirmDrops} style={{ '--hp-columns': Math.max(1, Math.min(6, hp)) } as CSSProperties} aria-hidden="true">
      {Array.from({ length: hp }, (_, index) => <i className="blood-drop" key={index} />)}
    </span>
  </span>;
}

function DuelHealth({ hp }: { hp: number | undefined }) {
  return <div className={styles.duelHealth}>{hp === undefined ? <small>血量 —</small> : <ConfirmHealth hp={hp} />}</div>;
}

export default function LiveArena({ player, players }: { player: DuelPlayer | null; players: DuelPlayer[] }) {
  const [community, setCommunity] = useState<Community | null>(null);
  const [session, setSession] = useState<PlayerSession | null>(null);
  const [targetId, setTargetId] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [failure, setFailure] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const pendingRecovery = useRef<{ entryId: number; gw: number } | null>(null);
  const errorDialog = useRef<HTMLDialogElement>(null);
  const failedReads = useRef(new Set<'public' | 'mine'>());
  const loadFailureShown = useRef(false);
  const recoverRead = useCallback((kind: 'public' | 'mine') => {
    failedReads.current.delete(kind);
    if (loadFailureShown.current && failedReads.current.size === 0) {
      loadFailureShown.current = false; setError(''); setFailure('');
    }
  }, []);
  const reportError = useCallback((reason: unknown, loadFailure = false) => {
    loadFailureShown.current = loadFailure;
    if (!(reason instanceof UncertainSubmission)) pendingRecovery.current = null;
    const detail = reason instanceof Error ? reason.message : '请求失败，请稍后再试';
    const message = /fetch|network|load failed/i.test(detail) ? '网络连接失败，请检查网络后重试' : /timed?\s*out|timeout|aborted/i.test(detail) ? '请求超时，请稍后再试' : detail;
    setError(message); setFailure(message);
  }, []);
  const [clock, setClock] = useState(() => Date.now());
  const [confirmation, setConfirmation] = useState<{ entryId: number; targetId: number; targetName: string; gw: number } | null>(null);
  const confirmDialog = useRef<HTMLDialogElement>(null);
  const modalOpen = Boolean(confirmation || failure);
  useEffect(() => {
    if (!modalOpen) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = overflow; };
  }, [modalOpen]);
  const submitting = useRef(false);
  const health = new Map(players.map(candidate => [candidate.entryId, candidate.hp]));
  const members = community?.members.length ? community.members : players.map(candidate => ({ entryId: candidate.entryId, teamName: candidate.name }));
  const identity = player?.entryId ?? null;
  const client = useMemo(() => identity ? createDuelClient(identity) : null, [identity]);
  const currentIdentity = useRef(identity);
  useEffect(() => { currentIdentity.current = identity; }, [identity]);
  const currentSession = session?.entryId === identity ? session : null;
  const mine = currentSession?.mine ?? null;
  const round = mine?.arena ?? community?.arena;
  const refreshMine = useCallback(async () => {
    if (!client) return;
    let own: PlayerSession;
    try { own = await client.read(); }
    catch (reason) { if (identity === currentIdentity.current) failedReads.current.add('mine'); throw reason; }
    if (own.entryId === currentIdentity.current) {
      recoverRead('mine');
      setSession(own); setUncertain(false);
      if (own.mine.submitted && pendingRecovery.current?.entryId === own.entryId && pendingRecovery.current.gw === own.mine.gw) {
        pendingRecovery.current = null;
        setError(''); setFailure(''); setMessage('报名已提交，不可修改。');
      }
    }
    return own;
  }, [client, identity, recoverRead]);
  const reload = useCallback(async () => {
    // Registration depends on the signed personal status, not the public feed.
    // Start both reads, but never hold a ready player or a saved POST behind it.
    let publicFailure: unknown;
    const publicRead = loadCommunity().then(data => { recoverRead('public'); setCommunity(data); return data; }).catch(reason => { failedReads.current.add('public'); publicFailure = reason; return undefined; });
    const own = await refreshMine();
    const ownArena = own?.mine.arena;
    if (ownArena && (!ownArena.deadline || Date.now() < Date.parse(ownArena.deadline))) return;
    if (!await publicRead) throw publicFailure;
  }, [refreshMine, recoverRead]);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(async () => {
      setTargetId(''); setSearch(''); setMessage(''); setError(''); setFailure(''); setConfirmation(null); setUncertain(false);
      pendingRecovery.current = null;
      failedReads.current.clear(); loadFailureShown.current = false;
      if (!identity) { setSession(null); await reload(); return; }
      if (active) await reload();
    }).catch(reason => { if (active) reportError(reason, true); });
    return () => { active = false; };
  }, [identity, reload, reportError]);
  useEffect(() => {
    if (!failure || !errorDialog.current) return;
    const dialog = errorDialog.current;
    dialog.showModal();
    return () => { dialog.close(); };
  }, [failure]);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  const deadline = round?.deadline;
  const roundGw = round?.gw;
  const drawReady = community?.arena.gw === roundGw && community?.arena.selectionReady;
  useEffect(() => {
    if (!deadline || !roundGw || drawReady) return;
    const captureAt = Date.parse(deadline) + 90 * 60000;
    if (!Number.isFinite(captureAt)) return;
    let active = true;
    let timer: number | undefined;
    const check = async () => {
      if (!active) return;
      if (document.visibilityState === 'visible') {
        try {
          const data = await loadCommunity();
          if (!active) return;
          setCommunity(data);
          recoverRead('public');
          if (data.arena.gw === roundGw && data.arena.selectionReady) return;
        } catch { /* Preserve existing data; retry only this pending draw. */ }
      }
      if (active) timer = window.setTimeout(() => { void check(); }, 5 * 60000);
    };
    const delay = Math.max(1000, captureAt + 1000 - Date.now());
    if (delay <= 2147483000) timer = window.setTimeout(() => { void check(); }, delay);
    return () => { active = false; window.clearTimeout(timer); };
  }, [deadline, roundGw, drawReady, recoverRead]);
  useEffect(() => {
    const transitions = [round?.opensAt, round?.closesAt, round?.nextOpensAt, deadline];
    const next = transitions.filter((value): value is string => Boolean(value)).map(Date.parse).filter(time => time > Date.now()).sort((a, b) => a - b)[0];
    const delay = next - Date.now();
    if (!Number.isFinite(delay) || delay <= 0 || delay > 2147483000) return;
    const timer = window.setTimeout(() => { setClock(Date.now()); void reload().catch(() => {}); }, delay + 1000);
    return () => window.clearTimeout(timer);
  }, [clock, deadline, round?.opensAt, round?.closesAt, round?.nextOpensAt, reload]);
  useEffect(() => {
    let checkedAt = Date.now();
    const updated = (event: Event) => {
      setCommunity((event as CustomEvent<Community>).detail);
      recoverRead('public');
      void refreshMine().catch(() => {});
    };
    const visible = () => {
      if (document.visibilityState === 'visible' && Date.now() - checkedAt > 5 * 60000) {
        checkedAt = Date.now(); void reload().catch(() => {});
      }
    };
    window.addEventListener('penguin-community-updated', updated);
    document.addEventListener('visibilitychange', visible);
    return () => { window.removeEventListener('penguin-community-updated', updated); document.removeEventListener('visibilitychange', visible); };
  }, [refreshMine, reload, recoverRead]);
  useEffect(() => {
    if (!uncertain) return;
    const timer = window.setTimeout(() => { void refreshMine().catch(() => {}); }, 15000);
    return () => window.clearTimeout(timer);
  }, [uncertain, refreshMine]);
  useEffect(() => {
    const dialog = confirmDialog.current;
    if (!confirmation || !dialog) return;
    dialog.showModal();
    return () => { dialog.close(); };
  }, [confirmation]);
  const askConfirmation = (event: FormEvent) => {
    event.preventDefault();
    if (eliminated || !round || !mine || !client || busy || uncertain || mine.submitted || closed || mine.gw !== round.gw) return;
    const target = members.find(member => member.entryId === Number(targetId));
    if (!target || !identity) return;
    setConfirmation({ entryId: identity, targetId: target.entryId, targetName: target.teamName, gw: round.gw });
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (eliminated || !confirmation || confirmation.entryId !== identity || confirmation.gw !== round?.gw || !mine || mine.submitted || submitting.current || !client || uncertain) return;
    submitting.current = true;
    const submittedAs = identity;
    setBusy(true); setError(''); setMessage('');
    try {
      const accepted = await client.submit(confirmation);
      if (submittedAs === currentIdentity.current) { setSession(accepted); setTargetId(''); setMessage('报名已提交，不可修改。'); }
      void reload().catch(() => {});
    } catch (reason) {
      if (submittedAs === currentIdentity.current) {
        pendingRecovery.current = reason instanceof UncertainSubmission ? { entryId: confirmation.entryId, gw: confirmation.gw } : null;
        setConfirmation(null); setUncertain(reason instanceof UncertainSubmission); reportError(reason);
      }
      if (!(reason instanceof UncertainSubmission)) void reload().catch(() => {});
    } finally { submitting.current = false; setBusy(false); setConfirmation(null); }
  };
  const revealed = Boolean(round?.deadline && clock >= Date.parse(round.deadline));
  const closed = !round?.open || revealed || Boolean(round.closesAt && clock >= Date.parse(round.closesAt));
  const eliminated = mine?.eliminated || player?.hp === 0;
  const locked = eliminated || busy || uncertain || closed || !mine || mine.gw !== round?.gw || mine.submitted || mine.remaining <= 0;
  const selectionLocked = eliminated || !player || busy || uncertain || Boolean(mine?.submitted);
  const query = search.trim().toLocaleLowerCase();
  const candidates = members.filter(member => member.entryId !== identity && health.get(member.entryId) !== 0 && (
    !query || member.teamName.toLocaleLowerCase().includes(query) || String(member.entryId).includes(query)
  ));
  const assets = { '--arena-frame-image': `url("${siteBasePath}/assets/leaderboard/ice-frame-complete.webp")`, '--pixel-heart-image': `url("${siteBasePath}/assets/leaderboard/pixel-heart.svg")` } as CSSProperties;
  const targetHealth = confirmation ? health.get(confirmation.targetId) ?? 0 : 0;
  const healthRows = Math.max(1, Math.ceil(Math.max(player?.hp ?? 0, targetHealth) / 6));
  const publicDuels = community?.duels.filter(duel => duel.gw === round?.gw) ?? [];
  const selectionReady = community?.arena.gw === round?.gw && community?.arena.selectionReady;
  return <div className={frame.preview}>
    <section className={`${frame.arena} ${styles.panel}`} style={assets} aria-label="正式决斗">
      <header className={`${frame.arenaHeader} ${styles.header}`}>
        <div><small>GW{round?.gw ?? 9}</small><h2>{revealed ? '本轮决斗' : '发起决斗'}</h2></div>
        {deadline ? <p className={styles.deadline}>DDL {chinaTime(deadline)}</p> : null}
      </header>
      {mine ? <p className={styles.remaining}>剩余主动挑战 <strong>{mine.remaining}</strong> / 5 次</p> : null}
      {eliminated ? <p className={styles.muted}>已淘汰，不能再参与挑战。</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {message ? <p className={styles.message} role="status">{message}</p> : null}
      {revealed ? <div className={styles.duels}>
        {mine?.submitted && mine.gw === round?.gw && mine.challenge ? <p className={styles.muted}>挑战 {mine.challenge.targetName} · {duelSelectionLabels[mine.selectionStatus ?? 'pending']}</p> : null}
        {publicDuels.map(duel => <article className={frame.duelCard} key={duel.id} style={{ '--duel-health-rows': Math.max(1, Math.ceil(Math.max(health.get(duel.challenger_id) ?? 0, health.get(duel.target_id) ?? 0) / 6)) } as CSSProperties}>
          <header className={frame.duelCardHeader}><span>GW{duel.gw}</span><span>{chinaTime(duel.created_at)}</span></header>
          <div className={frame.combatants}><div className={frame.combatant}><small>挑战者</small><strong>{duel.challengerName}</strong><DuelHealth hp={health.get(duel.challenger_id)} />{duel.challengerCaptain ? <><b className={styles.duelCaptain}>C {duel.challengerCaptain.captainName}</b><small>V {duel.challengerCaptain.viceCaptainName ?? '—'}</small></> : null}</div><div className={frame.versus}>VS</div><div className={frame.combatant}><small>被挑战者</small><strong>{duel.targetName}</strong><DuelHealth hp={health.get(duel.target_id)} />{duel.targetCaptain ? <><b className={styles.duelCaptain}>C {duel.targetCaptain.captainName}</b><small>V {duel.targetCaptain.viceCaptainName ?? '—'}</small></> : null}</div></div>
          <div className={frame.outcome}><strong>{duel.settled_at ? duel.challenger_score : '待结算'}</strong><strong>{duel.settled_at ? duel.target_score : '待结算'}</strong></div>
        </article>)}
        {!publicDuels.length ? <p className={styles.muted}>{selectionReady ? '本轮暂无对阵。' : '正在确认队长与入选对阵。'}</p> : null}
      </div> : <div className={styles.registration}>
        <aside className={styles.profile} aria-label="我的决斗信息">
          <small>挑战者</small>
          <h3 className={player && isFeatured(player.name) ? styles.featured : undefined}>{player?.name ?? '尚未登录'}</h3>
          {player ? <><p className={styles.playerId}>FPL ID {player.entryId}</p><div className={styles.life} aria-label={`血量 ${player.hp}`}><span>血量</span><strong>{player.hp}</strong><span className={styles.drops} aria-hidden="true">{Array.from({ length: player.hp }, (_, index) => <i className="blood-drop" key={index} />)}</span></div></> : <p className={styles.muted}>请先在右上角登录。</p>}
        </aside>
        <form className={styles.form} onSubmit={askConfirmation}>
          {mine?.submitted ? <div className={styles.submitted} role="status"><h3>决斗情况</h3><small>GW{mine.gw} · 已提交挑战</small><span>挑战对象</span><strong className={mine.challenge && isFeatured(mine.challenge.targetName) ? styles.featured : undefined}>{mine.challenge?.targetName ?? '正在读取…'}</strong>{mine.challenge ? <small>FPL ID {mine.challenge.targetId}</small> : null}<p>提交后不可修改</p></div> : <>
            <label className={frame.candidateSearch} htmlFor="duel-search"><span>搜索挑战对象</span><input id="duel-search" type="search" placeholder="玩家名称 / FPL ID" value={search} onChange={event => { setSearch(event.target.value); setTargetId(''); }} disabled={!player || busy} autoComplete="off" /></label>
            <fieldset className={styles.fieldset} disabled={selectionLocked}><legend className={styles.srOnly}>选择挑战对象</legend><div className={`${frame.candidateList} ${styles.candidates}`}>
              {candidates.map(member => <label key={member.entryId} className={targetId === String(member.entryId) ? frame.selectedCandidate : ''}>
                <input type="radio" name="duel-target" value={member.entryId} checked={targetId === String(member.entryId)} onChange={event => setTargetId(event.target.value)} />
                <span><strong className={isFeatured(member.teamName) ? styles.featured : undefined}>{member.teamName}</strong><small className={styles.candidateMeta}>FPL ID {member.entryId}<span className={styles.candidateHealth} aria-label={`血量 ${health.get(member.entryId) ?? 0}`}>{health.get(member.entryId) ?? 0}<i className="blood-drop" aria-hidden="true" /></span></small></span>
              </label>)}
              {!candidates.length ? <p className={frame.candidateEmpty}>{members.length ? '未找到玩家' : '玩家名单暂不可用，请刷新后重试'}</p> : null}
            </div></fieldset>
            <button className={frame.challengeButton} disabled={locked || !targetId}><strong>{busy ? '正在提交…' : '确认发起决斗'}</strong></button>
            {closed && round ? <p className={styles.muted}>{round.opensAt && clock < Date.parse(round.opensAt) ? `报名开放：${chinaTime(round.opensAt)}` : '报名未开放或已截止'}</p> : null}
          </>}
        </form>
      </div>}
    </section>
    <dialog ref={confirmDialog} className={styles.confirmDialog} style={assets} aria-labelledby="confirm-duel-title" aria-describedby="confirm-duel-note" onCancel={event => { if (busy) event.preventDefault(); else setConfirmation(null); }} onClick={event => { if (event.target === event.currentTarget && !busy) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) setConfirmation(null); } }}>
      <form onSubmit={submit}>
        <header><small>GW{confirmation?.gw ?? round?.gw ?? 9}</small><h2 id="confirm-duel-title">确认发起决斗</h2></header>
        <div className={styles.confirmPlayers} style={{ '--confirmation-heart-rows': healthRows } as CSSProperties}>
          <div className={styles.confirmPlayer}>
            <small>挑战者</small><strong>{player?.name}</strong>
            <ConfirmHealth hp={player?.hp ?? 0} />
          </div>
          <span className={styles.confirmVersus}>VS</span>
          <div className={styles.confirmPlayer}>
            <small>被挑战者</small><strong>{confirmation?.targetName}</strong>
            <ConfirmHealth hp={targetHealth} />
          </div>
        </div>
        <p id="confirm-duel-note">每轮只能提交一次，提交后不能修改。</p>
        <div className={styles.confirmActions}><button type="button" disabled={busy} onClick={() => setConfirmation(null)}>取消</button><button type="submit" disabled={busy}>{busy ? '正在提交…' : '确认提交'}</button></div>
      </form>
    </dialog>
    <dialog ref={errorDialog} className={styles.confirmDialog} style={assets} aria-labelledby="duel-error-title" aria-describedby="duel-error-detail" onCancel={() => setFailure('')}>
      <h2 id="duel-error-title">操作失败</h2><p id="duel-error-detail" className={styles.failureDetail}>{failure}</p>
      <div className={styles.confirmActions}><button type="button" onClick={() => setFailure('')}>知道了</button></div>
    </dialog>
  </div>;
}

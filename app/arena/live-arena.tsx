'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { chinaTime, loadCommunity, operationsFetch, visitorIdentity, type Community } from '../operations-client';
import frame from '../test/arena.module.css';
import styles from './live-arena.module.css';

type Mine = { entryId: number; remaining: number; gw: number; submitted: boolean };
export type DuelPlayer = { entryId: number; name: string; rank: number | null; hp: number; captainTotal: number };
type PlayerSession = { entryId: number; token: string; mine: Mine };
const siteBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const isFeatured = (name: string) => name === '企鹅' || name === 'SSU - Sakai Moka';

export default function LiveArena({ player }: { player: DuelPlayer | null }) {
  const [community, setCommunity] = useState<Community | null>(null);
  const [session, setSession] = useState<PlayerSession | null>(null);
  const [targetId, setTargetId] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [clock, setClock] = useState(() => Date.now());
  const identity = player?.entryId ?? null;
  const currentIdentity = useRef(identity);
  useEffect(() => { currentIdentity.current = identity; }, [identity]);
  const requestGeneration = useRef(0);
  const currentSession = session?.entryId === identity ? session : null;
  const mine = currentSession?.mine ?? null;
  const reload = useCallback(async (token = '', entryId: number | null = null) => {
    const generation = ++requestGeneration.current;
    const [data, own] = await Promise.all([
      loadCommunity(),
      token ? operationsFetch<Mine>('/duels/mine', { headers: { authorization: `Bearer ${token}` } }) : Promise.resolve(null),
    ]);
    if (generation !== requestGeneration.current) return;
    setCommunity(data);
    if (own && entryId === currentIdentity.current) setSession({ entryId: own.entryId, token, mine: own });
  }, []);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(async () => {
      setTargetId(''); setSearch(''); setMessage(''); setError('');
      if (!identity) { setSession(null); await reload(); return; }
      const result = await operationsFetch<{ token: string }>('/player/session', {
        method: 'POST', body: JSON.stringify({ entryId: identity, ...visitorIdentity() }),
      });
      if (active) await reload(result.token, identity);
    }).catch(reason => { if (active) setError((reason as Error).message); });
    return () => { active = false; };
  }, [identity, reload]);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  const deadline = community?.arena.deadline;
  const token = currentSession?.token ?? '';
  useEffect(() => {
    const delay = deadline ? Date.parse(deadline) - Date.now() : 0;
    if (delay <= 0 || delay > 2147483000) return;
    const timer = window.setTimeout(() => { setClock(Date.now()); void reload(token, identity).catch(() => {}); }, delay + 1000);
    return () => window.clearTimeout(timer);
  }, [deadline, reload, token, identity]);
  useEffect(() => {
    let checkedAt = Date.now();
    const updated = (event: Event) => setCommunity((event as CustomEvent<Community>).detail);
    const visible = () => {
      if (document.visibilityState === 'visible' && Date.now() - checkedAt > 5 * 60000) {
        checkedAt = Date.now(); void reload(token, identity).catch(() => {});
      }
    };
    window.addEventListener('penguin-community-updated', updated);
    document.addEventListener('visibilitychange', visible);
    return () => { window.removeEventListener('penguin-community-updated', updated); document.removeEventListener('visibilitychange', visible); };
  }, [token, identity, reload]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!community || !mine || !token || busy || mine.submitted) return;
    const target = community.members.find(member => member.entryId === Number(targetId));
    if (!target || !window.confirm(`确认以「${player?.name}」在 GW${community.arena.gw} 挑战「${target.teamName}」？每轮只能提交一次，提交后不能修改。`)) return;
    const submittedAs = identity;
    setBusy(true); setError(''); setMessage('');
    try {
      await operationsFetch('/duels', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ targetId: Number(targetId), gw: community.arena.gw }) });
      await reload(token, submittedAs);
      if (submittedAs === currentIdentity.current) { setTargetId(''); setMessage('报名已提交，不可修改。'); }
    } catch (reason) {
      if (submittedAs === currentIdentity.current) setError((reason as Error).message);
      await reload(token, submittedAs).catch(() => {});
    } finally { setBusy(false); }
  };
  const round = community?.arena;
  const revealed = Boolean(round?.deadline && clock >= Date.parse(round.deadline));
  const closed = !round?.open || revealed;
  const locked = busy || closed || !mine || mine.gw !== round?.gw || mine.submitted || mine.remaining <= 0;
  const query = search.trim().toLocaleLowerCase();
  const candidates = community?.members.filter(member => member.entryId !== identity && (
    !query || member.teamName.toLocaleLowerCase().includes(query) || String(member.entryId).includes(query)
  )) ?? [];
  const assets = { '--arena-frame-image': `url("${siteBasePath}/assets/leaderboard/ice-frame-complete.webp")` } as CSSProperties;
  return <div className={frame.preview}>
    <section className={`${frame.arena} ${styles.panel}`} style={assets} aria-label="正式决斗">
      <header className={`${frame.arenaHeader} ${styles.header}`}>
        <div><small>GW{round?.gw ?? 9}</small><h2>{revealed ? '本轮决斗' : '发起决斗'}</h2></div>
        {deadline ? <p className={styles.deadline}>DDL {chinaTime(deadline)}</p> : null}
      </header>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {message ? <p className={styles.message} role="status">{message}</p> : null}
      {revealed ? <div className={styles.duels}>
        {community?.duels.map(duel => <article className={frame.duelCard} key={duel.id}>
          <header className={frame.duelCardHeader}><span>GW{duel.gw}</span><span>{chinaTime(duel.created_at)}</span></header>
          <div className={frame.combatants}><div className={frame.combatant}><small>挑战者</small><strong>{duel.challengerName}</strong></div><div className={frame.versus}>VS</div><div className={frame.combatant}><small>被挑战者</small><strong>{duel.targetName}</strong></div></div>
          <div className={frame.outcome}><strong>{duel.settled_at ? duel.challenger_score : '待结算'}</strong><strong>{duel.settled_at ? duel.target_score : '待结算'}</strong></div>
        </article>)}
        {!community?.duels.length ? <p className={styles.muted}>本轮暂无对阵。</p> : null}
      </div> : <div className={styles.registration}>
        <aside className={styles.profile} aria-label="我的决斗信息">
          <small>挑战者</small>
          <h3 className={player && isFeatured(player.name) ? styles.featured : undefined}>{player?.name ?? '尚未登录'}</h3>
          {player ? <><p className={styles.playerId}>FPL ID {player.entryId}</p><dl>
            <div><dt>阶位</dt><dd>{player.rank ?? 1}</dd></div>
            <div><dt>血量</dt><dd>{player.hp}</dd></div>
            <div><dt>队长总分</dt><dd>{player.captainTotal}</dd></div>
            <div><dt>剩余决斗权</dt><dd>{mine ? mine.remaining : '…'}</dd></div>
          </dl></> : <p className={styles.muted}>请先在右上角登录。</p>}
        </aside>
        <form className={styles.form} onSubmit={submit}>
          {mine?.submitted ? <div className={styles.submitted} role="status"><strong>本轮已报名</strong><p>提交后不可修改</p></div> : <>
            <label className={frame.candidateSearch} htmlFor="duel-search"><span>搜索挑战对象</span><input id="duel-search" type="search" placeholder="玩家名称 / FPL ID" value={search} onChange={event => setSearch(event.target.value)} disabled={!player || busy} autoComplete="off" /></label>
            <fieldset className={styles.fieldset} disabled={locked}><legend className={styles.srOnly}>选择挑战对象</legend><div className={`${frame.candidateList} ${styles.candidates}`}>
              {candidates.map(member => <label key={member.entryId} className={targetId === String(member.entryId) ? frame.selectedCandidate : ''}>
                <input type="radio" name="duel-target" value={member.entryId} checked={targetId === String(member.entryId)} onChange={event => setTargetId(event.target.value)} />
                <span><strong className={isFeatured(member.teamName) ? styles.featured : undefined}>{member.teamName}</strong><small>FPL ID {member.entryId}</small></span>
              </label>)}
              {!candidates.length ? <p className={frame.candidateEmpty}>{community ? '未找到玩家' : '正在读取玩家…'}</p> : null}
            </div></fieldset>
            <button className={frame.challengeButton} disabled={locked || !targetId}><strong>{busy ? '正在提交…' : '确认发起决斗'}</strong></button>
            {closed && community ? <p className={styles.muted}>报名未开放或已截止</p> : null}
          </>}
        </form>
      </div>}
    </section>
  </div>;
}

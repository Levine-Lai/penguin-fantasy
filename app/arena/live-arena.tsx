'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { chinaTime, loadCommunity, operationsFetch, visitorIdentity, type Community } from '../operations-client';

type Mine = { entryId: number; remaining: number; gw: number; submitted: boolean };
const identityKey = 'penguin-fantasy:player-id:v1';

export default function LiveArena() {
  const [community, setCommunity] = useState<Community | null>(null);
  const [mine, setMine] = useState<Mine | null>(null);
  const [token, setToken] = useState('');
  const [entryId, setEntryId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [clock, setClock] = useState(() => Date.now());
  const loadGeneration = useRef(0);
  const reload = useCallback(async (sessionToken = '') => {
    const generation = ++loadGeneration.current;
    const [data, own] = await Promise.all([loadCommunity(), sessionToken ? operationsFetch<Mine>('/duels/mine', { headers: { authorization: `Bearer ${sessionToken}` } }) : Promise.resolve(null)]);
    if (generation !== loadGeneration.current) return;
    setCommunity(data); setMine(own);
  }, []);
  useEffect(() => {
    let active = true;
    let generation = 0;
    const identify = () => {
      const current = ++generation;
      loadGeneration.current++;
      let id = 0; try { id = Number(localStorage.getItem(identityKey)) || 0; } catch { /* Storage may be unavailable. */ }
      setToken(''); setMine(null); setTargetId(''); setMessage('');
      if (!id) return;
      void operationsFetch<{ token: string }>('/player/session', { method: 'POST', body: JSON.stringify({ entryId: id, ...visitorIdentity() }) }).then(async result => {
        if (!active || current !== generation) return;
        setToken(result.token); await reload(result.token);
      }).catch(reason => { if (active && current === generation) setError((reason as Error).message); });
    };
    const storage = (event: StorageEvent) => { if (!event.key || event.key === identityKey) identify(); };
    void reload().catch(() => { if (active) setError('暂时无法读取决斗数据，请稍后重试。'); });
    identify();
    window.addEventListener('penguin-player-login', identify);
    window.addEventListener('storage', storage);
    return () => { active = false; generation++; window.removeEventListener('penguin-player-login', identify); window.removeEventListener('storage', storage); };
  }, [reload]);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  const deadline = community?.arena.deadline;
  useEffect(() => {
    const delay = deadline ? Date.parse(deadline) - Date.now() : 0;
    if (delay <= 0 || delay > 2147483000) return;
    const timer = window.setTimeout(() => { setClock(Date.now()); void reload(token).catch(() => {}); }, delay + 1000);
    return () => window.clearTimeout(timer);
  }, [deadline, reload, token]);
  useEffect(() => {
    let checkedAt = Date.now();
    const updated = (event: Event) => setCommunity((event as CustomEvent<Community>).detail);
    const visible = () => {
      if (document.visibilityState === 'visible' && Date.now() - checkedAt > 5 * 60000) {
        checkedAt = Date.now(); void reload(token).catch(() => {});
      }
    };
    window.addEventListener('penguin-community-updated', updated);
    document.addEventListener('visibilitychange', visible);
    return () => { window.removeEventListener('penguin-community-updated', updated); document.removeEventListener('visibilitychange', visible); };
  }, [token, reload]);
  const login = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      const result = await operationsFetch<{ token: string }>('/player/session', { method: 'POST', body: JSON.stringify({ entryId: Number(entryId), ...visitorIdentity() }) });
      setToken(result.token);
      try { localStorage.setItem(identityKey, String(Number(entryId))); } catch { /* Session can remain in memory. */ }
      await reload(result.token);
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!community || !mine) return;
    const target = community.members.find(member => member.entryId === Number(targetId));
    if (!target || !window.confirm(`确认在 GW${community.arena.gw} 挑战「${target.teamName}」？提交后由管理员处理撤销。`)) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await operationsFetch('/duels', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ targetId: Number(targetId), gw: community.arena.gw }) });
      await reload(token); setTargetId(''); setMessage('挑战已提交。');
    } catch (reason) { setError((reason as Error).message); await reload(token).catch(() => {}); }
    finally { setBusy(false); }
  };
  const myName = community?.members.find(member => member.entryId === mine?.entryId)?.teamName;
  const round = community?.arena;
  const revealed = Boolean(round?.deadline && clock >= Date.parse(round.deadline));
  const closed = !round?.open || Boolean(round.deadline && clock >= Date.parse(round.deadline));
  const remaining = mine?.remaining ?? 0;
  return <section className="live-arena" aria-label="正式决斗">
    <header><div><small>ICE ARENA · GW{round?.gw ?? 9}</small><h2>{revealed ? '本轮决斗' : '发起决斗'}</h2></div></header>
    {error ? <p className="arena-error" role="alert">{error}</p> : null}{message ? <p role="status">{message}</p> : null}
    {!community ? <p>正在读取决斗数据…</p> : <>
      {!revealed ? <>
        <p className="arena-meta">{closed ? '报名未开放' : '报名已开放'} · DDL {chinaTime(round?.deadline)}</p>
        {!mine ? <form className="arena-form" onSubmit={login}><label>FPL ID<input type="text" inputMode="numeric" pattern="[0-9]+" value={entryId} onChange={event => setEntryId(event.target.value)} required /></label><button disabled={busy}>登录</button></form> : <>
          <div className="arena-identity"><strong>{myName}</strong></div>
          <form className="arena-form" onSubmit={submit}><label>挑战目标<select value={targetId} onChange={event => setTargetId(event.target.value)} required disabled={busy || closed || mine.submitted || remaining <= 0}><option value="">选择玩家</option>{community.members.filter(member => member.entryId !== mine.entryId).map(member => <option key={member.entryId} value={member.entryId}>{member.teamName}</option>)}</select></label><button disabled={busy || closed || mine.submitted || remaining <= 0 || !targetId}>{mine.submitted ? '已报名' : '确认发起挑战'}</button></form>
        </>}
      </> : <div className="arena-public-duels">{community.duels.map(duel => <article className="arena-duel" key={duel.id}><strong>{duel.challengerName} → {duel.targetName}</strong><span>{chinaTime(duel.created_at)}</span><b>{duel.settled_at ? `${duel.challenger_score} : ${duel.target_score}` : '待结算'}</b></article>)}{!community.duels.length ? <p className="arena-meta">本轮暂无对阵。</p> : null}</div>}
    </>}
  </section>;
}

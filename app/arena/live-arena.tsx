'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { chinaTime, loadCommunity, operationsFetch, visitorIdentity, type Community, type DuelRecord } from '../operations-client';

type Mine = { entryId: number; remaining: number; gw: number; duels: DuelRecord[] };
const sessionKey = 'penguin:duel-session:v1';

export default function LiveArena() {
  const [community, setCommunity] = useState<Community | null>(null);
  const [mine, setMine] = useState<Mine | null>(null);
  const [token, setToken] = useState('');
  const [entryId, setEntryId] = useState('');
  const [code, setCode] = useState('');
  const [targetId, setTargetId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [clock, setClock] = useState(() => Date.now());
  const reload = useCallback(async (sessionToken = '') => {
    const [data, own] = await Promise.all([loadCommunity(), sessionToken ? operationsFetch<Mine>('/duels/mine', { headers: { authorization: `Bearer ${sessionToken}` } }) : Promise.resolve(null)]);
    setCommunity(data); setMine(own);
  }, []);
  useEffect(() => {
    let active = true;
    const storedToken = (() => { try { return sessionStorage.getItem(sessionKey) ?? ''; } catch { return ''; } })();
    void Promise.resolve().then(() => reload(storedToken)).then(() => { if (active) setToken(storedToken); }).catch(async () => {
      try { sessionStorage.removeItem(sessionKey); } catch { /* Memory-only session is sufficient. */ }
      await reload().catch(() => { if (active) setError('暂时无法读取决斗数据，请稍后重试。'); });
    });
    return () => { active = false; };
  }, [reload]);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  const login = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      const result = await operationsFetch<{ token: string }>('/player/session', { method: 'POST', body: JSON.stringify({ entryId: Number(entryId), code, ...visitorIdentity() }) });
      setToken(result.token); setCode('');
      try { sessionStorage.setItem(sessionKey, result.token); } catch { /* Session can remain in memory. */ }
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
  const ownRound = mine?.duels.filter(duel => duel.gw === round?.gw) ?? [];
  const closed = !round?.open || Boolean(round.deadline && clock >= Date.parse(round.deadline));
  const remaining = mine?.remaining ?? 0;
  return <section className="live-arena" aria-label="正式决斗">
    <header><div><small>ICE ARENA · GW{round?.gw ?? 9}</small><h2>决斗申请与战况</h2></div><strong>{round?.count ?? 0} / 5 组</strong></header>
    {error ? <p className="arena-error" role="alert">{error}</p> : null}{message ? <p role="status">{message}</p> : null}
    {!community ? <p>正在读取决斗数据…</p> : <>
      <p className="arena-meta">{closed ? '报名未开放或已截止' : '报名已开放'} · DDL {chinaTime(round?.deadline)}</p>
      {!mine ? <form className="arena-form" onSubmit={login}><label>FPL ID<input type="text" inputMode="numeric" pattern="[0-9]+" value={entryId} onChange={event => setEntryId(event.target.value)} required /></label><label>玩家决斗口令<input type="password" autoComplete="current-password" value={code} onChange={event => setCode(event.target.value)} required maxLength={80} /></label><button disabled={busy}>验证</button><small>口令由联赛管理员发放。</small></form> : <>
        <div className="arena-identity"><strong>{myName} · 剩余 {remaining} 次主动挑战权</strong><button onClick={() => { setToken(''); setMine(null); try { sessionStorage.removeItem(sessionKey); } catch { /* Memory state is cleared. */ } }}>退出验证</button></div>
        <form className="arena-form" onSubmit={submit}><label>挑战目标<select value={targetId} onChange={event => setTargetId(event.target.value)} required disabled={busy || closed || ownRound.length > 0 || remaining <= 0}><option value="">选择玩家</option>{community.members.filter(member => member.entryId !== mine.entryId).map(member => <option key={member.entryId} value={member.entryId}>{member.teamName} · {member.entryId}</option>)}</select></label><button disabled={busy || closed || ownRound.length > 0 || remaining <= 0 || !targetId}>确认发起挑战</button></form>
        {ownRound.map(duel => <article className="arena-duel" key={duel.id}><strong>我的对阵：{duel.challengerName} → {duel.targetName}</strong><span>{chinaTime(duel.created_at)}</span><b>{duel.settled_at ? `${duel.challenger_score} : ${duel.target_score}` : '已登记，等待本轮结束'}</b></article>)}
      </>}
      <div className="arena-public-duels">{community.duels.map(duel => <article className="arena-duel" key={duel.id}><strong>{duel.challengerName} → {duel.targetName}</strong><span>{chinaTime(duel.created_at)}</span><b>{duel.settled_at ? `${duel.challenger_score} : ${duel.target_score}` : '待结算'}</b></article>)}</div>
      {!community.duels.length ? <p className="arena-meta">{round?.deadline && clock < Date.parse(round.deadline) ? 'DDL 后公开本轮对阵。' : '本轮暂无公开对阵。'}</p> : null}
    </>}
  </section>;
}

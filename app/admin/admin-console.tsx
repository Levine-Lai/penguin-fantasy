'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { operationsFetch, operationsOrigin, chinaTime, duelSelectionLabels, type ArenaConfig, type Announcement, type DuelRecord } from '../operations-client';
import styles from './admin.module.css';

type Member = { entryId: number; teamName: string };
type Overview = {
  day: string; page: number; arena: ArenaConfig; members: Member[]; duels: DuelRecord[]; announcements: Announcement[];
  duelPagination: { page: number; pageSize: number; total: number };
  activity: Array<{ id: string; entry_id: number; device: string; created_at: string }>;
  players: Array<{ entry_id: number; firstLogin: string; lastLogin: string }>;
  logs: Array<{ id: string; action: string; target: string; detail: string; created_at: string }>;
};
type Tab = 'duels' | 'announcements' | 'players' | 'audit';
const tabs: Array<[Tab, string]> = [['duels', '决斗管理'], ['announcements', '公告'], ['players', '登录玩家'], ['audit', '操作记录']];
const today = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const actionLabels: Record<string, string> = { admin_login: '管理员登录', arena_settings: '调整报名', reset_player_code: '重置玩家口令', publish_announcement: '发布公告', remove_duels: '移除决斗', remove_announcements: '撤下公告' };

export default function AdminConsole() {
  const [data, setData] = useState<Overview | null>(null);
  const [loggedIn, setLoggedIn] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [tab, setTab] = useState<Tab>('duels');
  const [day, setDay] = useState(today);
  const [page, setPage] = useState(0);
  const [showRemoved, setShowRemoved] = useState(false);
  const [duelPage, setDuelPage] = useState(0);
  const authRevision = useRef(0);

  const load = useCallback(async (selectedDay?: string, selectedPage = 0, selectedDuelPage = 0, includeRemoved = false) => {
    const revision = authRevision.current;
    const response = await operationsFetch<Overview>(`/admin/overview?day=${selectedDay ?? today()}&page=${selectedPage}&duelPage=${selectedDuelPage}&includeRemoved=${includeRemoved}`);
    if (revision !== authRevision.current) return;
    setData(response); setLoggedIn(true); setDuelPage(response.duelPagination.page);
  }, []);
  const refreshDashboard = useCallback((revision: number, selectedDay?: string, selectedPage = 0) => {
    setNotice('正在读取管理数据…');
    void load(selectedDay, selectedPage).then(() => {
      if (revision === authRevision.current) setNotice('');
    }).catch(reason => {
      if (revision !== authRevision.current) return;
      setNotice('');
      if (reason.status === 401) { authRevision.current++; setLoggedIn(false); setData(null); setError('登录已过期，请重新登录。'); }
      else setError('已登录，管理数据读取失败，请点击刷新数据重试。');
    });
  }, [load]);
  useEffect(() => {
    if (window.location.origin !== operationsOrigin && window.location.hostname !== 'localhost') {
      window.location.replace(`${operationsOrigin}/admin/`); return;
    }
    let active = true;
    const revision = authRevision.current;
    void operationsFetch('/admin/session', { signal: AbortSignal.timeout(6000) }).then(() => {
      if (!active || revision !== authRevision.current) return;
      setLoggedIn(true); refreshDashboard(revision);
    }).catch(reason => { if (active && revision === authRevision.current && reason.status !== 401) setError('登录状态读取失败，可重新登录。'); }).finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [refreshDashboard]);
  const run = async (operation: () => Promise<unknown>, success: string, refresh = true) => {
    setBusy(true); setError(''); setNotice('');
    try {
      await operation(); setNotice(success);
      if (refresh) {
        try { await load(day, page, duelPage, showRemoved); }
        catch { setError(success ? '操作已完成，列表暂未刷新，请稍后刷新数据。' : '登录已完成，列表读取失败，请重试。'); }
      }
    }
    catch (reason) { const failure = reason as Error & { status?: number }; setError(failure.message); if (failure.status === 401) { authRevision.current++; setLoggedIn(false); setData(null); } }
    finally { setBusy(false); }
  };
  const login = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const revision = ++authRevision.current;
    setBusy(true); setError(''); setNotice('');
    try {
      try { await operationsFetch('/admin/login', { method: 'POST', body: JSON.stringify({ password }) }); }
      catch (reason) {
        // A lost acknowledgement may still have installed the HttpOnly cookie.
        // Check it once, without automatically repeating the password POST.
        if ((reason as { status?: number }).status) throw reason;
        try { await operationsFetch('/admin/session', { signal: AbortSignal.timeout(6000) }); }
        catch { throw reason; }
      }
      if (revision !== authRevision.current) return;
      setPassword(''); setLoggedIn(true); refreshDashboard(revision, day, page);
    } catch (reason) { if (revision === authRevision.current) setError((reason as Error).message); }
    finally { if (revision === authRevision.current) setBusy(false); }
  };
  const logout = () => {
    if (busy) return;
    const revision = ++authRevision.current;
    setBusy(true); setNotice('');
    void operationsFetch('/admin/logout', { method: 'POST', body: '{}' }).then(() => {
      if (revision === authRevision.current) { setLoggedIn(false); setData(null); }
    }).catch(() => { if (revision === authRevision.current) setError('退出失败，请重试'); })
      .finally(() => { if (revision === authRevision.current) setBusy(false); });
  };
  const remove = (type: 'duels' | 'announcements', id: string, label: string) => {
    if (!window.confirm(`确认${type === 'duels' ? '移除' : '撤下'}「${label}」？`)) return;
    const reason = window.prompt('操作原因（可选）', ''); if (reason === null) return;
    void run(async () => {
      await operationsFetch(`/admin/${type}/${id}`, { method: 'DELETE', body: JSON.stringify({ reason }) });
      setData(previous => previous ? { ...previous, [type]: previous[type].map(item => item.id === id ? { ...item, deleted_at: new Date().toISOString(), ...(type === 'duels' ? { delete_reason: reason } : {}) } : item) } : previous);
    }, '已移除，后台保留操作记录');
  };
  const names = new Map(data?.members.map(member => [member.entryId, member.teamName]));
  const name = (id: number | null) => id ? names.get(id) ?? `ID ${id}` : '匿名访客';

  if (checking) return <main className={styles.shell}><p>正在检查登录…</p></main>;
  if (!loggedIn) return <main className={styles.shell}><section className={styles.login}>
    <Link href="/">← 返回战榜</Link><small>PENGUIN CUP</small><h1>管理后台</h1>
    <form onSubmit={login}><label htmlFor="admin-password">管理员密码</label><input id="admin-password" type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required maxLength={160} />
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}<button disabled={busy}>{busy ? '正在登录…' : '登录'}</button></form>
  </section></main>;
  return <main className={styles.shell}>
    <header className={styles.header}><div><small>PENGUIN CUP · ADMIN</small><h1>联赛管理</h1></div><div className={styles.actions}><a href="/arena/" target="_blank" rel="noreferrer">正式决斗页 ↗</a><Link href="/">战榜</Link><button disabled={busy} onClick={logout}>退出</button></div></header>
    <nav className={styles.tabs} aria-label="后台模块">{tabs.map(([id, label]) => <button aria-current={tab === id ? 'page' : undefined} key={id} onClick={() => { setTab(id); }}>{label}</button>)}</nav>
    <div className={styles.toolbar}><label>统计日期（北京时间）<input type="date" value={day} onChange={event => { setDay(event.target.value); setPage(0); }} /></label><button disabled={busy || !day} onClick={() => { setPage(0); void run(() => load(day, 0, duelPage, showRemoved), '', false); }}>刷新数据</button></div>
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}{notice ? <p role="status" className={styles.notice}>{notice}</p> : null}
    {data && tab === 'duels' ? <>
      <section className={styles.panel}><h2>报名时间</h2>
        <p>GW{data?.arena.gw} · {data?.arena.open ? '已开放' : '未开放'} · 已报名 {data.arena.count ?? 0} 组<br /><small>开放 {chinaTime(data?.arena.opensAt)} · DDL {chinaTime(data?.arena.deadline)}</small></p>
        <p className={styles.muted}>每轮 DDL 前 12 小时自动开放，DDL 截止。报名不限组数，按提交顺序选出 5 组；同队长不计并顺延，未入选不扣次数。双方本轮只能参与一组；GW9–GW20 共 5 次主动挑战权；不同队长同分不扣血、不返还次数。</p></section>
      <section className={styles.panel}><div className={styles.sectionHead}><h2>决斗记录</h2><label><input type="checkbox" checked={showRemoved} onChange={event => { const includeRemoved = event.target.checked; setShowRemoved(includeRemoved); setDuelPage(0); void run(() => load(day, page, 0, includeRemoved), '', false); }} disabled={busy} /> 显示已移除</label></div>
        <div className={styles.tableWrap}><table><thead><tr><th>比赛周</th><th>提交时间（北京时间）</th><th>发起者 → 对手</th><th>结果</th><th>状态</th><th>操作</th></tr></thead><tbody>{data?.duels.filter(item => showRemoved || !item.deleted_at).map(item => <tr key={item.id}><td>GW{item.gw}</td><td>{chinaTime(item.created_at)}</td><td>{item.challengerName}<small>ID {item.challenger_id}</small> → {item.targetName}<small>ID {item.target_id}</small></td><td>{item.settled_at ? `${item.challenger_score} : ${item.target_score}` : item.selection_status && !['pending', 'selected'].includes(item.selection_status) ? '不计本轮' : '进行中'}</td><td>{item.deleted_at ? '已移除' : item.settled_at ? '已结算' : duelSelectionLabels[item.selection_status ?? 'pending']}</td><td>{item.deleted_at ? item.delete_reason || '—' : <button disabled={busy} className={styles.danger} onClick={() => remove('duels', item.id, `${item.challengerName} → ${item.targetName}`)}>移除</button>}</td></tr>)}</tbody></table></div>
        {!data?.duels.some(item => showRemoved || !item.deleted_at) ? <p className={styles.empty}>尚无正式提交的决斗。</p> : null}<div className={styles.actions} aria-label="决斗记录分页"><button disabled={busy || duelPage === 0} onClick={() => { void run(() => load(day, page, duelPage - 1, showRemoved), '', false); }}>上一页</button><span>第 {duelPage + 1} / {Math.max(1, Math.ceil(data.duelPagination.total / data.duelPagination.pageSize))} 页 · {data.duelPagination.total} 条</span><button disabled={busy || (duelPage + 1) * data.duelPagination.pageSize >= data.duelPagination.total} onClick={() => { void run(() => load(day, page, duelPage + 1, showRemoved), '', false); }}>下一页</button></div></section>
    </> : null}
    {data && tab === 'announcements' ? <>
      <section className={styles.panel}><h2>发布公告</h2><form className={styles.form} onSubmit={event => { event.preventDefault(); const form = event.currentTarget; const input = new FormData(form); void run(async () => { await operationsFetch('/admin/announcements', { method: 'POST', body: JSON.stringify({ title: input.get('title'), body: input.get('body'), day: input.get('day') }) }); form.reset(); }, '公告已发布，所选日期访问的玩家可见'); }}>
        <label>展示日期（北京时间）<input name="day" type="date" defaultValue={today()} required /></label><label>标题<input name="title" maxLength={60} required /></label><label>公告内容<textarea name="body" maxLength={2000} rows={5} required /></label><button disabled={busy}>发布</button></form></section>
      <section className={styles.panel}><h2>已发布公告</h2>{data?.announcements.map(item => <article className={styles.record} key={item.id}><div><small>{item.display_day} {item.deleted_at ? '· 已撤下' : ''}</small><h3>{item.title}</h3><p className={styles.pre}>{item.body}</p></div>{!item.deleted_at ? <button disabled={busy} className={styles.danger} onClick={() => remove('announcements', item.id, item.title)}>撤下</button> : null}</article>)}{!data?.announcements.length ? <p className={styles.empty}>暂无公告。</p> : null}</section>
    </> : null}
    {data && tab === 'players' ? <>
      <section className={styles.panel}><h2>当天登录玩家 · {data?.players.length ?? 0} 人</h2><div className={styles.tableWrap}><table><thead><tr><th>玩家</th><th>首次登录</th><th>最近登录</th></tr></thead><tbody>{data?.players.map(player => <tr key={player.entry_id}><td>{name(player.entry_id)}<small>FPL ID {player.entry_id}</small></td><td>{chinaTime(player.firstLogin)}</td><td>{chinaTime(player.lastLogin)}</td></tr>)}</tbody></table></div>{!data?.players.length ? <p className={styles.empty}>当天暂无登录记录。</p> : null}</section>
      <section className={styles.panel}><h2>登录记录</h2><div className={styles.tableWrap}><table><thead><tr><th>登录时间</th><th>玩家</th><th>设备</th></tr></thead><tbody>{data?.activity.map(item => <tr key={item.id}><td>{chinaTime(item.created_at)}</td><td>{name(item.entry_id)}<small>FPL ID {item.entry_id}</small></td><td>{item.device}</td></tr>)}</tbody></table></div><div className={styles.actions}><button disabled={busy || page === 0} onClick={() => { const next = page - 1; setPage(next); void run(() => load(day, next, duelPage, showRemoved), '', false); }}>上一页</button><span>第 {page + 1} 页</span><button disabled={busy || (data?.activity.length ?? 0) < 50} onClick={() => { const next = page + 1; setPage(next); void run(() => load(day, next, duelPage, showRemoved), '', false); }}>下一页</button></div></section>
    </> : null}
    {data && tab === 'audit' ? <section className={styles.panel}><h2>最近操作</h2><div className={styles.tableWrap}><table><thead><tr><th>时间</th><th>操作</th><th>对象</th><th>说明</th></tr></thead><tbody>{data?.logs.map(log => <tr key={log.id}><td>{chinaTime(log.created_at)}</td><td>{actionLabels[log.action] ?? log.action}</td><td>{log.target}</td><td>{log.detail || '—'}</td></tr>)}</tbody></table></div></section> : null}
  </main>;
}

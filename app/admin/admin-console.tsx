'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { operationsFetch, operationsOrigin, chinaTime, type ArenaConfig, type Announcement, type DuelRecord } from '../operations-client';
import styles from './admin.module.css';

type Member = { entryId: number; teamName: string };
type Overview = {
  day: string; page: number; arena: ArenaConfig; members: Member[]; duels: DuelRecord[]; announcements: Announcement[];
  stats: { views: number; visitors: number; sessions: number; logins: number }; total: { views: number };
  activity: Array<{ id: string; visitor_id: string; entry_id: number | null; kind: string; path: string; device: string; created_at: string }>;
  players: Array<{ entry_id: number; lastSeen: string; events: number; lastVerified: string | null; lastIdentified: string | null }>;
  logs: Array<{ id: string; action: string; target: string; detail: string; created_at: string }>;
  codes: Array<{ entry_id: number; updated_at: string }>;
};
type Tab = 'duels' | 'announcements' | 'visits' | 'players' | 'audit';
const tabs: Array<[Tab, string]> = [['duels', '决斗管理'], ['announcements', '公告'], ['visits', '浏览与登录'], ['players', '玩家口令'], ['audit', '操作记录']];
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
  const [gw, setGw] = useState(9);
  const [showRemoved, setShowRemoved] = useState(false);
  const [entryId, setEntryId] = useState('');
  const [issuedCode, setIssuedCode] = useState<{ code: string; entryId: number } | null>(null);

  const load = useCallback(async (selectedDay?: string, selectedPage = 0) => {
    const response = await operationsFetch<Overview>(`/admin/overview?day=${selectedDay ?? today()}&page=${selectedPage}`);
    setData(response); setGw(response.arena.gw); setLoggedIn(true);
  }, []);
  useEffect(() => {
    if (window.location.origin !== operationsOrigin && window.location.hostname !== 'localhost') {
      window.location.replace(`${operationsOrigin}/admin/`); return;
    }
    let active = true;
    void Promise.resolve().then(() => load()).catch(reason => { if (active && reason.status !== 401) setError(reason.message); }).finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [load]);
  const run = async (operation: () => Promise<unknown>, success: string, refresh = true) => {
    setBusy(true); setError(''); setNotice('');
    try { await operation(); if (refresh) await load(day, page); setNotice(success); }
    catch (reason) { const failure = reason as Error & { status?: number }; setError(failure.message); if (failure.status === 401) setLoggedIn(false); }
    finally { setBusy(false); }
  };
  const login = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => { await operationsFetch('/admin/login', { method: 'POST', body: JSON.stringify({ password }) }); setPassword(''); }, '');
  };
  const remove = (type: 'duels' | 'announcements', id: string, label: string) => {
    if (!window.confirm(`确认${type === 'duels' ? '移除' : '撤下'}「${label}」？`)) return;
    const reason = window.prompt('操作原因（可选）', ''); if (reason === null) return;
    void run(() => operationsFetch(`/admin/${type}/${id}`, { method: 'DELETE', body: JSON.stringify({ reason }) }), '已移除，后台保留操作记录');
  };
  const names = new Map(data?.members.map(member => [member.entryId, member.teamName]));
  const name = (id: number | null) => id ? names.get(id) ?? `ID ${id}` : '匿名访客';
  const activeDuels = data?.duels.filter(item => item.gw === data.arena.gw && !item.deleted_at) ?? [];

  if (checking) return <main className={styles.shell}><p>正在检查登录…</p></main>;
  if (!loggedIn) return <main className={styles.shell}><section className={styles.login}>
    <Link href="/">← 返回战榜</Link><small>PENGUIN CUP</small><h1>管理后台</h1>
    <form onSubmit={login}><label htmlFor="admin-password">管理员密码</label><input id="admin-password" type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required maxLength={160} />
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}<button disabled={busy}>{busy ? '正在登录…' : '登录'}</button></form>
  </section></main>;
  return <main className={styles.shell}>
    <header className={styles.header}><div><small>PENGUIN CUP · ADMIN</small><h1>联赛管理</h1></div><div className={styles.actions}><a href="/arena/" target="_blank" rel="noreferrer">正式决斗页 ↗</a><Link href="/">战榜</Link><button disabled={busy} onClick={() => void operationsFetch('/admin/logout', { method: 'POST', body: '{}' }).then(() => { setLoggedIn(false); setData(null); setIssuedCode(null); }).catch(() => setError('退出失败，请重试'))}>退出</button></div></header>
    <div className={styles.metrics}>{[['当日浏览', data?.stats.views], ['当日访客', data?.stats.visitors], ['登录/验证次数', data?.stats.logins], ['累计浏览（保留90天）', data?.total.views]].map(([label, value]) => <article key={String(label)}><span>{label}</span><strong>{value ?? 0}</strong></article>)}</div>
    <nav className={styles.tabs} aria-label="后台模块">{tabs.map(([id, label]) => <button aria-current={tab === id ? 'page' : undefined} key={id} onClick={() => { setTab(id); setIssuedCode(null); }}>{label}</button>)}</nav>
    <div className={styles.toolbar}><label>统计日期（北京时间）<input type="date" value={day} onChange={event => { setDay(event.target.value); setPage(0); }} /></label><button disabled={busy || !day} onClick={() => { setPage(0); void run(() => load(day, 0), '', false); }}>刷新数据</button></div>
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}{notice ? <p role="status" className={styles.notice}>{notice}</p> : null}
    {tab === 'duels' ? <>
      <section className={styles.panel}><h2>报名控制</h2><form className={styles.inline} onSubmit={event => { event.preventDefault(); void run(() => operationsFetch('/admin/arena', { method: 'POST', body: JSON.stringify({ gw, open: !data?.arena.open }) }), '报名状态已更新'); }}>
        <label>比赛周<select value={gw} onChange={event => setGw(Number(event.target.value))}>{Array.from({ length: 12 }, (_, i) => <option key={i + 9} value={i + 9}>GW{i + 9}</option>)}</select></label>
        <p>当前 GW{data?.arena.gw} · {data?.arena.open ? '已开放' : '未开放'} · {activeDuels.length}/5 组<br /><small>DDL {chinaTime(data?.arena.deadline)}</small></p><button disabled={busy}>{data?.arena.open ? '关闭报名' : '保存并开放报名'}</button></form>
        <p className={styles.muted}>DDL 自动停止提交。先到先得，每轮最多 5 组，双方本轮只能参加一组；每位玩家在 GW9–GW20 有 5 次主动挑战权，平局返还。</p></section>
      <section className={styles.panel}><div className={styles.sectionHead}><h2>决斗记录</h2><label><input type="checkbox" checked={showRemoved} onChange={event => setShowRemoved(event.target.checked)} /> 显示已移除</label></div>
        <div className={styles.tableWrap}><table><thead><tr><th>比赛周</th><th>提交时间（北京时间）</th><th>发起者 → 对手</th><th>结果</th><th>状态</th><th>操作</th></tr></thead><tbody>{data?.duels.filter(item => showRemoved || !item.deleted_at).map(item => <tr key={item.id}><td>GW{item.gw}</td><td>{chinaTime(item.created_at)}</td><td>{item.challengerName}<small>ID {item.challenger_id}</small> → {item.targetName}<small>ID {item.target_id}</small></td><td>{item.settled_at ? `${item.challenger_score} : ${item.target_score}` : '等待本轮结束'}</td><td>{item.deleted_at ? '已移除' : item.settled_at ? '已结算' : '已提交'}</td><td>{item.deleted_at ? item.delete_reason || '—' : <button disabled={busy} className={styles.danger} onClick={() => remove('duels', item.id, `${item.challengerName} → ${item.targetName}`)}>移除</button>}</td></tr>)}</tbody></table></div>
        {!data?.duels.some(item => showRemoved || !item.deleted_at) ? <p className={styles.empty}>尚无正式提交的决斗。</p> : null}</section>
    </> : null}
    {tab === 'announcements' ? <>
      <section className={styles.panel}><h2>发布公告</h2><form className={styles.form} onSubmit={event => { event.preventDefault(); const form = event.currentTarget; const input = new FormData(form); void run(async () => { await operationsFetch('/admin/announcements', { method: 'POST', body: JSON.stringify({ title: input.get('title'), body: input.get('body'), day: input.get('day') }) }); form.reset(); }, '公告已发布，所选日期访问的玩家可见'); }}>
        <label>展示日期（北京时间）<input name="day" type="date" defaultValue={today()} required /></label><label>标题<input name="title" maxLength={60} required /></label><label>公告内容<textarea name="body" maxLength={2000} rows={5} required /></label><button disabled={busy}>发布</button></form></section>
      <section className={styles.panel}><h2>已发布公告</h2>{data?.announcements.map(item => <article className={styles.record} key={item.id}><div><small>{item.display_day} {item.deleted_at ? '· 已撤下' : ''}</small><h3>{item.title}</h3><p className={styles.pre}>{item.body}</p></div>{!item.deleted_at ? <button disabled={busy} className={styles.danger} onClick={() => remove('announcements', item.id, item.title)}>撤下</button> : null}</article>)}{!data?.announcements.length ? <p className={styles.empty}>暂无公告。</p> : null}</section>
    </> : null}
    {tab === 'visits' ? <>
      <section className={styles.panel}><h2>当天识别玩家</h2><p className={styles.muted}>FPL ID 识别由玩家填写；“口令验证”表示使用了你发放的决斗口令。访客数按浏览器标识去重，统计从本次上线开始。</p><div className={styles.tableWrap}><table><thead><tr><th>玩家</th><th>最近访问</th><th>最近口令验证</th><th>最近 ID 登录</th><th>事件数</th></tr></thead><tbody>{data?.players.map(player => <tr key={player.entry_id}><td>{name(player.entry_id)}<small>ID {player.entry_id}</small></td><td>{chinaTime(player.lastSeen)}</td><td>{chinaTime(player.lastVerified)}</td><td>{chinaTime(player.lastIdentified)}</td><td>{player.events}</td></tr>)}</tbody></table></div>{!data?.players.length ? <p className={styles.empty}>当天暂无识别玩家。</p> : null}</section>
      <section className={styles.panel}><h2>访问记录</h2><div className={styles.tableWrap}><table><thead><tr><th>时间</th><th>玩家 / 访客</th><th>行为</th><th>页面</th><th>设备</th></tr></thead><tbody>{data?.activity.map(item => <tr key={item.id}><td>{chinaTime(item.created_at)}</td><td>{name(item.entry_id)}<small>{item.visitor_id.slice(0, 8)}</small></td><td>{{ pageview: '浏览', identify: 'ID 登录', verified_login: '口令验证' }[item.kind] ?? item.kind}</td><td>{item.path}</td><td>{item.device}</td></tr>)}</tbody></table></div><div className={styles.actions}><button disabled={busy || page === 0} onClick={() => { const next = page - 1; setPage(next); void run(() => load(day, next), '', false); }}>上一页</button><span>第 {page + 1} 页</span><button disabled={busy || (data?.activity.length ?? 0) < 50} onClick={() => { const next = page + 1; setPage(next); void run(() => load(day, next), '', false); }}>下一页</button></div></section>
    </> : null}
    {tab === 'players' ? <section className={styles.panel}><h2>玩家决斗口令</h2><p className={styles.muted}>生成后将口令私下交给对应玩家。口令只显示一次；重置会立即使旧口令和旧验证失效。</p><form className={styles.inline} onSubmit={event => { event.preventDefault(); if (!window.confirm('确认生成新口令？已有口令和登录验证将失效。')) return; void run(async () => { const issued = await operationsFetch<{ code: string; entryId: number }>('/admin/player-code', { method: 'POST', body: JSON.stringify({ entryId: Number(entryId) }) }); setIssuedCode(issued); }, '口令已生成，请立即保存并交给对应玩家'); }}><label>玩家<select value={entryId} onChange={event => { setEntryId(event.target.value); setIssuedCode(null); }} required><option value="">选择玩家</option>{data?.members.map(member => <option key={member.entryId} value={member.entryId}>{member.teamName} · {member.entryId}</option>)}</select></label><button disabled={busy || !entryId}>生成 / 重置口令</button></form>
      {issuedCode ? <div className={styles.secret}><strong>{name(issuedCode.entryId)} · ID {issuedCode.entryId}</strong><code>{issuedCode.code}</code><button onClick={() => void navigator.clipboard.writeText(`FPL ID：${issuedCode.entryId}\n决斗口令：${issuedCode.code}\nhttps://penguin-fantasy.pages.dev/arena/`).then(() => setNotice('已复制')).catch(() => setError('无法自动复制，请手动选择口令'))}>复制给玩家</button></div> : null}
      <h3>已发放</h3>{data?.codes.map(code => <p key={code.entry_id}>{name(code.entry_id)} <small>· {chinaTime(code.updated_at)}</small></p>)}{!data?.codes.length ? <p className={styles.empty}>尚未发放玩家口令。</p> : null}</section> : null}
    {tab === 'audit' ? <section className={styles.panel}><h2>最近操作</h2><div className={styles.tableWrap}><table><thead><tr><th>时间</th><th>操作</th><th>对象</th><th>说明</th></tr></thead><tbody>{data?.logs.map(log => <tr key={log.id}><td>{chinaTime(log.created_at)}</td><td>{actionLabels[log.action] ?? log.action}</td><td>{log.target}</td><td>{log.detail || '—'}</td></tr>)}</tbody></table></div></section> : null}
  </main>;
}

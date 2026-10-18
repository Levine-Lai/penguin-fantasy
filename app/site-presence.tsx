'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { loadCommunity, operationsFetch, visitorIdentity, type Announcement } from './operations-client';

export default function SitePresence() {
  const pathname = usePathname();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const lastPath = useRef('');
  useEffect(() => {
    if (!pathname || pathname.includes('/admin')) return;
    const send = (kind: 'pageview' | 'identify') => {
      let entryId: number | null = null;
      try { entryId = Number(localStorage.getItem('penguin-fantasy:player-id:v1')) || null; } catch { /* Storage can be unavailable. */ }
      void operationsFetch('/visits', { method: 'POST', body: JSON.stringify({ id: crypto.randomUUID(), ...visitorIdentity(), entryId, kind, path: pathname }) }).catch(() => {});
    };
    if (lastPath.current !== pathname) { lastPath.current = pathname; send('pageview'); }
    let active = true; let checkedAt = Date.now();
    const load = () => { void loadCommunity().then(data => { if (active) setAnnouncements(data.announcements); }).catch(() => {}); };
    load();
    const identify = () => send('identify');
    const visible = () => { if (document.visibilityState === 'visible' && Date.now() - checkedAt > 5 * 60000) { checkedAt = Date.now(); load(); } };
    window.addEventListener('penguin-player-login', identify);
    document.addEventListener('visibilitychange', visible);
    return () => { active = false; window.removeEventListener('penguin-player-login', identify); document.removeEventListener('visibilitychange', visible); };
  }, [pathname]);
  if (!announcements.length || pathname?.includes('/admin')) return null;
  return <aside className="site-announcements" aria-label="今日公告">{announcements.map(item => <article key={item.id}><strong>{item.title}</strong><p>{item.body}</p></article>)}</aside>;
}

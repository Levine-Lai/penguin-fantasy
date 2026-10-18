'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { loadCommunity, type Announcement } from './operations-client';

export default function SitePresence() {
  const pathname = usePathname();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  useEffect(() => {
    if (!pathname || pathname.includes('/admin')) return;
    let active = true; let checkedAt = Date.now();
    const load = () => { void loadCommunity().then(data => { if (active) setAnnouncements(data.announcements); }).catch(() => {}); };
    load();
    const visible = () => { if (document.visibilityState === 'visible' && Date.now() - checkedAt > 5 * 60000) { checkedAt = Date.now(); load(); } };
    document.addEventListener('visibilitychange', visible);
    return () => { active = false; document.removeEventListener('visibilitychange', visible); };
  }, [pathname]);
  if (!announcements.length || pathname?.includes('/admin')) return null;
  return <aside className="site-announcements" aria-label="今日公告">{announcements.map(item => <article key={item.id}><strong>{item.title}</strong><p>{item.body}</p></article>)}</aside>;
}

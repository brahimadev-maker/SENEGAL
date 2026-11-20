'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { IoAlbums, IoAlbumsOutline, IoChatbubble, IoChatbubbleOutline, IoMic, IoMicOutline } from 'react-icons/io5';

import { useNotes } from '@/store/notes';

const TABS = [
  { href: '/', label: 'Vocal', on: IoMic, off: IoMicOutline },
  { href: '/notes', label: 'Mes vocaux', on: IoAlbums, off: IoAlbumsOutline },
  { href: '/assistant', label: 'Assistant', on: IoChatbubble, off: IoChatbubbleOutline },
] as const;

export function TabBar() {
  const path = usePathname();
  const { unseenCount } = useNotes();

  return (
    <nav className="tabbar">
      {TABS.map(({ href, label, on: On, off: Off }) => {
        const active = href === '/' ? path === '/' : path.startsWith(href);
        return (
          <Link key={href} href={href} className={`tab ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined}>
            <span className="tab-icon">
              {active ? <On size={24} /> : <Off size={24} />}
              {href === '/notes' && unseenCount > 0 && <span className="badge">{unseenCount}</span>}
            </span>
            <span className="tab-label">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

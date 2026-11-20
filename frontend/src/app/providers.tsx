'use client';

import { ReactNode, useSyncExternalStore } from 'react';

import { Inscription } from '@/components/Inscription';
import { TabBar } from '@/components/TabBar';
import { NotesProvider } from '@/store/notes';
import { SessionProvider, useSession } from '@/store/session';

const noop = () => () => {};

/**
 * La session et les brouillons vivent dans le navigateur : l'app n'est montée que
 * côté client. Tant que l'utilisateur n'est pas inscrit, seul l'écran d'inscription s'affiche.
 */
export function Providers({ children }: { children: ReactNode }) {
  const isClient = useSyncExternalStore(noop, () => true, () => false);
  if (!isClient) return <div className="app" />;
  return (
    <SessionProvider>
      <Shell>{children}</Shell>
    </SessionProvider>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const { profile } = useSession();
  if (!profile) {
    return (
      <div className="app">
        <main className="screen">
          <Inscription />
        </main>
      </div>
    );
  }
  // `key` : repart d'un état propre si l'utilisateur change.
  return (
    <NotesProvider key={profile.id}>
      <div className="app">
        <main className="screen">{children}</main>
        <TabBar />
      </div>
    </NotesProvider>
  );
}

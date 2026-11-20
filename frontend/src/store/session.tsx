'use client';

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { loadSession, me, saveSession, Session, SESSION_EXPIRED } from '@/lib/api';
import type { Profile } from '@/lib/types';

type Ctx = {
  profile: Profile | null;
  signIn: (s: Session) => void;
  signOut: () => void;
};

const SessionContext = createContext<Ctx | null>(null);

/** Utilisateur inscrit (jeton + profil gardés dans le navigateur). */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState(loadSession);

  const signIn = useCallback((s: Session) => {
    saveSession(s);
    setSession(s);
  }, []);

  const signOut = useCallback(() => {
    saveSession(null);
    setSession(null);
  }, []);

  // Session refusée par le serveur (compte supprimé…) : retour à l'inscription.
  useEffect(() => {
    window.addEventListener(SESSION_EXPIRED, signOut);
    return () => window.removeEventListener(SESSION_EXPIRED, signOut);
  }, [signOut]);

  // Rafraîchit le profil au démarrage.
  const token = session?.token;
  useEffect(() => {
    if (!token) return;
    me()
      .then((profile) => signIn({ token, profile }))
      .catch(() => {});
  }, [token, signIn]);

  const value = useMemo(() => ({ profile: session?.profile ?? null, signIn, signOut }), [session, signIn, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession doit être utilisé dans SessionProvider');
  return ctx;
}

/** Profil de l'utilisateur connecté (les écrans ne s'affichent qu'une fois inscrit). */
export function useProfile(): Profile {
  const { profile } = useSession();
  if (!profile) throw new Error('Utilisateur non inscrit');
  return profile;
}

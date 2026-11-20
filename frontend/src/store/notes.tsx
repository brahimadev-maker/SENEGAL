'use client';

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { cancelAnnonce, createAnnonce, listAnnonces, RemoteAnnonce } from '@/lib/api';
import { deleteBlob, getBlob, loadJSON, now, putBlob, saveJSON, uid } from '@/lib/blobs';
import type { VoiceNote } from '@/lib/types';

const DRAFTS_KEY = 'agrivoix.drafts.v1'; // annonces pas encore enregistrées (audio local en attente)
const CACHE_KEY = 'agrivoix.annonces.v1'; // dernière liste reçue du serveur (affichage hors ligne)
const SEEN_KEY = 'agrivoix.seen.v1'; // ce que l'utilisateur a déjà vu : correspondance + nb de messages
const POLL_MS = 10000;

type Seen = Record<string, { partner?: string; messages: number }>;

type Ctx = {
  notes: VoiceNote[];
  unseenCount: number;
  addNote: (n: { blob?: Blob; text?: string; durationMs: number }) => Promise<void>;
  retryNote: (id: string) => void;
  deleteNote: (id: string) => void;
  markSeen: (id?: string) => void;
  refresh: () => Promise<void>;
};

const NotesContext = createContext<Ctx | null>(null);

const toNote = (r: RemoteAnnonce, seen: Seen): VoiceNote => {
  const s = seen[r.id];
  const matched = r.status === 'matched' && !!r.partner;
  return {
    id: r.id,
    draft: false,
    audioUrl: r.audio_url ?? undefined,
    text: r.source === 'text' ? r.transcript_fr : undefined,
    durationMs: 0,
    createdAt: Date.parse(r.created_at),
    kind: r.kind,
    product: r.product,
    quantity: r.quantity ?? undefined,
    place: r.place ?? undefined,
    transcript: r.source === 'voice' ? r.transcript_fr : undefined,
    status: matched ? 'matched' : 'pending',
    partner: r.partner ?? undefined,
    messagesCount: r.messages_count,
    seen: !matched || (s?.partner === r.partner?.id && s.messages >= r.messages_count),
  };
};

/**
 * Annonces de l'utilisateur. Source de vérité : la base Supabase (via le backend),
 * qui stocke l'audio, la transcription, l'intention et fait le matching.
 * Seuls les brouillons (envoi en cours ou en échec) sont gardés dans le navigateur.
 */
export function NotesProvider({ children }: { children: ReactNode }) {
  const [drafts, setDrafts] = useState(() => loadJSON<VoiceNote[]>(DRAFTS_KEY, []));
  const [remote, setRemote] = useState(() => loadJSON<RemoteAnnonce[]>(CACHE_KEY, []));
  const [seen, setSeen] = useState(() => loadJSON<Seen>(SEEN_KEY, {}));

  const draftsRef = useRef(drafts);
  const remoteRef = useRef(remote);
  useEffect(() => {
    draftsRef.current = drafts;
    saveJSON(DRAFTS_KEY, drafts);
  }, [drafts]);
  useEffect(() => {
    remoteRef.current = remote;
    saveJSON(CACHE_KEY, remote);
  }, [remote]);
  useEffect(() => saveJSON(SEEN_KEY, seen), [seen]);

  const refresh = useCallback(async () => {
    try {
      const list = await listAnnonces();
      const before = new Map(remoteRef.current.map((r) => [r.id, r]));
      const fresh = list.some((r) => {
        const b = before.get(r.id);
        return r.partner && (!b || b.partner?.id !== r.partner.id || b.messages_count < r.messages_count);
      });
      setRemote(list);
      if (fresh) navigator.vibrate?.(60);
    } catch {
      // hors ligne : on garde la dernière liste connue
    }
  }, []);

  const patchDraft = useCallback((id: string, p: Partial<VoiceNote>) => {
    setDrafts((prev) => prev.map((n) => (n.id === id ? { ...n, ...p } : n)));
  }, []);

  /** Envoie le brouillon : audio stocké, transcription, analyse, enregistrement, matching. */
  const process = useCallback(
    async (note: VoiceNote) => {
      try {
        const audio = note.audioId ? await getBlob(note.audioId) : undefined;
        if (note.audioId && !audio) throw new Error('Fichier audio introuvable.');
        const created = await createAnnonce({ text: note.text, audio });
        setRemote((prev) => [created, ...prev.filter((r) => r.id !== created.id)]);
        setDrafts((prev) => prev.filter((n) => n.id !== note.id));
        if (note.audioId) deleteBlob(note.audioId); // l'audio est désormais dans le stockage Supabase
        if (created.partner) navigator.vibrate?.(60);
      } catch (e) {
        patchDraft(note.id, { status: 'error', error: e instanceof Error ? e.message : 'Envoi impossible.' });
      }
    },
    [patchDraft],
  );

  // Au chargement : renvoie les brouillons interrompus, puis suit les correspondances et messages.
  useEffect(() => {
    draftsRef.current.forEach((n) => n.status === 'analyzing' && process(n));
    const first = setTimeout(refresh, 0);
    const timer = setInterval(refresh, POLL_MS);
    window.addEventListener('focus', refresh);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [process, refresh]);

  const addNote: Ctx['addNote'] = useCallback(
    async ({ blob, text, durationMs }) => {
      const audioId = blob ? await putBlob(blob) : undefined;
      const note: VoiceNote = {
        id: uid('d-'),
        draft: true,
        audioId,
        text,
        durationMs,
        createdAt: now(),
        status: 'analyzing',
        messagesCount: 0,
        seen: true,
      };
      setDrafts((prev) => [note, ...prev]);
      process(note);
    },
    [process],
  );

  const retryNote = useCallback(
    (id: string) => {
      const note = draftsRef.current.find((n) => n.id === id);
      if (!note) return;
      patchDraft(id, { status: 'analyzing', error: undefined });
      process(note);
    },
    [patchDraft, process],
  );

  const deleteNote = useCallback((id: string) => {
    const draft = draftsRef.current.find((n) => n.id === id);
    if (draft) {
      if (draft.audioId) deleteBlob(draft.audioId);
      setDrafts((prev) => prev.filter((n) => n.id !== id));
      return;
    }
    setRemote((prev) => prev.filter((r) => r.id !== id));
    cancelAnnonce(id).catch(() => {});
  }, []);

  /** Marque comme vu (une annonce, ou toutes). */
  const markSeen = useCallback((id?: string) => {
    setSeen((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const r of remoteRef.current) {
        if (id && r.id !== id) continue;
        const cur = { partner: r.partner?.id, messages: r.messages_count };
        if (prev[r.id]?.partner !== cur.partner || prev[r.id]?.messages !== cur.messages) {
          next[r.id] = cur;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  const notes = useMemo(() => [...drafts, ...remote.map((r) => toNote(r, seen))], [drafts, remote, seen]);
  const unseenCount = useMemo(() => notes.filter((n) => !n.seen).length, [notes]);

  const value = useMemo(
    () => ({ notes, unseenCount, addNote, retryNote, deleteNote, markSeen, refresh }),
    [notes, unseenCount, addNote, retryNote, deleteNote, markSeen, refresh],
  );
  return <NotesContext.Provider value={value}>{children}</NotesContext.Provider>;
}

export function useNotes() {
  const ctx = useContext(NotesContext);
  if (!ctx) throw new Error('useNotes doit être utilisé dans NotesProvider');
  return ctx;
}

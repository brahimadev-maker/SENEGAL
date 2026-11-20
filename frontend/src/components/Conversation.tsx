'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { IoCall, IoChevronBack } from 'react-icons/io5';

import { usePressToTalk } from '@/hooks/usePressToTalk';
import { listMessages, RemoteMessage, sendMessage } from '@/lib/api';
import { uid } from '@/lib/blobs';
import type { ChatMessage } from '@/lib/types';
import { useNotes } from '@/store/notes';
import { Bubble } from './Bubble';
import { Composer } from './Composer';
import { NavBar } from './ScreenHeader';

const POLL_MS = 4000;

const toChat = (m: RemoteMessage): ChatMessage => ({
  id: m.id,
  role: m.mine ? 'user' : 'assistant',
  createdAt: Date.parse(m.created_at),
  text: m.text ?? undefined,
  audioUrl: m.audio_url ?? undefined,
  durationMs: m.duration_ms ?? undefined,
});

/** Conversation avec la personne trouvée pour une annonce (messages stockés dans Supabase). */
export function Conversation({ id, onBack }: { id: string; onBack: () => void }) {
  const { notes, markSeen, refresh } = useNotes();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<ChatMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  const note = notes.find((n) => n.id === id);
  const partner = note?.partner;

  const load = useCallback(async () => {
    try {
      const list = await listMessages(id);
      setMessages(list.map(toChat));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Messages indisponibles.');
    } finally {
      setLoaded(true);
    }
  }, [id]);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const timer = setInterval(load, POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  // Les messages affichés comptent comme lus.
  useEffect(() => {
    if (loaded) markSeen(id);
  }, [loaded, messages.length, id, markSeen]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, pending.length]);

  const deliver = async (payload: { text?: string; blob?: Blob; durationMs?: number }) => {
    const temp: ChatMessage = { id: uid('p-'), role: 'user', createdAt: Date.now(), text: payload.text ?? 'Envoi du vocal…', pending: true };
    setPending((p) => [...p, temp]);
    try {
      const sent = await sendMessage(id, { text: payload.text, audio: payload.blob, durationMs: payload.durationMs });
      setMessages((m) => (m.some((x) => x.id === sent.id) ? m : [...m, toChat(sent)]));
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Message non envoyé.');
    } finally {
      setPending((p) => p.filter((x) => x.id !== temp.id));
    }
  };

  const ptt = usePressToTalk((rec) => deliver({ blob: rec.blob, durationMs: rec.durationMs }));

  if (!partner) {
    return (
      <div className="missing">
        <p>Cette mise en relation n’existe plus.</p>
        <button type="button" className="link-btn" onClick={onBack}>
          Retour
        </button>
      </div>
    );
  }

  const sendText = () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    deliver({ text: t });
  };

  return (
    <div className="screen-col">
      <NavBar
        title={partner.name}
        subtitle={partner.place ?? undefined}
        left={
          <button type="button" className="nav-btn" onClick={onBack} aria-label="Retour">
            <IoChevronBack size={24} /> Retour
          </button>
        }
        right={
          <a className="nav-btn" href={`tel:${partner.phone}`} aria-label={`Appeler ${partner.name}`}>
            <IoCall size={21} />
          </a>
        }
      />

      <div className="scroll">
        <div className="chat-list">
          <p className="hint">
            {partner.kind === 'offer' ? 'Vend' : 'Cherche'} : {partner.transcript_fr}
          </p>
          {loaded && messages.length === 0 && pending.length === 0 && <p className="hint">Envoyez un premier message à {partner.name}.</p>}
          {messages.map((m) => (
            <Bubble key={m.id} m={m} />
          ))}
          {pending.map((m) => (
            <Bubble key={m.id} m={m} />
          ))}
          {error && <p className="form-error center">{error}</p>}
          <div ref={endRef} />
        </div>
      </div>

      <Composer value={text} onChange={setText} onSend={sendText} ptt={ptt} placeholder="Message" />
    </div>
  );
}

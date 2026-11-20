'use client';

import { useEffect, useRef, useState } from 'react';
import { IoCameraOutline, IoClose, IoCreateOutline, IoListOutline, IoTrashOutline, IoVolumeHighOutline, IoVolumeMuteOutline } from 'react-icons/io5';

import { Bubble, TypingBubble } from '@/components/Bubble';
import { Composer } from '@/components/Composer';
import { NavBar } from '@/components/ScreenHeader';
import { usePressToTalk } from '@/hooks/usePressToTalk';
import { askAssistant } from '@/lib/api';
import { base64ToBlob, deleteBlob, loadJSON, makeMessage, putBlob, saveJSON, uid } from '@/lib/blobs';
import type { ChatMessage } from '@/lib/types';

const KEY = 'agrivoix.assistant.v2';
const VOICE_KEY = 'agrivoix.assistant.voiceReply';

type Conv = { id: string; title: string; updatedAt: number; messages: ChatMessage[] };
type Payload = { text?: string; image?: Blob; audio?: Blob; durationMs?: number };

const SUGGESTIONS = ['Mes feuilles ont des taches', 'Quel engrais pour le maïs ?', 'Comment bien arroser ?', 'Des chenilles dans mon champ'];

const titleOf = (p: Payload) => (p.text ? p.text.slice(0, 42) : p.image ? 'Photo de plantation' : 'Message vocal');

/** Texte d'un message tel qu'on le renvoie au modèle comme historique. */
const historyText = (m: ChatMessage) => (m.error ? '' : m.role === 'user' ? [m.text, m.caption].filter(Boolean).join('\n') : (m.text ?? ''));

export default function AssistantPage() {
  const [convs, setConvs] = useState(() => loadJSON<Conv[]>(KEY, []));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [thinkingId, setThinkingId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [image, setImage] = useState<{ blob: Blob; url: string } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [voiceReply, setVoiceReply] = useState(() => loadJSON<boolean>(VOICE_KEY, false));
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const active = convs.find((c) => c.id === activeId) ?? null;
  const messages = active?.messages ?? [];
  const thinking = thinkingId !== null && thinkingId === activeId;

  useEffect(() => saveJSON(KEY, convs), [convs]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, thinking]);

  const append = (convId: string, m: Omit<ChatMessage, 'id' | 'createdAt'>, title?: string) => {
    const msg: ChatMessage = makeMessage(m);
    setConvs((prev) =>
      prev.some((c) => c.id === convId)
        ? prev.map((c) => (c.id === convId ? { ...c, updatedAt: msg.createdAt, messages: [...c.messages, msg] } : c))
        : [{ id: convId, title: title ?? 'Discussion', updatedAt: msg.createdAt, messages: [msg] }, ...prev],
    );
    return msg.id;
  };

  const patchMessage = (convId: string, msgId: string, p: Partial<ChatMessage>) =>
    setConvs((prev) =>
      prev.map((c) => (c.id === convId ? { ...c, messages: c.messages.map((m) => (m.id === msgId ? { ...m, ...p } : m)) } : c)),
    );

  const ask = async (payload: Payload) => {
    if (thinking) return;
    const convId = activeId ?? uid('c-');
    if (!activeId) setActiveId(convId);
    const history = messages.map((m) => ({ role: m.role, text: historyText(m) })).filter((m) => m.text);

    const [imageId, audioId] = await Promise.all([
      payload.image ? putBlob(payload.image) : undefined,
      payload.audio ? putBlob(payload.audio) : undefined,
    ]);
    const userMsgId = append(convId, { role: 'user', text: payload.text, imageId, audioId, durationMs: payload.durationMs }, titleOf(payload));
    setThinkingId(convId);

    try {
      const r = await askAssistant({ history, text: payload.text, image: payload.image, audio: payload.audio, voiceReply });
      if (r.question_fr) patchMessage(convId, userMsgId, { caption: r.question_fr });
      const replyAudio = r.audio_b64 ? await putBlob(base64ToBlob(r.audio_b64, 'audio/mpeg')) : undefined;
      append(convId, { role: 'assistant', text: r.answer_fr, audioId: replyAudio, caption: r.voice_error });
    } catch (e) {
      append(convId, { role: 'assistant', error: true, text: e instanceof Error ? e.message : 'Une erreur est survenue.' });
    } finally {
      setThinkingId(null);
    }
  };

  // Maintenir le micro, parler, relâcher : la question part.
  const ptt = usePressToTalk((rec) => ask({ audio: rec.blob, durationMs: rec.durationMs }));

  const clearImage = () => {
    if (image) URL.revokeObjectURL(image.url);
    setImage(null);
  };

  const sendText = () => {
    if ((!text.trim() && !image) || thinking) return;
    ask({ text: text.trim() || undefined, image: image?.blob });
    setText('');
    clearImage();
  };

  const onPickImage = (file: File | undefined) => {
    if (!file) return;
    if (image) URL.revokeObjectURL(image.url);
    setImage({ blob: file, url: URL.createObjectURL(file) });
  };

  const toggleVoice = () =>
    setVoiceReply((v) => {
      saveJSON(VOICE_KEY, !v);
      return !v;
    });

  const newChat = () => {
    setActiveId(null);
    setText('');
    clearImage();
    setMenuOpen(false);
  };

  const removeChat = (c: Conv) => {
    if (!window.confirm(`Supprimer cette discussion ?\n${c.title}`)) return;
    c.messages.forEach((m) => {
      if (m.audioId) deleteBlob(m.audioId);
      if (m.imageId) deleteBlob(m.imageId);
    });
    setConvs((prev) => prev.filter((x) => x.id !== c.id));
    if (activeId === c.id) setActiveId(null);
  };

  const sorted = [...convs].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className="screen-col">
      <NavBar
        title={active?.title ?? 'Assistant'}
        left={
          <button type="button" className="nav-btn" onClick={() => setMenuOpen(true)} aria-label="Mes discussions">
            <IoListOutline size={24} />
          </button>
        }
        right={
          <>
            <button
              type="button"
              className={`nav-btn ${voiceReply ? 'on' : 'off'}`}
              onClick={toggleVoice}
              aria-pressed={voiceReply}
              aria-label="Réponses lues en dioula"
              title={voiceReply ? 'Réponses lues en dioula : activé' : 'Réponses lues en dioula : désactivé'}
            >
              {voiceReply ? <IoVolumeHighOutline size={22} /> : <IoVolumeMuteOutline size={22} />}
            </button>
            <button type="button" className="nav-btn" onClick={newChat} aria-label="Nouvelle discussion">
              <IoCreateOutline size={22} />
            </button>
          </>
        }
      />

      {messages.length === 0 && !thinking ? (
        <div className="a-empty">
          <h2>Comment puis-je vous aider ?</h2>
          <p>Posez une question, envoyez une photo ou maintenez le micro pour parler en dioula.</p>
          <div className="group suggestions">
            {SUGGESTIONS.map((s) => (
              <div key={s} className="row">
                <button type="button" className="suggestion" onClick={() => ask({ text: s })}>
                  {s}
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="scroll">
          <div className="chat-list">
            {messages.map((m) => (
              <Bubble key={m.id} m={m} />
            ))}
            {thinking && <TypingBubble label="L’assistant réfléchit" />}
            <div ref={endRef} />
          </div>
        </div>
      )}

      {image && (
        <div className="preview">
          {/* eslint-disable-next-line @next/next/no-img-element -- aperçu local (blob:) */}
          <img src={image.url} alt="Photo à envoyer" />
          <button type="button" onClick={clearImage} aria-label="Retirer la photo">
            <IoClose size={14} />
          </button>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(e) => {
          onPickImage(e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      <Composer
        value={text}
        onChange={setText}
        onSend={sendText}
        ptt={ptt}
        disabled={thinking}
        placeholder={image ? 'Ajoutez une question (facultatif)' : 'Question'}
        leading={
          <button type="button" className="ghost-btn" onClick={() => fileRef.current?.click()} aria-label="Ajouter une photo">
            <IoCameraOutline size={24} />
          </button>
        }
      />

      <div className={`overlay ${menuOpen ? 'open' : ''}`} onClick={() => setMenuOpen(false)} aria-hidden />
      <aside className={`drawer ${menuOpen ? 'open' : ''}`} aria-hidden={!menuOpen}>
        <h2>Discussions</h2>
        <button type="button" className="btn primary block" onClick={newChat}>
          Nouvelle discussion
        </button>
        <div className="drawer-list">
          <div className="group">
            {sorted.length === 0 && <p className="drawer-empty">Aucune discussion.</p>}
            {sorted.map((c) => (
              <div key={c.id} className={`row ${c.id === activeId ? 'active' : ''}`}>
                <button
                  type="button"
                  className="conv-title"
                  onClick={() => {
                    setActiveId(c.id);
                    setMenuOpen(false);
                  }}
                >
                  {c.title}
                </button>
                <button type="button" className="icon-btn" onClick={() => removeChat(c)} aria-label="Supprimer la discussion">
                  <IoTrashOutline size={17} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}

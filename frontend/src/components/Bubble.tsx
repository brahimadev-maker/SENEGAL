'use client';

import { useEffect, useState } from 'react';

import { IoStop, IoVolumeHighOutline } from 'react-icons/io5';

import { getBlob } from '@/lib/blobs';
import { canSpeak, speak, stopSpeaking } from '@/lib/speech';
import { LANG_LABEL, type ChatMessage } from '@/lib/types';
import { AudioPlayer } from './AudioPlayer';

/** Réponse française / anglaise : lecture par la voix native du navigateur. */
function SpeakButton({ text, lang, autoPlay }: { text: string; lang: 'fr' | 'en'; autoPlay?: boolean }) {
  const [playing, setPlaying] = useState(false);

  const start = () => {
    setPlaying(true);
    speak(text, lang, () => setPlaying(false));
  };

  useEffect(() => {
    if (!autoPlay) return;
    const t = setTimeout(start, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lecture automatique une seule fois
  }, []);

  useEffect(() => () => stopSpeaking(), []);

  return (
    <button
      type="button"
      className="speak-btn"
      onClick={() => (playing ? (stopSpeaking(), setPlaying(false)) : start())}
      aria-label={playing ? 'Arrêter la lecture' : 'Écouter la réponse'}
    >
      {playing ? <IoStop size={15} /> : <IoVolumeHighOutline size={16} />}
      <span>{playing ? 'Arrêter' : 'Écouter'}</span>
    </button>
  );
}

function StoredImage({ id }: { id: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    getBlob(id).then((b) => b && setUrl((u = URL.createObjectURL(b))));
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [id]);
  // eslint-disable-next-line @next/next/no-img-element -- image locale (blob:)
  return url ? <img src={url} alt="Photo envoyée" className="bubble-img" /> : <div className="bubble-img" />;
}

export function Bubble({ m, autoSpeak }: { m: ChatMessage; autoSpeak?: boolean }) {
  const mine = m.role === 'user';
  const speakable = !mine && !m.error && !m.audioId && !m.audioUrl && !!m.text && canSpeak(m.lang);
  return (
    <div className={`bubble ${mine ? 'mine' : 'theirs'}${m.error ? ' error' : ''}${m.pending ? ' pending' : ''}`}>
      {m.imageId && <StoredImage id={m.imageId} />}
      {(m.audioUrl || m.audioId) && (
        <AudioPlayer src={m.audioUrl} blobId={m.audioId} durationMs={m.durationMs ?? 0} tone={mine ? 'dark' : 'light'} />
      )}
      {m.text ? <p className="bubble-text">{m.text}</p> : null}
      {m.caption ? (
        <p className="bubble-caption">
          {mine && m.lang && (m.audioId || m.audioUrl) ? <span className="lang-tag">{LANG_LABEL[m.lang]}</span> : null}
          {m.caption}
        </p>
      ) : null}
      {speakable && <SpeakButton text={m.text!} lang={m.lang as 'fr' | 'en'} autoPlay={autoSpeak} />}
    </div>
  );
}

export function TypingBubble({ label }: { label: string }) {
  return (
    <div className="bubble theirs">
      <p className="bubble-text muted">
        {label}
        <span className="dots" aria-hidden>
          <i />
          <i />
          <i />
        </span>
      </p>
    </div>
  );
}

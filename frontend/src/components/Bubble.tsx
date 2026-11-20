'use client';

import { useEffect, useState } from 'react';

import { getBlob } from '@/lib/blobs';
import type { ChatMessage } from '@/lib/types';
import { AudioPlayer } from './AudioPlayer';

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

export function Bubble({ m }: { m: ChatMessage }) {
  const mine = m.role === 'user';
  return (
    <div className={`bubble ${mine ? 'mine' : 'theirs'}${m.error ? ' error' : ''}${m.pending ? ' pending' : ''}`}>
      {m.imageId && <StoredImage id={m.imageId} />}
      {(m.audioUrl || m.audioId) && (
        <AudioPlayer src={m.audioUrl} blobId={m.audioId} durationMs={m.durationMs ?? 0} tone={mine ? 'dark' : 'light'} />
      )}
      {m.text ? <p className="bubble-text">{m.text}</p> : null}
      {m.caption ? <p className="bubble-caption">{m.caption}</p> : null}
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

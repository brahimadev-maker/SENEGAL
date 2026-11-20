'use client';

import { useEffect, useRef, useState } from 'react';
import { IoPause, IoPlay } from 'react-icons/io5';

import { formatDuration } from '@/hooks/useVoiceRecorder';
import { getBlob } from '@/lib/blobs';

type Props = { src?: string; blobId?: string; blob?: Blob; durationMs: number; tone?: 'light' | 'dark' };

/** Lecteur audio compact : lien distant (stockage Supabase), fichier local (IndexedDB) ou Blob en mémoire. */
export function AudioPlayer({ src, blobId, blob, durationMs, tone = 'light' }: Props) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [localUrl, setUrl] = useState<string | null>(null);
  const url = src ?? localUrl;
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(durationMs);

  useEffect(() => {
    if (src) return;
    let alive = true;
    let objectUrl: string | null = null;
    (async () => {
      const b = blob ?? (blobId ? await getBlob(blobId) : undefined);
      if (!alive || !b) return;
      objectUrl = URL.createObjectURL(b);
      setUrl(objectUrl);
    })();
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, blob, blobId]);

  const toggle = () => {
    const a = audio.current;
    if (!a) return;
    if (a.paused) {
      if (a.ended) a.currentTime = 0;
      a.play().catch(() => {});
    } else a.pause();
  };

  const progress = total > 0 ? Math.min(1, (current * 1000) / total) : 0;

  return (
    <div className={`player ${tone}`}>
      {url && (
        <audio
          ref={audio}
          src={url}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setTotal(e.currentTarget.duration * 1000)}
        />
      )}
      <button type="button" className="player-btn" onClick={toggle} disabled={!url} aria-label={playing ? 'Pause' : 'Lecture'}>
        {playing ? <IoPause size={18} /> : <IoPlay size={18} />}
      </button>
      <div className="player-track">
        <div className="player-fill" style={{ width: `${progress * 100}%` }} />
      </div>
      <span className="player-time">{formatDuration(playing ? current * 1000 : total)}</span>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type Recording = { blob: Blob; durationMs: number };

const TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];

/** Enregistrement vocal via MediaRecorder : démarrer / arrêter (garde l'audio) / annuler. */
export function useVoiceRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [durationMs, setDurationMs] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    rec.current?.stream.getTracks().forEach((t) => t.stop());
    rec.current = null;
    setIsRecording(false);
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const start = useCallback(async () => {
    if (rec.current) return false;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      alert("L'enregistrement vocal n'est pas disponible dans ce navigateur.");
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported(t));
      const r = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunks.current = [];
      r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      r.start(250);
      rec.current = r;
      startedAt.current = Date.now();
      setDurationMs(0);
      setIsRecording(true);
      timer.current = setInterval(() => setDurationMs(Date.now() - startedAt.current), 200);
      return true;
    } catch {
      alert('Micro refusé. Autorisez le micro dans les réglages du navigateur pour enregistrer un vocal.');
      return false;
    }
  }, []);

  /** Arrête et renvoie l'audio (null si trop court ou annulé). */
  const stop = useCallback(async (): Promise<Recording | null> => {
    const r = rec.current;
    if (!r) return null;
    const ms = Date.now() - startedAt.current;
    const done = new Promise<void>((resolve) => (r.onstop = () => resolve()));
    r.stop();
    await done;
    cleanup();
    if (ms < 700) return null; // trop court : ignoré
    return { blob: new Blob(chunks.current, { type: r.mimeType || 'audio/webm' }), durationMs: ms };
  }, [cleanup]);

  return { isRecording, durationMs, start, stop };
}

export function formatDuration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

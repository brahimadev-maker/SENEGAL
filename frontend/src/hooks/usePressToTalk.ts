'use client';

import { KeyboardEvent, PointerEvent, useCallback, useEffect, useRef, useState } from 'react';

import { Recording, useVoiceRecorder } from './useVoiceRecorder';

/**
 * « Appuyer pour parler » : l'enregistrement démarre quand on appuie sur le bouton,
 * et le vocal est envoyé dès qu'on relâche. Un appui trop court est ignoré.
 *
 * Usage : const ptt = usePressToTalk(envoyer); <button {...ptt.bind} />
 */
export function usePressToTalk(onRecorded: (rec: Recording) => void) {
  const { isRecording, durationMs, start, stop } = useVoiceRecorder();
  const [tooShort, setTooShort] = useState(false);
  const held = useRef(false);
  const callback = useRef(onRecorded);
  useEffect(() => {
    callback.current = onRecorded;
  });

  const press = useCallback(async () => {
    if (held.current) return;
    held.current = true;
    setTooShort(false);
    navigator.vibrate?.(10);
    const started = await start();
    // Relâché pendant la demande d'accès au micro : on n'envoie rien.
    if (started && !held.current) {
      await stop();
      setTooShort(true);
    }
  }, [start, stop]);

  const release = useCallback(async () => {
    if (!held.current) return;
    held.current = false;
    const rec = await stop();
    if (rec) callback.current(rec);
    else setTooShort(true);
  }, [stop]);

  const cancel = useCallback(async () => {
    held.current = false;
    await stop();
  }, [stop]);

  const bind = {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId); // le relâchement arrive même si le doigt glisse
      press();
    },
    onPointerUp: () => release(),
    onPointerCancel: () => cancel(),
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
    // Clavier : maintenir Espace ou Entrée.
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
        e.preventDefault();
        press();
      }
    },
    onKeyUp: (e: KeyboardEvent<HTMLElement>) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        release();
      }
    },
  };

  return { isRecording, durationMs, tooShort, bind };
}

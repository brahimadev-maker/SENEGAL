'use client';

import { IoMic } from 'react-icons/io5';

import { usePressToTalk } from '@/hooks/usePressToTalk';

type PTT = ReturnType<typeof usePressToTalk>;

/** Bouton « maintenir pour parler » (grand au centre de l'écran Vocal, petit dans les barres de saisie). */
export function MicButton({ ptt, small }: { ptt: PTT; small?: boolean }) {
  return (
    <button
      type="button"
      className={`ptt${small ? ' small' : ''}${ptt.isRecording ? ' rec' : ''}`}
      aria-label={ptt.isRecording ? 'Relâchez pour envoyer' : 'Maintenez pour parler'}
      title="Maintenez pour parler, relâchez pour envoyer"
      {...ptt.bind}
    >
      <IoMic size={small ? 20 : 46} />
    </button>
  );
}

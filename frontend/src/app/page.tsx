'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { MicButton } from '@/components/MicButton';
import { AccountButton } from '@/components/AccountButton';
import { LargeTitle } from '@/components/ScreenHeader';
import { usePressToTalk } from '@/hooks/usePressToTalk';
import { formatDuration } from '@/hooks/useVoiceRecorder';
import { useNotes } from '@/store/notes';
import { useProfile } from '@/store/session';

type Mode = 'voice' | 'text';

export default function VocalPage() {
  const router = useRouter();
  const profile = useProfile();
  const { addNote } = useNotes();
  const [mode, setMode] = useState<Mode>('voice');
  const [text, setText] = useState('');

  // Relâcher = envoyer : l'annonce part tout de suite, on l'affiche dans « Mes vocaux ».
  const ptt = usePressToTalk(async (rec) => {
    await addNote({ blob: rec.blob, durationMs: rec.durationMs });
    router.push('/notes');
  });

  const sendText = async () => {
    const t = text.trim();
    if (!t) return;
    await addNote({ text: t, durationMs: 0 });
    setText('');
    router.push('/notes');
  };

  return (
    <div className="vocal">
      <LargeTitle title={`Bonjour ${profile.name.split(' ')[0]}`} subtitle={profile.place ?? undefined} action={<AccountButton />} />

      <div className="segmented" role="tablist">
        {(['voice', 'text'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            className={mode === m ? 'active' : ''}
            onClick={() => !ptt.isRecording && setMode(m)}
          >
            {m === 'voice' ? 'Vocal' : 'Texte'}
          </button>
        ))}
      </div>

      {mode === 'voice' ? (
        <div className="vocal-body">
          <MicButton ptt={ptt} />
          <div className="timer">{ptt.isRecording ? formatDuration(ptt.durationMs) : ''}</div>
          <p className="hold-label">{ptt.isRecording ? 'Relâchez pour envoyer' : 'Maintenez pour parler'}</p>
          <p className={`hold-hint${ptt.tooShort && !ptt.isRecording ? ' warn' : ''}`}>
            {ptt.tooShort && !ptt.isRecording
              ? 'Gardez le doigt sur le bouton pendant que vous parlez.'
              : 'Dites ce que vous vendez ou cherchez, avec le produit et la quantité.'}
          </p>
        </div>
      ) : (
        <div className="text-card">
          <textarea
            className="text-area"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Ex. : Je vends 500 kg de maïs à Bouaké"
          />
          <button type="button" className="btn primary block" style={{ marginTop: 16 }} disabled={!text.trim()} onClick={sendText}>
            Envoyer
          </button>
        </div>
      )}
    </div>
  );
}

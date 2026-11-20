'use client';

import type { ComponentType, ReactNode } from 'react';
import { IoArrowUp } from 'react-icons/io5';

import { formatDuration } from '@/hooks/useVoiceRecorder';
import { usePressToTalk } from '@/hooks/usePressToTalk';
import { MicButton } from './MicButton';

type IconType = ComponentType<{ size?: number }>;

export function RoundButton({ icon: Icon, onClick, label, disabled }: { icon: IconType; onClick: () => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" className="round-btn" onClick={onClick} aria-label={label} title={label} disabled={disabled}>
      <Icon size={20} />
    </button>
  );
}

/**
 * Barre de saisie façon Messages : champ texte, flèche d'envoi quand il y a du texte,
 * sinon micro « maintenir pour parler » (le vocal part au relâchement).
 */
export function Composer({
  value,
  onChange,
  onSend,
  ptt,
  placeholder,
  leading,
  disabled,
}: {
  value: string;
  onChange: (t: string) => void;
  onSend: () => void;
  ptt: ReturnType<typeof usePressToTalk>;
  placeholder: string;
  leading?: ReactNode;
  disabled?: boolean;
}) {
  const hasText = value.trim().length > 0;
  return (
    <div className="composer">
      {!ptt.isRecording && leading}
      {ptt.isRecording ? (
        <div className="composer-rec">
          <i className="rec-dot" />
          {formatDuration(ptt.durationMs)}
          <span>· Relâchez pour envoyer</span>
        </div>
      ) : (
        <div className="composer-field">
          <textarea
            className="composer-input"
            value={value}
            rows={1}
            placeholder={ptt.tooShort ? 'Maintenez le micro pendant que vous parlez' : placeholder}
            onChange={(e) => {
              onChange(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(110, e.target.scrollHeight)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!disabled) onSend();
              }
            }}
          />
        </div>
      )}
      {/* Le micro reste au même endroit pendant l'appui (le geste ne doit pas être interrompu). */}
      {hasText && !ptt.isRecording ? (
        <RoundButton icon={IoArrowUp} onClick={onSend} label="Envoyer" disabled={disabled} />
      ) : (
        <MicButton ptt={ptt} small />
      )}
    </div>
  );
}

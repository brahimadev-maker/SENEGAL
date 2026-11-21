'use client';

import { useState } from 'react';
import { IoPersonCircleOutline } from 'react-icons/io5';

import { loadSession, logout, setPin } from '@/lib/api';
import { stopSpeaking } from '@/lib/speech';
import { useSession } from '@/store/session';
import { PinInput } from './PinInput';

/** Bouton en haut à droite : compte et déconnexion. */
export function AccountButton() {
  const { profile, signIn, signOut } = useSession();
  const [open, setOpen] = useState(false);
  const [pin, setPinValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!profile) return null;
  const needsPin = !profile.has_pin;

  const close = () => {
    setOpen(false);
    setPinValue('');
    setError(null);
  };

  const disconnect = async () => {
    setBusy(true);
    setError(null);
    try {
      // Compte sans code : on le crée d'abord, sinon impossible de revenir.
      if (needsPin) {
        const updated = await setPin(pin);
        const token = loadSession()?.token;
        if (token) signIn({ token, profile: updated });
      }
      await logout().catch(() => {}); // la session locale est fermée même hors ligne
      stopSpeaking();
      signOut();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Déconnexion impossible.');
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" className="account-btn" onClick={() => setOpen(true)} aria-label="Mon compte">
        <IoPersonCircleOutline size={30} />
      </button>

      <div className={`overlay ${open ? 'open' : ''}`} onClick={close} aria-hidden />
      <div className={`sheet ${open ? 'open' : ''}`} role="dialog" aria-modal="true" aria-label="Mon compte" aria-hidden={!open}>
        <div className="sheet-grabber" />
        <div className="group">
          <div className="row account-row">
            <span>Nom</span>
            <strong>{profile.name}</strong>
          </div>
          <div className="row account-row">
            <span>Téléphone</span>
            <strong>{profile.phone}</strong>
          </div>
          {profile.place && (
            <div className="row account-row">
              <span>Lieu</span>
              <strong>{profile.place}</strong>
            </div>
          )}
        </div>

        {needsPin && (
          <>
            <div className="group">
              <div className="field">
                <label htmlFor="new-pin">Code</label>
                <PinInput id="new-pin" value={pin} onChange={setPinValue} />
              </div>
            </div>
            <p className="group-note">Créez un code à 4 chiffres : il vous servira à vous reconnecter avec votre numéro.</p>
          </>
        )}

        {error && <p className="form-error">{error}</p>}

        <button type="button" className="btn danger block" onClick={disconnect} disabled={busy || (needsPin && pin.length !== 4)}>
          {busy ? 'Déconnexion…' : 'Se déconnecter'}
        </button>
        <button type="button" className="btn plain block" onClick={close}>
          Annuler
        </button>
      </div>
    </>
  );
}

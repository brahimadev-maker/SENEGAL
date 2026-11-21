'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { IoLocation, IoLocationOutline } from 'react-icons/io5';

import { localite, login, register } from '@/lib/api';
import { useSession } from '@/store/session';
import { PinInput } from './PinInput';

type Geo =
  | { state: 'searching' }
  | { state: 'found'; lat: number; lng: number; place: string }
  | { state: 'failed'; reason: string };

type Mode = 'signup' | 'login';

/** Accueil : inscription (nom, téléphone, code, position automatique) ou connexion (téléphone + code). */
export function Inscription() {
  const [mode, setMode] = useState<Mode>('signup');

  return (
    <div className="scroll">
      <div className="signup">
        <div className="signup-head">
          <h1>AgriVoix</h1>
          <p>Vendez et achetez vos récoltes à la voix, près de chez vous.</p>
        </div>

        <div className="segmented" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>
            Inscription
          </button>
          <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>
            Connexion
          </button>
        </div>

        {mode === 'signup' ? <SignupForm /> : <LoginForm />}
      </div>
    </div>
  );
}

function LoginForm() {
  const { signIn } = useSession();
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSubmit = phone.replace(/\D/g, '').length >= 8 && pin.length === 4 && !sending;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSending(true);
    setError(null);
    try {
      signIn(await login(phone, pin));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connexion impossible.');
      setSending(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <div className="group">
        <div className="field">
          <label htmlFor="login-phone">Téléphone</label>
          <input id="login-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07 01 02 03 04" inputMode="tel" autoComplete="tel" required />
        </div>
        <div className="field">
          <label htmlFor="login-pin">Code</label>
          <PinInput id="login-pin" value={pin} onChange={setPin} />
        </div>
      </div>
      <p className="group-note">Le code à 4 chiffres choisi à l’inscription.</p>

      {error && <p className="form-error">{error}</p>}

      <button type="submit" className="btn primary block" disabled={!canSubmit}>
        {sending ? 'Connexion…' : 'Se connecter'}
      </button>
    </form>
  );
}

function SignupForm() {
  const { signIn } = useSession();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [manualPlace, setManualPlace] = useState('');
  const [geo, setGeo] = useState<Geo>({ state: 'searching' });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const locate = useCallback(() => {
    if (!navigator.geolocation) {
      setGeo({ state: 'failed', reason: 'Non disponible' });
      return;
    }
    setGeo({ state: 'searching' });
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const lat = Number(coords.latitude.toFixed(5));
        const lng = Number(coords.longitude.toFixed(5));
        const place = await localite(lat, lng).then((r) => r.place).catch(() => '');
        setGeo({ state: 'found', lat, lng, place });
      },
      (err) => setGeo({ state: 'failed', reason: err.code === err.PERMISSION_DENIED ? 'Refusée' : 'Introuvable' }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  }, []);

  // La position est demandée dès l'ouverture de l'écran.
  useEffect(() => {
    const t = setTimeout(locate, 0);
    return () => clearTimeout(t);
  }, [locate]);

  const place = geo.state === 'found' && geo.place ? geo.place : manualPlace.trim();
  const needsPlace = geo.state === 'failed' || (geo.state === 'found' && !geo.place);
  const canSubmit =
    name.trim().length >= 2 && phone.replace(/\D/g, '').length >= 8 && pin.length === 4 && (geo.state === 'found' || !!place) && !sending;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSending(true);
    setError(null);
    try {
      signIn(
        await register({
          name: name.trim(),
          phone,
          pin,
          lat: geo.state === 'found' ? geo.lat : undefined,
          lng: geo.state === 'found' ? geo.lng : undefined,
          place: place || undefined,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Inscription impossible.');
      setSending(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <div className="group">
        <div className="field">
          <label htmlFor="name">Nom</label>
          <input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Awa Koné" autoComplete="name" maxLength={80} required />
        </div>
        <div className="field">
          <label htmlFor="phone">Téléphone</label>
          <input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07 01 02 03 04" inputMode="tel" autoComplete="tel" required />
        </div>
        <div className="field">
          <label htmlFor="pin">Code</label>
          <PinInput id="pin" value={pin} onChange={setPin} />
        </div>
        <div className="field">
          <label>Position</label>
          <div className={`geo ${geo.state}`}>
            {geo.state === 'found' ? <IoLocation size={18} /> : <IoLocationOutline size={18} />}
            <span>
              {geo.state === 'searching' && 'Recherche…'}
              {geo.state === 'found' && (geo.place || 'Trouvée')}
              {geo.state === 'failed' && geo.reason}
            </span>
            {geo.state !== 'searching' && (
              <button type="button" className="geo-retry" onClick={locate}>
                Actualiser
              </button>
            )}
          </div>
        </div>
        {needsPlace && (
          <div className="field">
            <label htmlFor="place">Ville</label>
            <input id="place" value={manualPlace} onChange={(e) => setManualPlace(e.target.value)} placeholder="Ville ou village" autoComplete="address-level2" />
          </div>
        )}
      </div>
      <p className="group-note">
        Choisissez un code à 4 chiffres pour vous reconnecter. Votre position est détectée automatiquement. Numéro sans indicatif = Côte d’Ivoire (+225).
      </p>

      {error && <p className="form-error">{error}</p>}

      <button type="submit" className="btn primary block" disabled={!canSubmit}>
        {sending ? 'Inscription…' : 'Continuer'}
      </button>
    </form>
  );
}

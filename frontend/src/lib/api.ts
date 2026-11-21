/**
 * Appels au backend Python (server.py), relayés par la route Next /api/[...path].
 * La session (jeton + profil) est gardée dans le navigateur après l'inscription.
 */
import type { Kind, Lang, Partner, Product, Profile } from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    public status = 0,
  ) {
    super(message);
  }
}

// --- Session -----------------------------------------------------------------

const SESSION_KEY = 'agrivoix.session.v1';
export const SESSION_EXPIRED = 'agrivoix:session-expired';

export type Session = { token: string; profile: Profile };

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(s: Session | null) {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // stockage indisponible
  }
}

// --- Requêtes ----------------------------------------------------------------

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = loadSession()?.token;
  if (token) headers.set('X-User-Token', token);

  let res: Response;
  try {
    res = await fetch(`/api/${path}`, { ...init, headers, cache: 'no-store' });
  } catch {
    throw new ApiError('Connexion impossible. Vérifiez votre réseau.');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token) window.dispatchEvent(new Event(SESSION_EXPIRED));
  if (!res.ok) throw new ApiError(typeof data.detail === 'string' ? data.detail : `Erreur serveur (${res.status}).`, res.status);
  return data as T;
}

const post = <T,>(path: string, form: FormData) => request<T>(path, { method: 'POST', body: form });

const extFor = (type: string) => (type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : type.includes('mpeg') ? 'mp3' : 'webm');
const audioFile = (blob: Blob) => [blob, `vocal.${extFor(blob.type)}`] as const;

// --- Inscription -------------------------------------------------------------

export const localite = (lat: number, lng: number) =>
  request<{ place: string }>(`localite?lat=${lat}&lng=${lng}`);

export function register(input: { name: string; phone: string; lat?: number; lng?: number; place?: string }) {
  const f = new FormData();
  f.set('name', input.name);
  f.set('phone', input.phone);
  if (input.lat !== undefined && input.lng !== undefined) {
    f.set('lat', String(input.lat));
    f.set('lng', String(input.lng));
  }
  if (input.place) f.set('place', input.place);
  return post<Session>('inscription', f);
}

export const me = () => request<Profile>('moi');

// --- Assistant ---------------------------------------------------------------

export type AssistantReply = {
  lang: Lang;
  /** Réponse dans la langue de l'utilisateur (français pour le dioula, lu ensuite en dioula). */
  answer: string;
  answer_fr: string;
  /** Transcription du vocal dans sa langue d'origine. */
  question?: string;
  /** Réponse à lire par la synthèse vocale du navigateur (français / anglais). */
  speak?: boolean;
  answer_bam?: string;
  audio_b64?: string;
  question_bam?: string;
  question_fr?: string;
  voice_error?: string;
};

export function askAssistant(input: {
  history: { role: 'user' | 'assistant'; text: string }[];
  text?: string;
  image?: Blob;
  audio?: Blob;
  voiceReply?: boolean;
}) {
  const f = new FormData();
  f.set('history', JSON.stringify(input.history));
  if (input.text) f.set('text', input.text);
  if (input.voiceReply) f.set('voice_reply', 'true');
  if (input.image) f.set('image', input.image, `photo.${input.image.type.split('/')[1] || 'jpg'}`);
  if (input.audio) f.set('audio', ...audioFile(input.audio));
  return post<AssistantReply>('assistant', f);
}

// --- Annonces ----------------------------------------------------------------

/** Annonce enregistrée dans Supabase (l'audio est dans le stockage, lu via `audio_url`). */
export type RemoteAnnonce = {
  id: string;
  created_at: string;
  source: 'voice' | 'text';
  kind: Kind;
  product: Product;
  quantity: string | null;
  place: string | null;
  transcript_fr: string;
  transcript_bam: string | null;
  audio_url: string | null;
  status: 'pending' | 'matched';
  messages_count: number;
  last_message_at: string | null;
  partner: Partner | null;
};

/** Audio stocké, transcription, analyse, enregistrement et matching, en un appel. */
export function createAnnonce(input: { text?: string; audio?: Blob }) {
  const f = new FormData();
  if (input.text) f.set('text', input.text);
  if (input.audio) f.set('audio', ...audioFile(input.audio));
  return post<RemoteAnnonce>('annonces', f);
}

export const listAnnonces = () => request<RemoteAnnonce[]>('annonces');

export const cancelAnnonce = (id: string) =>
  request<{ cancelled: boolean }>(`annonces/${encodeURIComponent(id)}`, { method: 'DELETE' });

// --- Messages ----------------------------------------------------------------

export type RemoteMessage = {
  id: string;
  created_at: string;
  mine: boolean;
  text: string | null;
  audio_url: string | null;
  duration_ms: number | null;
};

export const listMessages = (annonceId: string) =>
  request<RemoteMessage[]>(`annonces/${encodeURIComponent(annonceId)}/messages`);

export function sendMessage(annonceId: string, input: { text?: string; audio?: Blob; durationMs?: number }) {
  const f = new FormData();
  if (input.text) f.set('text', input.text);
  if (input.audio) f.set('audio', ...audioFile(input.audio));
  if (input.durationMs) f.set('duration_ms', String(Math.round(input.durationMs)));
  return post<RemoteMessage>(`annonces/${encodeURIComponent(annonceId)}/messages`, f);
}

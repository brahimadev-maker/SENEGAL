export type Kind = 'offer' | 'need';

export const PRODUCTS = ['Maïs', 'Manioc', 'Riz', 'Tomate', 'Igname', 'Banane', 'Cacao', 'Café'] as const;
export type Product = (typeof PRODUCTS)[number] | 'Autre';

/** Utilisateur inscrit. */
export type Profile = {
  id: string;
  name: string;
  phone: string;
  place: string | null;
  lat: number | null;
  lng: number | null;
};

/** L'annonce d'en face trouvée par le matching, avec la personne qui l'a publiée. */
export type Partner = {
  id: string;
  kind: Kind;
  product: Product;
  quantity: string | null;
  place: string | null;
  transcript_fr: string;
  name: string;
  phone: string;
  lat: number | null;
  lng: number | null;
};

export type VoiceNote = {
  /** Identifiant Supabase, ou identifiant local tant que l'annonce n'est pas enregistrée. */
  id: string;
  /** Brouillon local : pas encore enregistré (envoi en cours ou en échec). */
  draft: boolean;
  /** Brouillon : audio gardé dans le navigateur jusqu'à l'envoi (IndexedDB). */
  audioId?: string;
  /** Annonce enregistrée : lien de lecture de l'audio stocké. */
  audioUrl?: string;
  text?: string;
  durationMs: number;
  createdAt: number;
  kind?: Kind;
  product?: Product;
  quantity?: string;
  place?: string;
  transcript?: string;
  status: 'analyzing' | 'pending' | 'matched' | 'error';
  error?: string;
  partner?: Partner;
  messagesCount: number;
  /** Faux si une correspondance ou des messages sont arrivés depuis la dernière visite. */
  seen: boolean;
};

/** Langues reconnues : dioula (Djelia), français et anglais (Whisper côté serveur). */
export type Lang = 'dyu' | 'fr' | 'en';
export const LANG_LABEL: Record<Lang, string> = { dyu: 'Dioula', fr: 'Français', en: 'English' };

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  createdAt: number;
  text?: string;
  /** Texte secondaire : transcription d'un vocal, ou version dioula de la réponse. */
  caption?: string;
  /** Langue détectée (vocal de l'utilisateur, réponse de l'assistant). */
  lang?: Lang;
  imageId?: string;
  /** Audio local (IndexedDB) ou distant (lien signé). */
  audioId?: string;
  audioUrl?: string;
  durationMs?: number;
  error?: boolean;
  pending?: boolean;
};

/** Distance à vol d'oiseau en km entre deux positions. */
export function distanceKm(a: { lat: number | null; lng: number | null }, b: { lat: number | null; lng: number | null }) {
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

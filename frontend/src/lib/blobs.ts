/**
 * Stockage des fichiers (vocaux, photos) dans IndexedDB : ils survivent au
 * rechargement de la page, contrairement aux URL `blob:`.
 */
const DB = 'agrivoix';
const STORE = 'blobs';

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const uid = (p = '') => `${p}${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export const now = () => Date.now();

/** Nouveau message de discussion (identifiant + date). */
export function makeMessage<T extends object>(m: T): T & { id: string; createdAt: number } {
  return { ...m, id: uid('m-'), createdAt: now() };
}

export async function putBlob(blob: Blob, id = uid('b-')): Promise<string> {
  await run('readwrite', (s) => s.put(blob, id));
  return id;
}

export const getBlob = (id: string) => run<Blob | undefined>('readonly', (s) => s.get(id)).catch(() => undefined);

export const deleteBlob = (id: string) => run('readwrite', (s) => s.delete(id)).catch(() => undefined);

export function base64ToBlob(b64: string, type: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** Lecture / écriture localStorage tolérante (navigation privée, quota…). */
export function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function saveJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // stockage indisponible : l'app reste utilisable pour la session
  }
}

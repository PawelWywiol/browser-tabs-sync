import type { Snapshot } from "./types";

const KEY_STORE = "keys";
const BACKUP_STORE = "backups";
const KEY_ID = "sync";
const MAX_BACKUPS = 5;

export type Backup = { id: number; savedAt: string; snapshot: Snapshot };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("browser-tabs-sync", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(KEY_STORE);
      request.result.createObjectStore(BACKUP_STORE, { keyPath: "id", autoIncrement: true });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run<T>(
  store: string,
  mode: IDBTransactionMode,
  action: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const request = action(db.transaction(store, mode).objectStore(store));
        request.onsuccess = () => {
          db.close();
          resolve(request.result);
        };
        request.onerror = () => {
          db.close();
          reject(request.error);
        };
      }),
  );
}

export async function saveKey(key: CryptoKey): Promise<void> {
  await run(KEY_STORE, "readwrite", (s) => s.put(key, KEY_ID));
}

export function loadKey(): Promise<CryptoKey | undefined> {
  return run<CryptoKey | undefined>(KEY_STORE, "readonly", (s) => s.get(KEY_ID));
}

export async function listBackups(): Promise<Backup[]> {
  const all = await run<Backup[]>(BACKUP_STORE, "readonly", (s) => s.getAll());
  return all.sort((a, b) => b.id - a.id);
}

export async function saveBackup(snapshot: Snapshot): Promise<void> {
  await run(BACKUP_STORE, "readwrite", (s) =>
    s.add({ savedAt: new Date().toISOString(), snapshot }),
  );
  const stale = (await listBackups()).slice(MAX_BACKUPS);
  for (const backup of stale) await run(BACKUP_STORE, "readwrite", (s) => s.delete(backup.id));
}

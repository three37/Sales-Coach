/** Mission storage in IndexedDB. */
import type { Mission } from '../domain/types';

const DB_NAME = 'waypath';
const STORE = 'missions';

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Could not open local storage'));
      req.onblocked = () => reject(new Error('Local storage is blocked by another tab'));
    });
    dbPromise.catch(() => (dbPromise = null));
  }
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error ?? req.error);
        tx.onabort = () => reject(tx.error ?? new Error('Storage write was aborted'));
      }),
  );
}

export const db = {
  all: () => run<Mission[]>('readonly', (s) => s.getAll()),
  get: (id: string) => run<Mission | undefined>('readonly', (s) => s.get(id)),
  put: (m: Mission) => run('readwrite', (s) => s.put(m)).then(() => undefined),
  remove: (id: string) => run('readwrite', (s) => s.delete(id)).then(() => undefined),
};

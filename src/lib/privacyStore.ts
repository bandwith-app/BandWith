/**
 * The second home of the device's privacy choices (crash reports,
 * src/lib/crashReports.ts; usage statistics, src/lib/appAnalytics.ts) when
 * localStorage is full or blocked: IndexedDB "bw-privacy" (review #277).
 *
 * A write counts only once its transaction completes (oncomplete), never
 * after the put alone: a transaction can still abort after the request
 * succeeded (a quota error at commit), and then nothing was saved.
 * No IndexedDB at all (some private modes): nothing can have been saved
 * there, so it reads as empty and every write fails.
 */
export type ChoiceStore = { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void> };

const IDB_NAME = 'bw-privacy';
const IDB_STORE = 'choices';
const IDB_TIMEOUT_MS = 3000;

function idbRun<T>(run: (store: IDBObjectStore) => IDBRequest<T>, mode: IDBTransactionMode): Promise<T | null> {
  return new Promise<T | null>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      if (mode === 'readonly') resolve(null);
      else reject(new Error('no IndexedDB'));
      return;
    }
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new Error('IndexedDB timeout'))), IDB_TIMEOUT_MS);
    let open: IDBOpenDBRequest;
    try {
      open = indexedDB.open(IDB_NAME, 1);
    } catch (e) {
      finish(() => reject(e));
      return;
    }
    open.onupgradeneeded = () => open.result.createObjectStore(IDB_STORE);
    open.onerror = () => finish(() => reject(open.error ?? new Error('IndexedDB open failed')));
    open.onsuccess = () => {
      const db = open.result;
      try {
        const tx = db.transaction(IDB_STORE, mode);
        const req = run(tx.objectStore(IDB_STORE));
        // Done only when the transaction is: a put that succeeded can still be rolled back.
        tx.oncomplete = () => finish(() => resolve((req.result as T) ?? null));
        tx.onabort = () => finish(() => reject(tx.error ?? new Error('IndexedDB transaction aborted')));
        tx.onerror = () => finish(() => reject(tx.error ?? req.error ?? new Error('IndexedDB error')));
      } catch (e) {
        finish(() => reject(e));
      } finally {
        db.close(); // closes once the transaction is done
      }
    };
  });
}

const idbStore: ChoiceStore = {
  get: (key) => idbRun<string>((st) => st.get(key) as IDBRequest<string>, 'readonly'),
  set: (key, value) => idbRun((st) => st.put(value, key), 'readwrite').then(() => undefined),
};

let current: ChoiceStore = idbStore;

/** The store in use (IndexedDB, or a test's stand-in). */
export const privacyStore: ChoiceStore = {
  get: (key) => current.get(key),
  set: (key, value) => current.set(key, value),
};

/** Tests: a stand-in store (null: the real IndexedDB). */
export function __setPrivacyStoreForTest(store: ChoiceStore | null) {
  current = store ?? idbStore;
}

/**
 * A small in-memory window.indexedDB with just what storage.ts uses (open,
 * one keyval store: get, put, delete, getAllKeys, openCursor). Install it
 * before storage.ts first opens the database. Returns the stored map.
 */
export function installIdbStub(): Map<string, unknown> {
  const data = new Map<string, unknown>();
  const request = <T>(fn: () => T) => {
    const r: { result?: T; error?: unknown; onsuccess?: (e: unknown) => void; onerror?: () => void } = {};
    setTimeout(() => {
      try {
        r.result = fn();
        r.onsuccess?.({ target: r });
      } catch (e) {
        r.error = e;
        r.onerror?.();
      }
    }, 0);
    return r;
  };
  const store = {
    get: (k: string) => request(() => data.get(k)),
    put: (v: unknown, k: string) => request(() => void data.set(k, structuredClone(v))),
    delete: (k: string) => request(() => void data.delete(k)),
    getAllKeys: () => request(() => [...data.keys()]),
    openCursor: () => {
      const keys = [...data.keys()];
      let i = 0;
      const r: { result?: unknown; onsuccess?: (e: unknown) => void; onerror?: () => void } = {};
      const step = () =>
        setTimeout(() => {
          const key = keys[i];
          r.result = i < keys.length ? { key, delete: () => data.delete(key), continue: () => (i++, step()) } : null;
          r.onsuccess?.({ target: r });
        }, 0);
      step();
      return r;
    },
  };
  const db = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => store,
    transaction: () => ({ objectStore: () => store }),
  };
  const indexedDB = {
    open: () => {
      const r: { result?: unknown; onsuccess?: () => void; onupgradeneeded?: () => void; onerror?: () => void } = {};
      setTimeout(() => {
        r.result = db;
        r.onsuccess?.();
      }, 0);
      return r;
    },
  };
  Object.defineProperty(window, 'indexedDB', { value: indexedDB, configurable: true, writable: true });
  return data;
}

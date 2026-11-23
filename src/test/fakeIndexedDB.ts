/**
 * A small in-memory IndexedDB for the privacy-choice tests (jsdom has none).
 * Events fire like a real one: the request's onsuccess first, then the
 * transaction's oncomplete, or its onabort when `abortWrites` is set (a
 * quota error after the put succeeded). `failOpen`: the database can't be opened.
 */
type Handler = (() => void) | null | undefined;
type Req = { result?: unknown; error?: unknown; onsuccess?: Handler; onerror?: Handler; onupgradeneeded?: Handler };
type Tx = { error: unknown; oncomplete?: Handler; onabort?: Handler; onerror?: Handler; objectStore: () => unknown };

export function fakeIndexedDB(opts: { abortWrites?: boolean; failOpen?: boolean } = {}) {
  const data = new Map<string, unknown>();
  const state = { abortWrites: !!opts.abortWrites, failOpen: !!opts.failOpen, data };
  const later = (fn: () => void) => setTimeout(fn, 0);
  let created = false;
  const db = {
    createObjectStore: () => {
      created = true;
    },
    close: () => {},
    transaction: () => {
      const tx: Tx = { error: null, objectStore: () => store };
      const store = {
        get: (key: string) => {
          const req: Req = {};
          later(() => {
            req.result = data.get(key);
            req.onsuccess?.();
            later(() => tx.oncomplete?.());
          });
          return req;
        },
        put: (value: unknown, key: string) => {
          const req: Req = {};
          later(() => {
            req.result = key;
            req.onsuccess?.();
            later(() => {
              if (state.abortWrites) {
                tx.error = new DOMException('full', 'QuotaExceededError');
                tx.onabort?.();
              } else {
                data.set(key, value);
                tx.oncomplete?.();
              }
            });
          });
          return req;
        },
      };
      return tx;
    },
  };
  const indexedDB = {
    open: () => {
      const req: Req = {};
      later(() => {
        if (state.failOpen) {
          req.error = new DOMException('unavailable', 'UnknownError');
          req.onerror?.();
          return;
        }
        req.result = db;
        if (!created) req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };
  return { indexedDB, state };
}

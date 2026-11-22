/**
 * IndexedDB storage engine with localStorage fallback for BandWith offline data.
 */

const DB_NAME = 'bandwith_offline_db';
const DB_VERSION = 1;
const STORE_NAME = 'keyval';

let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Pre-namespacing key of the offline mutation queue. It did not carry the
 * `bw:` prefix, so it survived logout; it is still cleared explicitly below.
 */
export const LEGACY_MUTATION_QUEUE_KEY = 'bw_offline_mutation_queue';

const isIndexedDBAvailable = (): boolean => {
  try {
    return typeof window !== 'undefined' && 'indexedDB' in window && window.indexedDB !== null;
  } catch {
    return false;
  }
};

const getDB = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (!isIndexedDBAvailable()) {
      reject(new Error('IndexedDB not supported'));
      return;
    }

    try {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        reject(request.error || new Error('Failed to open IndexedDB'));
      };
    } catch (err) {
      reject(err);
    }
  });

  return dbPromise;
};

/**
 * Generates an isolated cache key based on user and band scope.
 */
export const getCacheKey = (
  userId: string | null | undefined,
  bandId: string | null | undefined,
  queryKey: string
): string => {
  const u = userId || 'anonymous';
  const b = bandId || 'global';
  return `bw:${u}:${b}:${queryKey}`;
};

/**
 * Retrieve an item from IndexedDB with fallback to localStorage.
 */
export const getOfflineItem = async <T>(key: string): Promise<T | null> => {
  if (isIndexedDBAvailable()) {
    try {
      const db = await getDB();
      return await new Promise<T | null>((resolve) => {
        try {
          const tx = db.transaction(STORE_NAME, 'readonly');
          const store = tx.objectStore(STORE_NAME);
          const req = store.get(key);
          req.onsuccess = () => resolve(req.result !== undefined ? req.result : null);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
    } catch {
      // Fall through to localStorage
    }
  }

  // Fallback to localStorage
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch (err) {
    console.warn(`[OfflineStorage] Failed to read ${key} from localStorage:`, err);
    return null;
  }
};

/**
 * Save an item to IndexedDB with fallback to localStorage.
 */
export const setOfflineItem = async <T>(key: string, value: T): Promise<void> => {
  if (isIndexedDBAvailable()) {
    try {
      const db = await getDB();
      await new Promise<void>((resolve, reject) => {
        try {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          const req = store.put(value, key);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        } catch (err) {
          reject(err);
        }
      });
      return;
    } catch {
      // Fall through to localStorage
    }
  }

  // Fallback to localStorage
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn(`[OfflineStorage] Failed to write ${key} to localStorage:`, err);
  }
};

/**
 * Delete a specific item.
 */
export const removeOfflineItem = async (key: string): Promise<void> => {
  if (isIndexedDBAvailable()) {
    try {
      const db = await getDB();
      await new Promise<void>((resolve) => {
        try {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          const req = store.delete(key);
          req.onsuccess = () => resolve();
          req.onerror = () => resolve();
        } catch {
          resolve();
        }
      });
    } catch {
      // Ignore
    }
  }

  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore
  }
};

/** Every cached key starting with `prefix` (IndexedDB and the localStorage fallback). */
export const listOfflineKeys = async (prefix: string): Promise<string[]> => {
  const keys = new Set<string>();
  if (isIndexedDBAvailable()) {
    try {
      const db = await getDB();
      await new Promise<void>((resolve) => {
        try {
          const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAllKeys();
          req.onsuccess = () => {
            for (const k of req.result) if (typeof k === 'string' && k.startsWith(prefix)) keys.add(k);
            resolve();
          };
          req.onerror = () => resolve();
        } catch {
          resolve();
        }
      });
    } catch {
      // Fall through to localStorage
    }
  }
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) keys.add(k);
    }
  } catch {
    // Ignore
  }
  return [...keys];
};

/**
 * Chat messages written on this phone and not sent yet (#291), one list per
 * account: `bw:chat_outbox:<uid>` = [{ chatId, clientId, body, createdAt,
 * replyToId?, refused? }] in localStorage. `refused` (the server's reason,
 * maybe ''): turned down, kept until Try again or Delete; still not sent.
 * #291 reads and writes it only through readChatOutbox / writeChatOutbox.
 */
export const CHAT_OUTBOX_PREFIX = 'bw:chat_outbox:';
export const chatOutboxKey = (userId: string): string => `${CHAT_OUTBOX_PREFIX}${userId}`;

export interface ChatOutboxEntry {
  chatId: string;
  clientId: string;
  body: string;
  createdAt: string;
  replyToId?: string | null;
  refused?: string;
}

const isChatOutboxEntry = (x: unknown): x is ChatOutboxEntry => {
  const o = x as Partial<ChatOutboxEntry> | null;
  return !!o && typeof o === 'object' && typeof o.chatId === 'string' && typeof o.clientId === 'string' && typeof o.body === 'string' && typeof o.createdAt === 'string';
};
const chatOutboxEntries = (v: unknown): ChatOutboxEntry[] => (Array.isArray(v) ? v.filter(isChatOutboxEntry) : []);

/** The account's chat outbox (extra fields kept, malformed entries skipped). Never throws. */
export function readChatOutbox(userId: string | null | undefined): ChatOutboxEntry[] {
  if (!userId) return [];
  try {
    return chatOutboxEntries(JSON.parse(localStorage.getItem(chatOutboxKey(userId)) || '[]'));
  } catch {
    return [];
  }
}

/** Replaces the account's chat outbox; empty removes the key. Storage full or blocked: nothing written. */
export function writeChatOutbox(userId: string | null | undefined, entries: ChatOutboxEntry[]): void {
  if (!userId) return;
  try {
    if (entries.length) localStorage.setItem(chatOutboxKey(userId), JSON.stringify(entries));
    else localStorage.removeItem(chatOutboxKey(userId));
  } catch {
    // Ignore
  }
}

/**
 * The account's chat outbox in both stores (localStorage, then an IndexedDB
 * copy), one entry per client id. Never throws.
 */
export const readChatOutboxAll = async (userId: string | null | undefined): Promise<ChatOutboxEntry[]> => {
  const all = readChatOutbox(userId);
  if (!userId) return all;
  try {
    const ids = new Set(all.map((e) => e.clientId));
    for (const e of chatOutboxEntries(await getOfflineItem<unknown>(chatOutboxKey(userId)))) {
      if (!ids.has(e.clientId)) all.push(e);
      ids.add(e.clientId);
    }
  } catch {
    // Ignore
  }
  return all;
};

/** How many chat messages are not sent for `userId`, refused ones included (both stores). */
export const readChatOutboxCount = async (userId: string | null | undefined): Promise<number> =>
  (await readChatOutboxAll(userId)).length;

/** Deletes one message (by client id) from the account's chat outbox, in both stores. */
export const deleteChatOutboxEntry = async (userId: string | null | undefined, clientId: string): Promise<void> => {
  if (!userId) return;
  const local = readChatOutbox(userId).filter((e) => e.clientId !== clientId);
  try {
    const copy = await getOfflineItem<unknown>(chatOutboxKey(userId));
    if (chatOutboxEntries(copy).some((e) => e.clientId === clientId)) {
      const rest = chatOutboxEntries(copy).filter((e) => e.clientId !== clientId);
      // Without IndexedDB these write localStorage: rewritten just below.
      if (rest.length) await setOfflineItem(chatOutboxKey(userId), rest);
      else await removeOfflineItem(chatOutboxKey(userId));
    }
  } catch {
    // Ignore
  }
  writeChatOutbox(userId, local);
};

/**
 * Removes every cached key `drop` says yes to (IndexedDB and the localStorage
 * fallback), never the chat outbox: sign-out keeps unsent chat messages for
 * their account (Codex #291 r7 B5; #292's KEEP_ON_SIGN_OUT_PREFIXES has it).
 */
const removeOfflineItemsWhere = async (dropAny: (key: string) => boolean): Promise<void> => {
  const drop = (key: string) => !key.startsWith(CHAT_OUTBOX_PREFIX) && dropAny(key);
  if (isIndexedDBAvailable()) {
    try {
      const db = await getDB();
      await new Promise<void>((resolve) => {
        try {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          const req = store.openCursor();
          req.onsuccess = (e) => {
            const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
            if (cursor) {
              const k = cursor.key;
              if (typeof k === 'string' && drop(k)) {
                cursor.delete();
              }
              cursor.continue();
            } else {
              resolve();
            }
          };
          req.onerror = () => resolve();
        } catch {
          resolve();
        }
      });
    } catch {
      // Ignore
    }
  }

  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && drop(k)) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  } catch {
    // Ignore
  }
};

/**
 * Clear cache entries (optionally filtered by prefix, e.g. on logout).
 * With the default `bw:` prefix this also removes every per-user offline
 * mutation queue (`bw:offline_queue:<userId>`) and the legacy un-prefixed
 * queue key, so one user's unsynced edits can never replay for the next user.
 */
export const clearOfflineCache = async (prefix: string = 'bw:'): Promise<void> => {
  if (prefix === 'bw:') {
    await removeOfflineItem(LEGACY_MUTATION_QUEUE_KEY);
  }
  await removeOfflineItemsWhere((k) => k.startsWith(prefix));
};

// ─── Cached data and the role it was read for ───────────────────────────────

/** Band id → the user's role in it ('admin' | 'member'). */
export type BandRoles = Record<string, string>;

/**
 * Cached keys a role change keeps: who the user is and which band was open.
 * Everything else under `bw:<userId>:` was read for one role (a member's
 * rows carry no client, price or colleagues' fees) and is dropped.
 */
const ROLE_NEUTRAL_KEYS = ['user_profile', 'selected_band_id'];

const cachedRolesKey = (userId: string) => getCacheKey(userId, 'global', 'cache_roles');

type RolesChangedListener = (userId: string) => void;
const rolesChangedListeners = new Set<RolesChangedListener>();

/** Called after a role change dropped the cache: data on screen was read for the old role. */
export const onCachedRolesChanged = (listener: RolesChangedListener): (() => void) => {
  rolesChangedListeners.add(listener);
  return () => {
    rolesChangedListeners.delete(listener);
  };
};

/**
 * Records the roles a fresh band list gives the user, and drops the cached
 * data when it was read for other roles: a member made admin must not keep
 * member-shaped rows (no client, so an empty new contract), and an admin made
 * member must not keep the client and price on the device. Also dropped once
 * when the device has no record yet (cache written before this check).
 * Listeners hear about a real change, so the open screens fetch again.
 * Returns whether the cache was dropped.
 */
export const syncCachedRoles = async (userId: string, roles: BandRoles): Promise<boolean> => {
  const key = cachedRolesKey(userId);
  const previous = await getOfflineItem<BandRoles>(key);
  const changed = !!previous && Object.keys(roles).some((band) => band in previous && previous[band] !== roles[band]);
  const sameRecord =
    !!previous &&
    Object.keys(previous).length === Object.keys(roles).length &&
    Object.keys(roles).every((band) => previous[band] === roles[band]);
  if (previous && !changed) {
    if (!sameRecord) await setOfflineItem(key, roles);
    return false;
  }
  const userPrefix = `bw:${userId}:`;
  const keep = new Set(ROLE_NEUTRAL_KEYS.map((k) => getCacheKey(userId, 'global', k)));
  await removeOfflineItemsWhere((k) => k.startsWith(userPrefix) && !keep.has(k));
  await setOfflineItem(key, roles);
  if (changed) {
    rolesChangedListeners.forEach((listener) => {
      try {
        listener(userId);
      } catch {
        /* one listener must not stop the others */
      }
    });
  }
  return true;
};

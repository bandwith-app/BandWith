/**
 * Chat messages written with no connection, kept on this device until the
 * server has them (main's decision, #291 r4): closing the chat or the app
 * offline never loses the text.
 *
 * Key `bw:chat_outbox:<uid>`, a JSON array of
 * `{ chatId, clientId, body, createdAt }`. #292 owns the key and its storage
 * (src/lib/offline/storage.ts): it keeps it at sign-out, erases it on account
 * deletion and counts it in "You have N unsent messages". Read and written
 * only through the two store functions below.
 * Optional, for this file only: `replyToId` (the quoted message) and
 * `refused` (the server said no: the reason, maybe ''): a refused message is
 * never sent again by itself; it shows as "Not sent" with Try again / Delete
 * until the person picks one.
 *
 * Sent with the same client id (the (sender_id, client_id) upsert, 192), so
 * a retry after a lost reply never saves a second copy. Only the account
 * that wrote it sends it: before each send the signed-in user must be <uid>.
 * One flush at a time on this device.
 */
import { getSafeUser } from './supabase';
import { sendMessage, chatErrorMessage, type Message } from './services/chats';
import { isOfflineError } from './offline/networkErrors';

export const CHAT_OUTBOX_PREFIX = 'bw:chat_outbox:';
export const chatOutboxKey = (userId: string): string => `${CHAT_OUTBOX_PREFIX}${userId}`;

export interface ChatOutboxItem {
  chatId: string;
  clientId: string;
  body: string;
  createdAt: string;
  replyToId?: string | null;
  refused?: string;
}

/** What a flush did, for the chat on screen (window event `CHAT_OUTBOX_EVENT`). */
export interface ChatOutboxResult {
  userId: string;
  sent: { chatId: string; clientId: string; message: Message }[];
  /** `denied`: a rule or 42501 said this account may not write here (the chat locks). */
  refused: { chatId: string; clientId: string; reason: string; denied: boolean }[];
}
export const CHAT_OUTBOX_EVENT = 'bw:chat-outbox';

const valid = (x: unknown): x is ChatOutboxItem => {
  const o = x as Partial<ChatOutboxItem> | null;
  return !!o && typeof o.chatId === 'string' && typeof o.clientId === 'string' && typeof o.body === 'string' && typeof o.createdAt === 'string';
};

// ---------------------------------------------------------------------------
// Storage: the ONLY two places that touch `bw:chat_outbox:<uid>`.
// #292 owns that key and its storage (src/lib/offline/storage.ts, main's
// decision on #292 Claude r5 M3: localStorage and IndexedDB). Until #292's
// helper block lands (a byte-identical copy goes into storage.ts here), these
// two bodies are the stand-in; then they become calls to #292's read and
// write helpers and nothing else in this file changes.
// ---------------------------------------------------------------------------
async function loadStoredOutbox(userId: string): Promise<unknown[]> {
  try {
    const raw = localStorage.getItem(chatOutboxKey(userId));
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function saveStoredOutbox(userId: string, entries: ChatOutboxItem[]): Promise<void> {
  try {
    if (entries.length) localStorage.setItem(chatOutboxKey(userId), JSON.stringify(entries));
    else localStorage.removeItem(chatOutboxKey(userId));
  } catch {
    // Storage full or blocked: the bubble on screen still has the text.
  }
}

// Every read and change waits for the ones before it (the store is async):
// a Delete tapped while a flush runs is seen by the flush's next re-read.
let storeQueue: Promise<unknown> = Promise.resolve();
function inOrder<T>(job: () => Promise<T>): Promise<T> {
  const run = storeQueue.then(job);
  storeQueue = run.catch(() => {});
  return run;
}

const readValid = async (userId: string): Promise<ChatOutboxItem[]> => (await loadStoredOutbox(userId)).filter(valid);

/** This account's outbox, oldest first as written (waiting and "Not sent" ones). */
export function listChatOutbox(userId: string | null | undefined): Promise<ChatOutboxItem[]> {
  if (!userId) return Promise.resolve([]);
  return inOrder(() => readValid(userId));
}

/** Adds (or updates, same client id) a message; it waits to be sent unless `refused`. */
export function putChatOutbox(userId: string | null | undefined, item: ChatOutboxItem): Promise<void> {
  if (!userId) return Promise.resolve();
  return inOrder(async () => {
    const list = (await readValid(userId)).filter((x) => x.clientId !== item.clientId);
    const clean: ChatOutboxItem = { chatId: item.chatId, clientId: item.clientId, body: item.body, createdAt: item.createdAt };
    if (item.replyToId) clean.replyToId = item.replyToId;
    if (typeof item.refused === 'string') clean.refused = item.refused;
    await saveStoredOutbox(userId, [...list, clean]);
  });
}

/** Saved, or deleted by the person. */
export function dropChatOutbox(userId: string | null | undefined, clientId: string | null | undefined): Promise<void> {
  if (!userId || !clientId) return Promise.resolve();
  return inOrder(async () => {
    const list = await readValid(userId);
    const rest = list.filter((x) => x.clientId !== clientId);
    if (rest.length !== list.length) await saveStoredOutbox(userId, rest);
  });
}

/** The server said no: an answer, not a lost connection or a hiccup. */
export function isRefusal(error: unknown): boolean {
  if (!error || isOfflineError(error)) return false;
  if (chatErrorMessage(error, '') !== '') return true;
  const code = String((error as { code?: unknown }).code ?? '');
  return code === 'PGRST116' || code.startsWith('42') || code.startsWith('23') || code === '22P02';
}

/** The server said this account may not write in the chat (a rule, or 42501). */
export function isDenied(error: unknown): boolean {
  if (!error || isOfflineError(error)) return false;
  return chatErrorMessage(error, '') !== '' || String((error as { code?: unknown }).code ?? '') === '42501';
}

let lock: Promise<unknown> = Promise.resolve();

const sameUser = (a: string | null | undefined, b: string) => !!a && a.toLowerCase() === b.toLowerCase();
const signedInId = async (): Promise<string | null> => {
  try {
    return (await getSafeUser()).data.user?.id ?? null;
  } catch {
    return null;
  }
};

/** True only when <uid> is the account signed in now (no answer: false). */
export async function isSignedInAs(uid: string | null | undefined): Promise<boolean> {
  return !!uid && sameUser(await signedInId(), uid);
}

// Sends from the chat on screen (the composer, Try again): a flush waits
// for them, so a waiting message never goes out alongside one being sent
// (Claude #291 r5). Capped, so a send that never answers can't hold the
// queue forever.
let sendsInFlight = 0;
let idleWaiters: (() => void)[] = [];
export const CHAT_SEND_WAIT_MS = 20_000;

/** A send from the chat on screen starts; call the result when it ends. */
export function beginChatSend(): () => void {
  sendsInFlight += 1;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    sendsInFlight -= 1;
    if (sendsInFlight === 0) {
      const waiting = idleWaiters;
      idleWaiters = [];
      waiting.forEach((wake) => wake());
    }
  };
}

const sendsDone = (): Promise<void> => {
  if (sendsInFlight === 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      idleWaiters = idleWaiters.filter((w) => w !== wake);
      resolve();
    }, CHAT_SEND_WAIT_MS);
    const wake = () => {
      clearTimeout(timer);
      resolve();
    };
    idleWaiters.push(wake);
  });
};

/**
 * Sends <uid>'s waiting messages, oldest first. Stops at the first lost
 * connection (the rest wait), or when someone else is signed in. A refusal
 * marks the message `refused` (kept, shown as "Not sent"); another error
 * leaves it waiting for the next flush.
 */
export function flushChatOutbox(
  userId: string | null | undefined,
  opts: { chatId?: string; currentUserId?: () => Promise<string | null> } = {},
): Promise<ChatOutboxResult> {
  const uid = userId ?? '';
  const empty: ChatOutboxResult = { userId: uid, sent: [], refused: [] };
  if (!uid) return Promise.resolve(empty);
  const run = lock.then(async () => {
    const result: ChatOutboxResult = { userId: uid, sent: [], refused: [] };
    const current = opts.currentUserId ?? signedInId;
    const waiting = (await listChatOutbox(uid))
      .filter((x) => x.refused === undefined && (!opts.chatId || x.chatId === opts.chatId))
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
    for (const item of waiting) {
      await sendsDone();
      if (typeof navigator !== 'undefined' && !navigator.onLine) break;
      // Never as someone else (another account signed in on this device).
      if (!sameUser(await current(), uid)) break;
      // Still waiting? (Try again or Delete may have handled it meanwhile.)
      const now = (await listChatOutbox(uid)).find((x) => x.clientId === item.clientId);
      if (!now || now.refused !== undefined) continue;
      const { data, error } = await sendMessage(item.chatId, item.body, 'text', item.replyToId ?? undefined, item.clientId);
      if (!error && data) {
        await dropChatOutbox(uid, item.clientId);
        result.sent.push({ chatId: item.chatId, clientId: item.clientId, message: data });
      } else if (isRefusal(error)) {
        const reason = chatErrorMessage(error, '');
        await putChatOutbox(uid, { ...item, refused: reason });
        result.refused.push({ chatId: item.chatId, clientId: item.clientId, reason, denied: isDenied(error) });
      } else {
        break;
      }
    }
    if ((result.sent.length || result.refused.length) && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent<ChatOutboxResult>(CHAT_OUTBOX_EVENT, { detail: result }));
    }
    return result;
  });
  lock = run.catch(() => {});
  return run.catch(() => empty);
}

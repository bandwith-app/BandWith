/**
 * Chat messages written with no connection, kept on this device until the
 * server has them (main's decision, #291 r4): closing the chat or the app
 * offline never loses the text.
 *
 * Key `bw:chat_outbox:<uid>`, a JSON array of
 * `{ chatId, clientId, body, createdAt, replyToId?, refused? }`. #292 owns
 * the key and its storage (src/lib/offline/storage.ts, localStorage and an
 * IndexedDB copy): it keeps it at sign-out, erases it on account deletion
 * and counts it in "You have N unsent messages". This file reads and writes
 * it only through #292's helpers there. Hard order: #292 merges first.
 * `refused` (the server said no: the reason, maybe ''): never sent again by
 * itself; it shows as "Not sent" with Try again / Delete until the person
 * picks one.
 *
 * Sent with the same client id (the (sender_id, client_id) upsert, 192), so
 * a retry after a lost reply never saves a second copy. Only the account
 * that wrote it sends it: before each send the signed-in user must be <uid>.
 * One flush at a time on this device. A message goes in before its first
 * send from the chat on screen and leaves once saved (Claude #291 CR6 M4):
 * a send that hangs and an app that is closed lose nothing.
 */
import { getSafeUser } from './supabase';
import { sendMessage, chatErrorMessage, type Message } from './services/chats';
import { isOfflineError } from './offline/networkErrors';
import { readChatOutboxAll, writeChatOutbox, deleteChatOutboxEntry, type ChatOutboxEntry } from './offline/storage';

export type ChatOutboxItem = ChatOutboxEntry;

/** What a flush did, for the chat on screen (window event `CHAT_OUTBOX_EVENT`). */
export interface ChatOutboxResult {
  userId: string;
  sent: { chatId: string; clientId: string; message: Message }[];
  /** `denied`: a rule or 42501 said this account may not write here (the chat locks). */
  refused: { chatId: string; clientId: string; reason: string; denied: boolean }[];
}
export const CHAT_OUTBOX_EVENT = 'bw:chat-outbox';

// Storage: only through #292's helpers (main's decision on #292 Claude r5
// M3). Read: both stores, one entry per client id. Remove: from both stores
// (deleteChatOutboxEntry), so an IndexedDB copy never brings a sent or
// deleted message back. Add or change: the list goes to localStorage.
const loadStoredOutbox = (userId: string): Promise<ChatOutboxItem[]> => readChatOutboxAll(userId);
const removeStored = async (userId: string, clientIds: string[]): Promise<void> => {
  for (const id of clientIds) await deleteChatOutboxEntry(userId, id);
};

// Every read and change waits for the ones before it (the store is async):
// a Delete tapped while a flush runs is seen by the flush's next re-read.
// Across tabs too (Claude #291 CR6 M5): each read-modify-write holds the
// Web Lock `bw-chat-outbox` where the browser has Web Locks, so two tabs
// never write over each other's change; without it, as before.
export const CHAT_OUTBOX_LOCK = 'bw-chat-outbox';
type LockManagerLike = { request: <T>(name: string, cb: () => Promise<T>) => Promise<T> };
const webLocks = (): LockManagerLike | null => {
  try {
    const locks = typeof navigator !== 'undefined' ? (navigator as { locks?: LockManagerLike }).locks : undefined;
    return locks && typeof locks.request === 'function' ? locks : null;
  } catch {
    return null;
  }
};
let storeQueue: Promise<unknown> = Promise.resolve();
function inOrder<T>(job: () => Promise<T>): Promise<T> {
  const run = storeQueue.then(() => {
    const locks = webLocks();
    return locks ? locks.request(CHAT_OUTBOX_LOCK, job) : job();
  });
  storeQueue = run.catch(() => {});
  return run;
}

const readValid = (userId: string): Promise<ChatOutboxItem[]> => loadStoredOutbox(userId);

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
    writeChatOutbox(userId, [...list, clean]);
  });
}

/** Saved, or deleted by the person. */
export function dropChatOutbox(userId: string | null | undefined, clientId: string | null | undefined): Promise<void> {
  if (!userId || !clientId) return Promise.resolve();
  return inOrder(async () => {
    await removeStored(userId, [clientId]);
  });
}

/**
 * The chat list loaded (all of this account's chats): a "Not sent" message
 * for a chat no longer in it can't be tried again or seen, so it goes
 * (Claude #291 r5, main's split: #292's sign-out sheet shows the rest).
 * Refused ones only; a waiting one is never dropped.
 */
export function dropRefusedOutsideChats(userId: string | null | undefined, chatIds: readonly string[]): Promise<void> {
  if (!userId) return Promise.resolve();
  const present = new Set(chatIds.map((id) => id.toLowerCase()));
  return inOrder(async () => {
    const list = await readValid(userId);
    const gone = list.filter((x) => x.refused !== undefined && !present.has(x.chatId.toLowerCase())).map((x) => x.clientId);
    if (gone.length) await removeStored(userId, gone);
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

/** Tries per message in one flush before it waits for the next one (CR6 M4). */
export const CHAT_FLUSH_TRIES = 3;
/** Waits between those tries. */
export const CHAT_FLUSH_BACKOFF_MS: readonly number[] = [1_000, 3_000];
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Sends <uid>'s waiting messages, oldest first. Stops at the first lost
 * connection (the rest wait), or when someone else is signed in. A refusal
 * marks the message `refused` (kept, shown as "Not sent"). Another error is
 * tried again, CHAT_FLUSH_TRIES times with a pause; then that message and
 * the later ones of its chat (order in a chat holds) wait for the next
 * flush, and other chats still go (Claude #291 CR6 M4).
 */
export function flushChatOutbox(
  userId: string | null | undefined,
  opts: { chatId?: string; currentUserId?: () => Promise<string | null>; backoffMs?: readonly number[] } = {},
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
    const backoff = opts.backoffMs ?? CHAT_FLUSH_BACKOFF_MS;
    // Chats with a message that kept failing in this flush: the rest of the
    // chat waits too (never sent ahead of it).
    const held = new Set<string>();
    let stop = false;
    for (const item of waiting) {
      if (stop) break;
      if (held.has(item.chatId)) continue;
      for (let tries = 1; ; tries++) {
        await sendsDone();
        if (typeof navigator !== 'undefined' && !navigator.onLine) { stop = true; break; }
        // Never as someone else (another account signed in on this device).
        if (!sameUser(await current(), uid)) { stop = true; break; }
        // Still waiting, as it reads now? (Try again or Delete may have
        // handled it meanwhile: Codex r-old B3.)
        const now = (await listChatOutbox(uid)).find((x) => x.clientId === item.clientId);
        if (!now || now.refused !== undefined) break;
        // The writer is passed on too: sendMessage refuses to send as anyone else.
        const { data, error } = await sendMessage(now.chatId, now.body, 'text', now.replyToId ?? undefined, now.clientId, uid);
        if (!error && data) {
          await dropChatOutbox(uid, now.clientId);
          result.sent.push({ chatId: now.chatId, clientId: now.clientId, message: data });
          break;
        }
        if (isRefusal(error)) {
          const reason = chatErrorMessage(error, '');
          await putChatOutbox(uid, { ...now, refused: reason });
          result.refused.push({ chatId: now.chatId, clientId: now.clientId, reason, denied: isDenied(error) });
          break;
        }
        // No connection: everything waits for the network.
        if (isOfflineError(error)) { stop = true; break; }
        if (tries >= CHAT_FLUSH_TRIES) { held.add(item.chatId); break; }
        await pause(backoff[Math.min(tries - 1, backoff.length - 1)] ?? 0);
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

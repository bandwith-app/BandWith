/**
 * Changes made with no signal during a gig or rehearsal (plan §3.5): my
 * personal notes, suggestions to the band ("Note for the band" included) and
 * the leader's new song order in Stage. Kept on this device, shown at once,
 * sent when back online. Same pattern as the rehearsal notes outbox
 * (rehearsalNotesOutbox.ts), whose changes count in the same "waiting" tag.
 * Every change carries its own id, so sending one twice is harmless. Kept per
 * user under `bw:`, which logout wipes.
 */
import { isOfflineError } from './offline/networkErrors';
import type { NoteAnchor, PersonalNote } from './personalNotes';
import { OUTBOX_EVENT, readOutbox, writeOutbox } from './rehearsalNotesOutbox';

export interface OrderRow {
  id: string;
  setlist_id: string;
  song_id: string;
  position: number;
  set_number: number;
}

export type LiveOp =
  /** A personal note written or edited; `isNew`: not on the server yet. */
  | { kind: 'note'; id: string; songId: string; anchor: NoteAnchor; body: string; isNew?: boolean }
  | { kind: 'noteDelete'; id: string; songId: string }
  /** A suggestion to the band (song_suggestions row, with its own id). */
  | { kind: 'suggestion'; id: string; row: Record<string, unknown> }
  /**
   * The leader's new order; `before`: the order the server had (for the
   * band's summary push, and saved only over it: with `id`, row by row, 188).
   */
  | { kind: 'order'; setlistId: string; eventId?: string; rows: OrderRow[]; before: { songId: string; setNumber?: number; id?: string }[] };

const keyOfOp = (op: LiveOp): string => {
  switch (op.kind) {
    case 'note':
    case 'noteDelete':
      return `note:${op.id}`;
    case 'suggestion':
      return `suggestion:${op.id}`;
    case 'order':
      return `order:${op.setlistId}`;
  }
};

/** Queue a change: it replaces a waiting one for the same thing. */
export function addLiveOp(ops: LiveOp[], op: LiveOp): LiveOp[] {
  const key = keyOfOp(op);
  const prev = ops.find((o) => keyOfOp(o) === key);
  const kept = ops.filter((o) => keyOfOp(o) !== key);
  if (op.kind === 'noteDelete' && prev?.kind === 'note' && prev.isNew) return kept; // never reached the server
  if (op.kind === 'note' && prev?.kind === 'note' && prev.isNew) return [...kept, { ...op, isNew: true }];
  if (op.kind === 'order' && prev?.kind === 'order') return [...kept, { ...op, before: prev.before }];
  return [...kept, op];
}

/** My notes on a song as this device will see them once its changes are sent. */
export function applyNoteOps(saved: PersonalNote[], ops: LiveOp[], songId: string): PersonalNote[] {
  const byId = new Map(saved.map((n) => [n.id, n]));
  for (const op of ops) {
    if (op.kind === 'note' && op.songId === songId) {
      const was = byId.get(op.id);
      byId.set(op.id, { ...(was ?? { id: op.id, song_id: songId }), anchor: op.anchor, body: op.body });
    } else if (op.kind === 'noteDelete' && op.songId === songId) byId.delete(op.id);
  }
  return [...byId.values()];
}

// ------------------------------------------------------------- storage --

const KEY_PREFIX = 'bw:live_outbox:';
export const LIVE_OUTBOX_EVENT = 'bw:live-outbox';
const keyOf = (userId: string) => `${KEY_PREFIX}${userId}`;

export function readLiveOutbox(userId: string | null | undefined): LiveOp[] {
  if (!userId) return [];
  try {
    const v = JSON.parse(localStorage.getItem(keyOf(userId)) || '[]');
    return Array.isArray(v) ? (v as LiveOp[]) : [];
  } catch {
    return [];
  }
}

export function writeLiveOutbox(userId: string, ops: LiveOp[]) {
  try {
    if (ops.length) localStorage.setItem(keyOf(userId), JSON.stringify(ops));
    else localStorage.removeItem(keyOf(userId));
  } catch {
    /* storage full or blocked: the change stays in memory for this visit */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(LIVE_OUTBOX_EVENT, { detail: { userId } }));
}

/**
 * Changes the server refused for their own account (note gone, no longer
 * allowed, setlist changed meanwhile): kept on this phone, out of the queue so
 * they don't block the rest, shown in Settings › Offline & live until the
 * person removes them. Sign-out keeps them (KEEP_ON_SIGN_OUT_PREFIXES in
 * offline/storage.ts); only deleting the account erases them. Never dropped
 * silently: when the list is full, or storage can't take the copy, the
 * change stays in the queue.
 */
const REFUSED_PREFIX = 'bw:live_refused:';
export const REFUSED_LIMIT = 100;
/** The refused list changed (Settings › Offline & live shows it). */
export const LIVE_REFUSED_EVENT = 'bw:live-refused';
export const refusedKey = (userId: string) => `${REFUSED_PREFIX}${userId}`;

/**
 * A gig setlist edited offline (the gig wizard) that met someone else's newer
 * setlist when sent: never written over it, kept here with its songs.
 */
export type RefusedGigSetlist = {
  kind: 'gigSetlist';
  eventId: string;
  setlistId: string;
  songs: { song_id: string; set_number: number }[];
  reason: 'changed';
};
/** A refused change, with its own id in the list (`rid`). */
export type RefusedLiveOp = (LiveOp | RefusedGigSetlist) & { rid?: string };
/** The id a refused change is removed by (never its position: another tab may have changed the list). */
export const refusedId = (op: RefusedLiveOp): string => op.rid ?? JSON.stringify(op);

export function readRefusedLiveOps(userId: string | null | undefined): RefusedLiveOp[] {
  if (!userId) return [];
  try {
    const v = JSON.parse(localStorage.getItem(refusedKey(userId)) || '[]');
    return Array.isArray(v) ? (v as RefusedLiveOp[]) : [];
  } catch {
    return [];
  }
}
export const refusedListFull = (userId: string | null | undefined) => readRefusedLiveOps(userId).length >= REFUSED_LIMIT;
/**
 * Every change the band refused for this account and kept on this phone:
 * Stage (above) and rehearsal notes (`bw:rehearsal_notes_rejected:`, #296).
 */
export function refusedChanges(userId: string | null | undefined): number {
  return readRefusedLiveOps(userId).length + refusedRehearsalNotes(userId);
}

/**
 * Of those, the rehearsal notes not saved: bw:rehearsal_notes_rejected:<uid>
 * (#296: an array of RehearsalNote, one per refused version, listed in
 * Settings with #296). Read defensively: only entries with a note id count.
 */
export function refusedRehearsalNotes(userId: string | null | undefined): number {
  if (!userId) return 0;
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(`bw:rehearsal_notes_rejected:${userId}`) || '[]');
    return Array.isArray(raw) ? raw.filter((n) => !!n && typeof n === 'object' && typeof (n as { id?: unknown }).id === 'string').length : 0;
  } catch {
    return 0; // unreadable: none
  }
}

/** "Erase them" at sign-out: this account's refused changes go (Stage and rehearsal). */
export function discardRefusedChanges(userId: string | null | undefined): void {
  if (!userId) return;
  try {
    localStorage.removeItem(`bw:live_refused:${userId}`);
    localStorage.removeItem(`bw:rehearsal_notes_rejected:${userId}`);
  } catch {
    /* storage blocked */
  }
  try {
    window.dispatchEvent(new CustomEvent(LIVE_REFUSED_EVENT, { detail: { userId } }));
  } catch {
    /* no window */
  }
}

/** true: written (the caller may let go of its own copy). */
function writeRefused(userId: string, ops: RefusedLiveOp[], kind?: RefusedLiveOp['kind']): boolean {
  let ok = true;
  try {
    if (ops.length) localStorage.setItem(refusedKey(userId), JSON.stringify(ops));
    else localStorage.removeItem(refusedKey(userId));
  } catch {
    ok = false; /* storage full or blocked */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(LIVE_REFUSED_EVENT, { detail: { userId, ...(kind ? { kind } : {}) } }));
  return ok;
}
const newRid = () => `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
/** Kept in the refused list; true only when really written (full list or storage: false). */
export function keepRefused(userId: string, op: LiveOp | RefusedGigSetlist): boolean {
  const list = readRefusedLiveOps(userId);
  if (list.length >= REFUSED_LIMIT) return false;
  return writeRefused(userId, [...list, { ...op, rid: newRid() }], op.kind) && readRefusedLiveOps(userId).length === list.length + 1;
}
/** The person copied what they needed: this one goes (by its id). */
export function removeRefusedLiveOp(userId: string, rid: string) {
  const list = readRefusedLiveOps(userId);
  const i = list.findIndex((o) => refusedId(o) === rid);
  if (i >= 0) writeRefused(userId, list.filter((_, j) => j !== i));
}
/** Undo a remove: back at its place (unless it is there already). */
export function restoreRefusedLiveOp(userId: string, op: RefusedLiveOp, index: number) {
  const list = readRefusedLiveOps(userId);
  if (list.some((o) => refusedId(o) === refusedId(op))) return;
  const at = Math.max(0, Math.min(index, list.length));
  writeRefused(userId, [...list.slice(0, at), op, ...list.slice(at)]);
}

/**
 * Signing out from the lock screen (nothing can be sent from there) when
 * sign-out would wipe the queues: the waiting changes move to the kept
 * refused lists instead (Stage changes to bw:live_refused:, rehearsal note
 * texts to bw:rehearsal_notes_rejected: in #296's shape), so nothing is
 * destroyed. What finds no room stays queued. A waiting tick or delete of a
 * rehearsal note has no text to keep and stays queued too.
 */
export function keepQueuedAsRefused(userId: string): void {
  const live = readLiveOutbox(userId);
  if (live.length) writeLiveOutbox(userId, live.filter((op) => !keepRefused(userId, op)));
  const ops = readOutbox(userId);
  const saves = ops.filter((o): o is Extract<typeof o, { kind: 'save' }> => o.kind === 'save');
  if (!saves.length) return;
  const key = `bw:rehearsal_notes_rejected:${userId}`;
  // #296's rejectedKey: one entry per version of a note.
  const version = (n: { id?: unknown; body?: unknown; section?: unknown; preset?: unknown; songId?: unknown }) =>
    JSON.stringify([n.id, n.body ?? null, n.section ?? null, n.preset ?? null, n.songId ?? null]);
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) || '[]');
    const stored = Array.isArray(raw) ? raw : [];
    const seen = new Set(stored.map((n) => version((n ?? {}) as Record<string, unknown>)));
    const add = saves.map((o) => o.note).filter((n) => !seen.has(version(n)));
    localStorage.setItem(key, JSON.stringify([...stored, ...add]));
    writeOutbox(userId, ops.filter((o) => o.kind !== 'save'));
  } catch {
    /* storage full or blocked: they stay queued */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(LIVE_REFUSED_EVENT, { detail: { userId } }));
}

export function queueLiveOp(userId: string, op: LiveOp) {
  writeLiveOutbox(userId, addLiveOp(readLiveOutbox(userId), op));
}

/** Every change waiting on this phone for this person (rehearsal notes too). */
export const waitingChanges = (userId: string | null | undefined): number =>
  userId ? readLiveOutbox(userId).length + readOutbox(userId).length : 0;

/** Both outboxes announce their changes with these events. */
export const WAITING_EVENTS = [LIVE_OUTBOX_EVENT, OUTBOX_EVENT] as const;

// -------------------------------------------------------------- replay --

type Res = Promise<{ error: unknown }>;
/** `userId`: whose outbox it is (the change is written as that account only). */
export interface LiveOutboxApi {
  note: (op: Extract<LiveOp, { kind: 'note' }>, userId: string) => Res;
  noteDelete: (op: Extract<LiveOp, { kind: 'noteDelete' }>, userId: string) => Res;
  suggestion: (op: Extract<LiveOp, { kind: 'suggestion' }>, userId: string) => Res;
  order: (op: Extract<LiveOp, { kind: 'order' }>, userId: string) => Res;
  /** Is `userId` the account signed in now? Not: the flush stops, the change waits. */
  isSessionUser?: (userId: string) => Promise<boolean>;
}

const send = (api: LiveOutboxApi, op: LiveOp, userId: string): Res => {
  switch (op.kind) {
    case 'note':
      return api.note(op, userId);
    case 'noteDelete':
      return api.noteDelete(op, userId);
    case 'suggestion':
      return api.suggestion(op, userId);
    case 'order':
      return api.order(op, userId);
  }
};

/** `busy`: another tab is sending this account's changes right now; nothing sent from here. */
type FlushResult = { sent: number; dropped: number; left: number; busy?: boolean };
/**
 * The flush in flight, per account: another account's flush (signed in
 * meanwhile) runs its own outbox, never waits on or returns this one's.
 */
const flushing = new Map<string, Promise<FlushResult>>();

/**
 * Refused for good, never better on a retry: not allowed (42501), matched no
 * row (PGRST116), data the server rejects (22xxx: too long, bad value), a
 * constraint (23xxx: the song or setlist gone, a check), the setlist changed
 * meanwhile (BW_SETLIST_CONFLICT).
 * Anything else (a server error, a timeout) stays queued and is tried again.
 */
const DEFINITE_REFUSALS = new Set(['42501', 'PGRST116', 'BW_SETLIST_CONFLICT']);
export const isDefiniteRefusal = (error: unknown): boolean => {
  const code = String((error as { code?: unknown } | null)?.code ?? '');
  // Data the server will never take (22xxx: too long, bad value; 23xxx: a
  // check, a missing song). 23505 (already there) is handled where it occurs.
  return DEFINITE_REFUSALS.has(code) || /^22[0-9A-Z]{3}$/.test(code) || (/^23[0-9A-Z]{3}$/.test(code) && code !== '23505');
};

// After a server error: the next tries wait 5 s, 10 s, 20 s … up to 5 min
// (this tab). "Send now" goes at once.
const retryAfter = new Map<string, { at: number; n: number }>();
const backoff = (userId: string) => {
  const n = (retryAfter.get(userId)?.n ?? 0) + 1;
  retryAfter.set(userId, { n, at: Date.now() + Math.min(5000 * 2 ** (n - 1), 300_000) });
};

// One tab sends at a time (two tabs would send the same change twice):
// the Web Locks API where there is one, else a flag that expires.
const LOCK_MS = 60_000;
const tabId = Math.random().toString(36).slice(2);
const lockKey = (userId: string) => `bw:live_outbox_flushing:${userId}`;
function takeTabFlag(userId: string): boolean {
  try {
    const [owner, until] = (localStorage.getItem(lockKey(userId)) || '').split('|');
    if (owner && owner !== tabId && Number(until) > Date.now()) return false;
    localStorage.setItem(lockKey(userId), `${tabId}|${Date.now() + LOCK_MS}`);
  } catch {
    /* storage blocked: this tab only */
  }
  return true;
}
function dropTabFlag(userId: string) {
  try {
    if ((localStorage.getItem(lockKey(userId)) || '').startsWith(`${tabId}|`)) localStorage.removeItem(lockKey(userId));
  } catch {
    /* storage blocked */
  }
}
async function inOneTab(userId: string, run: () => Promise<FlushResult>, busy: () => FlushResult): Promise<FlushResult> {
  const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  if (locks?.request) {
    return locks.request(`bw-live-outbox:${userId}`, { ifAvailable: true }, async (lock) => (lock ? run() : busy()));
  }
  if (!takeTabFlag(userId)) return busy();
  try {
    return await run();
  } finally {
    dropTabFlag(userId);
  }
}

/**
 * Send the waiting changes in order. Still no signal: stop and keep the rest.
 * Sent only when the server wrote it (a write that matched no row is not).
 * Refused for good for its own account (isDefiniteRefusal): moved to the
 * refused list, so one bad change never blocks the others. Any other error:
 * kept in the queue and tried again later. Refused because another account
 * is signed in: kept in the queue. `force`: "Send now", no waiting.
 */
export function flushLiveOutbox(userId: string, api: LiveOutboxApi, opts?: { force?: boolean }) {
  const inFlight = flushing.get(userId);
  if (inFlight) return inFlight;
  const idle = (): FlushResult => ({ sent: 0, dropped: 0, left: readLiveOutbox(userId).length });
  const wait = retryAfter.get(userId);
  if (!opts?.force && wait && wait.at > Date.now()) return Promise.resolve(idle());
  const run: Promise<FlushResult> = inOneTab(
    userId,
    async () => {
      let sent = 0;
      let dropped = 0;
      // Another account signed in on this device: its session never sends this outbox.
      const notMine = async () => !!api.isSessionUser && !(await api.isSessionUser(userId));
      for (let op = readLiveOutbox(userId)[0], n = 0; op && n < 500; op = readLiveOutbox(userId)[0], n++) {
        if (await notMine()) break;
        const { error } = await send(api, op, userId);
        if (error && isOfflineError(error)) break;
        // Refused because the session changed meanwhile: kept for its account, not dropped.
        if (error && (await notMine())) break;
        // Not a refusal for good (a server error): kept, tried again later.
        if (error && !isDefiniteRefusal(error)) {
          backoff(userId);
          break;
        }
        // Refused: its copy is written first; no room (list full, storage) → it stays queued.
        if (error && !keepRefused(userId, op)) break;
        if (error) dropped++;
        else sent++;
        retryAfter.delete(userId);
        const same = JSON.stringify(op);
        writeLiveOutbox(userId, readLiveOutbox(userId).filter((o) => JSON.stringify(o) !== same));
      }
      return { sent, dropped, left: readLiveOutbox(userId).length };
    },
    () => ({ ...idle(), busy: true }),
  ).finally(() => {
    if (flushing.get(userId) === run) flushing.delete(userId);
  });
  flushing.set(userId, run);
  return run;
}

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
import { OUTBOX_EVENT, readOutbox } from './rehearsalNotesOutbox';

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
  /** The leader's new order; `before`: the order the server had (for the band's summary push). */
  | { kind: 'order'; setlistId: string; eventId?: string; rows: OrderRow[]; before: { songId: string; setNumber?: number }[] };

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
 * allowed, setlist changed meanwhile): kept on this phone, never deleted,
 * out of the queue so they don't block the rest. Newest last.
 */
const REFUSED_PREFIX = 'bw:live_refused:';
export function readRefusedLiveOps(userId: string | null | undefined): LiveOp[] {
  if (!userId) return [];
  try {
    const v = JSON.parse(localStorage.getItem(`${REFUSED_PREFIX}${userId}`) || '[]');
    return Array.isArray(v) ? (v as LiveOp[]) : [];
  } catch {
    return [];
  }
}
/** The refused list changed (Settings › Offline & live shows it). */
export const LIVE_REFUSED_EVENT = 'bw:live-refused';
function writeRefused(userId: string, ops: LiveOp[]) {
  try {
    if (ops.length) localStorage.setItem(`${REFUSED_PREFIX}${userId}`, JSON.stringify(ops.slice(-100)));
    else localStorage.removeItem(`${REFUSED_PREFIX}${userId}`);
  } catch {
    /* storage full or blocked */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(LIVE_REFUSED_EVENT, { detail: { userId } }));
}
function keepRefused(userId: string, op: LiveOp) {
  writeRefused(userId, [...readRefusedLiveOps(userId), op]);
}
/** The person copied what they needed: this one goes (the `index`-th of the list). */
export function removeRefusedLiveOp(userId: string, index: number) {
  writeRefused(userId, readRefusedLiveOps(userId).filter((_, i) => i !== index));
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

let flushing: Promise<{ sent: number; dropped: number; left: number }> | null = null;

/**
 * Send the waiting changes in order. Still no signal: stop and keep the rest.
 * Sent only when the server wrote it (a write that matched no row is not).
 * Refused for its own account (no longer allowed, song gone, setlist changed
 * by someone else): moved to the refused list, so one bad change never blocks
 * the others. Refused because another account is signed in: kept in the queue.
 */
export function flushLiveOutbox(userId: string, api: LiveOutboxApi) {
  if (flushing) return flushing;
  flushing = (async () => {
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
      if (error) dropped++;
      else sent++;
      if (error) keepRefused(userId, op);
      const same = JSON.stringify(op);
      writeLiveOutbox(userId, readLiveOutbox(userId).filter((o) => JSON.stringify(o) !== same));
    }
    return { sent, dropped, left: readLiveOutbox(userId).length };
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

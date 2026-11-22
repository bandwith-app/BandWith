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

export function queueLiveOp(userId: string, op: LiveOp) {
  writeLiveOutbox(userId, addLiveOp(readLiveOutbox(userId), op));
}

/** Every change waiting on this phone for this person (rehearsal notes too). */
export const waitingChanges = (userId: string | null | undefined): number =>
  userId ? readLiveOutbox(userId).length + readOutbox(userId).length : 0;

/** Both outboxes announce their changes with these events. */
export const WAITING_EVENTS = [LIVE_OUTBOX_EVENT, OUTBOX_EVENT] as const;

// -------------------------------------------------------------- replay --

/**
 * Worth sending again later, not a refusal: no signal, the server busy or
 * down (5xx, 408, 425, 429, a timeout), an expired session (it is renewed).
 * Anything else (not allowed, the song gone, invalid) is final.
 * Same rule as isRetryableWriteError in rehearsalNotesOutbox.ts (#296):
 * use that one once it is on main.
 */
function isRetryableWriteError(error: unknown, status?: number): boolean {
  if (isOfflineError(error)) return true;
  const e = (error && typeof error === 'object' ? error : {}) as { status?: unknown; code?: unknown; message?: unknown };
  const http = Number(status ?? e.status);
  if (http === 401 || http === 408 || http === 425 || http === 429 || http >= 500) return true;
  const code = e.code == null ? '' : String(e.code);
  // SQLSTATE: connection, rollback (serialization, deadlock), resources, operator intervention (timeouts).
  if (code === 'PGRST301' || /^(08|40|53|57)[0-9A-Z]{3}$/.test(code)) return true;
  const msg = String(e.message ?? '').toLowerCase();
  return msg.includes('jwt expired') || msg.includes('timed out') || msg.includes('timeout');
}

/** `status`: the HTTP status of the failed call, when known (a 503 is not a refusal). */
type Res = Promise<{ error: unknown; status?: number }>;
export interface LiveOutboxApi {
  note: (op: Extract<LiveOp, { kind: 'note' }>) => Res;
  noteDelete: (op: Extract<LiveOp, { kind: 'noteDelete' }>) => Res;
  suggestion: (op: Extract<LiveOp, { kind: 'suggestion' }>) => Res;
  order: (op: Extract<LiveOp, { kind: 'order' }>) => Res;
}

const send = (api: LiveOutboxApi, op: LiveOp): Res => {
  switch (op.kind) {
    case 'note':
      return api.note(op);
    case 'noteDelete':
      return api.noteDelete(op);
    case 'suggestion':
      return api.suggestion(op);
    case 'order':
      return api.order(op);
  }
};

let flushing: Promise<{ sent: number; dropped: number; left: number }> | null = null;

/**
 * Send the waiting changes in order. Still no signal or a passing server
 * problem (busy, down, a timeout, an expired session): stop and keep the
 * rest, tried again later. Refused by the server (no longer allowed, song
 * gone, setlist changed by someone else): dropped, so one bad change never
 * blocks the others.
 */
export function flushLiveOutbox(userId: string, api: LiveOutboxApi) {
  if (flushing) return flushing;
  flushing = (async () => {
    let sent = 0;
    let dropped = 0;
    for (let op = readLiveOutbox(userId)[0], n = 0; op && n < 500; op = readLiveOutbox(userId)[0], n++) {
      const { error, status } = await send(api, op);
      if (error && isRetryableWriteError(error, status)) break;
      if (error) dropped++;
      else sent++;
      const same = JSON.stringify(op);
      writeLiveOutbox(userId, readLiveOutbox(userId).filter((o) => JSON.stringify(o) !== same));
    }
    return { sent, dropped, left: readLiveOutbox(userId).length };
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

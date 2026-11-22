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

/**
 * Server problems met so far by a waiting change (no signal doesn't count):
 * how many tries failed, since when. A newer version of the change starts
 * again from zero.
 */
interface LiveOpTries {
  failedTries?: number;
  firstFailedAt?: string;
}

export type LiveOp = (
  /** A personal note written or edited; `isNew`: not on the server yet. */
  | { kind: 'note'; id: string; songId: string; anchor: NoteAnchor; body: string; isNew?: boolean }
  | { kind: 'noteDelete'; id: string; songId: string }
  /** A suggestion to the band (song_suggestions row, with its own id). */
  | { kind: 'suggestion'; id: string; row: Record<string, unknown> }
  /** The leader's new order; `before`: the order the server had (for the band's summary push). */
  | { kind: 'order'; setlistId: string; eventId?: string; rows: OrderRow[]; before: { songId: string; setNumber?: number }[] }
) &
  LiveOpTries;

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
export function addLiveOp(ops: LiveOp[], next: LiveOp): LiveOp[] {
  // A newer version: its own tries, none yet.
  const { failedTries: _tries, firstFailedAt: _since, ...op } = next;
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
export function isRetryableWriteError(error: unknown, status?: number): boolean {
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

// ------------------------------------------------------------ refused --

/**
 * A change the server refused for good (no longer allowed, the song gone,
 * the setlist changed meanwhile) or never took (still failing after many
 * tries): kept on this phone, never lost silently, so its words can be
 * copied. Removed when the person dismisses it.
 */
export interface LiveRefused {
  key: string;
  op: LiveOp;
  at: string;
  /** `refused`: the server said no. `stuck`: it kept failing. */
  why: 'refused' | 'stuck';
}

const REFUSED_PREFIX = 'bw:live_refused:';
const MAX_REFUSED = 50;
/** Set aside after this many failed tries, at least this long after the first… */
const MAX_TRIES = 10;
const MIN_STUCK_MS = 15 * 60_000;
/** …or after a day of failures, however few the tries. */
const MAX_STUCK_MS = 24 * 60 * 60_000;

export function readLiveRefused(userId: string | null | undefined): LiveRefused[] {
  if (!userId) return [];
  try {
    const v = JSON.parse(localStorage.getItem(`${REFUSED_PREFIX}${userId}`) || '[]');
    return Array.isArray(v) ? (v as LiveRefused[]) : [];
  } catch {
    return [];
  }
}

function writeLiveRefused(userId: string, items: LiveRefused[]) {
  try {
    if (items.length) localStorage.setItem(`${REFUSED_PREFIX}${userId}`, JSON.stringify(items.slice(-MAX_REFUSED)));
    else localStorage.removeItem(`${REFUSED_PREFIX}${userId}`);
  } catch {
    /* storage blocked */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(LIVE_OUTBOX_EVENT, { detail: { userId } }));
}

export function dismissLiveRefused(userId: string, key: string) {
  writeLiveRefused(userId, readLiveRefused(userId).filter((r) => r.key !== key));
}

/** A deleted note refused (not mine, already gone) loses nothing: not kept. */
function setAside(userId: string, op: LiveOp, why: LiveRefused['why']) {
  if (op.kind === 'noteDelete') return;
  const { failedTries: _tries, firstFailedAt: _since, ...clean } = op;
  const key = `${keyOfOp(clean as LiveOp)}:${Date.now()}`;
  writeLiveRefused(userId, [...readLiveRefused(userId), { key, op: clean as LiveOp, at: new Date().toISOString(), why }]);
}

let flushing: Promise<{ sent: number; dropped: number; left: number }> | null = null;

/**
 * Send the waiting changes in order. Still no signal or a passing server
 * problem (busy, down, a timeout, an expired session): stop and keep the
 * rest, tried again later. Refused by the server (no longer allowed, song
 * gone, setlist changed by someone else), or still failing after 10 tries
 * over a quarter of an hour or after a day: set aside (readLiveRefused), so
 * one bad change never blocks the others and none is lost silently.
 */
export function flushLiveOutbox(userId: string, api: LiveOutboxApi) {
  if (flushing) return flushing;
  flushing = (async () => {
    let sent = 0;
    let dropped = 0;
    for (let op = readLiveOutbox(userId)[0], n = 0; op && n < 500; op = readLiveOutbox(userId)[0], n++) {
      const { error, status } = await send(api, op);
      const same = JSON.stringify(op);
      if (error && isOfflineError(error)) break;
      if (error && isRetryableWriteError(error, status)) {
        const now = Date.now();
        const tries = (op.failedTries ?? 0) + 1;
        const since = op.firstFailedAt ?? new Date(now).toISOString();
        const age = now - Date.parse(since);
        if (!((tries >= MAX_TRIES && age >= MIN_STUCK_MS) || age >= MAX_STUCK_MS)) {
          // Counted on the change itself, unless a newer version replaced it meanwhile.
          writeLiveOutbox(userId, readLiveOutbox(userId).map((o) => (JSON.stringify(o) === same ? { ...o, failedTries: tries, firstFailedAt: since } : o)));
          break;
        }
        setAside(userId, op, 'stuck');
        dropped++;
      } else if (error) {
        setAside(userId, op, 'refused');
        dropped++;
      } else sent++;
      writeLiveOutbox(userId, readLiveOutbox(userId).filter((o) => JSON.stringify(o) !== same));
    }
    return { sent, dropped, left: readLiveOutbox(userId).length };
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

/**
 * Rehearsal notes written with no signal (rehearsal rooms are often
 * basements): kept on this device, shown at once, sent when back online.
 * Every change is idempotent (the note's own id), so sending one twice is
 * harmless. Kept per user under `bw:`.
 */
import { isOfflineError } from './offline/networkErrors';
import type { RehearsalNote } from './rehearsalNotes';

export type NoteOp =
  | { kind: 'save'; note: RehearsalNote; before: string[] }
  | { kind: 'delete'; id: string }
  | { kind: 'practised'; id: string; userId: string; value: boolean }
  | { kind: 'ok'; id: string; value: boolean };

const opId = (op: NoteOp) => (op.kind === 'save' ? op.note.id : op.id);

/** Queue a change: it replaces a waiting one of the same kind; a delete drops all of that note's. */
export function addOp(ops: NoteOp[], op: NoteOp): NoteOp[] {
  const id = opId(op);
  const kept = ops.filter((o) => opId(o) !== id || (op.kind !== 'delete' && o.kind !== op.kind));
  if (op.kind === 'save') {
    // Keep the assignees the server had before the first waiting save.
    const prev = ops.find((o) => o.kind === 'save' && o.note.id === id);
    if (prev && prev.kind === 'save') return [...kept, { ...op, before: prev.before }];
  }
  return [...kept, op];
}

/** The saved notes as this device will see them once its changes are sent. */
export function applyOps(saved: RehearsalNote[], ops: NoteOp[], userId: string | null | undefined): RehearsalNote[] {
  const byId = new Map(saved.map((n) => [n.id, n]));
  for (const op of ops) {
    if (op.kind === 'save') byId.set(op.note.id, op.note);
    else if (op.kind === 'delete') byId.delete(op.id);
    else {
      const n = byId.get(op.id);
      if (!n) continue;
      if (op.kind === 'ok') byId.set(n.id, { ...n, status: op.value ? 'ok' : 'open', okBy: op.value ? userId ?? null : null });
      else
        byId.set(n.id, {
          ...n,
          assignees: n.assignees.map((a) =>
            a.userId === op.userId ? { ...a, practisedAt: op.value ? a.practisedAt ?? new Date().toISOString() : null } : a,
          ),
        });
    }
  }
  return [...byId.values()];
}

// ------------------------------------------------------------- storage --

const KEY_PREFIX = 'bw:rehearsal_notes_outbox:';
export const OUTBOX_EVENT = 'bw:rehearsal-notes-outbox';
const keyOf = (userId: string) => `${KEY_PREFIX}${userId}`;

export function readOutbox(userId: string | null | undefined): NoteOp[] {
  if (!userId) return [];
  try {
    const v = JSON.parse(localStorage.getItem(keyOf(userId)) || '[]');
    return Array.isArray(v) ? (v as NoteOp[]) : [];
  } catch {
    return [];
  }
}

export function writeOutbox(userId: string, ops: NoteOp[]) {
  try {
    if (ops.length) localStorage.setItem(keyOf(userId), JSON.stringify(ops));
    else localStorage.removeItem(keyOf(userId));
  } catch {
    /* storage full or blocked: the change stays in memory for this visit */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(OUTBOX_EVENT, { detail: { userId } }));
}

export function queueNoteOp(userId: string, op: NoteOp) {
  writeOutbox(userId, addOp(readOutbox(userId), op));
}

/**
 * Notes the server refused for good (audit 06 #5): kept with their text so
 * the screen can say so and the words aren't lost. All of them, until the
 * person removes each one (their outbox entry is already gone, #296 round 3).
 */
const REJECTED_PREFIX = 'bw:rehearsal_notes_rejected:';

export function readRejected(userId: string | null | undefined): RehearsalNote[] {
  if (!userId) return [];
  try {
    const v = JSON.parse(localStorage.getItem(`${REJECTED_PREFIX}${userId}`) || '[]');
    return Array.isArray(v) ? (v as RehearsalNote[]) : [];
  } catch {
    return [];
  }
}

function writeRejected(userId: string, notes: RehearsalNote[]) {
  try {
    if (notes.length) localStorage.setItem(`${REJECTED_PREFIX}${userId}`, JSON.stringify(notes));
    else localStorage.removeItem(`${REJECTED_PREFIX}${userId}`);
  } catch {
    /* storage blocked */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(OUTBOX_EVENT, { detail: { userId } }));
}

export function dismissRejected(userId: string, id: string) {
  writeRejected(userId, readRejected(userId).filter((n) => n.id !== id));
}

/**
 * Worth sending again later, not a refusal (audit 06 #5): no signal, the
 * server busy or down (5xx, 429, a timeout), an expired session (it is
 * renewed). Anything else (not allowed, the note gone, invalid) is final.
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

// -------------------------------------------------------------- replay --

/** `status`: the HTTP status of the failed call, when known (a 503 is not a refusal). */
type Res = Promise<{ error: unknown; status?: number }>;
export interface OutboxApi {
  save: (note: RehearsalNote, before: string[]) => Res;
  remove: (id: string) => Res;
  practised: (id: string, userId: string, value: boolean) => Res;
  ok: (id: string, value: boolean) => Res;
}

const send = (api: OutboxApi, op: NoteOp): Res => {
  switch (op.kind) {
    case 'save':
      return api.save(op.note, op.before);
    case 'delete':
      return api.remove(op.id);
    case 'practised':
      return api.practised(op.id, op.userId, op.value);
    case 'ok':
      return api.ok(op.id, op.value);
  }
};

let flushing: Promise<{ sent: number; dropped: number; left: number }> | null = null;

/**
 * A note the server keeps failing (5xx and the like) waits on its own, longer
 * each time (20 s, 40 s… up to 10 min), so the other notes still go (PR #296
 * review). In memory: a restart tries it again at once.
 */
const BACKOFF_FIRST_MS = 20_000;
const BACKOFF_MAX_MS = 10 * 60_000;
const backoff = new Map<string, { attempts: number; until: number }>();
const backoffKey = (userId: string, id: string) => `${userId}:${id}`;
const waitingOut = (userId: string, id: string) => (backoff.get(backoffKey(userId, id))?.until ?? 0) > Date.now();
const failedAgain = (userId: string, id: string) => {
  const k = backoffKey(userId, id);
  const attempts = (backoff.get(k)?.attempts ?? 0) + 1;
  backoff.set(k, { attempts, until: Date.now() + Math.min(BACKOFF_MAX_MS, BACKOFF_FIRST_MS * 2 ** (attempts - 1)) });
};
/** Tests: forget every note's wait. */
export const clearNoteBackoff = () => backoff.clear();

/**
 * Send the waiting changes in order. Offline or a passing server problem:
 * stop and keep the rest (tried again later). Refused for good (no longer
 * allowed, note gone): dropped, so one bad change never blocks the others,
 * and a refused note's text is kept to show (readRejected). Changes queued
 * meanwhile stay queued.
 */
export function flushOutbox(userId: string, api: OutboxApi) {
  if (flushing) return flushing;
  flushing = (async () => {
    let sent = 0;
    let dropped = 0;
    // Notes passed over in this pass (failing now, or waiting out a failure):
    // their later changes wait behind them, in order.
    const held = new Set<string>();
    // Changes queued while sending go in the same pass (a mark, then its preset).
    // (Bounded: storage that can't be written would hand back the same change.)
    for (let n = 0; n < 500; n++) {
      const op = readOutbox(userId).find((o) => !held.has(opId(o)));
      if (!op) break;
      const id = opId(op);
      if (waitingOut(userId, id)) {
        held.add(id);
        continue;
      }
      const { error, status } = await send(api, op);
      // No signal: everything would fail, stop here.
      if (error && isOfflineError(error)) break;
      if (error && isRetryableWriteError(error, status)) {
        failedAgain(userId, id);
        held.add(id);
        continue;
      }
      backoff.delete(backoffKey(userId, id));
      if (error) {
        dropped++;
        if (op.kind === 'save') writeRejected(userId, [...readRejected(userId).filter((n) => n.id !== op.note.id), op.note]);
      } else {
        sent++;
        if (op.kind === 'save' && readRejected(userId).some((n) => n.id === op.note.id)) dismissRejected(userId, op.note.id);
      }
      const same = JSON.stringify(op);
      writeOutbox(userId, readOutbox(userId).filter((o) => JSON.stringify(o) !== same));
    }
    return { sent, dropped, left: readOutbox(userId).length };
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

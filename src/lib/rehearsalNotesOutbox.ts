/**
 * Rehearsal notes written with no signal (rehearsal rooms are often
 * basements): kept on this device, shown at once, sent when back online.
 * Every change is idempotent (the note's own id), so sending one twice is
 * harmless. Kept per user under `bw:`, which logout wipes.
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

// -------------------------------------------------------------- replay --

type Res = Promise<{ error: unknown }>;
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
 * Send the waiting changes in order. Offline: stop and keep the rest. Refused
 * by the server (no longer allowed, note gone): dropped, so one bad change
 * never blocks the others. Changes queued meanwhile stay queued.
 */
export function flushOutbox(userId: string, api: OutboxApi) {
  if (flushing) return flushing;
  flushing = (async () => {
    let sent = 0;
    let dropped = 0;
    // Changes queued while sending go in the same pass (a mark, then its preset).
    // (Bounded: storage that can't be written would hand back the same change.)
    for (let op = readOutbox(userId)[0], n = 0; op && n < 500; op = readOutbox(userId)[0], n++) {
      const { error } = await send(api, op);
      if (error && isOfflineError(error)) break;
      if (error) dropped++;
      else sent++;
      const same = JSON.stringify(op);
      writeOutbox(userId, readOutbox(userId).filter((o) => JSON.stringify(o) !== same));
    }
    return { sent, dropped, left: readOutbox(userId).length };
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

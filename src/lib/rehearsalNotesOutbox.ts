/**
 * Rehearsal notes written with no signal (rehearsal rooms are often
 * basements): kept on this device, shown at once, sent when back online.
 * Every change is idempotent (the note's own id), so sending one twice is
 * harmless. Kept per user under `bw:`.
 */
import { isOfflineError } from './offline/networkErrors';
import type { RehearsalNote } from './rehearsalNotes';

export type NoteOp =
  /** `refused`: refused for good, but the device had no room to keep its text apart: kept here, never sent again (#296 round 4). */
  | { kind: 'save'; note: RehearsalNote; before: string[]; refused?: true }
  | { kind: 'delete'; id: string }
  | { kind: 'practised'; id: string; userId: string; value: boolean }
  | { kind: 'ok'; id: string; value: boolean };

const opId = (op: NoteOp) => (op.kind === 'save' ? op.note.id : op.id);

/** Queue a change: it replaces a waiting one of the same kind; a delete drops all of that note's. */
export function addOp(ops: NoteOp[], op: NoteOp): NoteOp[] {
  const id = opId(op);
  // A refused note kept here (no room elsewhere) is never replaced: its words stay (#296 round 5).
  const kept = ops.filter((o) => opId(o) !== id || (o.kind === 'save' && !!o.refused) || (op.kind !== 'delete' && o.kind !== op.kind));
  if (op.kind === 'save') {
    // Keep the assignees the server had before the first waiting save.
    const prev = ops.find((o) => o.kind === 'save' && o.note.id === id && !o.refused);
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

/** The changes waiting to be sent (a refused note kept here for lack of room is not one, #296 round 4). */
export function readOutbox(userId: string | null | undefined): NoteOp[] {
  return userId ? readAllOps(userId).filter((o) => !isRefused(userId, o)) : [];
}

function readAllOps(userId: string | null | undefined): NoteOp[] {
  if (!userId) return [];
  try {
    const v = JSON.parse(localStorage.getItem(keyOf(userId)) || '[]');
    return Array.isArray(v) ? (v as NoteOp[]) : [];
  } catch {
    return [];
  }
}

export function writeOutbox(userId: string, ops: NoteOp[]): boolean {
  let ok = true;
  try {
    if (ops.length) localStorage.setItem(keyOf(userId), JSON.stringify(ops));
    else localStorage.removeItem(keyOf(userId));
  } catch {
    /* storage full or blocked: the change stays in memory for this visit */
    ok = false;
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(OUTBOX_EVENT, { detail: { userId } }));
  return ok;
}

export function queueNoteOp(userId: string, op: NoteOp) {
  const all = readAllOps(userId);
  // Refused ones stay as they are; the new change goes out on its own.
  writeOutbox(userId, [...all.filter((o) => isRefused(userId, o)), ...addOp(all.filter((o) => !isRefused(userId, o)), op)]);
}

/**
 * Notes the server refused for good (audit 06 #5): kept with their text so
 * the screen can say so and the words aren't lost. All of them, until the
 * person removes each one (#296 round 3).
 *
 * Moved out of the outbox only once the copy is really written (#296 round
 * 4): with the device's storage full, the note stays in the outbox marked
 * `refused` (or, if even that can't be written, in memory for this visit,
 * the outbox entry untouched), never sent again, and shown with
 * `spaceFull` so the person copies it now.
 */
/**
 * Kept exactly as it is: sign-out must keep these lists (they hold words the
 * server refused), only an account deletion erases them. The exclusion list
 * for sign-out lives in clearOfflineCache (src/lib/offline/storage.ts, PR #292).
 */
export const REJECTED_PREFIX = 'bw:rehearsal_notes_rejected:';

export type RejectedNote = RehearsalNote & { spaceFull?: boolean };

/**
 * One refused version of a note: the same note refused again with other
 * words is another entry, never written over (#296 round 6). Only Remove
 * takes one away.
 */
export const rejectedKey = (n: RehearsalNote): string =>
  JSON.stringify([n.id, n.body ?? null, n.section ?? null, n.preset ?? null, n.songId ?? null, n.line ?? null]);

/**
 * Refused changes no storage could take (this visit only), by the change
 * itself, not the note: a later real edit of the note still goes out.
 */
const refusedHere = new Map<string, Map<string, RehearsalNote>>();
const isRefused = (userId: string, op: NoteOp) => op.kind === 'save' && (!!op.refused || !!refusedHere.get(userId)?.has(JSON.stringify(op)));

const readStoredRejected = (userId: string): RehearsalNote[] => {
  try {
    const v = JSON.parse(localStorage.getItem(`${REJECTED_PREFIX}${userId}`) || '[]');
    return Array.isArray(v) ? (v as RehearsalNote[]) : [];
  } catch {
    return [];
  }
};

export function readRejected(userId: string | null | undefined): RejectedNote[] {
  if (!userId) return [];
  const out: RejectedNote[] = readStoredRejected(userId);
  const seen = new Set(out.map(rejectedKey));
  const spaceFull = (n: RehearsalNote) => {
    if (seen.has(rejectedKey(n))) return;
    seen.add(rejectedKey(n));
    out.push({ ...n, spaceFull: true });
  };
  for (const op of readAllOps(userId)) if (op.kind === 'save' && isRefused(userId, op)) spaceFull(op.note);
  for (const n of refusedHere.get(userId)?.values() ?? []) spaceFull(n);
  return out;
}

/** True only when the list is really written (storage full fails quietly in some browsers: read back). */
function writeRejected(userId: string, notes: RehearsalNote[]): boolean {
  let ok = true;
  try {
    if (notes.length) localStorage.setItem(`${REJECTED_PREFIX}${userId}`, JSON.stringify(notes));
    else localStorage.removeItem(`${REJECTED_PREFIX}${userId}`);
  } catch {
    ok = false;
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(OUTBOX_EVENT, { detail: { userId } }));
  return ok;
}

/** Remove (the person's choice): one entry by its rejectedKey, or every entry of a note by its id. */
export function dismissRejected(userId: string, keyOrId: string) {
  const byKey = readRejected(userId).some((n) => rejectedKey(n) === keyOrId);
  const match = (n: RehearsalNote) => (byKey ? rejectedKey(n) === keyOrId : n.id === keyOrId);
  const ops = readAllOps(userId);
  const left = ops.filter((o) => !(o.kind === 'save' && match(o.note) && isRefused(userId, o)));
  const here = refusedHere.get(userId);
  for (const [sig, n] of here ?? []) if (match(n)) here!.delete(sig);
  if (left.length !== ops.length) writeOutbox(userId, left);
  writeRejected(userId, readStoredRejected(userId).filter((n) => !match(n)));
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

/**
 * One pass at a time per account (#296 round 8, as #292's live outbox): an
 * account switch while the last account's pass is on its way still sends the
 * new account's notes and reports its own counts.
 */
const flushing = new Map<string, Promise<{ sent: number; dropped: number; left: number }>>();

/**
 * A refused note goes to the refused list, `bw:rehearsal_notes_rejected:<uid>`,
 * which sign-out keeps for that account (#296 round 8, Codex r8 B1; #292's
 * KEEP_ON_SIGN_OUT_PREFIXES). The copy is read back before the outbox entry
 * goes. No room for it: the entry is marked refused in the outbox, then taken
 * out to make room and the copy tried again; still no room, the marked entry
 * goes back (it fitted a moment ago). Not even the mark fits (storage
 * completely full): the entry stays as it is, marked in memory, never sent again.
 */
function keepRefused(userId: string, op: Extract<NoteOp, { kind: 'save' }>): boolean {
  const plain = JSON.stringify({ ...op, refused: undefined });
  const isIt = (o: NoteOp) => JSON.stringify({ ...o, refused: undefined }) === plain;
  const note = op.note;
  const copy = () =>
    writeRejected(userId, [...readStoredRejected(userId).filter((n) => rejectedKey(n) !== rejectedKey(note)), note]) &&
    readStoredRejected(userId).some((n) => rejectedKey(n) === rejectedKey(note));
  const without = () => readAllOps(userId).filter((o) => !isIt(o));
  const done = () => {
    refusedHere.get(userId)?.delete(JSON.stringify(op));
    refusedHere.get(userId)?.delete(JSON.stringify({ ...op, refused: true }));
    return true;
  };
  if (copy()) {
    writeOutbox(userId, without());
    return done();
  }
  const back: NoteOp = { ...op, refused: true };
  const marked = readAllOps(userId).some(isIt) ? readAllOps(userId).map((o) => (isIt(o) ? back : o)) : [...readAllOps(userId), back];
  if (!writeOutbox(userId, marked)) {
    if (!refusedHere.has(userId)) refusedHere.set(userId, new Map());
    refusedHere.get(userId)!.set(JSON.stringify(op), note);
    return false;
  }
  writeOutbox(userId, without());
  if (copy()) return done();
  writeOutbox(userId, marked);
  return false;
}

/**
 * Refused notes still in an outbox (kept there when storage was full): moved
 * to the refused list once there is room (each flush, and before a
 * sign-out), so the sign-out keeps them. `userId` missing: every account's
 * outbox on this device, each into its own list.
 */
export function settleRefusedNotes(userId?: string | null, except?: string | null): void {
  const users: string[] = [];
  if (userId) users.push(userId);
  else {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith(KEY_PREFIX)) users.push(k.slice(KEY_PREFIX.length));
      }
    } catch {
      /* storage blocked */
    }
  }
  const gone = except?.toLowerCase() ?? null;
  for (const u of users) {
    if (gone && u.toLowerCase() === gone) continue;
    for (const op of readAllOps(u)) if (op.kind === 'save' && op.refused) keepRefused(u, op);
  }
}

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
  const inFlight = flushing.get(userId);
  if (inFlight) return inFlight;
  const run = (async () => {
    let sent = 0;
    let dropped = 0;
    // Notes passed over in this pass (failing now, or waiting out a failure):
    // their later changes wait behind them, in order.
    const held = new Set<string>();
    settleRefusedNotes(userId);
    // Changes queued while sending go in the same pass (a mark, then its preset).
    // (Bounded: storage that can't be written would hand back the same change.)
    for (let n = 0; n < 500; n++) {
      // Refused notes kept in the outbox (no room elsewhere) are never sent again.
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
      const same = JSON.stringify(op);
      if (error) {
        dropped++;
        if (op.kind === 'save') {
          keepRefused(userId, op);
          continue;
        }
      } else {
        // A refused version of this note stays until the person removes it,
        // whatever was saved since (#296 round 6).
        sent++;
      }
      writeOutbox(userId, readAllOps(userId).filter((o) => JSON.stringify(o) !== same));
    }
    return { sent, dropped, left: readOutbox(userId).length };
  })().finally(() => {
    if (flushing.get(userId) === run) flushing.delete(userId);
  });
  flushing.set(userId, run);
  return run;
}

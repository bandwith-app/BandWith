import { describe, it, expect, vi, beforeEach } from 'vitest';
import { addOp, applyOps, clearNoteBackoff, dismissRejected, flushOutbox, readOutbox, readRejected, writeOutbox, type NoteOp } from '../rehearsalNotesOutbox';
import type { RehearsalNote } from '../rehearsalNotes';

const ME = 'user-me';
const note = (id: string, extra: Partial<RehearsalNote> = {}): RehearsalNote => ({
  id,
  bandId: 'b',
  eventId: 'e',
  date: '2026-11-19',
  sessionId: null,
  songId: 's1',
  songTitle: 'Paper Boats',
  preset: 'tempo',
  section: null,
  body: null,
  scope: 'members',
  status: 'open',
  markedAtS: null,
  createdBy: ME,
  okBy: null,
  okAt: null,
  createdAt: '2026-11-19T20:00:00.000Z',
  assignees: [{ userId: ME, practisedAt: null }],
  ...extra,
});

describe('rehearsal notes outbox: queue', () => {
  it('a later change of the same kind replaces the earlier one', () => {
    let ops: NoteOp[] = [];
    ops = addOp(ops, { kind: 'save', note: note('n1', { body: 'a' }), before: [] });
    ops = addOp(ops, { kind: 'save', note: note('n1', { body: 'b' }), before: [] });
    ops = addOp(ops, { kind: 'practised', id: 'n1', userId: ME, value: true });
    ops = addOp(ops, { kind: 'practised', id: 'n1', userId: ME, value: false });
    expect(ops).toHaveLength(2);
    expect(ops[0]).toMatchObject({ kind: 'save', note: { body: 'b' } });
    expect(ops[1]).toMatchObject({ kind: 'practised', value: false });
  });

  it('a delete drops what was waiting for that note', () => {
    let ops: NoteOp[] = [];
    ops = addOp(ops, { kind: 'save', note: note('n1'), before: [] });
    ops = addOp(ops, { kind: 'ok', id: 'n1', value: true });
    ops = addOp(ops, { kind: 'save', note: note('n2'), before: [] });
    ops = addOp(ops, { kind: 'delete', id: 'n1' });
    expect(ops.map((o) => o.kind)).toEqual(['save', 'delete']);
  });

  it('the list shows what waits on this device', () => {
    const saved = [note('n1'), note('n2')];
    const ops: NoteOp[] = [
      { kind: 'save', note: note('n3', { body: 'offline' }), before: [] },
      { kind: 'practised', id: 'n1', userId: ME, value: true },
      { kind: 'ok', id: 'n1', value: true },
      { kind: 'delete', id: 'n2' },
    ];
    const out = applyOps(saved, ops, ME);
    expect(out.map((n) => n.id).sort()).toEqual(['n1', 'n3']);
    const n1 = out.find((n) => n.id === 'n1')!;
    expect(n1.status).toBe('ok');
    expect(n1.assignees[0].practisedAt).not.toBeNull();
  });
});

describe('rehearsal notes outbox: replay', () => {
  beforeEach(() => localStorage.clear());

  it('kept per user under bw: (wiped on logout)', () => {
    writeOutbox(ME, [{ kind: 'delete', id: 'n1' }]);
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i) ?? '');
    expect(keys.some((k) => k.startsWith('bw:') && k.includes(ME))).toBe(true);
    expect(readOutbox(ME)).toEqual([{ kind: 'delete', id: 'n1' }]);
    expect(readOutbox('someone-else')).toEqual([]);
  });

  it('sends in order; offline keeps the rest; a refusal is dropped', async () => {
    const calls: string[] = [];
    const api = {
      save: vi.fn(async (n: RehearsalNote) => {
        calls.push(`save ${n.id}`);
        return { error: n.id === 'bad' ? { code: '42501', message: 'denied' } : null };
      }),
      remove: vi.fn(async (id: string) => {
        calls.push(`delete ${id}`);
        return { error: { message: 'Failed to fetch' } };
      }),
      practised: vi.fn(async () => ({ error: null })),
      ok: vi.fn(async () => ({ error: null })),
    };
    writeOutbox(ME, [
      { kind: 'save', note: note('bad'), before: [] },
      { kind: 'save', note: note('n1'), before: [] },
      { kind: 'delete', id: 'n2' },
      { kind: 'ok', id: 'n1', value: true },
    ]);
    const res = await flushOutbox(ME, api);
    expect(calls).toEqual(['save bad', 'save n1', 'delete n2']);
    expect(res).toEqual({ sent: 1, dropped: 1, left: 2 });
    expect(readOutbox(ME).map((o) => o.kind)).toEqual(['delete', 'ok']);
  });

  it('a change queued while sending goes in the same pass', async () => {
    const sent: string[] = [];
    const api = {
      save: vi.fn(async (n: RehearsalNote) => {
        sent.push(n.id);
        // The player taps a preset while the mark is on its way.
        if (n.id === 'mark') writeOutbox(ME, [...readOutbox(ME), { kind: 'save', note: note('preset'), before: [] }]);
        return { error: null };
      }),
      remove: vi.fn(async () => ({ error: null })),
      practised: vi.fn(async () => ({ error: null })),
      ok: vi.fn(async () => ({ error: null })),
    };
    writeOutbox(ME, [{ kind: 'save', note: note('mark'), before: [] }]);
    expect(await flushOutbox(ME, api)).toEqual({ sent: 2, dropped: 0, left: 0 });
    expect(sent).toEqual(['mark', 'preset']);
  });
});

describe('audit 06 #5: a server error never throws a note away', () => {
  beforeEach(() => {
    localStorage.clear();
    clearNoteBackoff();
  });
  const apiWith = (save: (n: RehearsalNote) => Promise<{ error: unknown; status?: number }>) => ({
    save: vi.fn(save),
    remove: vi.fn(async () => ({ error: null })),
    practised: vi.fn(async () => ({ error: null })),
    ok: vi.fn(async () => ({ error: null })),
  });

  it('503 Service Unavailable: the note stays queued for the next try', async () => {
    writeOutbox(ME, [{ kind: 'save', note: note('n1', { body: 'Bridge rushes' }), before: [] }]);
    const api = apiWith(async () => ({ error: { message: 'Service Unavailable', code: '' }, status: 503 }));
    expect(await flushOutbox(ME, api)).toEqual({ sent: 0, dropped: 0, left: 1 });
    expect(readOutbox(ME)).toHaveLength(1);
    expect(readRejected(ME)).toEqual([]);
  });

  it('other passing problems (schema cache 503, an expired session, too many requests, a timeout) wait too', async () => {
    for (const res of [
      { error: { code: 'PGRST002', message: 'Could not query the database for the schema cache. Retrying.' }, status: 503 },
      { error: { code: 'PGRST301', message: 'JWT expired' }, status: 401 },
      { error: { message: 'Too Many Requests' }, status: 429 },
      { error: { code: '57014', message: 'canceling statement due to statement timeout' }, status: 500 },
      { error: { message: 'Bad Gateway', status: 502 } },
    ]) {
      localStorage.clear();
      clearNoteBackoff();
      writeOutbox(ME, [{ kind: 'save', note: note('n1'), before: [] }]);
      expect(await flushOutbox(ME, apiWith(async () => res))).toEqual({ sent: 0, dropped: 0, left: 1 });
    }
  });

  it('refused for good (not allowed): its text is kept to show, the rest still goes', async () => {
    writeOutbox(ME, [
      { kind: 'save', note: note('bad', { body: 'Count the outro in four' }), before: [] },
      { kind: 'save', note: note('n2'), before: [] },
    ]);
    const api = apiWith(async (n) => (n.id === 'bad' ? { error: { code: '42501', message: 'denied' }, status: 403 } : { error: null }));
    expect(await flushOutbox(ME, api)).toEqual({ sent: 1, dropped: 1, left: 0 });
    expect(readRejected(ME).map((n) => [n.id, n.body])).toEqual([['bad', 'Count the outro in four']]);
    dismissRejected(ME, 'bad');
    expect(readRejected(ME)).toEqual([]);
  });

  it('Claude minor: one note that keeps failing (5xx) waits on its own; the others still go, and it is tried again later', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    writeOutbox(ME, [
      { kind: 'save', note: note('stuck'), before: [] },
      { kind: 'ok', id: 'stuck', value: true },
      { kind: 'save', note: note('n2'), before: [] },
    ]);
    const api = apiWith(async (n) => (n.id === 'stuck' ? { error: { message: 'Internal Server Error' }, status: 500 } : { error: null }));
    expect(await flushOutbox(ME, api)).toEqual({ sent: 1, dropped: 0, left: 2 });
    // Its later change waits behind it, in order.
    expect(api.ok).not.toHaveBeenCalled();
    expect(readOutbox(ME).map((o) => o.kind)).toEqual(['save', 'ok']);
    // Right away again: not hammered.
    await flushOutbox(ME, api);
    expect(api.save.mock.calls.filter(([n]) => n.id === 'stuck')).toHaveLength(1);
    // Later: tried again; now it goes, and its OK after it.
    now.mockReturnValue(1_000_000 + 10 * 60_000);
    api.save.mockImplementation(async () => ({ error: null }));
    expect(await flushOutbox(ME, api)).toEqual({ sent: 2, dropped: 0, left: 0 });
    now.mockRestore();
  });

  it('no signal still stops the whole pass (everything would fail)', async () => {
    writeOutbox(ME, [
      { kind: 'save', note: note('a'), before: [] },
      { kind: 'save', note: note('b'), before: [] },
    ]);
    const api = apiWith(async () => ({ error: { message: 'Failed to fetch' } }));
    expect(await flushOutbox(ME, api)).toEqual({ sent: 0, dropped: 0, left: 2 });
    expect(api.save).toHaveBeenCalledTimes(1);
  });
});

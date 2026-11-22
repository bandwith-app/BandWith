import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  addLiveOp,
  applyNoteOps,
  flushLiveOutbox,
  queueLiveOp,
  readLiveOutbox,
  readRefusedLiveOps,
  refusedListFull,
  REFUSED_LIMIT,
  waitingChanges,
  type LiveOp,
  type LiveOutboxApi,
} from '../liveOutbox';
import { queueNoteOp } from '../rehearsalNotesOutbox';

const me = 'u-1';
const note = (id: string, body: string, isNew = false): LiveOp => ({
  kind: 'note',
  id,
  songId: 's1',
  anchor: { type: 'song' } as never,
  body,
  isNew,
});

beforeEach(() => localStorage.clear());

describe('live outbox: what waits on the phone', () => {
  it('a later edit of the same note replaces the waiting one and stays "new"', () => {
    let ops = addLiveOp([], note('n1', 'capo 2', true));
    ops = addLiveOp(ops, note('n1', 'capo 3'));
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ body: 'capo 3', isNew: true });
  });

  it('deleting a note written offline sends nothing at all', () => {
    let ops = addLiveOp([], note('n1', 'capo 2', true));
    ops = addLiveOp(ops, { kind: 'noteDelete', id: 'n1', songId: 's1' });
    expect(ops).toEqual([]);
  });

  it('deleting a saved note replaces its waiting edit', () => {
    let ops = addLiveOp([], note('n1', 'capo 2'));
    ops = addLiveOp(ops, { kind: 'noteDelete', id: 'n1', songId: 's1' });
    expect(ops).toEqual([{ kind: 'noteDelete', id: 'n1', songId: 's1' }]);
  });

  it('the leader reordering twice sends the last order, diffed from the first saved one', () => {
    const order = (ids: string[], before: string[]): LiveOp => ({
      kind: 'order',
      setlistId: 'sl',
      eventId: 'e1',
      rows: ids.map((id, i) => ({ id, setlist_id: 'sl', song_id: `song-${id}`, position: i, set_number: 1 })),
      before: before.map((id) => ({ songId: `song-${id}`, setNumber: 1 })),
    });
    let ops = addLiveOp([], order(['b', 'a', 'c'], ['a', 'b', 'c']));
    ops = addLiveOp(ops, order(['c', 'b', 'a'], ['b', 'a', 'c']));
    expect(ops).toHaveLength(1);
    expect((ops[0] as Extract<LiveOp, { kind: 'order' }>).rows.map((r) => r.id)).toEqual(['c', 'b', 'a']);
    expect((ops[0] as Extract<LiveOp, { kind: 'order' }>).before.map((b) => b.songId)).toEqual(['song-a', 'song-b', 'song-c']);
  });

  it('shows my notes as they will be once sent', () => {
    const saved = [
      { id: 'n1', song_id: 's1', anchor: { type: 'song' }, body: 'old' },
      { id: 'n2', song_id: 's1', anchor: { type: 'song' }, body: 'gone' },
    ] as never[];
    const ops: LiveOp[] = [note('n1', 'new'), { kind: 'noteDelete', id: 'n2', songId: 's1' }, note('n3', 'added', true), { ...note('x', 'other song'), songId: 's2' } as LiveOp];
    const out = applyNoteOps(saved, ops, 's1');
    expect(out.map((n: any) => `${n.id}:${n.body}`)).toEqual(['n1:new', 'n3:added']);
  });

  it('counts every change waiting on this phone, rehearsal notes included', () => {
    queueLiveOp(me, note('n1', 'capo 2', true));
    queueLiveOp(me, { kind: 'suggestion', id: 'g1', row: { band_id: 'b', song_id: 's1', kind: 'note', proposed: { note: 'x' } } });
    queueNoteOp(me, { kind: 'delete', id: 'r1' });
    expect(waitingChanges(me)).toBe(3);
    expect(waitingChanges('someone-else')).toBe(0);
  });
});

describe('flushLiveOutbox', () => {
  const api = (over: Partial<LiveOutboxApi> = {}): LiveOutboxApi & { log: string[] } => {
    const log: string[] = [];
    const ok = (tag: string) => async () => {
      log.push(tag);
      return { error: null };
    };
    return {
      log,
      note: over.note ?? (async (op) => (log.push(`note:${op.id}`), { error: null })),
      noteDelete: over.noteDelete ?? ok('noteDelete'),
      suggestion: over.suggestion ?? ok('suggestion'),
      order: over.order ?? ok('order'),
    };
  };

  it('sends everything in order and empties the outbox', async () => {
    queueLiveOp(me, note('n1', 'a', true));
    queueLiveOp(me, note('n2', 'b', true));
    const a = api();
    const r = await flushLiveOutbox(me, a);
    expect(a.log).toEqual(['note:n1', 'note:n2']);
    expect(r).toEqual({ sent: 2, dropped: 0, left: 0 });
    expect(readLiveOutbox(me)).toEqual([]);
  });

  it('still no signal: stops and keeps the rest', async () => {
    queueLiveOp(me, note('n1', 'a', true));
    queueLiveOp(me, note('n2', 'b', true));
    const r = await flushLiveOutbox(me, api({ note: async () => ({ error: { message: 'Failed to fetch' } }) }));
    expect(r.left).toBe(2);
  });

  it('refused by the server (no longer allowed, song gone): dropped, the rest goes', async () => {
    queueLiveOp(me, note('n1', 'a', true));
    queueLiveOp(me, note('n2', 'b', true));
    const a = api({ note: async (op) => (op.id === 'n1' ? { error: { message: 'permission denied', code: '42501' } } : { error: null }) });
    const r = await flushLiveOutbox(me, a);
    expect(r).toEqual({ sent: 1, dropped: 1, left: 0 });
  });
});

// Round 5 (Codex B1 + MINOR): refused changes survive sign-out (only account
// deletion erases them), and are never dropped silently: a full list, or
// storage that can't take the copy, keeps the change in the queue.
describe('the refused list', () => {
  const refusedApi = () => ({
    note: async () => ({ error: { code: '42501', message: 'not allowed' } }),
    noteDelete: async () => ({ error: { code: '42501', message: 'not allowed' } }),
    suggestion: async () => ({ error: null }),
    order: async () => ({ error: null }),
  });
  const n = (id: string) => ({ kind: 'note' as const, id, songId: 's1', anchor: { type: 'song' as const }, body: `note ${id}` });

  it('survives sign-out (the bw: cache wipe)', async () => {
    const { clearOfflineCache } = await import('../offline/storage');
    queueLiveOp('u-1', n('a'));
    await flushLiveOutbox('u-1', refusedApi());
    expect(readRefusedLiveOps('u-1')).toHaveLength(1);
    await clearOfflineCache();
    expect(readRefusedLiveOps('u-1')).toHaveLength(1);
  });

  it('full: the change stays in the queue and the list says it is full', async () => {
    for (let i = 0; i < REFUSED_LIMIT; i++) {
      queueLiveOp('u-1', n(`x${i}`));
    }
    await flushLiveOutbox('u-1', refusedApi());
    expect(readRefusedLiveOps('u-1')).toHaveLength(REFUSED_LIMIT);
    queueLiveOp('u-1', n('one-more'));
    const r = await flushLiveOutbox('u-1', refusedApi());
    expect(r.left).toBe(1);
    expect(readLiveOutbox('u-1')).toEqual([n('one-more')]);
    expect(readRefusedLiveOps('u-1')).toHaveLength(REFUSED_LIMIT);
    expect(refusedListFull('u-1')).toBe(true);
  });

  it("storage can't take the copy: the change stays in the queue", async () => {
    queueLiveOp('u-1', n('a'));
    const real = localStorage.setItem.bind(localStorage);
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation((k: string, v: string) => {
      if (k.includes('live_refused')) throw new Error('QuotaExceededError');
      return real(k, v);
    });
    const r = await flushLiveOutbox('u-1', refusedApi());
    spy.mockRestore();
    expect(r.left).toBe(1);
    expect(readLiveOutbox('u-1')).toEqual([n('a')]);
  });
});

// Round 5 (Claude MINOR 1): only a definite refusal goes to the refused
// list; anything else (a server error, a timeout) stays queued and is tried
// again later, with a growing wait. One tab sends at a time.
describe('definite refusals, retries and one tab at a time', () => {
  const n = (id: string) => ({ kind: 'note' as const, id, songId: 's1', anchor: { type: 'song' as const }, body: `note ${id}` });
  const failing = (error: unknown) => {
    const calls: string[] = [];
    return {
      calls,
      api: {
        note: async (op: { id: string }) => (calls.push(op.id), { error }),
        noteDelete: async () => ({ error }),
        suggestion: async () => ({ error }),
        order: async () => ({ error }),
      } as LiveOutboxApi,
    };
  };

  for (const code of ['42501', 'PGRST116', '22023', '23503', 'BW_SETLIST_CONFLICT', '22001', '22P02', '23514', '23502']) {
    it(`${code} is a definite refusal: kept in the refused list`, async () => {
      queueLiveOp('u-2', n('a'));
      const r = await flushLiveOutbox('u-2', failing({ code, message: 'refused' }).api, { force: true });
      expect(r).toMatchObject({ dropped: 1, left: 0 });
      expect(readRefusedLiveOps('u-2')).toHaveLength(1);
    });
  }

  it('a server error (500) is not a refusal: it stays queued, the list stays empty', async () => {
    queueLiveOp('u-2', n('a'));
    queueLiveOp('u-2', n('b'));
    const r = await flushLiveOutbox('u-2', failing({ code: '500', message: 'Internal Server Error' }).api, { force: true });
    expect(r).toMatchObject({ sent: 0, dropped: 0, left: 2 });
    expect(readRefusedLiveOps('u-2')).toEqual([]);
  });

  it('after a server error the next try waits (backoff); "Send now" (force) goes at once', async () => {
    queueLiveOp('u-3', n('a'));
    const f = failing({ code: '503', message: 'Service Unavailable' });
    await flushLiveOutbox('u-3', f.api);
    expect(f.calls).toEqual(['a']);
    await flushLiveOutbox('u-3', f.api);
    expect(f.calls).toEqual(['a']);
    await flushLiveOutbox('u-3', f.api, { force: true });
    expect(f.calls).toEqual(['a', 'a']);
  });

  it('another tab is sending: this one sends nothing; its lock expired: this one sends', async () => {
    queueLiveOp('u-4', n('a'));
    const ok = { note: async () => ({ error: null }), noteDelete: async () => ({ error: null }), suggestion: async () => ({ error: null }), order: async () => ({ error: null }) };
    localStorage.setItem('bw:live_outbox_flushing:u-4', `other-tab|${Date.now() + 30_000}`);
    // Round 6 (Claude r5 nit): said as "another tab is sending", not "no connection".
    expect(await flushLiveOutbox('u-4', ok, { force: true })).toMatchObject({ sent: 0, left: 1, busy: true });
    localStorage.setItem('bw:live_outbox_flushing:u-4', `other-tab|${Date.now() - 1}`);
    const sent = await flushLiveOutbox('u-4', ok, { force: true });
    expect(sent).toMatchObject({ sent: 1, left: 0 });
    expect(sent.busy).toBeFalsy();
    expect(localStorage.getItem('bw:live_outbox_flushing:u-4')).toBeNull();
  });
});

// Round 6 (Codex B7): a data error (22xxx, 23xxx but 23505) never blocks the
// queue: a 100,001-character suggestion from an older build is refused and
// kept, and the change behind it goes.
describe('data errors', () => {
  it('a suggestion of 100,001 characters refused with 22001: kept apart, the next change is sent', async () => {
    const long = 'la '.repeat(33_334).slice(0, 100_001);
    queueLiveOp('u-5', { kind: 'suggestion', id: 'g-long', row: { band_id: 'b1', song_id: 's1', kind: 'lyrics', proposed: { lyrics: long } } });
    queueLiveOp('u-5', { kind: 'note', id: 'n-next', songId: 's1', anchor: { type: 'song' }, body: 'Count in at 120' });
    const sent: string[] = [];
    const api: LiveOutboxApi = {
      note: async (op) => (sent.push(op.id), { error: null }),
      noteDelete: async () => ({ error: null }),
      suggestion: async (op) => ({ error: (op.row.proposed as { lyrics?: string }).lyrics!.length > 100_000 ? { code: '22001', message: 'lyrics too long' } : null }),
      order: async () => ({ error: null }),
    };
    const r = await flushLiveOutbox('u-5', api, { force: true });
    expect(r).toMatchObject({ sent: 1, dropped: 1, left: 0 });
    expect(sent).toEqual(['n-next']);
    expect(readRefusedLiveOps('u-5').map((o) => (o as { id?: string }).id)).toEqual(['g-long']);
  });

  it('23505 (already there) is not a refusal for the list', async () => {
    queueLiveOp('u-6', { kind: 'note', id: 'n1', songId: 's1', anchor: { type: 'song' }, body: 'x' });
    const api: LiveOutboxApi = {
      note: async () => ({ error: { code: '23505', message: 'duplicate key' } }),
      noteDelete: async () => ({ error: null }), suggestion: async () => ({ error: null }), order: async () => ({ error: null }),
    };
    await flushLiveOutbox('u-6', api, { force: true });
    expect(readRefusedLiveOps('u-6')).toEqual([]);
  });
});


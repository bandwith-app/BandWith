import { describe, it, expect, vi, beforeEach } from 'vitest';

// Round 3 (Codex B1, offline path): A's note written with no signal waits in
// A's outbox. If the flush runs while the session is B's (a sign-in switch
// mid-flush, a flush scheduled before sign-out), nothing is written as B and
// the note stays queued for A. Made-up note (New York).

const net = vi.hoisted(() => ({
  session: 'u-a' as string | null,
  // Switch the session to this user once the first write goes out.
  switchOnWrite: null as string | null,
  writeError: null as unknown,
  // Rows a write returns (RLS can match none without an error).
  writeRows: [{ id: 'n1' }] as unknown[],
  rpcLog: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  rpcResult: { data: { saved: true, song_count: 2, previous: [] }, error: null } as { data: unknown; error: unknown },
  log: [] as Array<{ table: string; op: string; args: unknown[] }>,
}));
vi.mock('../../supabase', () => {
  const q = (table: string) => {
    const b: any = {};
    let writes = false;
    for (const op of ['insert', 'update', 'upsert', 'delete', 'select', 'eq', 'in', 'order', 'single', 'maybeSingle']) {
      b[op] = (...args: unknown[]) => {
        if (['insert', 'update', 'upsert', 'delete'].includes(op)) writes = true;
        net.log.push({ table, op, args });
        return b;
      };
    }
    b.then = (res: (v: unknown) => void) => {
      if (writes && net.switchOnWrite) net.session = net.switchOnWrite;
      res({ data: writes ? net.writeRows : [{ id: 'r1' }, { id: 'r2' }], error: writes ? net.writeError : null });
    };
    return b;
  };
  return {
    isDemoMode: false,
    supabase: {
      from: (t: string) => q(t),
      rpc: async (fn: string, args: Record<string, unknown>) => {
        net.rpcLog.push({ fn, args });
        return net.rpcResult;
      },
      auth: {
        getSession: async () => ({ data: { session: net.session ? { user: { id: net.session } } : null } }),
        getUser: async () => ({ data: { user: net.session ? { id: net.session } : null } }),
      },
    },
  };
});

import { flushLiveOutbox, queueLiveOp, readLiveOutbox, readRefusedLiveOps } from '../../liveOutbox';
import { liveOutboxApi, keepOrderOffline } from '../liveOutboxApi';
import { suggestSongChange } from '../songSuggestions';

const note = { kind: 'note' as const, id: 'n1', songId: 's1', anchor: { type: 'song' as const }, body: 'Watch the drummer before the bridge', isNew: true };
const writes = () => net.log.filter((c) => ['insert', 'update', 'upsert', 'delete'].includes(c.op));

beforeEach(() => {
  localStorage.clear();
  net.session = 'u-a';
  net.switchOnWrite = null;
  net.writeError = null;
  net.writeRows = [{ id: 'n1' }];
  net.rpcLog = [];
  net.rpcResult = { data: { saved: true, song_count: 2, previous: [] }, error: null };
  net.log = [];
});

describe("the outbox is sent only as its own account", () => {
  it("session is B's: A's note is not written, and stays in A's outbox", async () => {
    queueLiveOp('u-a', note);
    net.session = 'u-b';
    const r = await flushLiveOutbox('u-a', liveOutboxApi);
    expect(writes()).toEqual([]);
    expect(readLiveOutbox('u-a')).toEqual([note]);
    expect(r).toMatchObject({ sent: 0, dropped: 0, left: 1 });
  });

  it('a new note names its owner; edits and deletes only match that owner', async () => {
    queueLiveOp('u-a', note);
    queueLiveOp('u-a', { kind: 'note', id: 'n2', songId: 's1', anchor: { type: 'song' }, body: 'capo 2' });
    queueLiveOp('u-a', { kind: 'noteDelete', id: 'n3', songId: 's1' });
    await flushLiveOutbox('u-a', liveOutboxApi);
    const [up, upd, del] = writes();
    expect(up.op).toBe('upsert');
    expect(up.args[0]).toMatchObject({ id: 'n1', user_id: 'u-a' });
    expect(upd.op).toBe('update');
    expect(del.op).toBe('delete');
    const eqs = net.log.filter((c) => c.op === 'eq').map((c) => c.args);
    expect(eqs.filter((a) => a[0] === 'user_id' && a[1] === 'u-a')).toHaveLength(2);
    expect(readLiveOutbox('u-a')).toEqual([]);
  });

  it('switched while the request was out (refused by the database): kept, not dropped', async () => {
    queueLiveOp('u-a', note);
    net.switchOnWrite = 'u-b';
    net.writeError = { code: '42501', message: 'new row violates row-level security policy' };
    const r = await flushLiveOutbox('u-a', liveOutboxApi);
    expect(readLiveOutbox('u-a')).toEqual([note]);
    expect(r).toMatchObject({ dropped: 0, left: 1 });
  });
});

// Round 4 (Codex BLOCKER + Claude MINOR 1-2): a write that matches no row is
// not "sent"; suggestions and the setlist order are written as their owner.
describe('round 4: nothing counts as sent unless the server wrote it', () => {
  const edit = { kind: 'note' as const, id: 'n2', songId: 's1', anchor: { type: 'song' as const }, body: 'capo 2' };

  it('an edit that matched no row (session switched): kept for its owner, not sent', async () => {
    queueLiveOp('u-a', edit);
    net.switchOnWrite = 'u-b';
    net.writeRows = [];
    const r = await flushLiveOutbox('u-a', liveOutboxApi);
    expect(r).toMatchObject({ sent: 0, dropped: 0, left: 1 });
    expect(readLiveOutbox('u-a')).toEqual([edit]);
  });

  // Round 5 (Claude MINOR 1): a delete sent again (the first answer was lost)
  // finds no row with its owner signed in: the note is gone, so it is sent.
  it('a delete that matched no row with the owner signed in: already gone, counts as sent', async () => {
    const del = { kind: 'noteDelete' as const, id: 'n3', songId: 's1' };
    queueLiveOp('u-a', del);
    net.writeRows = [];
    const r = await flushLiveOutbox('u-a', liveOutboxApi);
    expect(r).toMatchObject({ sent: 1, dropped: 0, left: 0 });
    expect(readRefusedLiveOps('u-a')).toEqual([]);
  });

  it('a delete that matched no row because another account is signed in: kept for its owner', async () => {
    const del = { kind: 'noteDelete' as const, id: 'n3', songId: 's1' };
    queueLiveOp('u-a', del);
    net.writeRows = [];
    net.switchOnWrite = 'u-b';
    const r = await flushLiveOutbox('u-a', liveOutboxApi);
    expect(r).toMatchObject({ sent: 0, dropped: 0, left: 1 });
  });

  it('an order whose "conflict" is already the order it wanted (sent before, answer lost): counts as sent', async () => {
    queueLiveOp('u-a', {
      kind: 'order', setlistId: 'sl1',
      rows: [
        { id: 'r2', setlist_id: 'sl1', song_id: 's2', position: 0, set_number: 1 },
        { id: 'r1', setlist_id: 'sl1', song_id: 's1', position: 1, set_number: 1 },
      ],
      before: [{ songId: 's1', setNumber: 1 }, { songId: 's2', setNumber: 1 }],
    });
    net.rpcResult = { data: { saved: false, conflict: true, current: { name: 'Gig', songs: [{ song_id: 's2', set_number: 1 }, { song_id: 's1', set_number: 1 }] } }, error: null };
    const r = await flushLiveOutbox('u-a', liveOutboxApi);
    expect(r).toMatchObject({ sent: 1, dropped: 0, left: 0 });
    expect(readRefusedLiveOps('u-a')).toEqual([]);
  });

  it("a suggestion names its owner (created_by), so another account's session is refused", async () => {
    queueLiveOp('u-a', { kind: 'suggestion', id: 'g1', row: { band_id: 'b1', song_id: 's1', kind: 'note', proposed: { note: 'Slower intro' } } });
    await flushLiveOutbox('u-a', liveOutboxApi);
    const ins = writes().find((c) => c.table === 'song_suggestions')!;
    expect(ins.args[0]).toMatchObject({ id: 'g1', created_by: 'u-a' });
  });

  it('the setlist order goes through the one save (188), checked against the order it was made on', async () => {
    queueLiveOp('u-a', {
      kind: 'order', setlistId: 'sl1',
      rows: [
        { id: 'r2', setlist_id: 'sl1', song_id: 's2', position: 0, set_number: 1 },
        { id: 'r1', setlist_id: 'sl1', song_id: 's1', position: 1, set_number: 1 },
      ],
      before: [{ songId: 's1', setNumber: 1 }, { songId: 's2', setNumber: 1 }],
    });
    const r = await flushLiveOutbox('u-a', liveOutboxApi);
    expect(r).toMatchObject({ sent: 1, left: 0 });
    expect(net.rpcLog[0]?.fn).toBe('bw_save_setlist_songs');
    expect(net.rpcLog[0].args).toMatchObject({
      p_setlist_id: 'sl1',
      p_songs: [{ song_id: 's2', set_number: 1 }, { song_id: 's1', set_number: 1 }],
      p_expected: { songs: [{ song_id: 's1', set_number: 1 }, { song_id: 's2', set_number: 1 }] },
    });
    expect(writes().filter((c) => c.table === 'setlist_songs')).toEqual([]);
  });

  // Round 5 (Codex B4): the same song twice with different singers, swapped
  // in Stage: each entry names its row, so the rows (and voices) move.
  it('the order keeps every row id (the same song twice is never matched by song)', async () => {
    queueLiveOp('u-a', {
      kind: 'order', setlistId: 'sl1',
      rows: [
        { id: 'r2', setlist_id: 'sl1', song_id: 's1', position: 0, set_number: 1 },
        { id: 'r1', setlist_id: 'sl1', song_id: 's1', position: 1, set_number: 1 },
      ],
      before: [{ songId: 's1', setNumber: 1 }, { songId: 's1', setNumber: 1 }],
    });
    await flushLiveOutbox('u-a', liveOutboxApi);
    expect(net.rpcLog[0].args.p_songs).toEqual([
      { id: 'r2', song_id: 's1', set_number: 1 },
      { id: 'r1', song_id: 's1', set_number: 1 },
    ]);
  });

  it('someone changed the setlist meanwhile: the order is refused, nothing written', async () => {
    queueLiveOp('u-a', {
      kind: 'order', setlistId: 'sl1',
      rows: [{ id: 'r1', setlist_id: 'sl1', song_id: 's1', position: 0, set_number: 1 }],
      before: [{ songId: 's1', setNumber: 1 }],
    });
    net.rpcResult = { data: { saved: false, conflict: true, current: { songs: [] } }, error: null };
    const r = await flushLiveOutbox('u-a', liveOutboxApi);
    expect(r).toMatchObject({ sent: 0, dropped: 1 });
  });

  it("queued under the account that made the change: a tab switched meanwhile never fills another account's outbox", async () => {
    const offline = new TypeError('Failed to fetch');
    net.writeError = offline;
    net.switchOnWrite = 'u-b';
    const res = await suggestSongChange({ bandId: 'b1', songId: 's1', kind: 'note', note: 'Slower intro' });
    expect(res.queued).toBeUndefined();
    expect(readLiveOutbox('u-b')).toEqual([]);
    expect(readLiveOutbox('u-a')).toEqual([]);
    net.session = 'u-a';
    net.switchOnWrite = null;
    const kept = await keepOrderOffline(offline, { setlistId: 'sl1', rows: [], before: [] }, 'u-b');
    expect(kept).toBe(false);
    expect(readLiveOutbox('u-a')).toEqual([]);
  });

  // Round 6 (Codex B7): the server's limits checked here first, with a message.
  it('lyrics over 100,000 characters: said at once, nothing sent or queued', async () => {
    net.writeError = new TypeError('Failed to fetch');
    const res = await suggestSongChange({ bandId: 'b1', songId: 's1', kind: 'lyrics', lyrics: 'x'.repeat(100_001) });
    expect(res.error?.message).toMatch(/too long/i);
    expect(writes()).toEqual([]);
    expect(readLiveOutbox('u-a')).toEqual([]);
  });

  it('a note suggestion over 2,000 characters: said at once', async () => {
    const res = await suggestSongChange({ bandId: 'b1', songId: 's1', kind: 'note', note: 'y'.repeat(2001) });
    expect(res.error?.message).toMatch(/too long/i);
    expect(writes()).toEqual([]);
  });
});


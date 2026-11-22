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
      res({ data: [{ id: 'n1' }], error: writes ? net.writeError : null });
    };
    return b;
  };
  return {
    isDemoMode: false,
    supabase: {
      from: (t: string) => q(t),
      rpc: async () => ({ data: null, error: null }),
      auth: {
        getSession: async () => ({ data: { session: net.session ? { user: { id: net.session } } : null } }),
        getUser: async () => ({ data: { user: net.session ? { id: net.session } : null } }),
      },
    },
  };
});

import { flushLiveOutbox, queueLiveOp, readLiveOutbox } from '../../liveOutbox';
import { liveOutboxApi } from '../liveOutboxApi';

const note = { kind: 'note' as const, id: 'n1', songId: 's1', anchor: { type: 'song' as const }, body: 'Watch the drummer before the bridge', isNew: true };
const writes = () => net.log.filter((c) => ['insert', 'update', 'upsert', 'delete'].includes(c.op));

beforeEach(() => {
  localStorage.clear();
  net.session = 'u-a';
  net.switchOnWrite = null;
  net.writeError = null;
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

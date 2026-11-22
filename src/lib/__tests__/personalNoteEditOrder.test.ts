import { describe, it, expect, vi, beforeEach } from 'vitest';

/** The server: records every write; answers OK (back online). */
const writes: string[] = [];
const chain = (op: string): Record<string, unknown> => {
  const c: Record<string, unknown> = {};
  c.update = (v: { body?: string }) => chain(`update:${v.body ?? ''}`);
  c.insert = (v: { body?: string }) => chain(`insert:${v.body ?? ''}`);
  c.delete = () => chain('delete');
  c.eq = (_k: string, id: string) => chain(`${op}@${id}`);
  c.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
    writes.push(op);
    return Promise.resolve({ data: null, error: null, status: 200 }).then(ok, ko);
  };
  return c;
};
vi.mock('@/lib/supabase', () => ({ supabase: { from: () => chain(''), auth: { getUser: async () => ({ data: { user: { id: 'me' } } }) } } }));
vi.mock('@/lib/sessionUser', () => ({ sessionUserId: async () => 'me', newLocalId: () => 'local-1' }));
vi.mock('@/lib/livePackStore', () => ({ personalFromPacks: async () => null }));

import { deletePersonalNote, savePersonalNote } from '../services/personalLayer';
import { flushLiveOutbox, queueLiveOp, readLiveOutbox, type LiveOutboxApi } from '../liveOutbox';

const anchor = { type: 'song' } as const;

/** What the outbox sends once back online: records the body it writes. */
const sent: string[] = [];
const api: LiveOutboxApi = {
  note: async (op) => (sent.push(`note:${op.body}`), { error: null }),
  noteDelete: async (op) => (sent.push(`delete:${op.id}`), { error: null }),
  suggestion: async () => ({ error: null }),
  order: async () => ({ error: null }),
};

describe('an edit kept on this phone never overwrites a newer one', () => {
  beforeEach(() => {
    localStorage.clear();
    writes.length = 0;
    sent.length = 0;
  });

  it('offline edit kept after a 503, then a new edit online: the newer text stays', async () => {
    // Offline: the edit of an existing note waits on this phone (a 503 kept it there).
    queueLiveOp('me', { kind: 'note', id: 'n1', songId: 's', anchor, body: 'old words' });
    // Back online, the same note edited again.
    const res = await savePersonalNote('s', anchor, 'new words', 'n1');
    expect(res.error).toBeNull();
    // The automatic retry runs.
    await flushLiveOutbox('me', api);
    // Whatever reached the server last for n1 is the newer text.
    const last = [...writes.filter((w) => w.endsWith('@n1')).map((w) => `note:${w.split(':')[1].split('@')[0]}`), ...sent].pop();
    expect(last).toBe('note:new words');
    expect(sent).not.toContain('note:old words');
    expect(readLiveOutbox('me')).toEqual([]);
  });

  it('an edit waiting on this phone, then the note deleted online: the old edit is not sent after the delete', async () => {
    queueLiveOp('me', { kind: 'note', id: 'n1', songId: 's', anchor, body: 'old words' });
    await deletePersonalNote('s', 'n1');
    await flushLiveOutbox('me', api);
    expect(sent).not.toContain('note:old words');
  });
});

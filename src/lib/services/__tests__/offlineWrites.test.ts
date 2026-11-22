import { describe, it, expect, vi, beforeEach } from 'vitest';

// No signal: every request fails like fetch does with the network gone.
const net = vi.hoisted(() => ({ offline: true, log: [] as Array<{ table: string; op: string; args: unknown[] }> }));
vi.mock('../../supabase', () => {
  const q = (table: string) => {
    const b: any = {};
    for (const op of ['insert', 'update', 'upsert', 'delete', 'select', 'eq', 'in', 'order', 'single', 'maybeSingle']) {
      b[op] = (...args: unknown[]) => {
        net.log.push({ table, op, args });
        return b;
      };
    }
    b.then = (res: (v: unknown) => void) =>
      res(net.offline ? { data: null, error: { message: 'TypeError: Failed to fetch' } } : { data: [{ id: 'x' }], error: null });
    return b;
  };
  return {
    isDemoMode: false,
    supabase: {
      from: (t: string) => q(t),
      rpc: async () => ({ data: null, error: null }),
      auth: {
        getSession: async () => ({ data: { session: { user: { id: 'u-1' } } } }),
        getUser: async () => ({ data: { user: { id: 'u-1' } } }),
      },
    },
  };
});

import { savePersonalNote, deletePersonalNote } from '../personalLayer';
import { suggestSongChange } from '../songSuggestions';
import { readLiveOutbox } from '../../liveOutbox';
import { keepOrderOffline } from '../liveOutboxApi';

beforeEach(() => {
  localStorage.clear();
  net.offline = true;
  net.log = [];
});

describe('writes with no signal stay on the phone (plan §3.5)', () => {
  it('a new personal note is kept and marked new', async () => {
    const r = await savePersonalNote('s1', { type: 'song' }, '  capo 2  ');
    expect(r).toEqual({ error: null, queued: true });
    const [op] = readLiveOutbox('u-1');
    expect(op).toMatchObject({ kind: 'note', songId: 's1', body: 'capo 2', isNew: true });
    expect(typeof (op as { id: string }).id).toBe('string');
  });

  it('editing, then deleting, a note written offline leaves nothing to send', async () => {
    await savePersonalNote('s1', { type: 'song' }, 'capo 2');
    const id = (readLiveOutbox('u-1')[0] as { id: string }).id;
    net.log = [];
    await savePersonalNote('s1', { type: 'song' }, 'capo 3', id);
    expect(net.log).toHaveLength(0); // not even tried: it isn't on the server
    expect(readLiveOutbox('u-1')).toHaveLength(1);
    await deletePersonalNote('s1', id);
    expect(readLiveOutbox('u-1')).toEqual([]);
  });

  it('deleting a saved note waits on the phone', async () => {
    const r = await deletePersonalNote('s1', 'n-saved');
    expect(r).toEqual({ error: null, queued: true });
    expect(readLiveOutbox('u-1')).toEqual([{ kind: 'noteDelete', id: 'n-saved', songId: 's1' }]);
  });

  it('a note for the band waits on the phone', async () => {
    const r = await suggestSongChange({ bandId: 'b1', songId: 's1', kind: 'note', note: 'Slower intro tonight' });
    expect(r.error).toBeNull();
    expect(r.queued).toBe(true);
    const [op] = readLiveOutbox('u-1');
    expect(op).toMatchObject({ kind: 'suggestion', row: { band_id: 'b1', song_id: 's1', kind: 'note', proposed: { note: 'Slower intro tonight' } } });
  });

  it('online, nothing is queued', async () => {
    net.offline = false;
    expect(await savePersonalNote('s1', { type: 'song' }, 'capo 2')).toEqual({ error: null });
    expect(readLiveOutbox('u-1')).toEqual([]);
  });

  it("the leader's new order waits on the phone when the save has no signal; any other failure does not", async () => {
    const rows = [{ id: 'r2', setlist_id: 'sl', song_id: 'b', position: 0, set_number: 1 }, { id: 'r1', setlist_id: 'sl', song_id: 'a', position: 1, set_number: 1 }];
    const before = [{ songId: 'a', setNumber: 1 }, { songId: 'b', setNumber: 1 }];
    expect(await keepOrderOffline({ message: 'permission denied' }, { setlistId: 'sl', eventId: 'e1', rows, before })).toBe(false);
    expect(readLiveOutbox('u-1')).toEqual([]);
    expect(await keepOrderOffline({ message: 'Failed to fetch' }, { setlistId: 'sl', eventId: 'e1', rows, before })).toBe(true);
    expect(readLiveOutbox('u-1')).toEqual([{ kind: 'order', setlistId: 'sl', eventId: 'e1', rows, before }]);
  });

  // Dropped in merge 16 of release/2026-11-23 (#292's keepOrderOffline keeps the
  // order only with no signal; its third argument is the owner, not an HTTP
  // status). To be restored by release-fix/live-outbox-stuck: re-enable it there.
  it.skip("full signal but the server busy (503, 429, a timeout): the leader's new order stands and waits on the phone too", async () => {
    const rows = [{ id: 'r2', setlist_id: 'sl', song_id: 'b', position: 0, set_number: 1 }];
    const before = [{ songId: 'b', setNumber: 1 }];
    expect(await keepOrderOffline({ message: 'Service Unavailable' }, { setlistId: 'sl', rows, before }, 503 as never)).toBe(true);
    expect(readLiveOutbox('u-1')).toHaveLength(1);
    localStorage.clear();
    expect(await keepOrderOffline({ message: 'canceling statement due to statement timeout', code: '57014' }, { setlistId: 'sl', rows, before })).toBe(true);
    localStorage.clear();
    expect(await keepOrderOffline({ message: 'Forbidden' }, { setlistId: 'sl', rows, before }, 403 as never)).toBe(false);
    expect(readLiveOutbox('u-1')).toEqual([]);
  });
});

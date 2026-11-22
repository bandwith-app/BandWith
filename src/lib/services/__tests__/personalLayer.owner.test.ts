import { describe, it, expect, vi, beforeEach } from 'vitest';

// Round 3 (Codex B1): a private note belongs to the account that tapped Save.
// If another bandmate signed in on the same browser before the request got
// its session, nothing is written (the database would give them the note).
// Made-up song and note (New York).

const net = vi.hoisted(() => ({ session: 'u-a' as string | null, rows: [{ id: 'n1' }] as unknown[], log: [] as Array<{ table: string; op: string; args: unknown[] }> }));
vi.mock('../../supabase', () => {
  const q = (table: string) => {
    const b: any = {};
    for (const op of ['insert', 'update', 'upsert', 'delete', 'select', 'eq', 'in', 'order', 'single', 'maybeSingle']) {
      b[op] = (...args: unknown[]) => {
        net.log.push({ table, op, args });
        return b;
      };
    }
    b.then = (res: (v: unknown) => void) => res({ data: net.rows, error: null });
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

import { savePersonalNote } from '../personalLayer';
import { readLiveOutbox } from '../../liveOutbox';

beforeEach(() => {
  localStorage.clear();
  net.session = 'u-a';
  net.rows = [{ id: 'n1' }];
  net.log = [];
});

describe('My notes: written only for the account that tapped Save', () => {
  it('another account signed in before the request: nothing is written or queued', async () => {
    net.session = 'u-b';
    const r = await savePersonalNote('s1', { type: 'song' }, 'My cue: watch the drummer', undefined, 'u-a');
    expect(r.error).toBeTruthy();
    expect(net.log.filter((c) => ['insert', 'update', 'upsert'].includes(c.op))).toEqual([]);
    expect(readLiveOutbox('u-a')).toEqual([]);
    expect(readLiveOutbox('u-b')).toEqual([]);
  });

  it('a new note names its owner, so the database refuses any other session (user_id = auth.uid())', async () => {
    const r = await savePersonalNote('s1', { type: 'song' }, 'My cue: watch the drummer', undefined, 'u-a');
    expect(r).toEqual({ error: null });
    const insert = net.log.find((c) => c.op === 'insert');
    expect(insert?.args[0]).toMatchObject({ user_id: 'u-a', song_id: 's1', body: 'My cue: watch the drummer' });
  });

  it('an edit only matches a note of that owner', async () => {
    await savePersonalNote('s1', { type: 'song' }, 'capo 3', 'n1', 'u-a');
    expect(net.log.filter((c) => c.op === 'eq').map((c) => c.args)).toContainEqual(['user_id', 'u-a']);
  });

  // Round 5 (Claude MINOR 8): an online edit that matched no note (deleted
  // on another device) saved nothing: it says so, never "saved".
  it('an online edit that matches no note is an error, not saved', async () => {
    net.rows = [];
    const r = await savePersonalNote('s1', { type: 'song' }, 'capo 3', 'n1', 'u-a');
    expect(net.log.some((c) => c.op === 'select' && c.args[0] === 'id')).toBe(true);
    expect(r.error).toBeTruthy();
    expect(String((r.error as Error).message)).toMatch(/note was deleted/i);
    expect(readLiveOutbox('u-a')).toEqual([]);
  });
});

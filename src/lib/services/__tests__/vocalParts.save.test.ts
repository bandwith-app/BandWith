import { describe, it, expect, vi, beforeEach } from 'vitest';

// Round 3 (Codex B2): saving who sings what for a gig reported success even
// when no row was written (the row was gone: another admin's save replaced
// it, or it was taken out of the setlist). Now that is an error the sheet shows.

const db = vi.hoisted(() => ({ rows: [] as unknown[], log: [] as Array<{ op: string; args: unknown[] }> }));
vi.mock('../../supabase', () => {
  const q = () => {
    const b: any = {};
    for (const op of ['update', 'select', 'eq', 'in']) {
      b[op] = (...args: unknown[]) => {
        db.log.push({ op, args });
        return b;
      };
    }
    b.then = (res: (v: unknown) => void) => res({ data: db.rows, error: null });
    return b;
  };
  return { supabase: { from: () => q() } };
});

import { saveSetlistVocalParts, saveSongVocalParts } from '../vocalParts';

beforeEach(() => {
  db.rows = [];
  db.log = [];
});

describe('who sings what: a save that wrote nothing is not a success', () => {
  it('gig: no row updated → error', async () => {
    const { error } = await saveSetlistVocalParts('row-1', { lead: ['u-ana'] });
    expect(error).toBeTruthy();
  });

  it('song: no row updated → error', async () => {
    const { error } = await saveSongVocalParts('song-1', { lead: ['u-ana'] });
    expect(error).toBeTruthy();
  });

  it('a row updated → saved', async () => {
    db.rows = [{ id: 'row-1' }];
    expect((await saveSetlistVocalParts('row-1', null)).error).toBeNull();
    expect((await saveSongVocalParts('song-1', null)).error).toBeNull();
  });
});

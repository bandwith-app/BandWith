import { describe, it, expect } from 'vitest';
import { bandsToClean } from '../../../supabase/functions/_shared/account-deletion';

// Audit 02 #1 / 04 #1: if the "which bands still exist" lookup fails after the
// deletion RPC, the files of bands that go on (song files, branding, quote
// PDFs) must not be deleted.
describe('delete-account: whose band files go', () => {
  const mine = ['band-solo', 'band-shared'];

  it('only bands that are really gone', () => {
    expect(bandsToClean(mine, { data: [{ id: 'band-shared' }], error: null })).toEqual(['band-solo']);
  });

  it('nothing when the lookup failed (data is null)', () => {
    expect(bandsToClean(mine, { data: null, error: { message: 'canceling statement due to statement timeout' } })).toEqual([]);
  });

  it('nothing when the lookup returned no rows object at all', () => {
    expect(bandsToClean(mine, { data: null, error: null })).toEqual([]);
  });
});

import { storageReady } from '../../../supabase/functions/_shared/account-deletion';

// Audit 02 #2 / 04 #4: a personal file left in Storage blocks the Auth
// deletion after the data is gone; stop before deleting anything instead.
describe('delete-account: storage first', () => {
  it('goes on when no personal file is left', () => {
    expect(storageReady({ released: 3, personal_left: 0 }, null)).toBe(true);
  });
  it('stops when a personal file is still there', () => {
    expect(storageReady({ released: 0, personal_left: 1 }, null)).toBe(false);
  });
  it('stops when the check failed or answered nothing', () => {
    expect(storageReady(null, { message: 'boom' })).toBe(false);
    expect(storageReady({}, null)).toBe(false);
  });
});

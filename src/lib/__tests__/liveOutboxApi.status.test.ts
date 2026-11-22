import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Every Supabase call answers like a server that is down for a moment, unless told otherwise. */
const answers: Array<{ data: unknown; error: unknown; status: number }> = [];
const down = { data: null, error: { message: 'Service Unavailable', code: '' }, status: 503 };
const next = () => answers.shift() ?? down;
const chain = (): Record<string, unknown> => {
  const c: Record<string, unknown> = {};
  for (const m of ['upsert', 'update', 'insert', 'delete', 'select', 'eq']) c[m] = () => chain();
  c.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(next()).then(ok, ko);
  return c;
};
vi.mock('@/lib/supabase', () => ({ supabase: { from: () => chain() } }));
vi.mock('@/lib/services/setlistNotify', () => ({ notifySetlistSaved: vi.fn() }));
vi.mock('@/lib/services/personalLayer', () => ({ notifyPersonalChanged: vi.fn() }));
vi.mock('@/lib/services/songSuggestions', () => ({ notifySuggestionsChanged: vi.fn() }));

import { liveOutboxApi } from '../services/liveOutboxApi';

const rows = [{ id: 'r1', setlist_id: 's1', song_id: 'a', position: 0, set_number: 1 }];

// Skipped in merge 16 of release/2026-11-23: #292's live outbox won there, and
// its api answers `{ error }` only (a 503 waits because it is not on the list
// of final refusals, see "#271: a passing server problem keeps the change" in
// liveOutbox.test.ts). The HTTP status was #271's way to tell a passing
// problem from a refusal. Kept for release-fix/live-outbox-stuck, which
// decides whether the status comes back. The calls carry #292's `userId`.
describe.skip('sending the kept changes: the HTTP status reaches the outbox (a 503 is kept, not dropped)', () => {
  beforeEach(() => {
    answers.length = 0;
  });

  it('a note, new or edited', async () => {
    const anchor = { kind: 'song' } as never;
    expect(await liveOutboxApi.note({ kind: 'note', id: 'n1', songId: 'a', anchor, body: 'x', isNew: true }, 'u-1')).toMatchObject({ status: 503 });
    expect(await liveOutboxApi.note({ kind: 'note', id: 'n1', songId: 'a', anchor, body: 'x' }, 'u-1')).toMatchObject({ status: 503 });
  });

  it('a deleted note', async () => {
    expect(await liveOutboxApi.noteDelete({ kind: 'noteDelete', id: 'n1', songId: 'a' }, 'u-1')).toMatchObject({ status: 503 });
  });

  it('a suggestion', async () => {
    expect(await liveOutboxApi.suggestion({ kind: 'suggestion', id: 'g1', row: {} }, 'u-1')).toMatchObject({ status: 503 });
  });

  it('the new order: reading the setlist, then saving it', async () => {
    const op = { kind: 'order' as const, setlistId: 's1', rows, before: [] };
    expect(await liveOutboxApi.order(op, 'u-1')).toMatchObject({ status: 503 });
    answers.push({ data: [{ id: 'r1' }], error: null, status: 200 });
    expect(await liveOutboxApi.order(op, 'u-1')).toMatchObject({ status: 503 });
  });
});

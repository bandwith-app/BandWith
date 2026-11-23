// @vitest-environment jsdom
/**
 * release/2026-11-23 (with #292, #296 and #297 in the tree): a sync pass that
 * started for account A must stop sending once another account is signed in
 * on this device. The next mutation would go out under the new session and
 * be saved as that person's edit. What was not sent stays in A's queue.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ updateEvent: vi.fn() }));

vi.mock('@/lib/services/events', () => ({
  createEvent: vi.fn(),
  updateEvent: mocks.updateEvent,
  deleteEvent: vi.fn(),
  createPersonalGig: vi.fn(),
  updatePersonalGig: vi.fn(),
}));
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }) } },
}));

type Q = typeof import('../syncQueue');
let q: Q;
const A = 'user_a';
const B = 'user_b';
const queueOf = (uid: string): Array<{ payload: { eventId: string } }> | null =>
  JSON.parse(localStorage.getItem(`bw:offline_queue:${uid}`) || 'null');

beforeEach(async () => {
  localStorage.clear();
  vi.resetModules();
  mocks.updateEvent.mockReset();
  q = await import('../syncQueue');
  q.setOfflineQueueUser(A);
  for (const id of ['ev-1', 'ev-2', 'ev-3']) await q.enqueueMutation('update_event', { eventId: id, updates: { title: `A's edit of ${id}` } });
});

describe('a sync pass stops when the account changes', () => {
  it('B signs in while A’s first change is being sent: the other two are not sent and stay in A’s queue', async () => {
    let letFirstLand: () => void = () => {};
    mocks.updateEvent.mockImplementation(
      (id: string) =>
        new Promise((resolve) => {
          if (id === 'ev-1') letFirstLand = () => resolve({ data: {}, error: null });
          else resolve({ data: {}, error: null });
        }),
    );
    const pass = q.processSyncQueue(undefined, { force: true });
    await vi.waitFor(() => expect(mocks.updateEvent).toHaveBeenCalledTimes(1));
    // Another account is signed in on this device while the first request is on its way.
    q.setOfflineQueueUser(B);
    letFirstLand();
    const result = await pass;

    expect(mocks.updateEvent.mock.calls.map((c) => c[0])).toEqual(['ev-1']);
    expect(result.synced).toBe(1);
    expect(result.dropped).toBe(0);
    // A's two other edits wait for A's next sign-in; B's queue has none of them.
    expect(queueOf(A)?.map((m) => m.payload.eventId)).toEqual(['ev-2', 'ev-3']);
    expect(queueOf(B) ?? []).toEqual([]);
  });

  it('A signs out mid-pass (nobody signed in): nothing more is sent either', async () => {
    let letFirstLand: () => void = () => {};
    mocks.updateEvent.mockImplementation(
      (id: string) =>
        new Promise((resolve) => {
          if (id === 'ev-1') letFirstLand = () => resolve({ data: {}, error: null });
          else resolve({ data: {}, error: null });
        }),
    );
    const pass = q.processSyncQueue(undefined, { force: true });
    await vi.waitFor(() => expect(mocks.updateEvent).toHaveBeenCalledTimes(1));
    q.setOfflineQueueUser(null);
    letFirstLand();
    await pass;
    expect(mocks.updateEvent).toHaveBeenCalledTimes(1);
    expect(queueOf(A)?.map((m) => m.payload.eventId)).toEqual(['ev-2', 'ev-3']);
  });

  it('the same account all along: everything is sent, in order', async () => {
    mocks.updateEvent.mockResolvedValue({ data: {}, error: null });
    const result = await q.processSyncQueue(undefined, { force: true });
    expect(mocks.updateEvent.mock.calls.map((c) => c[0])).toEqual(['ev-1', 'ev-2', 'ev-3']);
    expect(result.synced).toBe(3);
    expect(queueOf(A)).toEqual([]);
  });
});

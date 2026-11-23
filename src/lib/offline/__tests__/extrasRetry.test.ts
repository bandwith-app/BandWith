// @vitest-environment jsdom
/**
 * Audit 05 #6: an event saved after reconnecting, whose to-dos / setlist /
 * rider then fail, keeps the failed steps queued and retries only those.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  deleteEvent: vi.fn(),
  replayEventExtras: vi.fn(),
}));

vi.mock('@/lib/services/events', () => ({
  createEvent: mocks.createEvent,
  updateEvent: mocks.updateEvent,
  deleteEvent: mocks.deleteEvent,
  createPersonalGig: vi.fn(),
  updatePersonalGig: vi.fn(),
}));

vi.mock('../eventExtras', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../eventExtras')>()),
  replayEventExtras: mocks.replayEventExtras,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }) } },
}));

type Q = typeof import('../syncQueue');
let q: Q;
const USER = 'user_a';
const stored = () => JSON.parse(localStorage.getItem(`bw:offline_queue:${USER}`) || 'null');
const failures = (names: string[], error: unknown) =>
  Object.defineProperty([...names], 'error', { value: error, enumerable: false });
const rls = Object.assign(new Error('new row violates row-level security'), { code: '42501' });
const offline = new TypeError('Failed to fetch');

const extras = {
  setlist: { bandId: 'b1', name: 'Gig setlist', songs: [{ song_id: 's1', position: 0, set_number: 1 }] },
  tasks: { drafts: [{ title: 'Print setlists' }], originalIds: [], eventDate: '2026-12-01' },
  stage: { bandId: 'b1', payload: { stage: null, createRider: true }, gig: { title: 'Gig' } },
};

const enqueueCreate = () =>
  q.enqueueMutation(
    'create_event',
    { eventData: { id: 'offline_ev_1', _tempId: 'offline_ev_1', band_id: 'b1', title: 'Gig' }, memberIds: [], extras },
    'offline_ev_1'
  );

beforeEach(async () => {
  localStorage.clear();
  vi.resetModules();
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.createEvent.mockImplementation(async (data: any) => ({ data: { id: data.id || 'server-id' }, error: null }));
  mocks.updateEvent.mockResolvedValue({ data: {}, error: null });
  mocks.deleteEvent.mockResolvedValue({ error: null });
  mocks.replayEventExtras.mockResolvedValue([]);
  q = await import('../syncQueue');
  q.setOfflineQueueUser(USER);
});

describe('failed extras stay queued (audit 05 #6)', () => {
  // Merge with #292: a setlist with no room in the refused list
  // (SETLIST_WAITING) stays queued as the extras-only retry and is never
  // dropped, however many passes it waits.
  it('a setlist waiting for room in the refused list is retried, never dropped', async () => {
    await enqueueCreate();
    mocks.replayEventExtras.mockResolvedValue(['setlist-waiting']);
    for (let i = 0; i < 8; i++) await q.processSyncQueue(undefined, { force: true });
    const left = stored();
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ type: 'update_event', retryCount: 0, lastError: 'BW_REFUSED_FULL', payload: { updates: {}, extrasOnly: true, extras: { setlist: extras.setlist } } });
    expect(mocks.createEvent).toHaveBeenCalledTimes(1);
    expect(mocks.updateEvent).not.toHaveBeenCalled();
    mocks.replayEventExtras.mockResolvedValue([]);
    await q.processSyncQueue(undefined, { force: true });
    expect(stored()).toEqual([]);
  });

  it('keeps the to-dos that failed after the event saved, and retries only them', async () => {
    await enqueueCreate();
    mocks.replayEventExtras.mockResolvedValueOnce(failures(['tasks'], offline));
    await q.processSyncQueue();
    const realId = mocks.createEvent.mock.calls[0][0].id;

    const left = stored();
    expect(left).toHaveLength(1);
    expect(left[0].type).toBe('update_event');
    expect(left[0].payload).toEqual({ eventId: realId, updates: {}, extrasOnly: true, extras: { tasks: extras.tasks } });
    // A lost connection does not count towards dropping it.
    expect(left[0].retryCount).toBe(0);

    await q.processSyncQueue();
    expect(mocks.createEvent).toHaveBeenCalledTimes(1);
    expect(mocks.updateEvent).not.toHaveBeenCalled();
    // The queue's account goes with it (#292: a refused setlist is filed under it).
    expect(mocks.replayEventExtras).toHaveBeenLastCalledWith(realId, { tasks: extras.tasks }, USER);
    expect(stored()).toEqual([]);
  });

  it('a rejected step waits for the backoff and counts towards the limit', async () => {
    await enqueueCreate();
    mocks.replayEventExtras.mockResolvedValueOnce(failures(['setlist'], rls));
    await q.processSyncQueue();
    const [left] = stored();
    expect(left.payload.extras).toEqual({ setlist: extras.setlist });
    expect(left.retryCount).toBe(1);
    expect(left.nextRetryAt).toBeGreaterThan(Date.now());
  });

  it('a retry that half works keeps only what still failed (no second rider)', async () => {
    await enqueueCreate();
    mocks.replayEventExtras.mockResolvedValueOnce(failures(['tasks', 'rider'], offline));
    await q.processSyncQueue();
    mocks.replayEventExtras.mockResolvedValueOnce(failures(['tasks'], offline));
    await q.processSyncQueue();
    const [left] = stored();
    expect(left.payload.extras).toEqual({ tasks: extras.tasks });
  });

  it('an edit failing its setlist keeps it queued without sending the event row again', async () => {
    await q.enqueueMutation('update_event', { eventId: 'ev-1', updates: { title: 'New' }, extras: { setlist: extras.setlist } });
    mocks.replayEventExtras.mockResolvedValueOnce(failures(['setlist'], offline));
    await q.processSyncQueue();
    expect(stored()[0].payload).toEqual({ eventId: 'ev-1', updates: {}, extrasOnly: true, extras: { setlist: extras.setlist } });
    await q.processSyncQueue();
    expect(mocks.updateEvent).toHaveBeenCalledTimes(1);
    expect(stored()).toEqual([]);
  });

  it('a later edit of the same event waits behind the failed extras, in order', async () => {
    await q.enqueueMutation('update_event', { eventId: 'ev-1', updates: { title: 'A' }, extras: { setlist: extras.setlist } });
    await q.enqueueMutation('update_event', { eventId: 'ev-1', updates: { title: 'B' }, extras: { setlist: { ...extras.setlist, name: 'Newer' } } });
    await q.enqueueMutation('update_event', { eventId: 'ev-2', updates: { title: 'Other' } });
    mocks.replayEventExtras.mockResolvedValueOnce(failures(['setlist'], rls));
    await q.processSyncQueue();
    // ev-1's second edit did not jump ahead of the setlist still waiting; ev-2 went out.
    expect(mocks.updateEvent.mock.calls.map((c) => c[1].title)).toEqual(['A', 'Other']);
    const left = stored();
    expect(left.map((m: any) => m.payload.updates.title ?? 'extras')).toEqual(['extras', 'B']);
  });
});

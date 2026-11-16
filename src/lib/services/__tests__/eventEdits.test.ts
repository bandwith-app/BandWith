/**
 * Saves made from the overview's card editors: the same writes and the same
 * notices to the lineup as the Edit page, no more, no less.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const existing: { data: unknown; error: unknown } = { data: [], error: null };
const calls: Array<[string, ...unknown[]]> = [];

vi.mock('@/lib/supabase', () => {
  const chain: any = {
    select: (...a: unknown[]) => { calls.push(['select', ...a]); return chain; },
    eq: (...a: unknown[]) => { calls.push(['eq', ...a]); return chain; },
    in: (...a: unknown[]) => { calls.push(['in', ...a]); return chain; },
    delete: () => { calls.push(['delete']); return chain; },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(existing).then(res, rej),
  };
  return { supabase: { from: (table: string) => { calls.push(['from', table]); return chain; } } };
});

const updateEvent = vi.fn(async (..._a: unknown[]) => ({ data: {}, error: null as unknown }));
vi.mock('../events', () => ({ updateEvent: (...a: unknown[]) => updateEvent(...a) }));
const saveEventLineup = vi.fn(async (..._a: unknown[]) => ({ error: null }));
vi.mock('../eventMemberMoney', () => ({ saveEventLineup: (...a: unknown[]) => saveEventLineup(...a) }));
const notifyEventMembersCreated = vi.fn(async (..._a: unknown[]) => undefined);
const notifyEventMembersRemoved = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('../notifications', () => ({
  notifyEventMembersCreated: (...a: unknown[]) => notifyEventMembersCreated(...a),
  notifyEventMembersRemoved: (...a: unknown[]) => notifyEventMembersRemoved(...a),
}));
const syncEventTasks = vi.fn(async (..._a: unknown[]) => ({ error: null as unknown }));
vi.mock('../eventTasks', () => ({ syncEventTasks: (...a: unknown[]) => syncEventTasks(...a) }));
const enqueueMutation = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('@/lib/offline/syncQueue', () => ({ enqueueMutation: (...a: unknown[]) => enqueueMutation(...a) }));

import { saveEventFields, saveLineupEdit, saveTasksEdit, type LineupEditContext } from '../eventEdits';

const ctx: LineupEditContext = {
  eventId: 'e1',
  bandId: 'b1',
  eventType: 'wedding',
  title: 'Wedding',
  date: '2026-12-05',
  time: '20:30',
  venue: 'Villa Rosa',
  actorId: 'admin',
  actorName: 'Ada Admin',
};

const setOnline = (online: boolean) => Object.defineProperty(window.navigator, 'onLine', { value: online, configurable: true });

beforeEach(() => {
  calls.length = 0;
  existing.data = [];
  existing.error = null;
  [updateEvent, saveEventLineup, notifyEventMembersCreated, notifyEventMembersRemoved, syncEventTasks, enqueueMutation].forEach((m) => m.mockClear());
  setOnline(true);
});
afterEach(() => setOnline(true));

describe('saveEventFields', () => {
  it('updates the event row (the database trigger tells the lineup)', async () => {
    const res = await saveEventFields('e1', { event_date: '2026-12-06' }, 'Wedding');
    expect(res).toEqual({ error: null });
    expect(updateEvent).toHaveBeenCalledWith('e1', { event_date: '2026-12-06' });
    expect(notifyEventMembersCreated).not.toHaveBeenCalled();
  });

  it('queues the edit offline, like the Edit page', async () => {
    setOnline(false);
    const res = await saveEventFields('e1', { notes: 'x' }, 'Wedding');
    expect(res).toEqual({ error: null, offline: true });
    expect(updateEvent).not.toHaveBeenCalled();
    expect(enqueueMutation).toHaveBeenCalledWith('update_event', { eventId: 'e1', updates: { notes: 'x', _isPendingSync: true } });
  });
});

describe('saveLineupEdit', () => {
  it('adds and removes as a diff and tells only who the Edit page told', async () => {
    existing.data = [
      { user_id: 'admin', status: 'confirmed', role: 'Guitar' },
      { user_id: 'u-keep', status: 'confirmed', role: 'Bass' },
      { user_id: 'u-gone', status: 'pending', role: 'Drums' },
      { user_id: 'u-declined', status: 'declined', role: 'Keys' },
    ];
    const res = await saveLineupEdit(
      ctx,
      [
        { user_id: 'admin', fee: 300, status: 'confirmed' },
        { user_id: 'u-keep', fee: 350, status: 'pending' },
        { user_id: 'u-new', role: 'Sax', fee: 250, status: 'pending' },
      ],
      { fee: 1100 },
    );
    expect(res.error).toBeNull();
    expect(res.added).toEqual(['u-new']);
    expect(res.removed).toEqual(['u-gone', 'u-declined']);
    // Who stays keeps their RSVP and role.
    expect(saveEventLineup).toHaveBeenCalledWith('e1', [
      { user_id: 'admin', fee: 300, status: 'confirmed', role: 'Guitar' },
      { user_id: 'u-keep', fee: 350, status: 'confirmed', role: 'Bass' },
      { user_id: 'u-new', role: 'Sax', fee: 250, status: 'pending' },
    ]);
    expect(calls).toContainEqual(['in', 'user_id', ['u-gone', 'u-declined']]);
    expect(updateEvent).toHaveBeenCalledWith('e1', { fee: 1100 });
    expect(notifyEventMembersCreated).toHaveBeenCalledTimes(1);
    expect(notifyEventMembersCreated).toHaveBeenCalledWith('b1', 'e1', 'Wedding', '2026-12-05', '20:30', 'wedding', 'admin', 'Ada Admin', ['u-new'], {
      venue: 'Villa Rosa',
      memberFees: { admin: 300, 'u-keep': 350, 'u-new': 250 },
      feeTbd: false,
    });
    // Not who had already declined.
    expect(notifyEventMembersRemoved).toHaveBeenCalledWith('b1', 'e1', 'Wedding', '2026-12-05', 'wedding', 'admin', 'Ada Admin', ['u-gone']);
  });

  it('never notifies the admin who edits, and sends nothing when no one was added or removed', async () => {
    existing.data = [{ user_id: 'u1', status: 'pending', role: 'Bass' }];
    await saveLineupEdit(ctx, [{ user_id: 'u1', fee: 500, status: 'pending' }, { user_id: 'admin', role: 'Guitar', status: 'confirmed' }], null);
    expect(notifyEventMembersCreated).not.toHaveBeenCalled();
    expect(notifyEventMembersRemoved).not.toHaveBeenCalled();
    expect(updateEvent).not.toHaveBeenCalled();

    notifyEventMembersCreated.mockClear();
    existing.data = [{ user_id: 'u1', status: 'pending', role: 'Bass' }];
    await saveLineupEdit(ctx, [{ user_id: 'u1', fee: 600, status: 'pending' }], { fee: 600 });
    expect(notifyEventMembersCreated).not.toHaveBeenCalled();
    expect(notifyEventMembersRemoved).not.toHaveBeenCalled();
  });

  it('can take everyone off (the admin unticked themselves too)', async () => {
    existing.data = [{ user_id: 'admin', status: 'confirmed', role: 'Guitar' }];
    const res = await saveLineupEdit(ctx, [], null);
    expect(res.removed).toEqual(['admin']);
    expect(saveEventLineup).toHaveBeenCalledWith('e1', []);
    expect(notifyEventMembersRemoved).not.toHaveBeenCalled();
  });

  it('stops before notifying when a write fails', async () => {
    existing.data = [];
    saveEventLineup.mockResolvedValueOnce({ error: new Error('denied') } as never);
    const res = await saveLineupEdit(ctx, [{ user_id: 'u-new', role: 'Sax', status: 'pending' }], null);
    expect(res.error?.message).toBe('denied');
    expect(notifyEventMembersCreated).not.toHaveBeenCalled();
  });

  it('queues the lineup offline', async () => {
    setOnline(false);
    const wanted = [{ user_id: 'u1', fee: 100, status: 'pending' }];
    const res = await saveLineupEdit(ctx, wanted, { fee: 100 });
    expect(res.offline).toBe(true);
    expect(enqueueMutation).toHaveBeenCalledWith('update_event', {
      eventId: 'e1',
      updates: { fee: 100, _isPendingSync: true },
      extras: { lineup: wanted },
    });
    expect(notifyEventMembersCreated).not.toHaveBeenCalled();
  });
});

describe('saveTasksEdit', () => {
  it('syncs the to-dos', async () => {
    const drafts = [{ id: 't1', title: 'Print setlists' }, { title: 'Book van' }];
    await saveTasksEdit('e1', drafts, '2026-12-05', ['t1', 't2'], 'Wedding');
    expect(syncEventTasks).toHaveBeenCalledWith('e1', drafts, '2026-12-05', ['t1', 't2']);
  });

  it('queues them offline with the title as the field', async () => {
    setOnline(false);
    await saveTasksEdit('e1', [{ title: 'Book van' }], '2026-12-05', [], 'Wedding');
    expect(enqueueMutation).toHaveBeenCalledWith('update_event', {
      eventId: 'e1',
      updates: { title: 'Wedding', _isPendingSync: true },
      extras: { tasks: { drafts: [{ title: 'Book van' }], originalIds: [], eventDate: '2026-12-05' } },
    });
  });
});

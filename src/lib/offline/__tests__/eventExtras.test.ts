import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  createSetlist: vi.fn(),
  replaceSetlistSongs: vi.fn(),
  updateSetlist: vi.fn(),
  syncEventTasks: vi.fn(),
  saveEventLineup: vi.fn(),
  persistComposerStage: vi.fn(),
  eventSetlistId: null as string | null,
  session: 'u-1' as string | null,
  existingMembers: [] as { user_id: string; status: string }[],
  writes: [] as string[],
}));

const query = (table: string) => {
  let op = 'select';
  const q: any = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') {
        return (res: (v: unknown) => void) => {
          mocks.writes.push(`${table}.${op}`);
          return res({ data: table === 'event_members' && op === 'select' ? mocks.existingMembers : null, error: null });
        };
      }
      if (prop === 'maybeSingle') return async () => ({ data: { setlist_id: mocks.eventSetlistId }, error: null });
      return (..._args: unknown[]) => {
        if (prop === 'update' || prop === 'delete') op = String(prop);
        return q;
      };
    },
  });
  return q;
};

vi.mock('@/lib/supabase', () => ({ supabase: { from: (t: string) => query(t) } }));
vi.mock('@/lib/services/songs', () => ({
  createSetlist: mocks.createSetlist,
  replaceSetlistSongs: mocks.replaceSetlistSongs,
  updateSetlist: mocks.updateSetlist,
}));
vi.mock('@/lib/sessionUser', () => ({ sessionUserId: async () => mocks.session, newLocalId: () => 'id-1' }));
vi.mock('@/lib/services/eventTasks', () => ({ syncEventTasks: mocks.syncEventTasks }));
vi.mock('@/lib/services/eventMemberMoney', () => ({ saveEventLineup: mocks.saveEventLineup }));
vi.mock('@/lib/services/composerStage', () => ({ persistComposerStage: mocks.persistComposerStage }));

import { extrasOf, lineupDiff, mergeExtras, replayEventExtras } from '../eventExtras';
import { readRefusedLiveOps } from '@/lib/liveOutbox';

const setlist = { bandId: 'b1', name: 'Gig setlist', songs: [{ song_id: 's1', position: 0, set_number: 1 }] };

beforeEach(() => {
  Object.values(mocks).forEach((m) => typeof m === 'function' && (m as any).mockReset());
  mocks.createSetlist.mockResolvedValue({ data: { id: 'sl1' }, error: null });
  mocks.replaceSetlistSongs.mockResolvedValue({ error: null });
  mocks.updateSetlist.mockResolvedValue({ data: {}, error: null });
  mocks.syncEventTasks.mockResolvedValue({ error: null });
  mocks.saveEventLineup.mockResolvedValue({ error: null });
  mocks.persistComposerStage.mockResolvedValue(null);
  mocks.eventSetlistId = null;
  mocks.session = 'u-1';
  localStorage.clear();
  mocks.existingMembers = [];
  mocks.writes.length = 0;
});

describe('offline event extras', () => {
  it('keeps everyone’s RSVP, removes who was taken out, adds the new ones', () => {
    const { removed, rows } = lineupDiff(
      [{ user_id: 'a', status: 'confirmed' }, { user_id: 'b', status: 'declined' }],
      [{ user_id: 'a', status: 'pending' }, { user_id: 'c', status: 'pending' }],
    );
    expect(removed).toEqual(['b']);
    expect(rows).toEqual([{ user_id: 'a', status: 'confirmed' }, { user_id: 'c', status: 'pending' }]);
  });

  it('creates the setlist and links it when the event has none', async () => {
    const failed = await replayEventExtras('e1', { setlist });
    expect(failed).toEqual([]);
    expect(mocks.createSetlist).toHaveBeenCalledWith({ band_id: 'b1', name: 'Gig setlist', song_count: 1 }, setlist.songs);
    expect(mocks.writes).toContain('events.update');
  });

  it("replaces the songs of the event's own setlist when it has one", async () => {
    mocks.eventSetlistId = 'sl-old';
    await replayEventExtras('e1', { setlist });
    expect(mocks.createSetlist).not.toHaveBeenCalled();
    // Songs in one call (188); the gig's existing setlist keeps its own name.
    expect(mocks.replaceSetlistSongs).toHaveBeenCalledWith('sl-old', [{ song_id: 's1', set_number: 1 }], undefined);
    expect(mocks.updateSetlist).not.toHaveBeenCalled();
  });

  // Audit review (Claude MINOR 9): the wizard's save carries the setlist as it
  // loaded, so it never overwrites someone else's newer setlist.
  it('an edit carries the setlist as the wizard loaded it, and never renames it', async () => {
    mocks.eventSetlistId = 'sl-old';
    const loaded = { id: 'sl-old', songs: [{ song_id: 's9', set_number: 1 }, { song_id: 's9', set_number: 2 }] };
    await replayEventExtras('e1', { setlist: { ...setlist, loaded } });
    expect(mocks.replaceSetlistSongs).toHaveBeenCalledWith('sl-old', [{ song_id: 's1', set_number: 1 }], { expected: { songs: loaded.songs } });
  });

  it('a setlist someone else changed meanwhile is not overwritten (reported as not saved)', async () => {
    mocks.eventSetlistId = 'sl-old';
    mocks.replaceSetlistSongs.mockResolvedValue({ error: null, conflict: { name: 'Other', songs: [] } });
    const loaded = { id: 'sl-old', songs: [{ song_id: 's9', set_number: 1 }] };
    const failed = await replayEventExtras('e1', { setlist: { ...setlist, loaded } });
    expect(failed).toContain('setlist');
  });

  // Round 6 (Codex B3): the gig now points at another setlist (B) than the
  // one the edit loaded (A): A's songs are never written over B.
  it('the gig now links another setlist: nothing written, a conflict', async () => {
    mocks.eventSetlistId = 'sl-new';
    const failed = await replayEventExtras('e1', { setlist: { ...setlist, loaded: { id: 'sl-old', songs: [] } } });
    expect(mocks.replaceSetlistSongs).not.toHaveBeenCalled();
    expect(failed).toContain('setlist');
  });

  // Round 6 (Codex B4): an offline edit that meets a conflict is never thrown
  // away: kept in the refused list with its reason, and the app is told.
  it('a conflict on an offline edit: kept in the refused list with its songs and reason', async () => {
    mocks.eventSetlistId = 'sl-old';
    mocks.session = 'u-1';
    mocks.replaceSetlistSongs.mockResolvedValue({ error: null, conflict: { name: 'Other', songs: [] } });
    const told: unknown[] = [];
    const listen = (e: Event) => told.push((e as CustomEvent).detail);
    window.addEventListener('bw:live-refused', listen);
    await replayEventExtras('e1', { setlist: { ...setlist, loaded: { id: 'sl-old', songs: [{ song_id: 's9', set_number: 1 }] } } });
    window.removeEventListener('bw:live-refused', listen);
    const kept = readRefusedLiveOps('u-1');
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ kind: 'gigSetlist', eventId: 'e1', setlistId: 'sl-old', songs: [{ song_id: 's1', set_number: 1 }], reason: 'changed' });
    expect(told).toContainEqual(expect.objectContaining({ userId: 'u-1', kind: 'gigSetlist' }));
  });

  // Round 7 (Codex r6 B4): the refused list is full: the setlist is never
  // dropped. The answer says it waits (the queue keeps it) and the app is told.
  it('a conflict with the refused list full: nothing dropped, it waits, the app is told', async () => {
    mocks.eventSetlistId = 'sl-old';
    mocks.replaceSetlistSongs.mockResolvedValue({ error: null, conflict: { name: 'Other', songs: [] } });
    const { keepRefused, REFUSED_LIMIT } = await import('@/lib/liveOutbox');
    for (let i = 0; i < REFUSED_LIMIT; i++) keepRefused('u-1', { kind: 'gigSetlist', eventId: `e${i}`, setlistId: 's', songs: [], reason: 'changed' });
    const told: unknown[] = [];
    const listen = (e: Event) => told.push((e as CustomEvent).detail);
    window.addEventListener('bw:live-refused', listen);
    const failed = await replayEventExtras('e1', { setlist: { ...setlist, loaded: { id: 'sl-old', songs: [] } } }, 'u-1');
    window.removeEventListener('bw:live-refused', listen);
    expect(failed).toContain('setlist-waiting');
    expect(readRefusedLiveOps('u-1')).toHaveLength(REFUSED_LIMIT);
    expect(told).toContainEqual(expect.objectContaining({ userId: 'u-1', kind: 'gigSetlist', full: true }));
  });

  // Round 7 (Codex r6 B5): filed under the account that made the change (the
  // queue's owner), never under whoever is signed in now.
  it('a refused setlist goes to the queue owner’s list, not the account signed in now', async () => {
    mocks.eventSetlistId = 'sl-old';
    mocks.session = 'u-2';
    mocks.replaceSetlistSongs.mockResolvedValue({ error: null, conflict: { name: 'Other', songs: [] } });
    await replayEventExtras('e1', { setlist: { ...setlist, loaded: { id: 'sl-old', songs: [] } } }, 'u-1');
    expect(readRefusedLiveOps('u-1')).toHaveLength(1);
    expect(readRefusedLiveOps('u-2')).toHaveLength(0);
  });

  // Round 7 (Codex r6 B3): the gig had no setlist when the wizard opened, and
  // has one now (someone else's): a conflict, nothing written over it.
  it('no setlist when opened, one now: nothing written, a conflict', async () => {
    mocks.eventSetlistId = 'sl-theirs';
    const failed = await replayEventExtras('e1', { setlist: { ...setlist, loaded: { id: null, songs: [] } } }, 'u-1');
    expect(mocks.replaceSetlistSongs).not.toHaveBeenCalled();
    expect(failed).toContain('setlist');
    expect(readRefusedLiveOps('u-1')[0]).toMatchObject({ kind: 'gigSetlist', eventId: 'e1', setlistId: 'sl-theirs' });
  });

  it('saves to-dos, the lineup and the stage, and reports what failed', async () => {
    mocks.existingMembers = [{ user_id: 'gone', status: 'confirmed' }];
    mocks.syncEventTasks.mockResolvedValue({ error: new Error('rls') });
    const failed = await replayEventExtras('e1', {
      tasks: { drafts: [{ title: 'Bring cables' }], originalIds: [], eventDate: '2026-12-01' },
      lineup: [{ user_id: 'u1', status: 'pending' }],
      stage: { bandId: 'b1', payload: { stage: null, createRider: true }, gig: { title: 'Gig' } },
    });
    expect(mocks.writes).toContain('event_members.delete');
    expect(mocks.saveEventLineup).toHaveBeenCalledWith('e1', [{ user_id: 'u1', status: 'pending' }]);
    expect(mocks.syncEventTasks).toHaveBeenCalledWith('e1', [{ title: 'Bring cables' }], '2026-12-01', []);
    expect(mocks.persistComposerStage).toHaveBeenCalled();
    expect(failed).toEqual(['tasks']);
  });

  it('reads extras from a payload and merges an edit into a pending create', () => {
    expect(extrasOf({})).toBeNull();
    expect(extrasOf({ extras: {} })).toBeNull();
    expect(mergeExtras({ setlist }, { lineup: [{ user_id: 'u1' }], tasks: { drafts: [], originalIds: ['t1'], eventDate: null } })).toEqual({
      setlist,
      tasks: { drafts: [], originalIds: ['t1'], eventDate: null },
    });
  });
});

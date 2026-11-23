import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useRef } from 'react';

// Round 10 (Claude r9): the leader moves a song while a song added on stage
// is still being saved. The add then showed the setlist without that move,
// and the move's own save, checked against the setlist before the add, was
// refused and sent the old order to everyone while the new song played. Now
// the move is kept: the new song goes in after the current one, and the
// move is saved against the setlist with the new song. Made-up setlist
// (Brooklyn gig).

type Row = { id: string; setlist_id: string; song_id: string; position: number; set_number: number };
// `hold`: the next save waits before it writes; `answerLate`: it writes at
// once but its answer waits (a slow connection back from the server).
const db = vi.hoisted(() => ({ rows: [] as Row[], n: 0, hold: null as null | Promise<void>, answerLate: null as null | Promise<void>, fail: null as null | 'error' | 'throw', rpcs: [] as unknown[] }));
const ble = vi.hoisted(() => ({ publish: vi.fn() }));
vi.mock('@/lib/supabase', () => {
  const order = (rows: Row[]) => [...rows].sort((a, b) => a.set_number - b.set_number || a.position - b.position);
  const out = () => order(db.rows).map(({ id, song_id, set_number, position }) => ({ id, song_id, set_number, position }));
  return {
    supabase: {
      from: () => {
        const b: any = { upsert: () => b, select: () => b, eq: () => b, then: (res: any, rej: any) => Promise.resolve({ data: [], error: null }).then(res, rej) };
        return b;
      },
      // bw_save_setlist_songs (188): written only while the setlist is still `p_expected`.
      rpc: vi.fn(async (_fn: string, args: { p_setlist_id: string; p_songs: { id?: string; song_id: string; set_number: number }[]; p_expected?: { songs: { id?: string; song_id: string; set_number: number }[] } }) => {
        db.rpcs.push(args);
        const hold = db.hold;
        db.hold = null;
        if (hold) await hold;
        const fail = db.fail;
        db.fail = null;
        if (fail === 'throw') throw new Error('Failed to fetch');
        if (fail === 'error') return { data: null, error: { message: 'boom', code: 'XX000' } };
        const now = order(db.rows).map((r) => ({ id: r.id, song_id: r.song_id, set_number: r.set_number }));
        const want = args.p_expected?.songs;
        if (want && (want.length !== now.length || want.some((w, i) => w.song_id !== now[i].song_id || w.set_number !== now[i].set_number || (!!w.id && w.id !== now[i].id)))) {
          return { data: { saved: false, conflict: true, current: { name: 'Brooklyn', songs: now } }, error: null };
        }
        db.rows = args.p_songs.map((s, i) => ({ id: s.id ?? `new-${++db.n}`, setlist_id: args.p_setlist_id, song_id: s.song_id, position: i + 1, set_number: s.set_number }));
        const rows = out();
        const late = db.answerLate;
        db.answerLate = null;
        if (late) await late;
        return { data: { saved: true, previous: [], rows }, error: null };
      }),
      channel: vi.fn(),
      removeChannel: vi.fn(),
    },
    getSafeUser: async () => ({ data: { user: { id: 'u-admin' } } }),
  };
});
vi.mock('@/lib/sessionUser', () => ({ sessionUserId: async () => 'u-admin' }));
vi.mock('@/lib/services/setlistNotify', () => ({ notifySetlistSaved: vi.fn() }));
vi.mock('../useStageBle', () => ({ useStageBle: () => ({ publish: ble.publish, burst: vi.fn(), status: 'off', followers: 0, fix: vi.fn() }) }));
vi.mock('@/lib/regiaAudio', async () => ({
  audioFailureFor: (await vi.importActual<typeof import('@/lib/regiaAudio')>('@/lib/regiaAudio')).audioFailureFor,
  // #296: useAudioDownloads binds each pass to the sign-in it is asked under (as in useStageRegia.test.ts).
  audioSession: () => () => true,
  cachedAudio: async () => new Set(),
  downloadAudio: async () => ({ ok: true }),
  playableUrl: async (ref: string) => ({ url: `local:${ref}`, local: true }),
  createRegiaPlayer: () => {
    throw new Error('the real player is never used in tests');
  },
}));
vi.mock('@/lib/audioPlayer', () => ({ stopPlayer: () => {} }));

import { useStageLive, type StageRegiaBridge } from '../useStageLive';
import { useStageRegia, type RegiaSong } from '../useStageRegia';
import type { RegiaPlayer } from '@/lib/regiaAudio';

const player = (): RegiaPlayer => {
  let snap = { status: 'idle', positionMs: 0, durationMs: null } as ReturnType<RegiaPlayer['snapshot']>;
  return {
    load: async () => ((snap = { ...snap, status: 'ready' }), true),
    play: async () => ((snap = { ...snap, status: 'playing' }), true),
    pause: () => {},
    // #296: RegiaPlayer.unload (the take is let go when its song leaves).
    unload: () => {
      snap = { status: 'idle', positionMs: 0, durationMs: null } as typeof snap;
    },
    stop: async () => {},
    snapshot: () => snap,
    subscribe: () => () => {},
    dispose: () => {},
  } as RegiaPlayer;
};

const TITLES: Record<string, string> = { a: 'Empire State of Mind', b: 'New York, New York', c: 'Brooklyn Bridge', d: 'Juicy' };
const stored = (): RegiaSong[] =>
  [...db.rows].sort((x, y) => x.position - y.position).map((r) => ({ id: r.id, songId: r.song_id, setNumber: r.set_number, title: TITLES[r.song_id] }));

const useBoth = (songs: RegiaSong[]) => {
  const bridge = useRef<StageRegiaBridge>({});
  const live = useStageLive({ setlistId: 'sl', songs, open: false, isLeader: true, regia: bridge });
  const regia = useStageRegia({
    eventId: 'gig-1',
    setlistId: 'sl',
    open: true,
    isAdmin: true,
    myName: 'Ana',
    clientId: live.clientId,
    send: live.sendRegia,
    bridge,
    songs: live.songs,
    savedSongs: live.savedSongs,
    pendingOrder: live.pendingOrder,
    clearPendingOrder: live.dropPendingOrder,
    rebasePendingOrder: live.rebasePendingOrder,
    holdOrderSaves: live.holdOrderSaves,
    currentId: live.currentId,
    skipped: live.skipped,
    select: live.select,
    jumpTo: live.jumpTo,
    createPlayer: player,
  });
  return { live, regia };
};

const orders = () => ble.publish.mock.calls.map((c) => (c[0] as { order: string[] | null }).order);

beforeEach(() => {
  localStorage.clear();
  db.rows = ['a', 'b', 'c'].map((s, i) => ({ id: `r${i + 1}`, setlist_id: 'sl', song_id: s, position: i + 1, set_number: 1 }));
  db.n = 0;
  db.hold = null;
  db.answerLate = null;
  db.fail = null;
  db.rpcs = [];
  ble.publish.mockClear();
});

const addWhileMoving = async (reloaded = false) => {
  const view = renderHook(({ songs }) => useBoth(songs), { initialProps: { songs: stored() } });
  act(() => view.result.current.regia.turnOn());
  let release!: () => void;
  db.hold = new Promise<void>((r) => (release = r));
  let adding!: Promise<unknown>;
  act(() => {
    adding = view.result.current.regia.playExtra({ id: 'd', title: 'Juicy', audio: 'sb://song-files/b/audio/d.mp3' });
  });
  // While the add is saving: the leader moves "Brooklyn Bridge" to the top.
  act(() => view.result.current.live.move(2, 0));
  expect(view.result.current.live.songs.map((s) => s.id)).toEqual(['r3', 'r1', 'r2']);
  const before = ble.publish.mock.calls.length;
  await act(async () => {
    release();
    await adding;
  });
  if (reloaded) view.rerender({ songs: stored() });
  return { view, before };
};

const sorted = () => [...db.rows].sort((x, y) => x.position - y.position).map((r) => r.id);
const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));

describe('Stage mode: a move made while a song added on stage is still saving', () => {
  // Round 11 (Claude r10 BLOCKER): the add is written at once but its answer
  // comes back after the move's 700 ms save; that save, checked against the
  // setlist before the add, was refused and sent the old order to everyone.
  // Order saves now wait while an add is in flight.
  it('the add answers after the move would have saved: the move waits, is kept, no old order sent', async () => {
    const view = renderHook(({ songs }) => useBoth(songs), { initialProps: { songs: stored() } });
    act(() => view.result.current.regia.turnOn());
    let answer!: () => void;
    db.answerLate = new Promise<void>((r) => (answer = r));
    let adding!: Promise<unknown>;
    act(() => {
      adding = view.result.current.regia.playExtra({ id: 'd', title: 'Juicy', audio: 'sb://song-files/b/audio/d.mp3' });
    });
    act(() => view.result.current.live.move(2, 0));
    const before = ble.publish.mock.calls.length;
    await wait(1200);
    expect(db.rpcs).toHaveLength(1); // nothing saved while the add is in flight
    await act(async () => {
      answer();
      await adding;
    });
    await waitFor(() => expect(view.result.current.live.saveState).toBe('saved'), { timeout: 3000 });
    expect(sorted()).toEqual(['r3', 'r1', 'new-1', 'r2']);
    expect(orders().slice(before).every((o) => o?.join() === 'r3,r1,new-1,r2')).toBe(true);
  });

  for (const fail of ['error', 'throw'] as const) {
    it(`the add fails (${fail}) with a move made meanwhile: the hold is released, the move is saved`, async () => {
      const view = renderHook(({ songs }) => useBoth(songs), { initialProps: { songs: stored() } });
      act(() => view.result.current.regia.turnOn());
      let release!: () => void;
      db.hold = new Promise<void>((r) => (release = r));
      db.fail = fail;
      let adding!: Promise<unknown>;
      act(() => {
        adding = view.result.current.regia.playExtra({ id: 'd', title: 'Juicy', audio: null }).catch(() => false);
      });
      act(() => view.result.current.live.move(2, 0));
      await act(async () => {
        release();
        await adding;
      });
      await waitFor(() => expect(view.result.current.live.saveState).toBe('saved'), { timeout: 3000 });
      expect(sorted()).toEqual(['r3', 'r1', 'r2']);
    });
  }

  // Round 11 (Claude r10 MINOR 2): a move right after the add, before the
  // setlist reloaded, left the new row out and sent the old order.
  it('a move after the add, before the reload: the new song stays in the order, saved, no old order sent', async () => {
    const view = renderHook(({ songs }) => useBoth(songs), { initialProps: { songs: stored() } });
    act(() => view.result.current.regia.turnOn());
    await act(async () => {
      await view.result.current.regia.playExtra({ id: 'd', title: 'Juicy', audio: 'sb://song-files/b/audio/d.mp3' });
    });
    expect(sorted()).toEqual(['r1', 'new-1', 'r2', 'r3']);
    const before = ble.publish.mock.calls.length;
    act(() => view.result.current.live.move(2, 0)); // shown: r1, r2, r3 (new-1 still loading)
    await waitFor(() => expect(view.result.current.live.saveState).toBe('saved'), { timeout: 3000 });
    expect(sorted()).toEqual(['r3', 'r1', 'new-1', 'r2']);
    expect(orders().slice(before).every((o) => o?.join() === 'r3,r1,new-1,r2')).toBe(true);
  });

  // Round 11 (Claude r10 MINOR 3): the rows after the add are used only until
  // the setlist reloaded with the new row: a fresher setlist (another admin's
  // save meanwhile) is what the move is checked against.
  it('another admin saved the setlist and it reloaded before the move is saved: checked against the fresh one, saved', async () => {
    const { view, before } = await addWhileMoving();
    // Another admin puts the new song first; this device reloads it.
    const byId = new Map(db.rows.map((r) => [r.id, r]));
    db.rows = ['new-1', 'r1', 'r2', 'r3'].map((id, i) => ({ ...byId.get(id)!, position: i + 1 }));
    view.rerender({ songs: stored() });
    await waitFor(() => expect(view.result.current.live.saveState).toBe('saved'), { timeout: 3000 });
    expect(sorted()).toEqual(['r3', 'r1', 'new-1', 'r2']);
    expect(orders().slice(before).some((o) => o?.join() === 'r1,new-1,r2,r3')).toBe(false);
  });

  it('the setlist reload has not landed yet: the move is kept, the new song after the current one, saved, no old order sent', async () => {
    const { view, before } = await addWhileMoving();
    await waitFor(() => expect(view.result.current.live.saveState).toBe('saved'), { timeout: 3000 });
    expect(db.rows.sort((x, y) => x.position - y.position).map((r) => r.id)).toEqual(['r3', 'r1', 'new-1', 'r2']);
    const sent = orders().slice(before);
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((o) => o?.join() === 'r3,r1,new-1,r2')).toBe(true);
  });

  it('the reload landed before the move is saved: the same, saved against the setlist with the new song', async () => {
    const { view, before } = await addWhileMoving(true);
    await waitFor(() => expect(view.result.current.live.saveState).toBe('saved'), { timeout: 3000 });
    expect(db.rows.sort((x, y) => x.position - y.position).map((r) => r.id)).toEqual(['r3', 'r1', 'new-1', 'r2']);
    expect(view.result.current.live.songs.map((s) => s.id)).toEqual(['r3', 'r1', 'new-1', 'r2']);
    expect(orders().slice(before).every((o) => o?.join() === 'r3,r1,new-1,r2')).toBe(true);
  });
});

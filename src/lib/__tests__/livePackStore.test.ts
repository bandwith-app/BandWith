// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Live packs on the device (plan §3.1–3.2): kept per user and band in the
 * offline store, removed after the event, when leaving the band, on a role
 * change and at sign-out; the old localStorage copy moves into them.
 */

// A tiny Supabase double: answers per table, records what was asked.
const answers: Record<string, (q: Q) => { data: unknown; error: unknown }> = {};
interface Q {
  table: string;
  select: string;
  filters: Array<[string, string, unknown]>;
}
const asked: Q[] = [];
const query = (table: string) => {
  const q: Q = { table, select: '', filters: [] };
  const chain: any = {
    select: (s: string) => ((q.select = s), chain),
    eq: (c: string, v: unknown) => (q.filters.push(['eq', c, v]), chain),
    in: (c: string, v: unknown) => (q.filters.push(['in', c, v]), chain),
    neq: (c: string, v: unknown) => (q.filters.push(['neq', c, v]), chain),
    order: () => chain,
    limit: () => chain,
    then: (ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) => {
      asked.push(q);
      const fn = answers[table];
      return Promise.resolve(fn ? fn(q) : { data: [], error: null }).then(ok, ko);
    },
  };
  return chain;
};
vi.mock('../supabase', () => ({
  supabase: { from: (t: string) => query(t), rpc: async () => ({ data: 'KEY-1', error: null }) },
  isDemoMode: false,
}));
// The native apps fetch the gig's Bluetooth key (087).
const keyAnswer = vi.hoisted(() => ({ value: { key: 'KEY-1' as string | null, denied: false } }));
vi.mock('../stageBleNative', () => ({
  stageBleAvailable: () => true,
  stageKey: async () => keyAnswer.value.key,
  fetchStageKey: async () => keyAnswer.value,
}));
// What the band's admins see (migration 170).
const status = vi.hoisted(() => ({ reported: [] as string[], forgotten: [] as string[] }));
vi.mock('../livePackStatus', () => ({
  reportPackStatus: async (p: { eventId: string; version: string }) => void status.reported.push(`${p.eventId}@${p.version}`),
  forgetPackStatus: async (_u: string, ids?: string[]) => void status.forgotten.push(...(ids ?? ['*'])),
  saveProfileChoice: async () => undefined,
}));

import { getCacheKey, getOfflineItem, setOfflineItem, syncCachedRoles, clearOfflineCache } from '../offline/storage';
import {
  fetchSetlistRows,
  findPack,
  listPacks,
  migrateLegacySetlists,
  packKey,
  personalFromPacks,
  readPack,
  readPackBySetlist,
  refreshPack,
  resetExtrasProbe,
  runLivePackPrefetch,
  savePackSongs,
  sweepPacks,
} from '../livePackStore';
import { writeChoice } from '../livePackConsent';

const me = 'u1';
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const inDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return ymd(d);
};
const gig = (over: Record<string, unknown> = {}) => ({
  id: 'e1',
  band_id: 'b1',
  title: 'The Loft, Brooklyn',
  event_type: 'gig',
  status: 'confirmed',
  event_date: inDays(3),
  start_time: '21:00',
  venue_name: 'The Loft',
  venue_city: 'Brooklyn',
  setlist_id: 's1',
  fee: 900,
  client_name: 'Jordan Lee',
  ...over,
});
const songs = [
  { id: 'ss1', songId: 'song1', setNumber: 1, title: 'Paper Boats', lyrics: '# Verse\nfolded [G]paper' },
  { id: 'ss2', songId: 'song2', setNumber: 1, title: 'Harbor Lights' },
];
const row = (id: string, songId: string, title: string) => ({ id, song_id: songId, set_number: 1, position: 1, song: { title, lyrics: 'la', updated_at: '2026-11-20T10:00:00Z' } });

beforeEach(() => {
  localStorage.clear();
  asked.length = 0;
  for (const k of Object.keys(answers)) delete answers[k];
  resetExtrasProbe();
  status.reported.length = 0;
  status.forgotten.length = 0;
});

describe('savePackSongs', () => {
  it('keeps the songs and the event basics, never the fee or the client', async () => {
    await savePackSongs({ userId: me, event: gig(), songs });
    const p = await readPack(me, 'b1', 'e1');
    expect(p?.songs.map((s) => s.title)).toEqual(['Paper Boats', 'Harbor Lights']);
    expect(p?.event.venue_name).toBe('The Loft');
    const raw = JSON.stringify(await getOfflineItem(packKey(me, 'b1', 'e1')));
    expect(raw).not.toMatch(/900|Jordan|fee|client/);
  });

  it('is found by setlist (Stage with no signal) and by event (Go live)', async () => {
    await savePackSongs({ userId: me, event: gig(), songs });
    expect((await readPackBySetlist(me, 's1'))?.eventId).toBe('e1');
    expect((await findPack(me, 'e1'))?.setlistId).toBe('s1');
    expect(await findPack('u2', 'e1')).toBeNull();
  });
});

describe('removal', () => {
  it('goes 24 h after the event', async () => {
    await savePackSongs({ userId: me, event: gig({ event_date: inDays(-2), end_time: '23:00' }), songs });
    expect(await readPack(me, 'b1', 'e1')).toBeNull();
    expect(await getOfflineItem(packKey(me, 'b1', 'e1'))).toBeNull();
  });

  it('goes when I am no longer in the band', async () => {
    await savePackSongs({ userId: me, event: gig(), songs });
    await savePackSongs({ userId: me, event: gig({ id: 'e2', band_id: 'b2', setlist_id: 's2' }), songs });
    expect(await sweepPacks(me, ['b2'])).toBe(1);
    expect((await listPacks(me)).map((p) => p.eventId)).toEqual(['e2']);
  });

  it('goes when my role changes, and at sign-out', async () => {
    await syncCachedRoles(me, { b1: 'member' });
    await savePackSongs({ userId: me, event: gig(), songs });
    await syncCachedRoles(me, { b1: 'admin' });
    expect(await readPack(me, 'b1', 'e1')).toBeNull();
    await savePackSongs({ userId: me, event: gig(), songs });
    await clearOfflineCache();
    expect(await readPack(me, 'b1', 'e1')).toBeNull();
  });
});

describe('refreshPack', () => {
  it('downloads songs, my notes only and the stage key; a rehearsal also its band notes', async () => {
    answers.setlist_songs = () => ({ data: [row('ss1', 'song1', 'Paper Boats')], error: null });
    answers.song_personal_notes = (q) => ({
      data: q.filters.some(([, c, v]) => c === 'user_id' && v === me) ? [{ id: 'n1', song_id: 'song1', anchor: { type: 'song' }, body: 'capo 2', updated_at: '2026-11-20T12:00:00Z' }] : [],
      error: null,
    });
    answers.rehearsal_notes = (q) => ({
      data: q.filters.some(([, c]) => c === 'occurrence_date') ? [] : [],
      error: null,
    });
    const p = await refreshPack({ userId: me, event: gig({ event_type: 'rehearsal' }) });
    expect(p?.songs[0].title).toBe('Paper Boats');
    expect(p?.personal.song1.notes[0].body).toBe('capo 2');
    expect(p?.stageKey).toBe('KEY-1');
    expect(p?.bandNotes?.date).toBe(inDays(3));
    expect((await personalFromPacks(me, 'song1'))?.notes).toHaveLength(1);
  });

  it("a no from the server drops the pack's kept stage key; offline keeps it (Claude on #283)", async () => {
    answers.setlist_songs = () => ({ data: [row('ss1', 'song1', 'Paper Boats')], error: null });
    keyAnswer.value = { key: 'KEY-1', denied: false };
    expect((await refreshPack({ userId: me, event: gig() }))?.stageKey).toBe('KEY-1');
    keyAnswer.value = { key: null, denied: false }; // offline, nothing cached
    expect((await refreshPack({ userId: me, event: gig() }))?.stageKey).toBe('KEY-1');
    keyAnswer.value = { key: null, denied: true }; // may no longer see the gig
    expect((await refreshPack({ userId: me, event: gig() }))?.stageKey).toBeNull();
    keyAnswer.value = { key: 'KEY-1', denied: false };
  });

  it('asks for the live fields of the other parts, and without them while the database has none', async () => {
    answers.setlist_songs = (q) =>
      q.select.includes('time_signature') ? { data: null, error: { message: 'column songs.time_signature does not exist', code: '42703' } } : { data: [row('ss1', 'song1', 'Paper Boats')], error: null };
    const { rows } = await fetchSetlistRows('s1');
    expect(rows).toHaveLength(1);
    const selects = asked.filter((q) => q.table === 'setlist_songs').map((q) => q.select);
    expect(selects[0]).toContain('vocal_parts');
    expect(selects[1]).not.toContain('time_signature');
  });

  it('drops only the columns the database lacks: voice parts stay when the tempo ones are missing', async () => {
    answers.setlist_songs = (q) =>
      /time_signature|count_in_bars/.test(q.select)
        ? { data: null, error: { message: `column songs.${q.select.includes('time_signature') ? 'time_signature' : 'count_in_bars'} does not exist`, code: '42703' } }
        : { data: [row('ss1', 'song1', 'Paper Boats')], error: null };
    const { rows } = await fetchSetlistRows('s1');
    expect(rows).toHaveLength(1);
    const selects = asked.filter((q) => q.table === 'setlist_songs').map((q) => q.select);
    expect(selects).toHaveLength(3);
    expect(selects[2]).toContain('vocal_parts');
    expect(selects[2]).toContain('line_timing');
    expect(selects[2]).not.toMatch(/time_signature|count_in_bars/);
  });

  it('tells the admins the full pack is on this device', async () => {
    answers.setlist_songs = () => ({ data: [row('ss1', 'song1', 'Paper Boats')], error: null });
    const p = await refreshPack({ userId: me, event: gig() });
    expect(status.reported).toEqual([`e1@${p?.version}`]);
  });

  it('keeps the songs it had when the setlist cannot be fetched (offline)', async () => {
    await savePackSongs({ userId: me, event: gig(), songs });
    answers.setlist_songs = () => ({ data: null, error: { message: 'Failed to fetch' } });
    const p = await refreshPack({ userId: me, event: gig() });
    expect(p?.songs).toHaveLength(2);
  });
});

describe('runLivePackPrefetch', () => {
  const ev = (id: string, date: string, over: Record<string, unknown> = {}) => ({
    eventId: id,
    bandId: 'b1',
    date,
    eventType: 'gig',
    setlistId: 's1',
    row: gig({ id, event_date: date, ...over }),
  });

  it('downloads nothing until the person said yes', async () => {
    answers.setlist_songs = () => ({ data: [row('ss1', 'song1', 'Paper Boats')], error: null });
    expect(await runLivePackPrefetch({ userId: me, bandIds: ['b1'], events: [ev('e1', inDays(2))], online: true })).toBe(0);
    expect(await readPack(me, 'b1', 'e1')).toBeNull();
  });

  it('with "keep it automatic": the next 7 days, not declined, not on mobile data with Wi-Fi only', async () => {
    writeChoice(me, { auto: true, events: [], wifiOnly: false });
    answers.setlist_songs = () => ({ data: [row('ss1', 'song1', 'Paper Boats')], error: null });
    answers.event_members = () => ({ data: [{ event_id: 'e3', status: 'declined' }], error: null });
    const events = [ev('e1', inDays(1)), ev('e2', inDays(9)), ev('e3', inDays(2))];
    expect(await runLivePackPrefetch({ userId: me, bandIds: ['b1'], events, online: true })).toBe(1);
    expect((await listPacks(me)).map((p) => p.eventId)).toEqual(['e1']);
    writeChoice(me, { auto: true, events: [], wifiOnly: true });
    expect(await runLivePackPrefetch({ userId: me, bandIds: ['b1'], events: [ev('e4', inDays(1))], online: true, onWifi: false })).toBe(0);
  });

  it('a silent push refreshes a fresh pack anyway; a pack that goes is forgotten on the server', async () => {
    writeChoice(me, { auto: true, events: [], wifiOnly: false });
    answers.setlist_songs = () => ({ data: [row('ss1', 'song1', 'Paper Boats')], error: null });
    const events = [ev('e1', inDays(1))];
    expect(await runLivePackPrefetch({ userId: me, bandIds: ['b1'], events, online: true })).toBe(1);
    expect(await runLivePackPrefetch({ userId: me, bandIds: ['b1'], events, online: true })).toBe(0);
    answers.setlist_songs = () => ({ data: [row('ss1', 'song1', 'Paper Boats'), row('ss2', 'song2', 'Harbor Lights')], error: null });
    expect(await runLivePackPrefetch({ userId: me, bandIds: ['b1'], events, online: true, force: ['e1'] })).toBe(1);
    expect((await readPack(me, 'b1', 'e1'))?.songs).toHaveLength(2);
    await sweepPacks(me, []);
    expect(status.forgotten).toEqual(['e1']);
  });

  it('"Only this gig": that event only', async () => {
    writeChoice(me, { auto: false, events: ['e2'], wifiOnly: false });
    answers.setlist_songs = () => ({ data: [row('ss1', 'song1', 'Paper Boats')], error: null });
    await runLivePackPrefetch({ userId: me, bandIds: ['b1'], events: [ev('e1', inDays(1)), ev('e2', inDays(2))], online: true });
    expect((await listPacks(me)).map((p) => p.eventId)).toEqual(['e2']);
  });
});

describe('migrateLegacySetlists', () => {
  it('moves the old localStorage copy into the pack, then removes it', async () => {
    localStorage.setItem('bw-setlist-songs:s1', JSON.stringify(songs));
    localStorage.setItem('bw-setlist-songs:old', JSON.stringify(songs));
    const events = [{ eventId: 'e1', bandId: 'b1', date: inDays(2), eventType: 'gig', setlistId: 's1' }];
    await migrateLegacySetlists(me, events, new Map([['e1', gig()]]));
    expect((await readPack(me, 'b1', 'e1'))?.songs).toHaveLength(2);
    expect(localStorage.getItem('bw-setlist-songs:s1')).toBeNull();
    expect(localStorage.getItem('bw-setlist-songs:old')).toBeNull();
  });
});

it('pack keys live under the user and band (what logout and role changes clear)', () => {
  expect(packKey(me, 'b1', 'e1')).toBe(getCacheKey(me, 'b1', 'live_pack:e1'));
  void setOfflineItem;
});

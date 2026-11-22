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
vi.mock('../stageBleNative', () => ({ stageBleAvailable: () => true, stageKey: async () => 'KEY-1' }));
// What the band's admins see (migration 170).
const status = vi.hoisted(() => ({ reported: [] as string[], forgotten: [] as string[] }));
vi.mock('../livePackStatus', () => ({
  reportPackStatus: async (p: { eventId: string; version: string; partial?: boolean }) =>
    void status.reported.push(`${p.eventId}@${p.version}${p.partial ? ':partial' : ''}`),
  forgetPackStatus: async (_u: string, ids?: string[]) => void status.forgotten.push(...(ids ?? ['*'])),
  saveProfileChoice: async () => undefined,
}));

// My files on the device (native): off in jsdom unless a test turns it on.
const files = vi.hoisted(() => ({ available: false, local: null as { path: string; directory: string } | null }));
vi.mock('../livePackFiles', async (orig) => ({
  ...(await orig<typeof import('../livePackFiles')>()),
  packFilesAvailable: () => files.available,
  downloadPackFile: async () => files.local,
  removePackFiles: async () => undefined,
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
  packOpenedEvent,
} from '../livePackStore';
import { isPackReady } from '../livePack';
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
  files.available = false;
  files.local = null;
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

// Kill switch live_pack off (docs/flags.md): it stops new downloads only.
// The tidy-up (old copies moved in, packs of left bands and past events
// removed) always runs: privacy and data migration are never switched off.
describe('runLivePackPrefetch with downloads off', () => {
  const ev = (id: string, date: string, over: Record<string, unknown> = {}) => ({
    eventId: id,
    bandId: 'b1',
    date,
    eventType: 'gig',
    setlistId: 's1',
    row: gig({ id, event_date: date, ...over }),
  });

  it('still moves the old copies in and removes packs of bands I left, downloads nothing', async () => {
    writeChoice(me, { auto: true, events: [], wifiOnly: false });
    answers.setlist_songs = () => ({ data: [row('ss1', 'song1', 'Paper Boats')], error: null });
    await savePackSongs({ userId: me, event: gig({ id: 'e9', band_id: 'b2', setlist_id: 's9' }), songs });
    localStorage.setItem('bw-setlist-songs:s1', JSON.stringify(songs));
    const events = [ev('e1', inDays(1)), ev('e2', inDays(2), { setlist_id: 's2' })];
    events[1].setlistId = 's2';
    expect(await runLivePackPrefetch({ userId: me, bandIds: ['b1'], events, online: true, downloads: false })).toBe(0);
    expect(localStorage.getItem('bw-setlist-songs:s1')).toBeNull();
    expect((await readPack(me, 'b1', 'e1'))?.songs).toHaveLength(2); // the old copy, not a download
    expect(await readPack(me, 'b1', 'e2')).toBeNull();
    expect(await readPack(me, 'b2', 'e9')).toBeNull();
  });

  it('switched off while downloading: the next event is not fetched', async () => {
    writeChoice(me, { auto: true, events: [], wifiOnly: false });
    answers.setlist_songs = () => ({ data: [row('ss1', 'song1', 'Paper Boats')], error: null });
    const events = [ev('e1', inDays(1)), ev('e2', inDays(2))];
    // On until the first pack is saved, then switched off.
    let on = true;
    const off = () => (on = false);
    window.addEventListener('bw:live-pack-changed', off);
    const n = await runLivePackPrefetch({ userId: me, bandIds: ['b1'], events, online: true, keepGoing: () => on });
    window.removeEventListener('bw:live-pack-changed', off);
    expect(n).toBe(1);
    expect((await listPacks(me)).map((p) => p.eventId)).toEqual(['e1']);
  });
});

// live_pack off (docs/flags.md): opening an event still keeps its songs and
// tidies the pack (deleted notes, files and band notes go), but such a pack is
// partial: never "fresh" for the prefetch, never "Offline ready", never
// reported to the admins. When the switch is on again it is completed.
describe('packOpenedEvent', () => {
  const openArgs = (on: boolean, over: Record<string, unknown> = {}) => ({
    userId: me,
    event: gig(),
    songs,
    livePackOn: on,
    fullDue: true,
    allowFiles: true,
    ...over,
  });

  it('off: songs kept and the pack tidied, but partial: not ready, reported only as partial', async () => {
    answers.song_personal_notes = () => ({ data: [{ id: 'n1', song_id: 'song1', anchor: { type: 'song' }, body: 'capo 2' }], error: null });
    await packOpenedEvent(openArgs(false));
    const p = await readPack(me, 'b1', 'e1');
    expect(p?.songs).toHaveLength(2);
    expect(p?.partial).toBe(true);
    expect(isPackReady(p)).toBe(false);
    // Held but partial (round 4): the server can reach it, the admins don't count it.
    await new Promise((r) => setTimeout(r, 0));
    expect(status.reported.length).toBeGreaterThan(0);
    expect(status.reported.every((r) => r.endsWith(':partial'))).toBe(true);
    // My note deleted meanwhile: gone from the pack too, even with the switch off.
    answers.song_personal_notes = () => ({ data: [], error: null });
    await packOpenedEvent(openArgs(false));
    expect((await readPack(me, 'b1', 'e1'))?.personal.song1).toBeUndefined();
  });

  it('on again: a partial pack is not fresh, the prefetch completes it', async () => {
    await packOpenedEvent(openArgs(false));
    writeChoice(me, { auto: true, events: [], wifiOnly: false });
    answers.setlist_songs = () => ({ data: [row('ss1', 'song1', 'Paper Boats')], error: null });
    const events = [{ eventId: 'e1', bandId: 'b1', date: inDays(3), eventType: 'gig', setlistId: 's1', row: gig() }];
    expect(await runLivePackPrefetch({ userId: me, bandIds: ['b1'], events, online: true })).toBe(1);
    const p = await readPack(me, 'b1', 'e1');
    expect(p?.partial).toBeFalsy();
    expect(isPackReady(p)).toBe(true);
  });

  it('on: the full pack as before (ready, reported)', async () => {
    await packOpenedEvent(openArgs(true));
    await new Promise((r) => setTimeout(r, 0));
    const p = await readPack(me, 'b1', 'e1');
    expect(isPackReady(p)).toBe(true);
    expect(status.reported.filter((r) => !r.endsWith(':partial'))).toHaveLength(1);
  });

  it('an empty setlist drops the pack, switch on or off', async () => {
    await packOpenedEvent(openArgs(true));
    await packOpenedEvent(openArgs(false, { songs: [] }));
    expect(await readPack(me, 'b1', 'e1')).toBeNull();
  });
});

// Review round 3 (#273): switched off, no NEW data comes down (songs only for
// an event not held yet), but what is already on the phone is kept current
// and tidied, including by the server's silent refresh.
describe('live_pack off: nothing new, held data kept current', () => {
  const ev = (over: Record<string, unknown> = {}) => ({ eventId: 'e1', bandId: 'b1', date: inDays(3), eventType: 'gig', setlistId: 's1', row: gig(over) });
  const note = (id: string, body: string) => ({ id, song_id: 'song1', anchor: { type: 'song' }, body });

  it('an uncached rehearsal opened while off: songs only, no notes, files, band notes or key', async () => {
    answers.song_personal_notes = () => ({ data: [note('n1', 'capo 2')], error: null });
    answers.song_personal_files = () => ({ data: [{ id: 'f1', song_id: 'song1', name: 'chart.pdf', kind: 'pdf', ref: 'r', size: 10 }], error: null });
    answers.rehearsal_notes = () => ({ data: [{ id: 'r1', band_id: 'b1', body: 'tighten the bridge', status: 'open' }], error: null });
    await packOpenedEvent({ userId: me, event: gig({ event_type: 'rehearsal' }), songs, livePackOn: false, fullDue: true, allowFiles: true });
    const p = await readPack(me, 'b1', 'e1');
    expect(p?.songs).toHaveLength(2);
    expect(p?.personal).toEqual({});
    expect(p?.bandNotes).toBeUndefined();
    expect(p?.stageKey).toBeFalsy();
  });

  it('a held pack opened while off keeps its notes current, gains no new ones', async () => {
    answers.setlist_songs = () => ({ data: [row('ss1', 'song1', 'Paper Boats')], error: null });
    answers.song_personal_notes = () => ({ data: [note('n1', 'capo 2')], error: null });
    await refreshPack({ userId: me, event: gig() });
    answers.song_personal_notes = () => ({ data: [note('n1', 'capo 3'), note('n2', 'new while off')], error: null });
    await packOpenedEvent({ userId: me, event: gig(), songs, livePackOn: false, fullDue: true, allowFiles: true });
    const p = await readPack(me, 'b1', 'e1');
    expect(p?.personal.song1.notes.map((n) => n.body)).toEqual(['capo 3']);
  });

  it('a pack that turns partial is reported partial: not ready for the admins, still a holder for the server (round 4)', async () => {
    answers.setlist_songs = () => ({ data: [row('ss1', 'song1', 'Paper Boats')], error: null });
    await refreshPack({ userId: me, event: gig() });
    await new Promise((r) => setTimeout(r, 0));
    expect(status.reported).toHaveLength(1);
    expect(status.reported[0]).not.toMatch(/:partial$/);
    await packOpenedEvent({ userId: me, event: gig(), songs, livePackOn: false, fullDue: false, allowFiles: true });
    await new Promise((r) => setTimeout(r, 0));
    // The status row stays (the server's only way to reach a held pack while off), marked partial.
    expect(status.forgotten).toEqual([]);
    expect(status.reported[status.reported.length - 1]).toMatch(/^e1@.*:partial$/);
  });

  it('an uncached open while off asks for no notes or files at all (round 4)', async () => {
    answers.song_personal_notes = () => ({ data: [note('n1', 'capo 2')], error: null });
    await packOpenedEvent({ userId: me, event: gig(), songs, livePackOn: false, fullDue: true, allowFiles: true });
    expect(asked.filter((q) => q.table === 'song_personal_notes' || q.table === 'song_personal_files')).toEqual([]);
  });

  it('back on: a partial pack stays partial when a part fails to load (round 4)', async () => {
    answers.setlist_songs = () => ({ data: [row('ss1', 'song1', 'Paper Boats')], error: null });
    await packOpenedEvent({ userId: me, event: gig(), songs, livePackOn: false, fullDue: false, allowFiles: true });
    expect((await readPack(me, 'b1', 'e1'))?.partial).toBe(true);
    answers.song_personal_notes = () => ({ data: null, error: { message: 'network' } });
    await refreshPack({ userId: me, event: gig() });
    const p = await readPack(me, 'b1', 'e1');
    expect(p?.partial).toBe(true);
    expect(isPackReady(p!)).toBe(false);
    expect(status.reported.every((r) => r.endsWith(':partial'))).toBe(true);
    // Everything loads: now it is complete.
    answers.song_personal_notes = () => ({ data: [note('n1', 'capo 2')], error: null });
    await refreshPack({ userId: me, event: gig() });
    expect((await readPack(me, 'b1', 'e1'))?.partial).toBeUndefined();
  });

  it('back on: a rehearsal stays partial when its band notes fail to load (round 4)', async () => {
    answers.setlist_songs = () => ({ data: [row('ss1', 'song1', 'Paper Boats')], error: null });
    const reh = gig({ event_type: 'rehearsal' });
    await packOpenedEvent({ userId: me, event: reh, songs, livePackOn: false, fullDue: false, allowFiles: true });
    answers.rehearsal_notes = () => ({ data: null, error: { message: 'network' } });
    await refreshPack({ userId: me, event: reh });
    expect((await readPack(me, 'b1', 'e1'))?.partial).toBe(true);
  });

  it("the server's silent refresh still tidies a held pack while off", async () => {
    answers.setlist_songs = () => ({ data: [row('ss1', 'song1', 'Paper Boats')], error: null });
    answers.song_personal_notes = () => ({ data: [note('n1', 'capo 2')], error: null });
    await refreshPack({ userId: me, event: gig() });
    answers.song_personal_notes = () => ({ data: [], error: null });
    await runLivePackPrefetch({ userId: me, bandIds: ['b1'], events: [ev()], online: true, downloads: false, force: ['e1'] });
    const p = await readPack(me, 'b1', 'e1');
    expect(p?.personal.song1).toBeUndefined();
    expect(p?.partial).toBe(true);
    // Setlist emptied: the pack goes.
    answers.setlist_songs = () => ({ data: [], error: null });
    await runLivePackPrefetch({ userId: me, bandIds: ['b1'], events: [ev()], online: true, downloads: false, force: ['e1'] });
    expect(await readPack(me, 'b1', 'e1')).toBeNull();
  });

  it('a silent refresh while off never creates a pack', async () => {
    answers.setlist_songs = () => ({ data: [row('ss1', 'song1', 'Paper Boats')], error: null });
    await runLivePackPrefetch({ userId: me, bandIds: ['b1'], events: [ev()], online: true, downloads: false, force: ['e1'] });
    expect(await readPack(me, 'b1', 'e1')).toBeNull();
  });
});

describe('migrateLegacySetlists', () => {
  it('moves the old localStorage copy into the pack, then removes it', async () => {
    localStorage.setItem('bw-setlist-songs:s1', JSON.stringify(songs));
    localStorage.setItem('bw-setlist-songs:old', JSON.stringify(songs));
    const events = [{ eventId: 'e1', bandId: 'b1', date: inDays(2), eventType: 'gig', setlistId: 's1' }];
    await migrateLegacySetlists(me, events, new Map([['e1', gig()]]), false);
    expect((await readPack(me, 'b1', 'e1'))?.songs).toHaveLength(2);
    // Switched off: songs only, partial, never "Offline ready" until a full download.
    expect((await readPack(me, 'b1', 'e1'))?.partial).toBe(true);
    expect(localStorage.getItem('bw-setlist-songs:s1')).toBeNull();
    expect(localStorage.getItem('bw-setlist-songs:old')).toBeNull();
  });
});

describe('migrateLegacySetlists with live_pack on (round 4)', () => {
  it('a moved copy keeps the status it had before the switch existed', async () => {
    localStorage.setItem('bw-setlist-songs:s1', JSON.stringify(songs));
    const events = [{ eventId: 'e1', bandId: 'b1', date: inDays(2), eventType: 'gig', setlistId: 's1' }];
    await migrateLegacySetlists(me, events, new Map([['e1', gig()]]), true);
    expect((await readPack(me, 'b1', 'e1'))?.partial).toBeUndefined();
  });
});

it('pack keys live under the user and band (what logout and role changes clear)', () => {
  expect(packKey(me, 'b1', 'e1')).toBe(getCacheKey(me, 'b1', 'live_pack:e1'));
  void setOfflineItem;
});

// Review #273 round 5.
describe('round 5 (review #273)', () => {
  const ev = (over: Record<string, unknown> = {}) => ({ eventId: 'e1', bandId: 'b1', date: inDays(3), eventType: 'gig', setlistId: 's1', row: gig(over) });
  const note = (id: string, body: string) => ({ id, song_id: 'song1', anchor: { type: 'song' }, body });
  const pdf = { id: 'f1', song_id: 'song1', name: 'chart.pdf', kind: 'pdf', ref: 'r', size: 10 };
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it('a file that fails to download keeps the pack partial; it is full once every file is on the device', async () => {
    files.available = true;
    answers.setlist_songs = () => ({ data: [row('ss1', 'song1', 'Paper Boats')], error: null });
    answers.song_personal_files = () => ({ data: [{ ...pdf }], error: null });
    await refreshPack({ userId: me, event: gig(), withFiles: true });
    let p = await readPack(me, 'b1', 'e1');
    expect(p?.partial).toBe(true);
    expect(isPackReady(p)).toBe(false);
    await tick();
    expect(status.reported.every((r) => r.endsWith(':partial'))).toBe(true);
    files.local = { path: 'live-pack/u1/f1-chart.pdf', directory: 'LIBRARY_NO_CLOUD' };
    await refreshPack({ userId: me, event: gig(), withFiles: true });
    p = await readPack(me, 'b1', 'e1');
    expect(p?.partial).toBeUndefined();
    expect(p?.personal.song1.files[0].local?.path).toBe('live-pack/u1/f1-chart.pdf');
  });

  it('a full pack whose new file fails to download turns partial (not "ready" without it)', async () => {
    files.available = true;
    answers.setlist_songs = () => ({ data: [row('ss1', 'song1', 'Paper Boats')], error: null });
    await refreshPack({ userId: me, event: gig(), withFiles: true });
    expect((await readPack(me, 'b1', 'e1'))?.partial).toBeUndefined();
    answers.song_personal_files = () => ({ data: [{ ...pdf }], error: null });
    await refreshPack({ userId: me, event: gig(), withFiles: true });
    expect((await readPack(me, 'b1', 'e1'))?.partial).toBe(true);
  });

  it('an uncached open with the switch on: the songs-only copy is partial until the full pack loads', async () => {
    await packOpenedEvent({ userId: me, event: gig(), songs, livePackOn: true, fullDue: false, allowFiles: true });
    const p = await readPack(me, 'b1', 'e1');
    expect(p?.partial).toBe(true);
    expect(isPackReady(p)).toBe(false);
    await tick();
    expect(status.reported.every((r) => r.endsWith(':partial'))).toBe(true);
    answers.setlist_songs = () => ({ data: [row('ss1', 'song1', 'Paper Boats')], error: null });
    await packOpenedEvent({ userId: me, event: gig(), songs, livePackOn: true, fullDue: true, allowFiles: true });
    expect((await readPack(me, 'b1', 'e1'))?.partial).toBeUndefined();
  });

  it('switched off: coming back still sweeps held packs (a note deleted elsewhere goes), not only on a push', async () => {
    answers.setlist_songs = () => ({ data: [row('ss1', 'song1', 'Paper Boats')], error: null });
    answers.song_personal_notes = () => ({ data: [note('n1', 'capo 2')], error: null });
    await refreshPack({ userId: me, event: gig() });
    answers.song_personal_notes = () => ({ data: [], error: null });
    const later = new Date(Date.now() + 31 * 60 * 1000);
    expect(await runLivePackPrefetch({ userId: me, bandIds: ['b1'], events: [ev()], online: true, downloads: false, now: later })).toBe(1);
    const p = await readPack(me, 'b1', 'e1');
    expect(p?.personal.song1).toBeUndefined();
    expect(p?.partial).toBe(true);
  });

  it('switched off: a pack swept a moment ago is not fetched again on the next resume', async () => {
    answers.setlist_songs = () => ({ data: [row('ss1', 'song1', 'Paper Boats')], error: null });
    await refreshPack({ userId: me, event: gig() });
    asked.length = 0;
    expect(await runLivePackPrefetch({ userId: me, bandIds: ['b1'], events: [ev()], online: true, downloads: false })).toBe(0);
    expect(asked.filter((q) => q.table === 'setlist_songs')).toEqual([]);
  });

  it('switched off, Wi-Fi only and on mobile data: a silent push fetches nothing', async () => {
    writeChoice(me, { auto: true, events: [], wifiOnly: true });
    answers.setlist_songs = () => ({ data: [row('ss1', 'song1', 'Paper Boats')], error: null });
    await refreshPack({ userId: me, event: gig() });
    asked.length = 0;
    expect(await runLivePackPrefetch({ userId: me, bandIds: ['b1'], events: [ev()], online: true, onWifi: false, downloads: false, force: ['e1'] })).toBe(0);
    expect(asked.filter((q) => q.table === 'setlist_songs')).toEqual([]);
  });
});

// Review #273 round 6.
describe('round 6 (review #273)', () => {
  const note = (id: string, body: string) => ({ id, song_id: 'song1', anchor: { type: 'song' }, body });
  const pdf = { id: 'f1', song_id: 'song1', name: 'chart.pdf', kind: 'pdf', ref: 'r', size: 10 };

  it('switched off: resume keeps a recurring rehearsal on its upcoming date, never the series start (rule 0)', async () => {
    answers.setlist_songs = () => ({ data: [row('ss1', 'song1', 'Paper Boats')], error: null });
    answers.song_personal_notes = () => ({ data: [note('n1', 'capo 2')], error: null });
    const reh = gig({ event_type: 'rehearsal', event_date: inDays(-7) });
    await refreshPack({ userId: me, event: reh, occurrenceDate: inDays(1) });
    expect((await readPack(me, 'b1', 'e1'))?.event.event_date).toBe(inDays(1));
    // The list has every occurrence of the series, the first one last week.
    const occ = (date: string) => ({ eventId: 'e1', bandId: 'b1', date, eventType: 'rehearsal', setlistId: 's1', row: reh });
    const later = new Date(Date.now() + 31 * 60 * 1000);
    await runLivePackPrefetch({ userId: me, bandIds: ['b1'], events: [occ(inDays(-7)), occ(inDays(1)), occ(inDays(8))], online: true, downloads: false, now: later });
    const p = await readPack(me, 'b1', 'e1');
    expect(p?.event.event_date).toBe(inDays(1));
    expect(p?.songs).toHaveLength(1);
  });

  it('on a phone, a file of mine not on the device keeps the pack partial even before the download yes', async () => {
    files.available = true;
    answers.setlist_songs = () => ({ data: [row('ss1', 'song1', 'Paper Boats')], error: null });
    answers.song_personal_files = () => ({ data: [{ ...pdf }], error: null });
    await packOpenedEvent({ userId: me, event: gig(), songs, livePackOn: true, fullDue: true, allowFiles: false });
    const p = await readPack(me, 'b1', 'e1');
    expect(p?.partial).toBe(true);
    expect(isPackReady(p)).toBe(false);
  });

  it('a setlist replaced meanwhile: the new songs are partial until they load, even over a full pack', async () => {
    answers.setlist_songs = () => ({ data: [row('ss1', 'song1', 'Paper Boats')], error: null });
    await refreshPack({ userId: me, event: gig() });
    expect((await readPack(me, 'b1', 'e1'))?.partial).toBeUndefined();
    const newSongs = [{ id: 'ss9', songId: 'song9', setNumber: 1, title: 'Hudson Line' }];
    await packOpenedEvent({ userId: me, event: gig({ setlist_id: 's2' }), songs: newSongs, livePackOn: true, fullDue: false, allowFiles: true });
    expect((await readPack(me, 'b1', 'e1'))?.partial).toBe(true);
    // Same setlist, songs changed (one added): partial too.
    await refreshPack({ userId: me, event: gig() });
    await packOpenedEvent({ userId: me, event: gig(), songs: [...songs, newSongs[0]], livePackOn: true, fullDue: false, allowFiles: true });
    expect((await readPack(me, 'b1', 'e1'))?.partial).toBe(true);
  });
});

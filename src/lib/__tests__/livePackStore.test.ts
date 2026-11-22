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
// RPCs answer from `answers['rpc:<name>']`; one not set is missing on this database (PGRST202).
const rpc = (name: string, args: unknown) => {
  asked.push({ table: `rpc:${name}`, select: '', filters: [['args', name, args]] });
  const fn = answers[`rpc:${name}`];
  return Promise.resolve(fn ? fn({ table: name, select: '', filters: [['args', name, args]] }) : { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
};
vi.mock('../supabase', () => ({
  supabase: { from: (t: string) => query(t), rpc: (n: string, a: unknown) => rpc(n, a) },
  isDemoMode: false,
}));
// The native apps fetch the gig's Bluetooth key (087).
const signedForgot = vi.hoisted(() => [] as string[]);
const keyAnswer = vi.hoisted(() => ({ value: { key: 'KEY-1' as string | null, denied: false }, asks: 0 }));
const keysForgot = vi.hoisted(() => [] as string[]);
vi.mock('../stageBleNative', () => ({
  stageBleAvailable: () => true,
  stageKey: async () => keyAnswer.value.key,
  fetchStageKey: async () => {
    keyAnswer.asks++;
    return keyAnswer.value;
  },
  forgetStageKeys: (e: string) => void keysForgot.push(e),
}));
vi.mock('../stageSignedMemory', () => ({ forgetSignedMemory: (u: string, e: string) => void signedForgot.push(`${u}:${e}`) }));
// What the band's admins see (migration 170).
const status = vi.hoisted(() => ({ reported: [] as string[], forgotten: [] as string[] }));
vi.mock('../livePackStatus', () => ({
  reportPackStatus: async (p: { eventId: string; version: string; partial?: boolean }) =>
    void status.reported.push(`${p.eventId}@${p.version}${p.partial ? ':partial' : ''}`),
  forgetPackStatus: async (_u: string, ids?: string[]) => void status.forgotten.push(...(ids ?? ['*'])),
  saveProfileChoice: async () => undefined,
}));

// My files on the device (native): off in jsdom unless a test turns it on.
const files = vi.hoisted(() => ({
  available: false,
  local: null as { path: string; directory: string } | null,
  downloads: 0,
  removed: [] as string[],
  gone: new Set<string>(),
  /** Removing a file really takes it off the device (hasPackFile then says no). */
  removeIsReal: false,
}));
vi.mock('../livePackFiles', async (orig) => ({
  ...(await orig<typeof import('../livePackFiles')>()),
  packFilesAvailable: () => files.available,
  downloadPackFile: async () => (files.downloads++, files.local),
  removePackFiles: async (fs: Array<{ local?: { path: string } }>) => {
    const paths = fs.filter((f) => f.local).map((f) => f.local!.path);
    files.removed.push(...paths);
    if (files.removeIsReal) paths.forEach((x) => files.gone.add(x));
  },
  // On the device unless a test removed it (the OS cleared it, the person deleted the app's data).
  hasPackFile: async (l?: { path: string }) => !!l && !files.gone.has(l.path),
}));

import { getCacheKey, getOfflineItem, setOfflineItem, syncCachedRoles, clearOfflineCache } from '../offline/storage';
import {
  deleteAllPacks,
  deletePack,
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
  sweepGonePacks,
  occurrenceNotesFromPack,
} from '../livePackStore';
import { isPackReady, unavailablePackFiles } from '../livePack';
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
  files.downloads = 0;
  files.removed.length = 0;
  files.gone.clear();
  files.removeIsReal = false;
  // The events exist and are on, unless a test says otherwise (the privacy sweep reads them).
  answers.events = (q) => ({ data: ((q.filters.find((f) => f[1] === 'id')?.[2] as string[]) ?? []).map((id) => ({ id, status: 'confirmed' })), error: null });
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

  it("takes along what this phone remembers of the gig's signed leaders (Claude on #288)", async () => {
    signedForgot.length = 0;
    await savePackSongs({ userId: me, event: gig(), songs });
    await savePackSongs({ userId: me, event: gig({ id: 'e2', band_id: 'b2', setlist_id: 's2' }), songs });
    await sweepPacks(me, ['b2']);
    expect(signedForgot).toEqual([`${me}:e1`]);
  });

  it('"Delete all" and deleting one take along the gig\'s kept keys, the private signing key included (Codex on #288)', async () => {
    keysForgot.length = 0;
    await savePackSongs({ userId: me, event: gig(), songs });
    await savePackSongs({ userId: me, event: gig({ id: 'e2', band_id: 'b2', setlist_id: 's2' }), songs });
    await deletePack(me, 'b1', 'e1');
    expect(keysForgot).toEqual(['e1']);
    await savePackSongs({ userId: me, event: gig(), songs });
    keysForgot.length = 0;
    await deleteAllPacks(me);
    expect(keysForgot.sort()).toEqual(['e1', 'e2']);
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
    expect(p?.bandNotes?.date).toBe(inDays(3));
    expect((await personalFromPacks(me, 'song1'))?.notes).toHaveLength(1);
  });

  it("the pack keeps no copy of the band key (nobody read it): refreshing still asks the server, so the phone's kept key stays current (Claude round 8 on #283)", async () => {
    answers.setlist_songs = () => ({ data: [row('ss1', 'song1', 'Paper Boats')], error: null });
    keyAnswer.value = { key: 'KEY-1', denied: false };
    keyAnswer.asks = 0;
    const p = await refreshPack({ userId: me, event: gig() });
    expect(p).toBeTruthy();
    expect(p).not.toHaveProperty('stageKey');
    expect(keyAnswer.asks).toBe(1);
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
    keyAnswer.asks = 0;
    await packOpenedEvent({ userId: me, event: gig({ event_type: 'rehearsal' }), songs, livePackOn: false, fullDue: true, allowFiles: true });
    const p = await readPack(me, 'b1', 'e1');
    expect(p?.songs).toHaveLength(2);
    expect(p?.personal).toEqual({});
    expect(p?.bandNotes).toBeUndefined();
    // No Bluetooth key asked for either (the pack keeps none since #283; the phone's copy is stageBleNative's).
    expect(keyAnswer.asks).toBe(0);
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
    window.dispatchEvent(new Event('online')); // round 8: the next try waits; a reconnect tries at once
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

// Review #273 round 7 (Claude).
describe('round 7 (review #273)', () => {
  const ev = (over: Record<string, unknown> = {}) => ({ eventId: 'e1', bandId: 'b1', date: inDays(3), eventType: 'gig', setlistId: 's1', row: gig(over) });
  const pdf = { id: 'f1', song_id: 'song1', name: 'chart.pdf', kind: 'pdf', ref: 'r', size: 10 };
  const held = async () => {
    answers.setlist_songs = () => ({ data: [row('ss1', 'song1', 'Paper Boats')], error: null });
    await refreshPack({ userId: me, event: gig() });
    expect(await readPack(me, 'b1', 'e1')).not.toBeNull();
  };

  for (const downloads of [true, false]) {
    describe(`privacy: a pack goes at once, not 24 h after (live_pack ${downloads ? 'on' : 'off'})`, () => {
      it('the event was cancelled', async () => {
        await held();
        answers.events = () => ({ data: [{ id: 'e1', status: 'cancelled' }], error: null });
        await runLivePackPrefetch({ userId: me, bandIds: ['b1'], events: [ev()], online: true, downloads });
        expect(await readPack(me, 'b1', 'e1')).toBeNull();
        expect(status.forgotten).toContain('e1');
      });

      it('the event was deleted', async () => {
        await held();
        answers.events = () => ({ data: [], error: null });
        await runLivePackPrefetch({ userId: me, bandIds: ['b1'], events: [], online: true, downloads });
        expect(await readPack(me, 'b1', 'e1')).toBeNull();
      });

      it('I declined it', async () => {
        await held();
        answers.event_members = () => ({ data: [{ event_id: 'e1', status: 'declined' }], error: null });
        await runLivePackPrefetch({ userId: me, bandIds: ['b1'], events: [ev()], online: true, downloads });
        expect(await readPack(me, 'b1', 'e1')).toBeNull();
      });
    });
  }

  it('no answer from the server (offline, an error): nothing is removed on a guess', async () => {
    await held();
    answers.events = () => ({ data: null, error: { message: 'Failed to fetch' } });
    answers.event_members = () => ({ data: null, error: { message: 'Failed to fetch' } });
    await runLivePackPrefetch({ userId: me, bandIds: ['b1'], events: [ev()], online: true, downloads: true });
    expect(await readPack(me, 'b1', 'e1')).not.toBeNull();
    await runLivePackPrefetch({ userId: me, bandIds: ['b1'], events: [ev()], online: false, downloads: true });
    expect(await readPack(me, 'b1', 'e1')).not.toBeNull();
  });

  it('Delete all while a refresh is running: the refresh saves nothing and reports nothing', async () => {
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    answers.setlist_songs = () => gate.then(() => ({ data: [row('ss1', 'song1', 'Paper Boats')], error: null })) as never;
    const run = refreshPack({ userId: me, event: gig() });
    await new Promise((r) => setTimeout(r, 0));
    await deleteAllPacks(me);
    open();
    expect(await run).toBeNull();
    expect(await readPack(me, 'b1', 'e1')).toBeNull();
    expect(status.reported).toEqual([]);
  });

  // Round 8 (item 4) replaced "ready except a dead link": a missing file always keeps the pack partial.
  it('a file of mine that keeps failing: never marked unavailable, the pack stays partial (not "Offline ready")', async () => {
    files.available = true;
    answers.setlist_songs = () => ({ data: [row('ss1', 'song1', 'Paper Boats')], error: null });
    answers.song_personal_files = () => ({ data: [{ ...pdf }], error: null });
    for (let i = 0; i < 4; i++) {
      window.dispatchEvent(new Event('online')); // a reconnect each time: tried each time
      await refreshPack({ userId: me, event: gig(), withFiles: true });
    }
    const p = await readPack(me, 'b1', 'e1');
    expect(files.downloads).toBe(4);
    expect(p?.partial).toBe(true);
    expect(isPackReady(p)).toBe(false);
    expect(unavailablePackFiles(p)).toEqual([]);
  });

  it('a file replaced (new link) is tried again', async () => {
    files.available = true;
    answers.setlist_songs = () => ({ data: [row('ss1', 'song1', 'Paper Boats')], error: null });
    answers.song_personal_files = () => ({ data: [{ ...pdf }], error: null });
    for (let i = 0; i < 3; i++) await refreshPack({ userId: me, event: gig(), withFiles: true });
    answers.song_personal_files = () => ({ data: [{ ...pdf, ref: 'r2' }], error: null });
    files.local = { path: 'live-pack/u1/f1-chart.pdf', directory: 'LIBRARY_NO_CLOUD' };
    await refreshPack({ userId: me, event: gig(), withFiles: true });
    const p = await readPack(me, 'b1', 'e1');
    expect(unavailablePackFiles(p)).toEqual([]);
    expect(p?.personal.song1.files[0].local?.path).toBe('live-pack/u1/f1-chart.pdf');
  });

  it('offline (my files could not be listed): a failed download is not counted as a try', async () => {
    files.available = true;
    answers.setlist_songs = () => ({ data: [row('ss1', 'song1', 'Paper Boats')], error: null });
    answers.song_personal_files = () => ({ data: [{ ...pdf }], error: null });
    await refreshPack({ userId: me, event: gig(), withFiles: true });
    answers.song_personal_files = () => ({ data: null, error: { message: 'Failed to fetch' } });
    for (let i = 0; i < 4; i++) await refreshPack({ userId: me, event: gig(), withFiles: true });
    expect(unavailablePackFiles(await readPack(me, 'b1', 'e1'))).toEqual([]);
  });
});

describe('Codex round (review #273, 11-22)', () => {
  const pdf = { id: 'f1', song_id: 'song1', name: 'chart.pdf', kind: 'pdf', ref: 'r', size: 10 };
  const PATH = 'live-pack/u1/f1-chart.pdf';
  const later = () => new Date(Date.now() + 31 * 60 * 1000);
  const ev = (id: string, date: string, over: Record<string, unknown> = {}) => ({
    eventId: id, bandId: 'b1', date, eventType: 'gig', setlistId: 's1', row: gig({ id, event_date: date, ...over }),
  });
  const withFile = () => {
    files.available = true;
    files.local = { path: PATH, directory: 'LIBRARY_NO_CLOUD' };
    answers.setlist_songs = () => ({ data: [row('ss1', 'song1', 'Paper Boats')], error: null });
    answers.song_personal_files = () => ({ data: [{ ...pdf }], error: null });
  };

  describe('B2: a gig that moved is refreshed on its date on the server', () => {
    for (const downloads of [true, false]) {
      it(`live_pack ${downloads ? 'on' : 'off'}: the server's date, not the one held (nor the app's cached list)`, async () => {
        writeChoice(me, { auto: true, events: [], wifiOnly: false });
        answers.setlist_songs = () => ({ data: [row('ss1', 'song1', 'Paper Boats')], error: null });
        await refreshPack({ userId: me, event: gig() });
        // Moved from +3 to +5 days; the app's list still says +3.
        answers.events = () => ({ data: [{ id: 'e1', status: 'confirmed', event_date: inDays(5), is_recurring: false }], error: null });
        await runLivePackPrefetch({ userId: me, bandIds: ['b1'], events: [ev('e1', inDays(3))], online: true, downloads, now: later() });
        expect((await readPack(me, 'b1', 'e1'))?.event.event_date).toBe(inDays(5));
      });
    }

    it('a recurring rehearsal keeps the occurrence it holds (the series row has its first date)', async () => {
      const reh = gig({ event_type: 'rehearsal', event_date: inDays(-14) });
      answers.setlist_songs = () => ({ data: [row('ss1', 'song1', 'Paper Boats')], error: null });
      answers.rehearsal_notes = () => ({ data: [], error: null });
      await refreshPack({ userId: me, event: reh, occurrenceDate: inDays(1) });
      answers.events = () => ({ data: [{ id: 'e1', status: 'confirmed', event_date: inDays(-14), is_recurring: true }], error: null });
      await runLivePackPrefetch({ userId: me, bandIds: ['b1'], events: [{ ...ev('e1', inDays(1)), eventType: 'rehearsal', row: reh }], online: true, downloads: false, now: later() });
      expect((await readPack(me, 'b1', 'e1'))?.event.event_date).toBe(inDays(1));
    });

    it('no answer from the server: the date held is kept', async () => {
      answers.setlist_songs = () => ({ data: [row('ss1', 'song1', 'Paper Boats')], error: null });
      await refreshPack({ userId: me, event: gig() });
      answers.events = () => ({ data: null, error: { message: 'Failed to fetch' } });
      await runLivePackPrefetch({ userId: me, bandIds: ['b1'], events: [ev('e1', inDays(4))], online: true, downloads: false, now: later() });
      expect((await readPack(me, 'b1', 'e1'))?.event.event_date).toBe(inDays(3));
    });
  });

  describe('B3: two gigs with the same song share one file of mine', () => {
    it('the first pack to go leaves the file for the other', async () => {
      withFile();
      await refreshPack({ userId: me, event: gig({ id: 'e1', event_date: inDays(1) }), withFiles: true });
      await refreshPack({ userId: me, event: gig({ id: 'e2', event_date: inDays(6) }), withFiles: true });
      expect((await readPack(me, 'b1', 'e2'))?.personal.song1.files[0].local?.path).toBe(PATH);
      // e1 is over (24 h after the event): its pack goes, the file stays for e2.
      await sweepPacks(me, ['b1'], new Date(Date.now() + 3 * 24 * 3600 * 1000));
      expect(await readPack(me, 'b1', 'e1')).toBeNull();
      expect(await readPack(me, 'b1', 'e2')).not.toBeNull();
      expect(files.removed).not.toContain(PATH);
      // The last one to use it takes it with it.
      await deleteAllPacks(me);
      expect(files.removed).toContain(PATH);
    });

    it('a refresh that drops the song from one gig leaves the file for the other', async () => {
      withFile();
      await refreshPack({ userId: me, event: gig({ id: 'e1' }), withFiles: true });
      await refreshPack({ userId: me, event: gig({ id: 'e2', event_date: inDays(4), setlist_id: 's2' }), withFiles: true });
      answers.setlist_songs = (q) =>
        q.filters.some((f) => f[2] === 's1') ? { data: [row('ss2', 'song2', 'Harbor Lights')], error: null } : { data: [row('ss1', 'song1', 'Paper Boats')], error: null };
      answers.song_personal_files = (q) => ({ data: (q.filters.find((f) => f[1] === 'song_id')?.[2] as string[]).includes('song1') ? [{ ...pdf }] : [], error: null });
      await refreshPack({ userId: me, event: gig({ id: 'e1' }), withFiles: true });
      expect(files.removed).not.toContain(PATH);
    });

    it('a saved file no longer on the device: downloaded again, never "Offline ready" without it', async () => {
      withFile();
      await refreshPack({ userId: me, event: gig(), withFiles: true });
      expect(isPackReady(await readPack(me, 'b1', 'e1'))).toBe(true);
      files.gone.add(PATH);
      files.local = null; // the new download fails
      await refreshPack({ userId: me, event: gig(), withFiles: true });
      const p = await readPack(me, 'b1', 'e1');
      expect(files.downloads).toBe(2);
      expect(p?.partial).toBe(true);
      expect(isPackReady(p)).toBe(false);
    });
  });
});

describe('Codex round MINOR (EventDetail:464): a song added to a ready setlist', () => {
  it('is not "Offline ready" until its notes and files are fetched; a reorder or a removal keeps ready', async () => {
    answers.setlist_songs = () => ({ data: [row('ss1', 'song1', 'Paper Boats')], error: null });
    await refreshPack({ userId: me, event: gig() });
    expect(isPackReady(await readPack(me, 'b1', 'e1'))).toBe(true);
    // The admin saves the setlist with a second song (EventDetail onSaved).
    await savePackSongs({ userId: me, event: gig(), songs });
    expect((await readPack(me, 'b1', 'e1'))?.partial).toBe(true);
    // The full refresh completes it.
    answers.setlist_songs = () => ({ data: [row('ss1', 'song1', 'Paper Boats'), row('ss2', 'song2', 'Harbor Lights')], error: null });
    await refreshPack({ userId: me, event: gig() });
    expect(isPackReady(await readPack(me, 'b1', 'e1'))).toBe(true);
    // Same songs reordered, or one taken out: nothing new to fetch, still ready.
    await savePackSongs({ userId: me, event: gig(), songs: [songs[1], songs[0]] });
    expect(isPackReady(await readPack(me, 'b1', 'e1'))).toBe(true);
    await savePackSongs({ userId: me, event: gig(), songs: [songs[0]] });
    expect(isPackReady(await readPack(me, 'b1', 'e1'))).toBe(true);
  });
});

// Review #273 round 8 (reviewers' decisions, 11-22).
describe('round 8 (review #273)', () => {
  const PATH = 'live-pack/u1/f1-chart.pdf';
  const pdf = { id: 'f1', song_id: 'song1', name: 'chart.pdf', kind: 'pdf', ref: 'r', size: 10 };
  const later = (min = 31) => new Date(Date.now() + min * 60 * 1000);
  const ev = (id: string, date: string, over: Record<string, unknown> = {}) => ({
    eventId: id, bandId: 'b1', date, eventType: String(over.event_type ?? 'gig'), setlistId: 's1', row: gig({ id, event_date: date, ...over }),
  });
  const confirmed = (q: Q) => ({ data: ((q.filters.find((f) => f[1] === 'id')?.[2] as string[]) ?? []).map((id) => ({ id, status: 'confirmed' })), error: null });
  const songsOk = () => (answers.setlist_songs = () => ({ data: [row('ss1', 'song1', 'Paper Boats')], error: null }));

  describe('1: what the sweep removes is not downloaded again', () => {
    for (const how of ['cancelled', 'hidden'] as const) {
      it(`${how}: not in the same run, nor the next, while it stays so; back when it is on again`, async () => {
        writeChoice(me, { auto: true, events: [], wifiOnly: false });
        songsOk();
        await refreshPack({ userId: me, event: gig() });
        answers.events = () => ({ data: how === 'cancelled' ? [{ id: 'e1', status: 'cancelled' }] : [], error: null });
        await runLivePackPrefetch({ userId: me, bandIds: ['b1'], events: [ev('e1', inDays(3))], online: true });
        expect(await readPack(me, 'b1', 'e1')).toBeNull();
        await runLivePackPrefetch({ userId: me, bandIds: ['b1'], events: [ev('e1', inDays(3))], online: true, now: later() });
        expect(await readPack(me, 'b1', 'e1')).toBeNull();
        answers.events = confirmed;
        await runLivePackPrefetch({ userId: me, bandIds: ['b1'], events: [ev('e1', inDays(3))], online: true, now: later(62) });
        expect(await readPack(me, 'b1', 'e1')).not.toBeNull();
      });
    }

    it('the sweep returns the events it deleted', async () => {
      songsOk();
      await refreshPack({ userId: me, event: gig() });
      await refreshPack({ userId: me, event: gig({ id: 'e2', event_date: inDays(4) }) });
      answers.events = () => ({ data: [{ id: 'e1', status: 'confirmed' }, { id: 'e2', status: 'cancelled' }], error: null });
      expect(await sweepGonePacks(me)).toEqual(['e2']);
    });
  });

  describe('2: no longer in the lineup (bw_live_pack_keep)', () => {
    for (const downloads of [true, false]) {
      it(`removed from the rehearsal: pack, my notes and the Bluetooth key go (live_pack ${downloads ? 'on' : 'off'})`, async () => {
        const reh = gig({ event_type: 'rehearsal' });
        songsOk();
        answers.song_personal_notes = () => ({ data: [{ id: 'n1', song_id: 'song1', anchor: { type: 'song' }, body: 'capo 2' }], error: null });
        answers.rehearsal_notes = () => ({ data: [], error: null });
        await refreshPack({ userId: me, event: reh });
        keysForgot.length = 0;
        expect((await personalFromPacks(me, 'song1'))?.notes).toHaveLength(1);
        expect(await occurrenceNotesFromPack(me, 'e1', inDays(3))).toEqual([]);
        answers['rpc:bw_live_pack_keep'] = () => ({ data: [], error: null });
        await runLivePackPrefetch({ userId: me, bandIds: ['b1'], events: [ev('e1', inDays(3), { event_type: 'rehearsal' })], online: true, downloads });
        expect(await readPack(me, 'b1', 'e1')).toBeNull();
        expect(await personalFromPacks(me, 'song1')).toBeNull();
        expect(await occurrenceNotesFromPack(me, 'e1', inDays(3))).toBeNull();
        // Every key kept for the gig goes (band key, public key, an admin's private one: forgetStageKeys, #288).
        expect(keysForgot).toContain('e1');
        expect(status.forgotten).toContain('e1');
        const keepCall = asked.find((q) => q.table === 'rpc:bw_live_pack_keep');
        expect((keepCall?.filters[0][2] as { p_event_ids: string[] }).p_event_ids).toContain('e1');
      });
    }

    it('dropped from the gig: not downloaded again either', async () => {
      writeChoice(me, { auto: true, events: [], wifiOnly: false });
      songsOk();
      answers['rpc:bw_live_pack_keep'] = () => ({ data: [], error: null });
      await runLivePackPrefetch({ userId: me, bandIds: ['b1'], events: [ev('e1', inDays(3))], online: true });
      expect(await readPack(me, 'b1', 'e1')).toBeNull();
    });

    it('still in the lineup: kept. The function missing (198 not applied): the rule before. Any other error: kept', async () => {
      songsOk();
      await refreshPack({ userId: me, event: gig() });
      answers['rpc:bw_live_pack_keep'] = (q) => ({ data: (q.filters[0][2] as { p_event_ids: string[] }).p_event_ids, error: null });
      expect(await sweepGonePacks(me)).toEqual([]);
      delete answers['rpc:bw_live_pack_keep']; // PGRST202
      expect(await sweepGonePacks(me)).toEqual([]);
      answers['rpc:bw_live_pack_keep'] = () => ({ data: null, error: { code: '42883', message: 'function public.bw_live_pack_keep(uuid[]) does not exist' } });
      expect(await sweepGonePacks(me)).toEqual([]);
      answers['rpc:bw_live_pack_keep'] = () => ({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } });
      expect(await sweepGonePacks(me)).toEqual([]);
      expect(await readPack(me, 'b1', 'e1')).not.toBeNull();
    });

    it('many events: asked in batches of up to 200 (the server answers NULL above 500), and a batch answers for its own ids', async () => {
      songsOk();
      await refreshPack({ userId: me, event: gig() });
      const others = Array.from({ length: 600 }, (_, i) => ({ eventId: `x${i}`, eventType: 'gig' }));
      answers['rpc:bw_live_pack_keep'] = (q) => {
        const ids = (q.filters[0][2] as { p_event_ids: string[] }).p_event_ids;
        return { data: ids.length > 500 ? null : ids.filter((id) => id !== 'e1'), error: null };
      };
      answers.events = (q) => ({ data: ((q.filters.find((f) => f[0] === 'in')?.[2] as string[]) ?? []).map((id) => ({ id, status: 'confirmed' })), error: null });
      expect(await sweepGonePacks(me, undefined, others)).toEqual(['e1']);
      const calls = asked.filter((q) => q.table === 'rpc:bw_live_pack_keep').map((q) => (q.filters[0][2] as { p_event_ids: string[] }).p_event_ids.length);
      expect(calls.length).toBeGreaterThan(1);
      expect(Math.max(...calls)).toBeLessThanOrEqual(200);
      expect(calls.reduce((a, b) => a + b, 0)).toBe(601);
    });

    it('one batch without an answer: nothing is deleted on the lineup rule', async () => {
      songsOk();
      await refreshPack({ userId: me, event: gig() });
      const others = Array.from({ length: 300 }, (_, i) => ({ eventId: `x${i}`, eventType: 'gig' }));
      let n = 0;
      answers['rpc:bw_live_pack_keep'] = () => (n++ === 1 ? { data: null, error: { code: '57014', message: 'timeout' } } : { data: [], error: null });
      answers.events = (q) => ({ data: ((q.filters.find((f) => f[0] === 'in')?.[2] as string[]) ?? []).map((id) => ({ id, status: 'confirmed' })), error: null });
      expect(await sweepGonePacks(me, undefined, others)).toEqual([]);
      expect(await readPack(me, 'b1', 'e1')).not.toBeNull();
    });
  });

  it("cancelled reads as the server reads it: 'Cancelled ' and 'canceled' go too (198 not applied)", async () => {
    for (const status of ['Cancelled ', 'canceled']) {
      songsOk();
      await refreshPack({ userId: me, event: gig() });
      answers.events = () => ({ data: [{ id: 'e1', status }], error: null });
      expect(await sweepGonePacks(me)).toEqual(['e1']);
    }
  });

  it('4: a failed file waits (backoff) between automatic tries; a reconnect or a refresh tries at once; never ready without it', async () => {
    writeChoice(me, { auto: true, events: [], wifiOnly: false });
    files.available = true;
    songsOk();
    answers.song_personal_files = () => ({ data: [{ ...pdf }], error: null });
    await refreshPack({ userId: me, event: gig(), withFiles: true });
    expect(files.downloads).toBe(1);
    // Opened again a moment later: waits.
    await refreshPack({ userId: me, event: gig(), withFiles: true });
    expect(files.downloads).toBe(1);
    expect(isPackReady(await readPack(me, 'b1', 'e1'))).toBe(false);
    // Back online: tried at once.
    window.dispatchEvent(new Event('online'));
    await refreshPack({ userId: me, event: gig(), withFiles: true });
    expect(files.downloads).toBe(2);
    // App open / resume (a refresh): tried at once, and this time it comes down.
    files.local = { path: PATH, directory: 'LIBRARY_NO_CLOUD' };
    await runLivePackPrefetch({ userId: me, bandIds: ['b1'], events: [ev('e1', inDays(3))], online: true });
    expect(files.downloads).toBe(3);
    expect(isPackReady(await readPack(me, 'b1', 'e1'))).toBe(true);
  });

  it('4: an old pack "ready except" a dead link (round 7) is not "Offline ready"', () => {
    const p = { v: 1 as const, eventId: 'e1', bandId: 'b1', userId: me, setlistId: 's1', event: gig() as never, songs, version: 'v', savedAt: '', expiresAt: '',
      personal: { song1: { notes: [], files: [{ ...pdf, unavailable: true, tries: 3 }] } } };
    expect(isPackReady(p)).toBe(false);
  });

  it('5: notes that fail to load in a refresh turn a full pack partial', async () => {
    songsOk();
    await refreshPack({ userId: me, event: gig() });
    expect(isPackReady(await readPack(me, 'b1', 'e1'))).toBe(true);
    answers.song_personal_notes = () => ({ data: null, error: { code: '500', message: 'Internal Server Error' } });
    await refreshPack({ userId: me, event: gig() });
    expect((await readPack(me, 'b1', 'e1'))?.partial).toBe(true);
  });

  it('5: band notes that fail to load turn a full rehearsal pack partial', async () => {
    const reh = gig({ event_type: 'rehearsal' });
    songsOk();
    answers.rehearsal_notes = () => ({ data: [], error: null });
    await refreshPack({ userId: me, event: reh });
    expect(isPackReady(await readPack(me, 'b1', 'e1'))).toBe(true);
    answers.rehearsal_notes = () => ({ data: null, error: { code: '500', message: 'Internal Server Error' } });
    await refreshPack({ userId: me, event: reh });
    expect((await readPack(me, 'b1', 'e1'))?.partial).toBe(true);
  });

  it('6: a file another pack removed meanwhile is not saved as on the device', async () => {
    files.available = true;
    files.removeIsReal = true;
    files.local = { path: PATH, directory: 'LIBRARY_NO_CLOUD' };
    songsOk();
    answers.song_personal_files = (q) => ({ data: (q.filters.find((f) => f[1] === 'song_id')?.[2] as string[]).includes('song1') ? [{ ...pdf }] : [], error: null });
    // e1 (gig, setlist s1) holds the file.
    await refreshPack({ userId: me, event: gig(), withFiles: true });
    // e2 (rehearsal, setlist s2) gets the same file, then waits on its band notes.
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    answers.rehearsal_notes = () => gate.then(() => ({ data: [], error: null })) as never;
    answers.setlist_songs = (q) =>
      q.filters.some((f) => f[2] === 's1') ? { data: [row('ss2', 'song2', 'Harbor Lights')], error: null } : { data: [row('ss1', 'song1', 'Paper Boats')], error: null };
    const b = refreshPack({ userId: me, event: gig({ id: 'e2', event_type: 'rehearsal', setlist_id: 's2', event_date: inDays(4) }), withFiles: true });
    for (let i = 0; i < 50 && !asked.some((q) => q.table === 'rehearsal_notes'); i++) await new Promise((r) => setTimeout(r, 0));
    // Meanwhile e1 drops the song: no saved pack points to the file, so it goes.
    await refreshPack({ userId: me, event: gig(), withFiles: true });
    expect(files.gone.has(PATH)).toBe(true);
    open();
    await b;
    const p2 = await readPack(me, 'b1', 'e2');
    expect(p2?.personal.song1.files[0].local).toBeUndefined();
    expect(isPackReady(p2)).toBe(false);
  });

  it('7: the date on the server is coalesce(event_date, date)', async () => {
    songsOk();
    await refreshPack({ userId: me, event: gig() });
    answers.events = () => ({ data: [{ id: 'e1', status: 'confirmed', event_date: null, date: inDays(5), is_recurring: false }], error: null });
    await runLivePackPrefetch({ userId: me, bandIds: ['b1'], events: [ev('e1', inDays(3))], online: true, downloads: false, now: later() });
    expect((await readPack(me, 'b1', 'e1'))?.event.event_date).toBe(inDays(5));
    // A row with only `date` still makes a pack.
    await savePackSongs({ userId: me, event: gig({ id: 'e3', event_date: undefined, date: inDays(2) }), songs });
    expect((await readPack(me, 'b1', 'e3'))?.event.event_date).toBe(inDays(2));
  });
});

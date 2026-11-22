import { describe, expect, it } from 'vitest';
import {
  LIVE_PACK_WINDOW_DAYS,
  eventEndsAt,
  isPackExpired,
  legacyPacksFrom,
  packEventFrom,
  packExpiresAt,
  packRowFromItem,
  packVersion,
  prefetchCandidates,
  songFromRow,
  type LivePackCandidate,
} from '../livePack';

const row = (over: Record<string, unknown> = {}, song: Record<string, unknown> = {}) => ({
  id: 'ss-1',
  song_id: 'song-1',
  set_number: 1,
  position: 1,
  song: {
    title: 'Harbor Lights',
    artist: 'The Ferrymen',
    duration_seconds: 245,
    key: 'Am',
    bpm: 96,
    lyrics: '# Verse\n[Am]Lights on the [F]water',
    chord_chart: null,
    audio_url: 'sb://song-files/b/audio/harbor.mp3',
    updated_at: '2026-11-20T18:02:00.000Z',
    ...song,
  },
  ...over,
});

describe('songFromRow', () => {
  it('maps a setlist row the way Stage shows it', () => {
    expect(songFromRow(row(), 'Unknown Song')).toEqual({
      id: 'ss-1',
      songId: 'song-1',
      setNumber: 1,
      title: 'Harbor Lights',
      artist: 'The Ferrymen',
      duration: '4:05',
      key: 'Am',
      bpm: 96,
      lyrics: '# Verse\n[Am]Lights on the [F]water',
      chart: undefined,
      audio: 'sb://song-files/b/audio/harbor.mp3',
      updatedAt: '2026-11-20T18:02:00.000Z',
    });
  });

  it('falls back to the given title and leaves bad numbers out', () => {
    const s = songFromRow(row({}, { title: null, bpm: 0, duration_seconds: -1 }), 'Unknown Song');
    expect(s.title).toBe('Unknown Song');
    expect(s.bpm).toBeUndefined();
    expect(s.duration).toBeUndefined();
  });

  it('carries the live fields of the other parts when the columns exist', () => {
    const s = songFromRow(
      row(
        { vocal_parts: { bv: ['u2'] } },
        {
          time_signature: '6/8',
          count_in_bars: 2,
          pickup_beats: 1,
          backing_track: true,
          line_timing: { hash: 'abc', beats: [0, 8] },
          vocal_parts: { v2: ['u1'] },
        },
      ),
      'Unknown Song',
    );
    expect(s).toMatchObject({
      timeSignature: '6/8',
      countInBars: 2,
      pickupBeats: 1,
      backingTrack: true,
      lineTiming: { hash: 'abc', beats: [0, 8] },
      vocalParts: { v2: ['u1'] },
      setlistVocalParts: { bv: ['u2'] },
    });
  });

  it('ignores live fields of the wrong shape (columns not there yet, or bad data)', () => {
    const s = songFromRow(
      row({ vocal_parts: 'x' }, { time_signature: 'fast', count_in_bars: 'two', pickup_beats: -3, backing_track: 'yes', line_timing: 5, vocal_parts: [] }),
      'Unknown Song',
    );
    expect(s.timeSignature).toBeUndefined();
    expect(s.countInBars).toBeUndefined();
    expect(s.pickupBeats).toBeUndefined();
    expect(s.backingTrack).toBeUndefined();
    expect(s.lineTiming).toBeUndefined();
    expect(s.vocalParts).toBeUndefined();
    expect(s.setlistVocalParts).toBeUndefined();
  });
});

describe('packEventFrom', () => {
  it('keeps the basics and never the money, the client or the contract', () => {
    const e = packEventFrom({
      id: 'e1',
      band_id: 'b1',
      title: 'The Loft, Brooklyn',
      event_type: 'gig',
      status: 'confirmed',
      event_date: '2026-11-28',
      start_time: '21:00',
      end_time: '23:30',
      load_in_time: '18:00',
      soundcheck_time: '19:00',
      venue_name: 'The Loft',
      venue_city: 'Brooklyn',
      venue_address: '12 Water St',
      setlist_id: 's1',
      fee: 1200,
      deposit_amount: 300,
      deposit_paid: true,
      payment_status: 'paid',
      client_name: 'Jordan Lee',
      client_email: 'jordan@example.com',
      client_phone: '+1 555',
      contract_url: 'sb://contracts/x.pdf',
      internal_notes: 'secret',
    });
    expect(e).toEqual({
      id: 'e1',
      band_id: 'b1',
      title: 'The Loft, Brooklyn',
      event_type: 'gig',
      status: 'confirmed',
      event_date: '2026-11-28',
      start_time: '21:00',
      end_time: '23:30',
      load_in_time: '18:00',
      soundcheck_time: '19:00',
      venue_name: 'The Loft',
      venue_city: 'Brooklyn',
      venue_address: '12 Water St',
      setlist_id: 's1',
    });
    expect(JSON.stringify(e)).not.toMatch(/1200|300|Jordan|example\.com|contract|secret|paid"/);
  });
});

describe('packVersion', () => {
  const songs = [
    { id: 'a', songId: 's1', title: 'One', updatedAt: '2026-11-20T10:00:00Z' },
    { id: 'b', songId: 's2', title: 'Two', updatedAt: '2026-11-20T11:00:00Z' },
  ];
  const personal = { s1: { notes: [{ id: 'n1', updated_at: '2026-11-20T12:00:00Z' }], files: [] } };

  it('is the same for the same content', () => {
    expect(packVersion(songs, personal)).toBe(packVersion(songs.map((s) => ({ ...s })), { ...personal }));
  });

  it('changes when the order, a song or a personal note changes', () => {
    const v = packVersion(songs, personal);
    expect(packVersion([songs[1], songs[0]], personal)).not.toBe(v);
    expect(packVersion([songs[0], { ...songs[1], updatedAt: '2026-11-21T09:00:00Z' }], personal)).not.toBe(v);
    expect(packVersion(songs, { s1: { notes: [{ id: 'n1', updated_at: '2026-11-21T09:00:00Z' }], files: [] } })).not.toBe(v);
  });
});

describe('expiry', () => {
  it('ends at the end time, or the end of the day with none', () => {
    expect(eventEndsAt({ event_date: '2026-11-28', start_time: '21:00', end_time: '23:30' }).getTime()).toBe(
      new Date(2026, 10, 28, 23, 30).getTime(),
    );
    expect(eventEndsAt({ event_date: '2026-11-28', start_time: '21:00' }).getTime()).toBe(new Date(2026, 10, 28, 23, 59).getTime());
  });

  it('a show past midnight ends the next day', () => {
    expect(eventEndsAt({ event_date: '2026-11-28', start_time: '22:00', end_time: '01:30' }).getTime()).toBe(
      new Date(2026, 10, 29, 1, 30).getTime(),
    );
  });

  it('a pack goes 24 hours after the event ends', () => {
    const at = packExpiresAt({ event_date: '2026-11-28', start_time: '21:00', end_time: '23:30' });
    expect(new Date(at).getTime()).toBe(new Date(2026, 10, 29, 23, 30).getTime());
    expect(isPackExpired({ expiresAt: at }, new Date(2026, 10, 29, 23, 0))).toBe(false);
    expect(isPackExpired({ expiresAt: at }, new Date(2026, 10, 29, 23, 31))).toBe(true);
  });
});

describe('prefetchCandidates', () => {
  const now = new Date(2026, 10, 21, 15, 0);
  const ev = (over: Partial<LivePackCandidate>): LivePackCandidate => ({
    eventId: 'e',
    bandId: 'b1',
    date: '2026-11-24',
    eventType: 'gig',
    setlistId: 's',
    ...over,
  });

  it('takes band gigs and rehearsals with a setlist in the next 7 days', () => {
    const list = [
      ev({ eventId: 'today', date: '2026-11-21' }),
      ev({ eventId: 'rehearsal', eventType: 'rehearsal', date: '2026-11-23' }),
      ev({ eventId: 'day7', date: '2026-11-28' }),
      ev({ eventId: 'day8', date: '2026-11-29' }),
      ev({ eventId: 'past', date: '2026-11-20' }),
      ev({ eventId: 'quote', eventType: 'quote' }),
      ev({ eventId: 'nosetlist', setlistId: undefined }),
      ev({ eventId: 'personal', bandId: undefined }),
      ev({ eventId: 'declined', declined: true }),
      ev({ eventId: 'nodate', date: '' }),
    ];
    expect(prefetchCandidates(list, now).map((e) => e.eventId)).toEqual(['today', 'rehearsal', 'day7']);
    expect(LIVE_PACK_WINDOW_DAYS).toBe(7);
  });

  it('lists a recurring event once (its next occurrence)', () => {
    const list = [ev({ eventId: 'weekly', date: '2026-11-27' }), ev({ eventId: 'weekly', date: '2026-11-22' })];
    expect(prefetchCandidates(list, now)).toEqual([ev({ eventId: 'weekly', date: '2026-11-22' })]);
  });
});

describe('legacyPacksFrom', () => {
  it('moves each old setlist copy to the events that use it, and drops the rest', () => {
    const legacy = { 's1': [{ title: 'Paper Boats', lyrics: 'x' }], 'gone': [{ title: 'Old' }] };
    const events = [
      { eventId: 'e1', bandId: 'b1', setlistId: 's1', date: '2026-11-24', eventType: 'gig' },
      { eventId: 'e2', bandId: 'b1', setlistId: 's2', date: '2026-11-25', eventType: 'gig' },
    ];
    expect(legacyPacksFrom(legacy, events)).toEqual([{ eventId: 'e1', bandId: 'b1', setlistId: 's1', songs: [{ title: 'Paper Boats', lyrics: 'x' }] }]);
  });
});

describe('packRowFromItem', () => {
  it('turns the event on screen into the pack row (no time when none was set)', () => {
    expect(
      packRowFromItem({
        eventId: 'e1',
        band_id: 'b1',
        title: 'Weekly rehearsal',
        eventType: 'rehearsal',
        status: 'REHEARSAL',
        date: '2026-11-24',
        time: '19:00',
        timeSet: false,
        endTime: '22:00',
        venueName: 'Rehearsal Room 4, Bushwick',
        venueCity: 'Brooklyn',
        setlistId: 's1',
        price: '900',
        clientName: 'Jordan Lee',
      } as Parameters<typeof packRowFromItem>[0]),
    ).toEqual({
      id: 'e1',
      band_id: 'b1',
      title: 'Weekly rehearsal',
      event_type: 'rehearsal',
      event_date: '2026-11-24',
      start_time: undefined,
      end_time: '22:00',
      load_in_time: undefined,
      soundcheck_time: undefined,
      venue_name: 'Rehearsal Room 4, Bushwick',
      venue_city: 'Brooklyn',
      venue_address: undefined,
      setlist_id: 's1',
    });
  });
});

describe('pack size on the consent sheet', () => {
  it('counts the songs’ text, shown in MB with one decimal, never 0', async () => {
    const { estimatePackBytes, packSizeMb } = await import('../livePack');
    const song = { id: 's', songId: 'x', setNumber: 1, title: 'Empire State of Mind', lyrics: 'x'.repeat(4000) } as never;
    const bytes = estimatePackBytes([song, song]);
    expect(bytes).toBeGreaterThan(8000);
    expect(packSizeMb(bytes)).toBe('0.1');
    expect(packSizeMb(2_340_000)).toBe('2.3');
  });
});

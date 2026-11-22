import { describe, expect, it } from 'vitest';
import { replacedFiles, songCreatePayload, songIdentity, songUpdatePayload, type SongFormValues } from '../songPayload';

const opened: SongFormValues = {
  title: 'Paper Boats',
  artist: 'The Puddles',
  genres: ['Funk'],
  audioUrl: 'song-files:band/audio/a.mp3',
  chartUrl: 'song-files:band/chart/c.pdf',
  youtubeUrl: 'https://youtube.com/watch?v=x',
  notes: 'Slow intro',
  lyrics: 'La la',
  bpm: '96',
  key: 'Am',
  durationSeconds: 245,
};

describe('songPayload', () => {
  it('sends nothing when nothing changed', () => {
    expect(songUpdatePayload(opened, { ...opened })).toEqual({});
  });

  it('clears emptied fields with null (not left out)', () => {
    const changes = songUpdatePayload(opened, {
      ...opened,
      artist: '  ',
      genres: [],
      audioUrl: null,
      youtubeUrl: null,
      notes: '',
      lyrics: '',
      bpm: '',
      key: '',
      durationSeconds: 0,
    });
    expect(changes).toEqual({
      artist: null,
      genre: null,
      audio_url: null,
      youtube_url: null,
      notes: null,
      lyrics: null,
      bpm: null,
      key: null,
      duration_seconds: null,
    });
    // Title and chart were not touched: not sent, so a bandmate's change to them stays.
    expect('title' in changes).toBe(false);
    expect('chart_url' in changes).toBe(false);
  });

  it('sends only the changed field', () => {
    expect(songUpdatePayload(opened, { ...opened, bpm: '100' })).toEqual({ bpm: 100 });
    expect(songUpdatePayload(opened, { ...opened, lyrics: 'La la\n\n' })).toEqual({});
  });

  it('sends the chord chart only when it was changed in the form', () => {
    expect(songUpdatePayload(opened, { ...opened, chordChart: { value: null } })).toEqual({ chord_chart: null });
  });

  it('lists stored files the song no longer uses', () => {
    const changes = songUpdatePayload(opened, { ...opened, audioUrl: null, chartUrl: 'song-files:band/chart/new.pdf' });
    expect(replacedFiles(opened, changes)).toEqual(['song-files:band/audio/a.mp3', 'song-files:band/chart/c.pdf']);
    expect(replacedFiles(opened, songUpdatePayload(opened, { ...opened, bpm: '1' }))).toEqual([]);
  });

  it('creates with the filled-in fields only', () => {
    expect(
      songCreatePayload({ ...opened, artist: '', genres: [], audioUrl: null, chartUrl: null, youtubeUrl: null, notes: '', lyrics: '', bpm: '', key: '', durationSeconds: 0 }),
    ).toEqual({ title: 'Paper Boats' });
  });

  it('spots the same song whatever the case, accents and punctuation', () => {
    expect(songIdentity('Supérstition!', 'Stevie  Wonder')).toBe(songIdentity('superstition', 'stevie wonder'));
    expect(songIdentity('Superstition', 'Stevie Wonder')).not.toBe(songIdentity('Superstition', 'Beck'));
  });
});

describe('songPayload: live mode fields (171)', () => {
  it('a new song at the defaults sends none of them (saves before 171 is applied)', () => {
    const p = songCreatePayload({ ...opened, timeSignature: '', countInBars: 1, pickupBeats: 0, backingTrack: false });
    for (const k of ['time_signature', 'count_in_bars', 'pickup_beats', 'backing_track']) expect(p).not.toHaveProperty(k);
  });

  it('a new song sends the ones set', () => {
    const p = songCreatePayload({ ...opened, timeSignature: ' 6 / 8 ', countInBars: 2, pickupBeats: 1, backingTrack: true });
    expect(p).toMatchObject({ time_signature: '6/8', count_in_bars: 2, pickup_beats: 1, backing_track: true });
  });

  it('an edit sends only what changed, and an unknown time signature as null', () => {
    const base = { ...opened, timeSignature: '3/4', countInBars: 1, pickupBeats: 0, backingTrack: false };
    expect(songUpdatePayload(base, { ...base })).toEqual({});
    expect(songUpdatePayload(base, { ...base, countInBars: 2, timeSignature: 'waltz' })).toEqual({ count_in_bars: 2, time_signature: null });
    // A form opened without them (older code path) is the same as the defaults.
    expect(songUpdatePayload(opened, { ...opened, timeSignature: '', countInBars: 1, pickupBeats: 0, backingTrack: false })).toEqual({});
  });
});

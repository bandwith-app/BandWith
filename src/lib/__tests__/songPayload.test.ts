import { describe, expect, it } from 'vitest';
import { lyricsTooLong, MAX_LYRICS_LENGTH, replacedFiles, songCreatePayload, songIdentity, songUpdatePayload, type SongFormValues } from '../songPayload';

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

describe('long lyrics (audit 09 #7)', () => {
  it('are saved whole, never cut at the limit', () => {
    const medley = `${'Uptown lights over the river\n'.repeat(800)}The very last line`;
    expect(medley.length).toBeGreaterThan(MAX_LYRICS_LENGTH);
    expect(songCreatePayload({ ...opened, lyrics: medley }).lyrics).toBe(medley);
    expect(songUpdatePayload(opened, { ...opened, lyrics: `${medley}\n\n` }).lyrics).toBe(medley);
  });

  it('JSON lyrics keep their closing brackets', () => {
    const json = JSON.stringify({ lines: Array.from({ length: 1200 }, (_, i) => `Line ${i} of the long version`) });
    expect(json.length).toBeGreaterThan(MAX_LYRICS_LENGTH);
    expect(() => JSON.parse(songCreatePayload({ ...opened, lyrics: json }).lyrics as string)).not.toThrow();
  });

  it('too long is known before saving', () => {
    expect(lyricsTooLong('a'.repeat(MAX_LYRICS_LENGTH))).toBe(false);
    expect(lyricsTooLong(`${'a'.repeat(MAX_LYRICS_LENGTH)}\n\n  `)).toBe(false);
    expect(lyricsTooLong('a'.repeat(MAX_LYRICS_LENGTH + 1))).toBe(true);
  });
});

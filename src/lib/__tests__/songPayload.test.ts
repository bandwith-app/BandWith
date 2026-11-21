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

describe('songPayload: the score (sheet music, Phase 1)', () => {
  const SCORE = 'sb://song-files/band/score/s-tune.mxl';
  it('saves a new score on a new song, and sends no score_path for a song without one', () => {
    expect(songCreatePayload({ ...opened, scoreUrl: SCORE }).score_path).toBe(SCORE);
    expect('score_path' in songCreatePayload(opened)).toBe(false);
  });

  it('edits send score_path only when the score changed (added, replaced or removed)', () => {
    expect('score_path' in songUpdatePayload(opened, { ...opened, bpm: '100' })).toBe(false);
    expect(songUpdatePayload(opened, { ...opened, scoreUrl: SCORE })).toEqual({ score_path: SCORE });
    const withScore = { ...opened, scoreUrl: SCORE };
    expect(songUpdatePayload(withScore, { ...withScore, scoreUrl: null })).toEqual({ score_path: null });
  });

  it('a replaced or removed score is removed from storage after the save', () => {
    const withScore = { ...opened, scoreUrl: SCORE };
    const changes = songUpdatePayload(withScore, { ...withScore, scoreUrl: 'sb://song-files/band/score/new.mxl' });
    expect(replacedFiles(withScore, changes)).toEqual([SCORE]);
  });
});


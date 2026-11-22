import { describe, it, expect } from 'vitest';
import sql171 from '../../../../supabase/migrations/171_song_tempo_count_in.sql?raw';
import { stageSongSelect, isMissingColumn, liveSongFields } from '../../stageSongs';

const sql = sql171.replace(/--.*$/gm, '');
const LIVE = ['time_signature', 'count_in_bars', 'pickup_beats', 'backing_track', 'line_timing'];

describe('171 live mode: tempo and count-in', () => {
  it('adds the song columns with safe checks and defaults', () => {
    for (const c of LIVE) expect(sql).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${c}\\b`));
    expect(sql).toMatch(/count_in_bars smallint NOT NULL DEFAULT 1/);
    expect(sql).toMatch(/pickup_beats smallint NOT NULL DEFAULT 0/);
    expect(sql).toMatch(/backing_track boolean NOT NULL DEFAULT false/);
    expect(sql).toMatch(/pg_column_size\(line_timing\) <= 65536/);
    expect(sql).toMatch(/count_in_style text NOT NULL DEFAULT 'down'[\s\S]*?IN \('down', 'up'\)/);
  });

  it('grants every new readable column (column grants since 080 / 132), nothing to anon', () => {
    const songs = sql.match(/GRANT SELECT \(([^)]+)\)[\s\S]*?ON public\.songs TO authenticated/);
    expect(songs?.[1].split(',').map((c) => c.trim()).sort()).toEqual([...LIVE].sort());
    expect(sql).toMatch(/GRANT SELECT \(count_in_style\), UPDATE \(count_in_style\) ON public\.bands TO authenticated/);
    expect(sql).not.toMatch(/TO anon/);
    expect(sql).toMatch(/^\s*BEGIN;/m);
    expect(sql).toMatch(/^\s*COMMIT;/m);
  });

  it('live mode asks for exactly these columns, and again without them before 171 is applied', () => {
    for (const c of LIVE) expect(stageSongSelect(true)).toContain(c);
    for (const c of LIVE) expect(stageSongSelect(false)).not.toContain(c);
    expect(isMissingColumn({ code: '42703', message: 'column songs.time_signature does not exist' })).toBe(true);
    expect(isMissingColumn({ code: 'PGRST301', message: 'JWT expired' })).toBe(false);
    expect(isMissingColumn(null)).toBe(false);
  });

  it('reads the joined row into the live fields, defaults left out', () => {
    expect(liveSongFields({ time_signature: '6/8', count_in_bars: 2, pickup_beats: 1, backing_track: true, duration_seconds: 200 })).toEqual({
      timeSignature: '6/8', countInBars: 2, pickupBeats: 1, backingTrack: true, durationSeconds: 200,
    });
    expect(liveSongFields({ time_signature: 'waltz', count_in_bars: 1, pickup_beats: 0, backing_track: false, line_timing: { v: 9 } })).toEqual({});
  });
});

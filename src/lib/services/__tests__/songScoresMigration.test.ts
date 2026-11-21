import { describe, expect, it } from 'vitest';
import sql170 from '../../../../supabase/migrations/170_song_scores.sql?raw';
import sql171 from '../../../../supabase/migrations/171_song_scores_grant.sql?raw';
import sql108 from '../../../../supabase/migrations/108_song_suggestions.sql?raw';
import { SCORE_MIME_MXL, SCORE_MIME_XML } from '@/lib/score';

/**
 * 170 + 171: song scores (sheet music plan §4.1). Not applied with this
 * change: the owner sees the preview first. The forced-abort dry run checks
 * the behaviour; these keep the files from drifting.
 */
const noComments = (sql: string) => sql.replace(/--.*$/gm, '');
const fn = (src: string, name: string) => {
  const s = noComments(src);
  const i = s.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  if (i < 0) throw new Error(`no ${name}`);
  return s.slice(i, s.indexOf('$$;', s.indexOf('AS $$', i))).replace(/\s+/g, ' ');
};

describe('170_song_scores', () => {
  const sql = noComments(sql170);
  it('one transaction (stripped for the dry run)', () => {
    expect(sql.match(/^BEGIN;/gm)).toHaveLength(1);
    expect(sql.match(/^COMMIT;/gm)).toHaveLength(1);
  });

  it('adds songs.score_path, only song-files references', () => {
    expect(sql).toMatch(/ALTER TABLE public\.songs ADD COLUMN IF NOT EXISTS score_path text;/);
    expect(sql).toMatch(/score_path LIKE 'sb:\/\/song-files\/%'/);
  });

  it('lets the bucket take exactly the types the app uploads scores with, appended', () => {
    expect(sql).toContain(`'${SCORE_MIME_XML}'`);
    expect(sql).toContain(`'${SCORE_MIME_MXL}'`);
    expect(sql).toMatch(/coalesce\(allowed_mime_types, '\{\}'\) \|\|/);
    expect(sql).toMatch(/WHERE id = 'song-files'/);
  });

  it("a member's suggested song carries a score only from their suggestions folder", () => {
    expect(sql).toMatch(/score_path LIKE 'sb:\/\/song-files\/' \|\| band_id::text \|\| '\/suggestions\/' \|\| auth\.uid\(\)::text \|\| '\/%'/);
  });

  it('the suggestion RPCs are 108 plus the score file, nothing else', () => {
    for (const name of ['bw_review_song_suggestion', 'bw_withdraw_song_suggestion']) {
      const before = fn(sql108, name)
        .replace(/audio_url, chart_url INTO s/g, 'audio_url, chart_url, score_path INTO s')
        .replace(/ARRAY\[s\.audio_url, s\.chart_url\]/g, 'ARRAY[s.audio_url, s.chart_url, s.score_path]');
      expect(fn(sql170, name)).toBe(before);
    }
  });
});

describe('171_song_scores_grant', () => {
  it('grants the column to signed-in users, never to anon', () => {
    const sql = noComments(sql171);
    expect(sql).toMatch(/GRANT SELECT \(score_path\), INSERT \(score_path\), UPDATE \(score_path\) ON public\.songs TO authenticated;/);
    expect(sql).not.toMatch(/TO anon/);
  });
});

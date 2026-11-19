import { describe, expect, it } from 'vitest';
import sql163 from '../../../../supabase/migrations/163_quote_made_with.sql?raw';
import sql099 from '../../../../supabase/migrations/099_quote_client_link.sql?raw';
import { QUOTE_STRINGS } from '../../../quote/strings';

/**
 * 163: the "Made with BandWith" mark on the client's quote page (paid plans
 * §4.3). Decided on the server, off while the plans are off. The rollback
 * dry run checks the behaviour; these keep the file from drifting.
 */
const noComments = (sql: string) => sql.replace(/--.*$/gm, '');
const sql = noComments(sql163);
const body = (src: string) => {
  const i = src.indexOf('CREATE OR REPLACE FUNCTION public.bw_quote_link_view');
  return noComments(src.slice(i, src.indexOf('$$;', src.indexOf('AS $$', i)))).replace(/\s+/g, ' ');
};

describe('163_quote_made_with', () => {
  it('one transaction, no data written, no switch turned on', () => {
    expect(sql.match(/^BEGIN;/gm)).toHaveLength(1);
    expect(sql.match(/^COMMIT;/gm)).toHaveLength(1);
    expect(sql).not.toMatch(/INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM/i);
  });
  it('the mark needs the plans on and branding = 0 on the band\'s plan', () => {
    expect(sql).toMatch(/key = 'plans_enforced' AND s\.enabled IS TRUE/);
    expect(sql).toMatch(/l\.key = 'branding'/);
    expect(sql).toMatch(/l\.value = 0/);
    expect(sql).toMatch(/COALESCE\([\s\S]*, false\)/);
  });
  it('the helper is internal; the page RPC keeps its grants', () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.bw_band_shows_mark\(uuid\) FROM PUBLIC, anon, authenticated;/);
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.bw_band_shows_mark/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.bw_quote_link_view\(text\) FROM PUBLIC;/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.bw_quote_link_view\(text\) TO anon, authenticated;/);
  });
  it('the page RPC is 099 plus made_with, nothing else', () => {
    const before = body(sql099);
    const after = body(sql163).replace(/, 'made_with', public\.bw_band_shows_mark\(v_link\.band_id\)/, '');
    expect(after).toBe(before);
  });
  it('the page has the words in every language', () => {
    for (const lang of ['en', 'it', 'es', 'fr', 'de', 'pt'] as const) {
      expect(QUOTE_STRINGS[lang].madeWith).toMatch(/BandWith/);
    }
  });
});

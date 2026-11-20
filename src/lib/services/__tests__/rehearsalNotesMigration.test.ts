import { describe, it, expect, vi } from 'vitest';
import sql132 from '../../../../supabase/migrations/132_rehearsal_notes.sql?raw';
import sql167 from '../../../../supabase/migrations/167_rehearsal_note_line.sql?raw';
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
import { NOTE_COLUMNS, ASSIGNEE_COLUMNS } from '../rehearsalNotes';

/** Static guards on 132 (the rollback-only dry run checks the behaviour). */
const sql = sql132.replace(/--.*$/gm, '');
const grantList = (kind: string, table: string) => {
  const m = sql.match(new RegExp(`GRANT ${kind} \\(([^)]+)\\)\\s+ON public\\.${table} TO authenticated`));
  if (!m) throw new Error(`no GRANT ${kind} on ${table}`);
  return m[1].split(',').map((c) => c.trim()).sort();
};
const cols = (list: string) => list.split(',').map((c) => c.trim()).sort();

describe('167 a note on one line', () => {
  const s = sql167.replace(/--.*$/gm, '');
  it('a short optional column, nothing for anon', () => {
    expect(s).toMatch(/ADD COLUMN IF NOT EXISTS line text/);
    expect(s).toMatch(/char_length\(line\) <= 200/);
    expect(s).not.toMatch(/TO anon/);
  });
});

describe('132 rehearsal notes', () => {
  it('RLS on both tables; nothing for anon', () => {
    for (const t of ['rehearsal_notes', 'rehearsal_note_assignees']) {
      expect(sql).toMatch(new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`));
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON public\\.${t} FROM PUBLIC, anon, authenticated`));
    }
    expect(sql).not.toMatch(/TO anon/);
  });

  it('a mark needs nothing else; a note needs a preset or text', () => {
    expect(sql).toMatch(/status = 'marked' OR preset IS NOT NULL OR body IS NOT NULL/);
  });

  it('the band reads; admins and the author write', () => {
    expect(sql).toMatch(/rehearsal_notes_member_select[\s\S]*?bw_is_band_member\(band_id\)/);
    expect(sql).toMatch(/rehearsal_notes_insert[\s\S]*?created_by = auth\.uid\(\)/);
    expect(sql).toMatch(/rehearsal_notes_update[\s\S]*?bw_is_band_admin\(band_id\) OR created_by = auth\.uid\(\)/);
  });

  it('members assign only themselves (Q-A1)', () => {
    expect(sql).toMatch(/rehearsal_note_assignees_insert[\s\S]*?user_id = auth\.uid\(\)/);
  });

  it('live sync through Realtime for notes', () => {
    expect(sql).toMatch(/ALTER PUBLICATION supabase_realtime ADD TABLE public\.rehearsal_notes/);
  });

  it('the app reads only granted columns', () => {
    const line = sql167.replace(/--.*$/gm, '').match(/GRANT SELECT \(([^)]+)\), INSERT \(\1\), UPDATE \(\1\) ON public\.rehearsal_notes TO authenticated/);
    expect(line?.[1]).toBe('line');
    expect([...grantList('SELECT', 'rehearsal_notes'), 'line'].sort()).toEqual(cols(NOTE_COLUMNS));
    expect(grantList('SELECT', 'rehearsal_note_assignees')).toEqual(cols(ASSIGNEE_COLUMNS));
  });
});

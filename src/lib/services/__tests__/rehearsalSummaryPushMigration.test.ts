import { describe, it, expect } from 'vitest';
import sql133 from '../../../../supabase/migrations/133_rehearsal_summary_push.sql?raw';

/** Static guards on 133 (the rollback-only dry run checks the behaviour). */
const sql = sql133.replace(/--.*$/gm, '');

describe('133 one summary push when a rehearsal session ends (A4)', () => {
  it('fires once, when the session goes from running to ended', () => {
    expect(sql).toMatch(/AFTER UPDATE OF ended_at ON public\.rehearsal_sessions/);
    expect(sql).toMatch(/WHEN \(OLD\.ended_at IS NULL AND NEW\.ended_at IS NOT NULL\)/);
  });

  it('one row per person per session (ending again after Resume sends nothing new)', () => {
    expect(sql).toMatch(/NOT EXISTS[\s\S]*?type = 'rehearsal_notes_added'[\s\S]*?data ->> 'session_id' = NEW\.id::text/);
  });

  it('only people with songs to practise: band notes, or notes assigned to them', () => {
    expect(sql).toMatch(/n\.scope = 'band'/);
    expect(sql).toMatch(/rehearsal_note_assignees/);
    expect(sql).toMatch(/n\.status IN \('open', 'marked'\)/);
  });

  it('written in each person’s language (6), not re-translated by 089/090', () => {
    expect(sql).toMatch(/preferred_language/);
    for (const lang of ['en', 'it', 'es', 'fr', 'de', 'pt']) expect(sql).toContain(`"${lang}":`);
    expect(sql).not.toMatch(/'server'/);
  });

  it('pushed through the dispatcher, which keeps the push setting', () => {
    expect(sql).toMatch(/NEW\.type = 'rehearsal_notes_added' AND coalesce\(NEW\.data->>'kind', ''\) = 'summary'/);
    expect(sql).toMatch(/notification_preferences->>'push'/);
  });

  it('nothing callable by the app', () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.bw_trg_rehearsal_session_ended\(\) FROM PUBLIC, anon, authenticated/);
    expect(sql).not.toMatch(/GRANT EXECUTE/);
  });
});

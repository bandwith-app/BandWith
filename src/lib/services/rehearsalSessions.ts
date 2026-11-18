/**
 * Rehearsal sessions (migration 131): one row per rehearsal occurrence with
 * the Live mode timer and the saved summary. Members read; band admins write.
 */
import { supabase } from '@/lib/supabase';
import { fromRow, parseSummary, type SessionRow, type SessionState, type SessionSummary } from '@/lib/rehearsalSession';

/** Must match the SELECT grant in 131 (rehearsalMigrations.test.ts). */
export const SESSION_COLUMNS =
  'id, band_id, event_id, occurrence_date, started_at, paused_ms, paused_at, ended_at, started_by, summary, updated_at';

export interface SavedSession {
  state: SessionState;
  summary: SessionSummary | null;
}

const toSaved = (row: unknown): SavedSession | null => {
  const state = fromRow(row);
  if (!state) return null;
  return { state, summary: parseSummary((row as { summary?: unknown }).summary) };
};

/** The saved session of one rehearsal occurrence; `undefined` when it couldn't be read (offline). */
export async function fetchRehearsalSession(eventId: string, date: string): Promise<SavedSession | null | undefined> {
  const { data, error } = await supabase
    .from('rehearsal_sessions')
    .select(SESSION_COLUMNS)
    .eq('event_id', eventId)
    .eq('occurrence_date', date)
    .maybeSingle();
  if (error) return undefined;
  return data ? toSaved(data) : null;
}

/** Save the whole session (idempotent: the same row again changes nothing). */
export async function saveRehearsalSession(row: SessionRow): Promise<{ error: unknown }> {
  const { error } = await supabase.from('rehearsal_sessions').upsert(row, { onConflict: 'event_id,occurrence_date' });
  return { error };
}

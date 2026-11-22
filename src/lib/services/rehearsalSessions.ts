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
  /** The row's revision (updated_at): a change is saved only on top of it (audit 06 #3). */
  rev?: string | null;
}

const toSaved = (row: unknown): SavedSession | null => {
  const state = fromRow(row);
  if (!state) return null;
  const rev = (row as { updated_at?: unknown }).updated_at;
  return { state, summary: parseSummary((row as { summary?: unknown }).summary), rev: typeof rev === 'string' ? rev : null };
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

export interface SaveSessionResult {
  error: unknown;
  /** Not written: someone saved this occurrence first (or it is already there). Read it again. */
  conflict?: boolean;
  /** The saved row's new revision. */
  rev?: string | null;
}

/** Refused because the saved session moved on: 23505 (already there); an error from the first 196 draft too. */
const isConflict = (e: unknown) => {
  const err = (e ?? {}) as { code?: unknown; message?: unknown };
  return err.code === '23505' || String(err.message ?? '').includes('rehearsal_session_conflict');
};

/**
 * Save the whole session, never over a newer one (audit 06 #3/#4): with the
 * revision it was read at, only if the row is still at that revision; with
 * none (`null`: nothing saved, or never read), only as a new row. Otherwise
 * (0 rows: moved on, gone, or another start skipped by 196) `conflict`: the
 * caller reads the saved session and merges into it.
 */
export async function saveRehearsalSession(row: SessionRow, rev?: string | null): Promise<SaveSessionResult> {
  const res = rev
    ? await supabase
        .from('rehearsal_sessions')
        .update(row)
        .eq('event_id', row.event_id)
        .eq('occurrence_date', row.occurrence_date)
        .eq('updated_at', rev)
        .select('updated_at')
    : await supabase.from('rehearsal_sessions').insert(row).select('updated_at');
  if (res.error) return isConflict(res.error) ? { error: null, conflict: true } : { error: res.error };
  const saved = (res.data as { updated_at?: string }[] | null)?.[0];
  // Updated nothing: the row is no longer at that revision (or is gone).
  if (!saved) return { error: null, conflict: true };
  return { error: null, rev: saved.updated_at ?? null };
}

/**
 * Rehearsal notes (migration 132). Reads are by rehearsal occurrence (Live
 * mode, the rehearsal page) or by band (To practise, A3); writes are
 * idempotent upserts by the note's own id, so the offline outbox can replay.
 */
import { supabase } from '@/lib/supabase';
import { fromNoteRow, toNoteRow, type RehearsalNote } from '@/lib/rehearsalNotes';
import { openLyrics } from '@/lib/lyrics';
import { asSongChart } from '@/lib/ireal';

/** Must match the SELECT grants in 132 + 167 (rehearsalNotesMigration.test.ts). */
export const NOTE_COLUMNS =
  'id, band_id, event_id, occurrence_date, session_id, song_id, song_title, preset, section, line, body, scope, status, marked_at_s, created_by, ok_by, ok_at, created_at, updated_at';
export const ASSIGNEE_COLUMNS = 'note_id, user_id, practised_at';

const SELECT = `${NOTE_COLUMNS}, rehearsal_note_assignees(${ASSIGNEE_COLUMNS})`;

const parse = (rows: unknown): RehearsalNote[] =>
  Array.isArray(rows) ? rows.map(fromNoteRow).filter((n): n is RehearsalNote => !!n) : [];

/** Notes of one rehearsal occurrence; `null` when they couldn't be read (offline). */
export async function fetchOccurrenceNotes(eventId: string, date: string): Promise<RehearsalNote[] | null> {
  const { data, error } = await supabase
    .from('rehearsal_notes')
    .select(SELECT)
    .eq('event_id', eventId)
    .eq('occurrence_date', date)
    .order('created_at', { ascending: true });
  return error ? null : parse(data);
}

/** A band's notes that are not OK yet (To practise, From last time). */
export async function fetchOpenBandNotes(bandId: string): Promise<RehearsalNote[] | null> {
  const { data, error } = await supabase
    .from('rehearsal_notes')
    .select(SELECT)
    .eq('band_id', bandId)
    .neq('status', 'ok')
    .order('created_at', { ascending: false })
    .limit(300);
  return error ? null : parse(data);
}

/** A write's error and its HTTP status (the outbox keeps a note on a 503, audit 06 #5). */
type WriteResult = { error: unknown; status?: number };
const result = (r: { error: unknown; status?: number }): WriteResult => ({ error: r.error, status: r.status });

/**
 * Save a note and its assignees. `before` = the assignees saved until now
 * (removed ones are deleted, new ones added). Same call twice = no change.
 */
export async function saveNote(note: RehearsalNote, before: string[]): Promise<WriteResult> {
  // Update first, insert when it isn't there yet: an upsert would run the
  // insert guard on a note that is already OK (132 refuses a new OK note).
  const row = toNoteRow(note);
  const changes: Partial<typeof row> = { ...row };
  delete changes.id;
  delete changes.band_id;
  delete changes.event_id;
  delete changes.occurrence_date;
  const update = () => supabase.from('rehearsal_notes').update(changes).eq('id', note.id).select('id');
  const upd = await update();
  if (upd.error) return result(upd);
  if (!upd.data?.length) {
    const ins = await supabase.from('rehearsal_notes').insert(row);
    if (ins.error && (ins.error as { code?: string }).code === '23505') {
      // Already there. Saved meanwhile by this same change from another tab (both replayed
      // it, #296 round 8): the update now finds it, a success. Still no row it may change:
      // this account may no longer edit it (admin rights gone meanwhile, someone else's
      // note), a refusal for good: the outbox keeps its text in the refused list (round 5).
      const again = await update();
      if (again.error) return result(again);
      if (!again.data?.length) return { error: { code: '42501', message: 'rehearsal_note_not_editable' }, status: 403 };
    } else if (ins.error) return result(ins);
  }
  const want = note.scope === 'members' ? note.assignees.map((a) => a.userId) : [];
  const gone = before.filter((u) => !want.includes(u));
  const added = want.filter((u) => !before.includes(u));
  if (gone.length) {
    const del = await supabase.from('rehearsal_note_assignees').delete().eq('note_id', note.id).in('user_id', gone);
    if (del.error) return result(del);
  }
  if (added.length) {
    const add = await supabase
      .from('rehearsal_note_assignees')
      .upsert(added.map((user_id) => ({ note_id: note.id, user_id })), { onConflict: 'note_id,user_id', ignoreDuplicates: true });
    if (add.error) return result(add);
  }
  return { error: null };
}

export async function deleteNote(id: string): Promise<WriteResult> {
  return result(await supabase.from('rehearsal_notes').delete().eq('id', id));
}

/** Practised (or not) by me. */
export async function setPractised(noteId: string, userId: string, practised: boolean): Promise<WriteResult> {
  return result(
    await supabase
      .from('rehearsal_note_assignees')
      .update({ practised_at: practised ? new Date().toISOString() : null })
      .eq('note_id', noteId)
      .eq('user_id', userId),
  );
}

/** OK (confirmed at a rehearsal) or back to open. */
export async function setNoteOk(noteId: string, ok: boolean): Promise<WriteResult> {
  return result(await supabase.from('rehearsal_notes').update({ status: ok ? 'ok' : 'open' }).eq('id', noteId));
}

/** Opens a band song's page (lyrics and its notes) from To practise. */
export async function openSongPage(songId: string, bandId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('songs')
    .select('id, title, artist, key, lyrics, chord_chart, notes')
    .eq('id', songId)
    .maybeSingle();
  if (error || !data) return false;
  const s = data as { id: string; title: string; artist?: string | null; key?: string | null; lyrics?: string | null; chord_chart?: unknown; notes?: string | null };
  openLyrics({
    songId: s.id,
    bandId,
    title: s.title,
    artist: s.artist ?? undefined,
    songKey: s.key ?? undefined,
    lyrics: s.lyrics || '',
    chart: asSongChart(s.chord_chart),
    view: 'lyrics',
    notes: s.notes,
  });
  return true;
}

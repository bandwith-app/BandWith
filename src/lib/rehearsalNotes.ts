/**
 * Rehearsal notes (plan A2, migration 132): per song or general, written in
 * Live mode or after it. "Mark now, write later": one tap records the song
 * and the minute (status 'marked'); at the pause or in the summary the mark
 * becomes a note (a preset and/or text, and who it is for).
 *
 * Rules (plan §5): the whole band reads every note. Admins write and assign
 * to anyone; members write for the band or for themselves. The assignee
 * marks "Practised" for themselves; an admin (or the author of a note to
 * members) confirms it OK. Pure: no I/O.
 */
import { parseLyrics } from './lyrics';
import { lyricsLineText } from './personalNotes';
import { normalizeLyrics } from './songFormat';
import { lineVoice, type VoicePart } from './voiceParts';

/** Built-in presets, stored as keys and shown translated (rehearsalNoteLabels). */
export const NOTE_PRESETS = ['review', 'repeat_section', 'tempo', 'key', 'ending', 'solo', 'nailed'] as const;
export type NotePreset = (typeof NOTE_PRESETS)[number];
export const isPreset = (v: unknown): v is NotePreset => typeof v === 'string' && (NOTE_PRESETS as readonly string[]).includes(v);

export type NoteScope = 'band' | 'members';
export type NoteStatus = 'marked' | 'open' | 'ok';

export interface NoteAssignee {
  userId: string;
  practisedAt: string | null;
}

export interface RehearsalNote {
  id: string;
  bandId: string;
  eventId: string;
  /** The rehearsal occurrence ("YYYY-MM-DD"). */
  date: string;
  sessionId: string | null;
  /** songs.id; null = a general note. */
  songId: string | null;
  /** The song's title when written (the list reads it without the song). */
  songTitle: string | null;
  preset: NotePreset | null;
  /** A structure heading ("Verse 3"): where in the song (any note; required for "Repeat a section"). */
  section: string | null;
  /** One line of that section, chords removed (167): the precise point. */
  line?: string | null;
  body: string | null;
  scope: NoteScope;
  status: NoteStatus;
  /** Seconds into the session when it was marked. */
  markedAtS: number | null;
  createdBy: string;
  okBy: string | null;
  okAt: string | null;
  createdAt: string;
  assignees: NoteAssignee[];
}

export const MAX_BODY = 1000;
export const MAX_LINE = 200;

/** The song's structure headings as Stage draws them ("Rit." → "Chorus"), in order, once each. */
export function songSections(lyrics: string | null | undefined): string[] {
  const names = parseLyrics(normalizeLyrics(lyrics))
    .map((s) => s.name?.trim())
    .filter((n): n is string => !!n);
  return [...new Set(names)];
}

/** The lines of one section as drawn, chords removed, once each (a repeated chorus counts once). */
export function sectionLines(lyrics: string | null | undefined, section: string | null | undefined): string[] {
  if (!section) return [];
  const out: string[] = [];
  for (const s of parseLyrics(normalizeLyrics(lyrics))) {
    if (s.name?.trim() !== section) continue;
    for (const l of s.lines) {
      const text = lyricsLineText(l);
      if (text && !out.includes(text)) out.push(text);
    }
  }
  return out;
}

/**
 * The voice part of the line a note is pinned to, and its number in the
 * section (1 = the section's first line): "Backing · line 3". Null when the
 * line is no longer in the song. Section null: the first match anywhere.
 */
export function linePart(
  lyrics: string | null | undefined,
  section: string | null | undefined,
  line: string | null | undefined,
): { voice: VoicePart; index: number } | null {
  if (!lyrics || !line) return null;
  for (const s of parseLyrics(normalizeLyrics(lyrics))) {
    if (section && s.name?.trim() !== section) continue;
    const drawn = s.lines.filter((l) => l.trim());
    const i = drawn.findIndex((l) => lyricsLineText(l) === line);
    if (i >= 0) {
      const v = lineVoice(drawn[i]);
      return { voice: v === 'mixed' ? 'lead' : v, index: i + 1 };
    }
  }
  return null;
}

/** Presets offered for a song: "Repeat a section" only when it has structure. */
export const presetsFor = (lyrics: string | null | undefined): NotePreset[] =>
  songSections(lyrics).length > 0 ? [...NOTE_PRESETS] : NOTE_PRESETS.filter((p) => p !== 'repeat_section');

export type NoteProblem = 'empty' | 'too_long' | 'section';

export function validateNote(n: Pick<RehearsalNote, 'status' | 'preset' | 'body' | 'section'>): NoteProblem | null {
  const body = n.body?.trim() ?? '';
  if (body.length > MAX_BODY) return 'too_long';
  if (n.status === 'marked') return null;
  if (!n.preset && !body) return 'empty';
  if (n.preset === 'repeat_section' && !n.section?.trim()) return 'section';
  return null;
}

/** Admins assign to anyone; members only to themselves (or nobody: the band). */
export const assigneesAllowed = (isAdmin: boolean, userId: string, assignees: string[]): boolean =>
  isAdmin || assignees.every((a) => a === userId);

export const canEditNote = (n: RehearsalNote, userId: string | null | undefined, isAdmin: boolean) =>
  isAdmin || (!!userId && n.createdBy === userId);
export const canDeleteNote = canEditNote;

/** OK: an admin; the author only for a note to members (band notes are closed by an admin). Not a mark. */
export const canMarkOk = (n: RehearsalNote, userId: string | null | undefined, isAdmin: boolean) =>
  n.status !== 'marked' && (isAdmin || (n.scope === 'members' && !!userId && n.createdBy === userId));

export type MyNoteState = 'marked' | 'open' | 'practised' | 'ok';

export function myNoteState(n: RehearsalNote, userId: string | null | undefined): MyNoteState {
  if (n.status === 'marked') return 'marked';
  if (n.status === 'ok') return 'ok';
  return n.assignees.some((a) => a.userId === userId && !!a.practisedAt) ? 'practised' : 'open';
}

/** The note is for me: to the band, or I'm one of its assignees. */
export const isForMe = (n: RehearsalNote, userId: string | null | undefined) =>
  n.scope === 'band' || n.assignees.some((a) => a.userId === userId);

export interface NoteGroup {
  songId: string | null;
  title: string | null;
  notes: RehearsalNote[];
}

/** By song: the setlist's order first, then other songs, then general notes; oldest first inside. */
export function groupBySong(notes: RehearsalNote[], setlistSongIds: string[]): NoteGroup[] {
  const groups = new Map<string, NoteGroup>();
  for (const n of [...notes].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const key = n.songId ?? '';
    const g = groups.get(key) ?? { songId: n.songId, title: n.songTitle, notes: [] };
    g.notes.push(n);
    groups.set(key, g);
  }
  const rank = (g: NoteGroup) => {
    if (!g.songId) return Number.MAX_SAFE_INTEGER;
    const i = setlistSongIds.indexOf(g.songId);
    return i >= 0 ? i : Number.MAX_SAFE_INTEGER - 1;
  };
  return [...groups.values()].sort((a, b) => rank(a) - rank(b));
}

/** Saved notes with the ones waiting on this device on top (offline writes win; offline deletes are gone). */
export function mergeOutbox(saved: RehearsalNote[], pending: RehearsalNote[], deleted: string[]): RehearsalNote[] {
  const byId = new Map(saved.map((n) => [n.id, n]));
  for (const n of pending) byId.set(n.id, n);
  for (const id of deleted) byId.delete(id);
  return [...byId.values()];
}

// ----------------------------------------------------------------- rows --

export interface NoteRow {
  id: string;
  band_id: string;
  event_id: string;
  occurrence_date: string;
  session_id: string | null;
  song_id: string | null;
  song_title: string | null;
  preset: NotePreset | null;
  section: string | null;
  body: string | null;
  scope: NoteScope;
  status: NoteStatus;
  marked_at_s: number | null;
  /** Left out when there's none, so saving works before migration 167; null clears it. */
  line?: string | null;
}

/** What the app writes (created_by, ok_by, ok_at and times are set by the database). */
export const toNoteRow = (n: RehearsalNote): NoteRow => ({
  id: n.id,
  band_id: n.bandId,
  event_id: n.eventId,
  occurrence_date: n.date,
  session_id: n.sessionId,
  song_id: n.songId,
  song_title: n.songTitle,
  preset: n.preset,
  section: n.section?.trim() || null,
  body: n.body?.trim() || null,
  scope: n.scope,
  status: n.status,
  marked_at_s: n.markedAtS,
  // '' = the line was taken off an edited note: clear it (null); null/undefined = no line, not sent.
  ...(n.line?.trim() ? { line: n.line.trim().slice(0, MAX_LINE) } : n.line === '' ? { line: null } : {}),
});

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function fromNoteRow(row: unknown): RehearsalNote | null {
  if (!isObj(row)) return null;
  const id = str(row.id);
  const bandId = str(row.band_id);
  const eventId = str(row.event_id);
  const date = str(row.occurrence_date)?.slice(0, 10) ?? null;
  const createdBy = str(row.created_by);
  const status = row.status === 'marked' || row.status === 'open' || row.status === 'ok' ? row.status : null;
  const scope = row.scope === 'band' || row.scope === 'members' ? row.scope : null;
  if (!id || !bandId || !eventId || !date || !createdBy || !status || !scope) return null;
  const assignees = Array.isArray(row.rehearsal_note_assignees)
    ? row.rehearsal_note_assignees
        .filter((a): a is Record<string, unknown> => isObj(a) && typeof a.user_id === 'string')
        .map((a) => ({ userId: a.user_id as string, practisedAt: str(a.practised_at) }))
    : [];
  return {
    id,
    bandId,
    eventId,
    date,
    sessionId: str(row.session_id),
    songId: str(row.song_id),
    songTitle: str(row.song_title),
    preset: isPreset(row.preset) ? row.preset : null,
    section: str(row.section),
    ...(str(row.line) ? { line: str(row.line) } : {}),
    body: str(row.body),
    scope,
    status,
    markedAtS: typeof row.marked_at_s === 'number' ? row.marked_at_s : null,
    createdBy,
    okBy: str(row.ok_by),
    okAt: str(row.ok_at),
    createdAt: str(row.created_at) ?? new Date(0).toISOString(),
    assignees,
  };
}

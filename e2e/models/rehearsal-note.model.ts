import { defineLifecycle } from './lifecycle.ts';

/**
 * Rehearsal note (plan A2): "Mark now, write later", then confirmed OK.
 *
 * From the code:
 * - Live mode on a band rehearsal shows the notes bar (StageMode.tsx →
 *   RehearsalNotes.tsx RehearsalNotesBar) when the `rehearsal_notes` flag is
 *   on (src/lib/flags.ts, default on): Mark and the notes ("Notes · N", or
 *   "To write: N" while marks wait).
 * - Mark saves a note with status 'marked', the song playing and the minute
 *   of the session (useRehearsalNotes.mark → outbox → rehearsal_notes, 132).
 * - The notes sheet (NotesListSheet) lists them by song; a mark has Write,
 *   which opens the editor (NoteEditorSheet): song, preset, section when the
 *   song has structure, text, who it's for. Saving makes it a note ('open').
 * - The rehearsal's page lists the notes (REHEARSAL NOTES); an admin
 *   confirms one OK and can take it back (src/lib/rehearsalNotes.ts canMarkOk).
 */
export const rehearsalNote = defineLifecycle({
  id: 'rehearsal-note',
  title: 'Rehearsal note (mark, write, OK)',
  summary: 'The admin marks a moment in Live mode, writes it as a note at the pause, and confirms it OK on the rehearsal page.',
  role: 'admin',
  initial: 'start',
  states: {
    start: {
      see: 'Nothing open yet: the first event seeds "Weekly rehearsal" with three focus songs and a running session, and opens Live mode.',
      on: { OPEN_LIVE: 'live' },
    },
    live: {
      see: 'Live mode with the notes bar: Mark and "Notes · 0"; nothing saved.',
      source: 'RehearsalNotes.tsx RehearsalNotesBar',
      on: { MARK: 'marked' },
    },
    marked: {
      see: '"Marked" and "To write: 1"; one saved note with status marked on the song playing.',
      source: 'useRehearsalNotes.mark; rehearsalNotesOutbox flushOutbox',
      on: { OPEN_NOTES: 'list' },
    },
    list: {
      see: 'The notes sheet: the song, "Marked at …" and Write.',
      source: 'RehearsalNotes.tsx NotesListSheet, NoteItem (marked)',
      on: { WRITE: 'editing', CLOSE: 'marked' },
    },
    editing: {
      see: 'The editor ("Edit note"): song, what to work on, note, who it is for, Save note.',
      source: 'RehearsalNotes.tsx NoteEditorSheet',
      on: { SAVE: 'written', CANCEL: 'list' },
    },
    written: {
      see: 'The sheet lists the note as "Tempo" with its text; saved as open with the preset.',
      source: 'useRehearsalNotes.save (a written mark becomes open)',
      on: { CLOSE: 'noted' },
    },
    noted: {
      see: 'The bar says "Notes · 1" and nothing to write.',
      source: 'RehearsalNotesBar',
      on: { EXIT: 'page' },
    },
    page: {
      see: 'The rehearsal page: REHEARSAL NOTES with the song, "Tempo", the text and OK.',
      source: 'EventDetail.tsx REHEARSAL NOTES; RehearsalNotesSection',
      on: { OK: 'confirmed' },
    },
    confirmed: {
      see: 'OK is pressed and the note says OK; saved with status ok.',
      source: 'NoteItem OK; rehearsal_notes guard (ok_by, ok_at)',
      on: { REOPEN: 'page' },
    },
  },
  events: {
    OPEN_LIVE: { do: 'Open "Weekly rehearsal" (session running) and tap Open live mode.' },
    MARK: { do: 'Tap Mark.' },
    OPEN_NOTES: { do: 'Tap "To write: 1".' },
    WRITE: { do: 'Tap Write on the mark.' },
    CANCEL: { do: 'Close the editor without saving.' },
    SAVE: { do: 'Pick Tempo, type a few words, tap Save note.' },
    CLOSE: { do: 'Close the notes sheet.' },
    EXIT: { do: 'Tap Exit live mode.' },
    OK: { do: 'Tap OK on the note.' },
    REOPEN: { do: 'Tap OK again (back to open).' },
  },
  wide: [],
  knownBugs: [],
  manual: [
    "Members (write for the band or themselves, Practised, no OK on others' notes) and two devices (a mark reaching the other phone live): e2e/specs/rehearsal-notes.spec.ts.",
    'No signal in the rehearsal room: notes wait on the device and go when back online (vitest rehearsalNotesOutbox, useRehearsalNotes).',
    'Duo Laptop: the notes pad on the deck (Mark, one-tap presets, Write…): rehearsal-notes.spec @smoke on duo-laptop.',
  ],
});

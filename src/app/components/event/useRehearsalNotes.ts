import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { deleteNote, fetchOccurrenceNotes, saveNote, setNoteOk, setPractised } from '@/lib/services/rehearsalNotes';
import { canMarkOk, type RehearsalNote } from '@/lib/rehearsalNotes';
import { occurrenceNotesFromPack } from '@/lib/livePackStore';
import {
  applyOps,
  dismissRejected as dismissRejectedNote,
  flushOutbox,
  OUTBOX_EVENT,
  queueNoteOp,
  readOutbox,
  readRejected,
  type NoteOp,
  type OutboxApi,
} from '@/lib/rehearsalNotesOutbox';

const api: OutboxApi = { save: saveNote, remove: deleteNote, practised: setPractised, ok: setNoteOk };

/** Changes arriving together cause one reload. */
const SETTLE_MS = 300;
/** Waiting changes are tried again this often (and when back online). */
const RETRY_MS = 20_000;

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => ((Math.random() * 16) | 0).toString(16));

interface Options {
  /** Band rehearsal with the `rehearsal_notes` flag on. */
  enabled: boolean;
  bandId?: string;
  eventId?: string;
  /** The occurrence ("YYYY-MM-DD"); null = no date yet (nothing to note). */
  date: string | null;
  userId?: string;
  isAdmin: boolean;
}

export interface MarkInput {
  songId: string | null;
  songTitle: string | null;
  markedAtS: number | null;
}

export interface RehearsalNotesControls {
  enabled: boolean;
  /** The occurrence's notes, with this device's waiting changes applied. */
  notes: RehearsalNote[];
  loaded: boolean;
  /** Changes not sent yet (no signal). */
  waiting: number;
  /** This rehearsal's notes the server refused for good, with their text (audit 06 #5). */
  rejected?: RehearsalNote[];
  /** The person has seen a refused note: it goes from the list. */
  dismissRejected?: (id: string) => void;
  userId?: string;
  isAdmin: boolean;
  /** "Mark now, write later": one tap, the song and the minute. */
  mark: (m: MarkInput) => RehearsalNote | null;
  /** A new note (no id yet) or an edited one. */
  save: (note: RehearsalNote) => void;
  remove: (id: string) => void;
  practised: (id: string, value: boolean) => void;
  ok: (id: string, value: boolean) => void;
  /** A blank note for this rehearsal (the composer fills it). */
  draft: (m: Partial<RehearsalNote>) => RehearsalNote | null;
}

/**
 * Rehearsal notes for one occurrence (plan A2): read, kept live (Realtime on
 * rehearsal_notes while the rehearsal is open), and written through the
 * offline outbox so a mark in a basement is never lost.
 */
export function useRehearsalNotes({ enabled, bandId, eventId, date, userId, isAdmin }: Options): RehearsalNotesControls {
  const on = enabled && !!bandId && !!eventId && !!userId && !!date;
  const [saved, setSaved] = useState<RehearsalNote[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [ops, setOps] = useState<NoteOp[]>(() => readOutbox(userId));
  const [refused, setRefused] = useState<RehearsalNote[]>(() => readRejected(userId));

  const reload = useCallback(async () => {
    if (!on) return;
    const rows = await fetchOccurrenceNotes(eventId!, date!);
    if (rows) setSaved(rows);
    else {
      // No signal: the notes kept in this rehearsal's live pack (plan §3.1).
      const kept = await occurrenceNotesFromPack(userId, eventId!, date!);
      if (kept) setSaved(kept);
    }
    setLoaded(true);
  }, [on, eventId, date, userId]);

  const flush = useCallback(async () => {
    if (!on || readOutbox(userId).length === 0) return;
    const res = await flushOutbox(userId!, api);
    if (res.sent + res.dropped > 0) void reload();
  }, [on, userId, reload]);

  // Load, and send whatever waited on this device.
  useEffect(() => {
    setSaved([]);
    setLoaded(false);
    if (!on) return;
    void reload();
    void flush();
  }, [on, reload, flush]);

  // The outbox changes (here or in another screen): show it, and retry while it waits.
  useEffect(() => {
    if (!on) return;
    const sync = () => {
      setOps(readOutbox(userId));
      setRefused(readRejected(userId));
    };
    sync();
    const onOnline = () => void flush();
    window.addEventListener(OUTBOX_EVENT, sync);
    window.addEventListener('online', onOnline);
    const id = window.setInterval(() => {
      if (readOutbox(userId).length) void flush();
    }, RETRY_MS);
    return () => {
      window.removeEventListener(OUTBOX_EVENT, sync);
      window.removeEventListener('online', onOnline);
      window.clearInterval(id);
    };
  }, [on, userId, flush]);

  // Live: another member's note shows up while the rehearsal is open.
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useEffect(() => {
    if (!on) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const later = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void reloadRef.current(), SETTLE_MS);
    };
    const channel = supabase
      .channel(`rehearsal-notes-${eventId}-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'rehearsal_notes', filter: `event_id=eq.${eventId}` }, later)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rehearsal_notes', filter: `event_id=eq.${eventId}` }, later)
      // Deletes can't be filtered: any delete reloads.
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'rehearsal_notes' }, later)
      .subscribe();
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [on, eventId]);

  const notes = useMemo(
    () => (on ? applyOps(saved, ops, userId).filter((n) => n.eventId === eventId && n.date === date) : []),
    [on, saved, ops, userId, eventId, date],
  );
  const rejected = useMemo(
    () => (on ? refused.filter((n) => n.eventId === eventId && n.date === date) : []),
    [on, refused, eventId, date],
  );
  const dismissRejected = useCallback((id: string) => userId && dismissRejectedNote(userId, id), [userId]);
  const notesRef = useRef(notes);
  notesRef.current = notes;

  const queue = useCallback(
    (op: NoteOp) => {
      if (!on) return;
      queueNoteOp(userId!, op);
      void flush();
    },
    [on, userId, flush],
  );

  const draft = useCallback(
    (m: Partial<RehearsalNote>): RehearsalNote | null =>
      on
        ? {
            id: '',
            bandId: bandId!,
            eventId: eventId!,
            date: date!,
            sessionId: null,
            songId: null,
            songTitle: null,
            preset: null,
            section: null,
            line: null,
            body: null,
            scope: 'band',
            status: 'open',
            markedAtS: null,
            createdBy: userId!,
            okBy: null,
            okAt: null,
            createdAt: new Date().toISOString(),
            assignees: [],
            ...m,
          }
        : null,
    [on, bandId, eventId, date, userId],
  );

  const save = useCallback(
    (note: RehearsalNote) => {
      const prev = notesRef.current.find((n) => n.id === note.id);
      const before = saved.find((n) => n.id === note.id)?.assignees.map((a) => a.userId) ?? [];
      const next: RehearsalNote = {
        ...note,
        id: note.id || newId(),
        // Writing a mark makes it a note.
        status: note.status === 'marked' && (note.preset || note.body?.trim()) ? 'open' : note.status,
        createdAt: prev?.createdAt ?? note.createdAt,
      };
      queue({ kind: 'save', note: next, before });
    },
    [queue, saved],
  );

  const mark = useCallback(
    (m: MarkInput) => {
      const n = draft({ ...m, status: 'marked' });
      if (!n) return null;
      const note = { ...n, id: newId() };
      queue({ kind: 'save', note, before: [] });
      return note;
    },
    [draft, queue],
  );

  const remove = useCallback((id: string) => queue({ kind: 'delete', id }), [queue]);
  const practised = useCallback(
    (id: string, value: boolean) => {
      if (userId) queue({ kind: 'practised', id, userId, value });
    },
    [queue, userId],
  );
  const ok = useCallback(
    (id: string, value: boolean) => {
      const n = notesRef.current.find((x) => x.id === id);
      if (n && canMarkOk(n, userId, isAdmin)) queue({ kind: 'ok', id, value });
    },
    [queue, userId, isAdmin],
  );

  return {
    enabled: on,
    notes,
    loaded,
    waiting: on ? ops.length : 0,
    rejected,
    dismissRejected,
    userId,
    isAdmin,
    mark,
    save,
    remove,
    practised,
    ok,
    draft,
  };
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchOpenBandNotes } from '@/lib/services/rehearsalNotes';
import { applyOps, OUTBOX_EVENT, queueNoteOp, readOutbox, flushOutbox, type NoteOp } from '@/lib/rehearsalNotesOutbox';
import { deleteNote, saveNote, setNoteOk, setPractised } from '@/lib/services/rehearsalNotes';
import type { RehearsalNote } from '@/lib/rehearsalNotes';

const api = { save: saveNote, remove: deleteNote, practised: setPractised, ok: setNoteOk };

/** Kept per band for this visit, so Home, the song page and the next rehearsal share one read. */
const cache = new Map<string, { at: number; notes: RehearsalNote[] }>();
const FRESH_MS = 60_000;

/** Window event after notes changed here (Practised, OK): band-wide lists read again. */
export const BAND_NOTES_CHANGED = 'bw:band-notes-changed';

export interface BandNotes {
  /** The band's notes that weren't OK when read, with this device's waiting changes (an OK just given stays, to take back). */
  notes: RehearsalNote[];
  loaded: boolean;
  practised: (id: string, value: boolean) => void;
  ok: (id: string, value: boolean) => void;
}

/**
 * The band's open rehearsal notes (plan A3): To practise on Home, the song
 * page strip, "From last time" and the Live mode badges. One read per band
 * per minute; Practised / OK go through the A2 outbox.
 */
export function useBandNotes(bandId: string | null | undefined, userId: string | null | undefined, enabled = true): BandNotes {
  const on = enabled && !!bandId && !!userId;
  const [saved, setSaved] = useState<RehearsalNote[]>(() => (bandId ? cache.get(bandId)?.notes ?? [] : []));
  const [loaded, setLoaded] = useState(() => !!bandId && cache.has(bandId));
  const [ops, setOps] = useState<NoteOp[]>(() => readOutbox(userId));
  // OK given here: kept on screen after the next read (which leaves OK notes out), to take it back.
  const okHere = useRef(new Map<string, RehearsalNote>());
  const withOkHere = useCallback((rows: RehearsalNote[]) => {
    const ids = new Set(rows.map((r) => r.id));
    return [...rows, ...[...okHere.current.values()].filter((n) => !ids.has(n.id))];
  }, []);

  const load = useCallback(
    async (force = false) => {
      if (!on) return;
      const hit = cache.get(bandId!);
      if (hit && !force && Date.now() - hit.at < FRESH_MS) {
        setSaved(withOkHere(hit.notes));
        setLoaded(true);
        return;
      }
      const rows = await fetchOpenBandNotes(bandId!);
      if (rows) {
        cache.set(bandId!, { at: Date.now(), notes: rows });
        setSaved(withOkHere(rows));
      }
      setLoaded(true);
    },
    [on, bandId, withOkHere],
  );

  useEffect(() => {
    if (!on) {
      setSaved([]);
      setLoaded(false);
      return;
    }
    void load();
    const reread = () => void load(true);
    const sync = () => setOps(readOutbox(userId));
    sync();
    window.addEventListener(BAND_NOTES_CHANGED, reread);
    window.addEventListener(OUTBOX_EVENT, sync);
    return () => {
      window.removeEventListener(BAND_NOTES_CHANGED, reread);
      window.removeEventListener(OUTBOX_EVENT, sync);
    };
  }, [on, load, userId]);

  const notes = useMemo(
    () => (on ? applyOps(saved, ops, userId).filter((n) => n.bandId === bandId) : []),
    [on, saved, ops, userId, bandId],
  );

  const queue = useCallback(
    (op: NoteOp) => {
      if (!on) return;
      queueNoteOp(userId!, op);
      void flushOutbox(userId!, api).then((r) => {
        if (r.sent + r.dropped > 0) {
          cache.delete(bandId!);
          window.dispatchEvent(new CustomEvent(BAND_NOTES_CHANGED, { detail: { bandId } }));
        }
      });
    },
    [on, userId, bandId],
  );

  return {
    notes,
    loaded,
    practised: (id, value) => userId && queue({ kind: 'practised', id, userId, value }),
    ok: (id, value) => {
      const n = notes.find((x) => x.id === id);
      if (n && value) okHere.current.set(id, { ...n, status: 'ok' });
      else okHere.current.delete(id);
      queue({ kind: 'ok', id, value });
    },
  };
}

/** Forget what was read (tests; sign-out). */
export const clearBandNotesCache = () => cache.clear();

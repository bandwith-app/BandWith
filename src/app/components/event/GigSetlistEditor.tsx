import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Folder, Plus } from '@/app/components/icons';
import { FormError, PillButton, Selector } from '@/app/components/bw/Form';
import { SortableSongList } from '@/app/components/ui/SortableSongList';
import { SongPicker, type PickedSong } from '@/app/components/ui/SongPicker';
import { SetChooserSheet } from '@/app/components/ui/SetChooserSheet';
import { cn } from '@/app/components/ui/utils';
import { haptic } from '@/lib/haptics';
import { useT } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { createSetlist, getSetlist, getSetlists, replaceSetlistSongs, type Setlist } from '@/lib/services/songs';
import { diffSetlist, entriesFromRows, type SetlistEntry } from '@/lib/setlistChanges';
import { setStartNumbers } from '@/lib/setlistOrder';
import { notifySetlistSaved } from '@/lib/services/setlistNotify';
import { userMessage } from '@/lib/userError';

/**
 * The gig's setlist, edited right in its overview by the band admin
 * (Figma "Event detail", setlists admin-only since 074): long-press and drag
 * to reorder, ✕ to remove, Add songs into the set you pick. Nothing is
 * written until Save; then the lineup gets one notification with what changed.
 */

/** A song of the gig's setlist as EventDetail loads it. */
export interface GigSetlistSong {
  id?: string;
  songId?: string;
  setNumber?: number;
  title: string;
  artist?: string;
  [extra: string]: unknown;
}

interface DraftSong {
  uid: string;
  songId: string;
  title: string;
  artist?: string;
  /** The loaded row (key, duration, lyrics…), kept for the optimistic list after Save. */
  source?: GigSetlistSong;
}
interface DraftSet {
  uid: string;
  songs: DraftSong[];
}

let seq = 0;
const newUid = (p: string) => `${p}-${Date.now().toString(36)}-${(seq += 1)}`;

/** Loaded songs grouped by set, in play order. */
export function setsFromGigSongs(songs: GigSetlistSong[]): DraftSet[] {
  const bySet = new Map<number, DraftSong[]>();
  songs.forEach((s, i) => {
    if (!s.songId) return;
    const n = typeof s.setNumber === 'number' && s.setNumber >= 1 ? Math.floor(s.setNumber) : 1;
    if (!bySet.has(n)) bySet.set(n, []);
    bySet.get(n)!.push({ uid: s.id ? `row-${s.id}` : `song-${s.songId}-${i}`, songId: s.songId, title: s.title, artist: s.artist, source: s });
  });
  return [...bySet.entries()].sort(([a], [b]) => a - b).map(([n, list]) => ({ uid: `set-${n}`, songs: list }));
}

const snapshot = (sets: DraftSet[]) =>
  JSON.stringify(sets.filter((s) => s.songs.length > 0).map((s) => s.songs.map((sg) => sg.songId)));

/** The setlist as stored (its own set numbers), in play order: what a save expects to find (188). */
// With each row's id: saved only over exactly these rows (188, Codex r6 B6).
const loadedOrder = (songs: GigSetlistSong[]): { song_id: string; set_number: number; id?: string }[] =>
  setsFromGigSongs(songs).flatMap((s) =>
    s.songs.map((sg) => ({
      ...(typeof sg.source?.id === 'string' && sg.source.id ? { id: sg.source.id } : {}),
      song_id: sg.songId,
      set_number: typeof sg.source?.setNumber === 'number' && sg.source.setNumber >= 1 ? Math.floor(sg.source.setNumber) : 1,
    }))
  );

/**
 * Rows to save: empty sets drop out and the rest are numbered 1, 2, …
 * A song that was loaded names its row (188 keeps that row: the same song
 * twice with the first removed leaves the second its own singers and notes).
 */
const rowsOf = (sets: DraftSet[]): { id?: string; song_id: string; set_number: number }[] =>
  sets
    .filter((s) => s.songs.length > 0)
    .flatMap((s, i) =>
      s.songs.map((sg) => ({
        ...(typeof sg.source?.id === 'string' && sg.source.id ? { id: sg.source.id } : {}),
        song_id: sg.songId,
        set_number: i + 1,
      }))
    );

export interface GigSetlistDraft {
  sets: DraftSet[];
  dirty: boolean;
  saving: boolean;
  error: string | null;
  reorder: (setUid: string, songs: DraftSong[]) => void;
  remove: (setUid: string, songUid: string) => void;
  /** Takes these songs out of a set (null: the first), e.g. unticked in the picker. */
  removeSongs: (setUid: string | null, songIds: string[]) => void;
  add: (setUid: string | null, picked: PickedSong[]) => void;
  addSet: () => string;
  /** Replaces the whole list (a saved setlist loaded as a template). */
  load: (songs: GigSetlistSong[]) => void;
  discard: () => void;
  save: () => Promise<boolean>;
}

export function useGigSetlistDraft(opts: {
  songs: GigSetlistSong[];
  setlistId?: string | null;
  eventId?: string;
  bandId?: string | null;
  eventTitle?: string;
  /** After Save: the new list (shown at once) and a reload from the server. */
  onSaved: (songs: GigSetlistSong[], setlistId: string) => void;
}): GigSetlistDraft {
  const { songs, setlistId, eventId, bandId, eventTitle, onSaved } = opts;
  const t = useT();
  const saved = useMemo(() => setsFromGigSongs(songs), [songs]);
  const [draft, setDraft] = useState<DraftSet[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sets = draft ?? saved;
  const dirty = draft !== null && snapshot(draft) !== snapshot(saved);
  // The setlist as it was when this draft started: the save is written only
  // while the setlist is still that, never over someone else's newer one.
  const draftRef = useRef<DraftSet[] | null>(null);
  draftRef.current = draft;
  const baseRef = useRef<{ song_id: string; set_number: number; id?: string }[] | null>(null);

  const update = useCallback(
    (fn: (prev: DraftSet[]) => DraftSet[]) => {
      setError(null);
      if (draftRef.current === null) baseRef.current = loadedOrder(songs);
      setDraft((prev) => fn(prev ?? saved));
    },
    [saved, songs]
  );

  const reorder = useCallback(
    (setUid: string, list: DraftSong[]) => update((prev) => prev.map((s) => (s.uid === setUid ? { ...s, songs: list } : s))),
    [update]
  );
  const remove = useCallback(
    (setUid: string, songUid: string) =>
      update((prev) => prev.map((s) => (s.uid === setUid ? { ...s, songs: s.songs.filter((sg) => sg.uid !== songUid) } : s))),
    [update]
  );
  const removeSongs = useCallback(
    (setUid: string | null, songIds: string[]) => {
      if (songIds.length === 0) return;
      const gone = new Set(songIds);
      update((prev) => {
        const target = (setUid && prev.find((s) => s.uid === setUid)) || prev[0];
        if (!target) return prev;
        return prev.map((s) => (s.uid === target.uid ? { ...s, songs: s.songs.filter((sg) => !gone.has(sg.songId)) } : s));
      });
    },
    [update]
  );
  const add = useCallback(
    (setUid: string | null, picked: PickedSong[]) =>
      update((prev) => {
        const base = prev.length > 0 ? prev : [{ uid: newUid('set'), songs: [] }];
        const target = (setUid && base.find((s) => s.uid === setUid)) || base[0];
        const have = new Set(target.songs.map((sg) => sg.songId));
        const extra = picked
          .filter((p) => p.id && !have.has(p.id))
          .map((p) => ({ uid: newUid('song'), songId: p.id, title: p.title, artist: p.artist || undefined }));
        return base.map((s) => (s.uid === target.uid ? { ...s, songs: [...s.songs, ...extra] } : s));
      }),
    [update]
  );
  const addSet = useCallback(() => {
    const uid = newUid('set');
    update((prev) => [...prev, { uid, songs: [] }]);
    return uid;
  }, [update]);
  const load = useCallback((list: GigSetlistSong[]) => update(() => setsFromGigSongs(list)), [update]);
  const discard = useCallback(() => {
    setDraft(null);
    setError(null);
  }, []);

  const save = useCallback(async (): Promise<boolean> => {
    if (!draft || saving) return !dirty;
    if (!dirty) {
      setDraft(null);
      return true;
    }
    setSaving(true);
    setError(null);
    const rows = rowsOf(draft);
    const after: SetlistEntry[] = rows.map((r) => ({ songId: r.song_id, setNumber: r.set_number }));
    try {
      let id = setlistId || null;
      let before: SetlistEntry[] = [];
      if (id) {
        const expected = baseRef.current ?? loadedOrder(songs);
        const { error: err, previous, conflict } = await replaceSetlistSongs(id, rows, { expected: { songs: expected } });
        if (err) throw err;
        if (conflict) {
          // Nothing written: the draft stays for the admin to look at again.
          setError(t('Someone else changed this setlist while you were editing. Your changes are still here, not saved yet.'));
          return false;
        }
        before = entriesFromRows(previous ?? []);
      } else {
        // A gig without a setlist yet: create it and link it to the gig.
        if (!bandId || !eventId) throw new Error(t('Could not save the setlist'));
        const name = eventTitle?.trim() ? t('{title} setlist', { title: eventTitle.trim() }) : t('Event setlist');
        const { data, error: err } = await createSetlist(
          { band_id: bandId, name, song_count: rows.length },
          // A new setlist: new rows, no ids from another one.
          rows.map(({ song_id, set_number }, i) => ({ song_id, set_number, position: i + 1 }))
        );
        if (err || !data?.id) throw err || new Error(t('Could not save the setlist'));
        id = data.id;
        const { error: linkErr } = await supabase.from('events').update({ setlist_id: id }).eq('id', eventId);
        if (linkErr) throw linkErr;
      }
      // Shown at once in the new order; the reload fills in keys and lengths.
      const next: GigSetlistSong[] = draft
        .filter((s) => s.songs.length > 0)
        .flatMap((s, i) =>
          s.songs.map((sg) => ({ ...(sg.source ?? {}), id: undefined, songId: sg.songId, setNumber: i + 1, title: sg.title, artist: sg.artist }))
        );
      setDraft(null);
      baseRef.current = null;
      haptic.confirm();
      onSaved(next, id);
      void notifySetlistSaved({ setlistId: id, eventId, change: diffSetlist(before, after) });
      return true;
    } catch (err) {
      setError(userMessage(err, t('Could not save the setlist')));
      return false;
    } finally {
      setSaving(false);
    }
  }, [draft, saving, dirty, setlistId, bandId, eventId, eventTitle, onSaved, t, songs]);

  return { sets, dirty, saving, error, reorder, remove, removeSongs, add, addSet, load, discard, save };
}

/** The editable list: sets, songs, Add songs (into the set you pick). */
export const GigSetlistEditor: React.FC<{
  draft: GigSetlistDraft;
  className?: string;
  /** Stacking of the set chooser and song picker (above the sheet that holds the list). */
  layerZ?: number;
  /** The band's saved setlists, offered as templates (as the Edit page did). */
  templatesBandId?: string | null;
}> = ({ draft, className, layerZ = 120, templatesBandId }) => {
  const t = useT();
  const { sets } = draft;
  const [templates, setTemplates] = useState<Setlist[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);
  useEffect(() => {
    if (!templatesBandId) return;
    let cancelled = false;
    getSetlists(templatesBandId).then(({ data }) => {
      if (!cancelled && data) setTemplates(data);
    });
    return () => {
      cancelled = true;
    };
  }, [templatesBandId]);
  const loadTemplate = async (sl: Setlist) => {
    const { data, error } = await getSetlist(sl.id);
    if (error) {
      setTemplateError(t('Couldn\'t load "{name}": {error}', { name: sl.name, error: error.message }));
      return;
    }
    setTemplateError(null);
    if (!data?.songs?.length) return;
    haptic.tap();
    draft.load(
      [...data.songs]
        .sort((a, b) => (a.set_number || 1) - (b.set_number || 1) || (a.position ?? 0) - (b.position ?? 0))
        .map((row) => ({ songId: row.song_id, setNumber: row.set_number || 1, title: row.song?.title || t('Untitled'), artist: row.song?.artist || undefined })),
    );
    setShowTemplates(false);
  };
  const [chooserOpen, setChooserOpen] = useState(false);
  const [pickerSet, setPickerSet] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const total = sets.reduce((n, s) => n + s.songs.length, 0);
  const visible = sets.filter((s) => s.songs.length > 0 || s.uid === pickerSet);
  const starts = setStartNumbers(visible);
  const titleOf = (uid: string | null) => {
    const i = sets.findIndex((s) => s.uid === uid);
    return t('Set {n}', { n: (i < 0 ? 0 : i) + 1 });
  };

  const openPicker = (setUid: string | null) => {
    setPickerSet(setUid);
    setPickerOpen(true);
  };
  // One set (or none yet): it is the one. More: ask which.
  const startAdd = () => {
    haptic.tap();
    if (sets.length > 1) setChooserOpen(true);
    else openPicker(sets[0]?.uid ?? null);
  };

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {total > 1 && <p className="bw-label-xs text-muted-foreground">{t('Long-press a song and drag to reorder')}</p>}
      {visible.map((set, i) => (
        <div key={set.uid} className="flex flex-col gap-1">
          {sets.length > 1 && <span className="bw-label-sm text-muted-foreground px-1">{titleOf(set.uid)}</span>}
          <SortableSongList
            songs={set.songs}
            startNumber={starts[i]}
            canReorder
            label={titleOf(set.uid)}
            onReorder={(list) => draft.reorder(set.uid, list)}
            onRemove={(uid) => draft.remove(set.uid, uid)}
          />
        </div>
      ))}
      {templates.length > 0 && (total === 0 || showTemplates) && (
        <div className="flex flex-col gap-2">
          <span className="bw-label-sm text-muted-foreground">{total > 0 ? t('Replace with a template') : t('Load from templates')}</span>
          <div className="flex flex-wrap gap-2">
            {templates.map((sl) => (
              <Selector key={sl.id} size="sm" selected={false} onClick={() => void loadTemplate(sl)}>
                <Folder className="w-3.5 h-3.5" />
                {sl.name}
                {sl.song_count != null && <span className="opacity-60">({sl.song_count})</span>}
              </Selector>
            ))}
          </div>
        </div>
      )}
      {templateError && <FormError>{templateError}</FormError>}
      <div className="flex flex-wrap items-center gap-2">
        <PillButton variant="outline" size="sm" fullWidth={false} icon={<Plus className="w-4 h-4" />} onClick={startAdd}>
          {t('Add songs')}
        </PillButton>
        {templates.length > 0 && total > 0 && (
          <PillButton variant="ghost" size="sm" fullWidth={false} icon={<Folder className="w-4 h-4" />} onClick={() => setShowTemplates((v) => !v)}>
            {t('Templates')}
          </PillButton>
        )}
      </div>

      <SetChooserSheet
        open={chooserOpen}
        zIndex={layerZ}
        sets={sets.map((s) => ({ uid: s.uid, title: titleOf(s.uid), count: s.songs.length }))}
        onClose={() => setChooserOpen(false)}
        onChoose={(uid) => {
          setChooserOpen(false);
          openPicker(uid);
        }}
        onNewSet={() => {
          setChooserOpen(false);
          openPicker(draft.addSet());
        }}
      />
      {typeof document !== 'undefined' &&
        createPortal(
          pickerOpen ? (
            <SongPicker
              isOpen
              multiSelect
              zIndex={layerZ + 2}
              overline={titleOf(pickerSet)}
              selectedIds={(sets.find((s) => s.uid === pickerSet) ?? sets[0])?.songs.map((sg) => sg.songId) ?? []}
              onClose={() => setPickerOpen(false)}
              onSelect={(song) => draft.add(pickerSet, [song])}
              // Unticking an "In set" song takes it out (Update setlist).
              onRemoveSelected={(ids) => draft.removeSongs(pickerSet, ids)}
              onSelectMultiple={(picked) => {
                draft.add(pickerSet, picked);
                setPickerOpen(false);
              }}
            />
          ) : null,
          document.body
        )}
    </div>
  );
};

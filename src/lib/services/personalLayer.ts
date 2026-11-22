/**
 * A person's own layer over a band song (109): notes and files only they see.
 * Tables song_personal_notes / song_personal_files (RLS user_id = auth.uid(),
 * no admin exception) and the private bucket personal-files (<user>/<song>/…).
 * The band song itself never changes here.
 */
import React from 'react';
import { supabase } from '../supabase';
import type { NoteAnchor, PersonalNote } from '../personalNotes';
import { classifySongFile, safeName, songFileContentType, validateSongFile, type SongFileKind } from './songFiles';
import { UserError } from '../userError';
import { personalFromPacks } from '../livePackStore';
import { isOfflineError } from '../offline/networkErrors';
import { applyNoteOps, queueLiveOp, readLiveOutbox } from '../liveOutbox';
import { newLocalId, sessionUserId } from '../sessionUser';
import { t } from '@/lib/i18n';

export const PERSONAL_BUCKET = 'personal-files';

export interface PersonalFile {
  id: string;
  song_id: string;
  name: string;
  kind: SongFileKind;
  ref: string;
  size?: number | null;
  created_at?: string;
  /** Kept on this device for live mode (the live pack, livePackFiles.ts). */
  local?: { path: string; directory: string };
}

// ── changes: every open view of the same song refreshes ──
export const PERSONAL_CHANGED = 'bw:personal-layer-changed';
export const notifyPersonalChanged = (songId: string) => changed(songId);
const changed = (songId: string) => {
  try {
    window.dispatchEvent(new CustomEvent(PERSONAL_CHANGED, { detail: { songId } }));
  } catch {
    /* no window (tests) */
  }
};

const uid = async () => (await supabase.auth.getUser()).data.user?.id ?? null;

/** My notes and files for a song from the live packs on this device (offline). */
const packedLayer = async (songId: string) => {
  try {
    const { data } = await supabase.auth.getSession();
    const me = data.session?.user?.id;
    if (!me) return null;
    return await personalFromPacks(me, songId);
  } catch {
    return null;
  }
};

export const fetchPersonalLayer = async (songId: string) => {
  const [n, f] = await Promise.all([
    supabase.from('song_personal_notes').select('id, song_id, anchor, body, created_at, updated_at').eq('song_id', songId).order('created_at'),
    supabase.from('song_personal_files').select('id, song_id, name, kind, ref, size, created_at').eq('song_id', songId).order('created_at'),
  ]);
  return {
    notes: ((n.data as PersonalNote[] | null) ?? []).filter((x) => x && x.anchor),
    files: (f.data as PersonalFile[] | null) ?? [],
    error: n.error || f.error || null,
  };
};

/** A note written with no signal and not sent yet: it lives only in the outbox. */
const waitingNew = (me: string | null, id?: string) =>
  !!me && !!id && readLiveOutbox(me).some((o) => o.kind === 'note' && o.id === id && o.isNew);

/**
 * Save my note. With no signal it is kept on this phone and sent when back
 * online (liveOutbox.ts): `queued`.
 */
/**
 * Save one of my notes. `owner`: the account signed in when Save was tapped.
 * If the session is someone else's by the time the request goes out (a
 * bandmate signed in on the same browser), nothing is written or queued;
 * the row names its owner too, so the database (user_id = auth.uid())
 * refuses it for any other session.
 */
export const savePersonalNote = async (
  songId: string,
  anchor: NoteAnchor,
  body: string,
  id?: string,
  owner?: string | null,
): Promise<{ error: unknown; queued?: true }> => {
  const text = body.trim().slice(0, 2000);
  const me = await sessionUserId();
  if (owner !== undefined && (!me || me !== owner)) {
    return { error: new UserError(t('Sign in again to save this note.')) };
  }
  const queue = (isNew: boolean) => {
    queueLiveOp(me!, { kind: 'note', id: id ?? newLocalId(), songId, anchor, body: text, isNew });
    changed(songId);
    return { error: null, queued: true as const };
  };
  if (waitingNew(me, id)) return queue(true);
  const res = id
    ? await (me
        ? supabase.from('song_personal_notes').update({ body: text, anchor }).eq('id', id).eq('user_id', me).select('id')
        : supabase.from('song_personal_notes').update({ body: text, anchor }).eq('id', id).select('id'))
    : await supabase.from('song_personal_notes').insert({ song_id: songId, anchor, body: text, ...(me ? { user_id: me } : {}) });
  if (res.error && me && isOfflineError(res.error)) return queue(!id);
  // An edit that matched no note (deleted on another device): nothing saved.
  if (!res.error && id && !(Array.isArray(res.data) && res.data.length > 0)) {
    return { error: new UserError(t('This note was deleted, maybe on another device. Nothing was saved.')) };
  }
  if (!res.error) changed(songId);
  return { error: res.error };
};

export const deletePersonalNote = async (songId: string, id: string): Promise<{ error: unknown; queued?: true }> => {
  const me = await sessionUserId();
  const queue = () => {
    queueLiveOp(me!, { kind: 'noteDelete', id, songId });
    changed(songId);
    return { error: null, queued: true as const };
  };
  if (waitingNew(me, id)) return queue();
  const res = await supabase.from('song_personal_notes').delete().eq('id', id);
  if (res.error && me && isOfflineError(res.error)) return queue();
  if (!res.error) changed(songId);
  return { error: res.error };
};

/** Upload one of my files for a song: <me>/<song>/<kind>/<id>-<name>. */
export const addPersonalFile = async (songId: string, file: File): Promise<{ error: Error | null }> => {
  const problem = validateSongFile(file);
  if (problem) return { error: new UserError(problem) };
  const kind = classifySongFile(file)!;
  const contentType = songFileContentType(file);
  if (!contentType) return { error: new UserError(t('This file type is not supported.')) };
  const me = await uid();
  if (!me) return { error: new UserError(t('Sign in again to add files.')) };
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}`;
  const path = `${me}/${songId}/${kind}/${id}-${safeName(file.name)}`;
  const up = await supabase.storage.from(PERSONAL_BUCKET).upload(path, file, { contentType, upsert: false, cacheControl: '3600' });
  if (up.error) return { error: new Error(up.error.message || 'Upload failed') };
  const ins = await supabase
    .from('song_personal_files')
    .insert({ song_id: songId, name: file.name.slice(0, 200) || 'file', kind, ref: `sb://${PERSONAL_BUCKET}/${path}`, size: file.size });
  if (ins.error) {
    await supabase.storage.from(PERSONAL_BUCKET).remove([path]).catch(() => undefined);
    return { error: ins.error };
  }
  changed(songId);
  return { error: null };
};

export const deletePersonalFile = async (file: PersonalFile) => {
  const res = await supabase.from('song_personal_files').delete().eq('id', file.id);
  if (res.error) return { error: res.error };
  const path = file.ref.replace(`sb://${PERSONAL_BUCKET}/`, '');
  await supabase.storage.from(PERSONAL_BUCKET).remove([path]).catch(() => undefined);
  changed(file.song_id);
  return { error: null };
};

/** My notes and files for one song, kept fresh after any change. */
export function usePersonalLayer(songId?: string | null) {
  const [state, setState] = React.useState<{ songId: string | null; notes: PersonalNote[]; files: PersonalFile[] }>({
    songId: null,
    notes: [],
    files: [],
  });
  React.useEffect(() => {
    if (!songId) return;
    let alive = true;
    const load = () =>
      fetchPersonalLayer(songId).then(async (r) => {
        if (!alive) return;
        // My changes still waiting on this phone show as done (plan §3.5).
        const me = await sessionUserId();
        const mine = (notes: PersonalNote[]) => applyNoteOps(notes, readLiveOutbox(me), songId);
        if (!r.error) {
          if (alive) setState({ songId, notes: mine(r.notes), files: r.files });
          return;
        }
        // No signal: my notes and files kept in a live pack (plan §3.1).
        const kept = await packedLayer(songId);
        if (alive) {
          if (kept) setState({ songId, notes: mine(kept.notes as PersonalNote[]), files: kept.files as PersonalFile[] });
          else setState((prev) => ({ songId, notes: mine(prev.songId === songId ? prev.notes : []), files: prev.songId === songId ? prev.files : [] }));
        }
      });
    load();
    const on = (e: Event) => {
      if ((e as CustomEvent).detail?.songId === songId) load();
    };
    window.addEventListener(PERSONAL_CHANGED, on);
    return () => {
      alive = false;
      window.removeEventListener(PERSONAL_CHANGED, on);
    };
  }, [songId]);
  return state.songId === songId ? state : { songId: songId ?? null, notes: [], files: [] };
}

// ── "My notes" on/off (per device) and the first-time explanation ──

const SHOW_KEY = 'bw-my-notes';
const INFO_KEY = 'bw-my-notes-info-seen';
const showListeners = new Set<() => void>();
const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* per-device preference */
  }
};

export function useShowMyNotes(): [boolean, (v: boolean) => void] {
  const [on, setOn] = React.useState(() => read(SHOW_KEY) !== '0');
  React.useEffect(() => {
    const l = () => setOn(read(SHOW_KEY) !== '0');
    showListeners.add(l);
    return () => {
      showListeners.delete(l);
    };
  }, []);
  const set = React.useCallback((v: boolean) => {
    write(SHOW_KEY, v ? '1' : '0');
    showListeners.forEach((l) => l());
  }, []);
  return [on, set];
}

export const myNotesInfoSeen = () => read(INFO_KEY) === '1';
export const markMyNotesInfoSeen = () => write(INFO_KEY, '1');

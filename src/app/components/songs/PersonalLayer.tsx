import React from 'react';
import { createPortal } from 'react-dom';
import { BwSheet } from '@/app/components/bw/Screen';
import { FormError, PillButton, Selector, Toggle } from '@/app/components/bw';
import { FileText, Info, Lock, Music2, Paperclip, Pencil, Send, StickyNote, Trash2, Users, X } from '@/app/components/icons';
import { haptic } from '@/lib/haptics';
import { cn } from '@/app/components/ui/utils';
import { useT } from '@/lib/i18n';
import { useOptionalAuth } from '@/lib/AuthContext';
import { userMessage } from '@/lib/userError';
import { chordLabel } from '@/lib/ireal';
import { ChordToken } from '@/app/components/ui/MusicSymbol';
import { anchorLabel, lineChords, lineKey, lineWords, lyricsLineText, placeNotes, songLineRefs, type LineRef, type NoteAnchor, type PersonalNote } from '@/lib/personalNotes';
import {
  addPersonalFile,
  deletePersonalFile,
  deletePersonalNote,
  markMyNotesInfoSeen,
  myNotesInfoSeen,
  savePersonalNote,
  usePersonalLayer,
  useShowMyNotes,
  type PersonalFile,
} from '@/lib/services/personalLayer';
import { openSongResource, SONG_FILE_ACCEPT } from '@/lib/services/songFiles';
import { openSuggestChange } from '@/lib/services/songSuggestions';

/**
 * "My notes": a person's own layer over a band song (109). Notes on the song,
 * a line, a word or a chord, and their own files, seen by nobody else (not
 * even admins). The band's song stays the same for everyone; "Suggest to the
 * band" turns a note into a suggestion (108).
 *
 * <PersonalLayerScope song> wraps a song view: <MyNotesBar /> and the lyrics
 * (LyricsText reads the scope to draw notes under their lines and, while
 * adding a note, to make lines tappable). <PersonalLayerSheets /> is mounted
 * once (AuthenticatedApp).
 */

export interface PersonalSong {
  id: string;
  band_id: string;
  title: string;
  lyrics?: string | null;
  notes?: string | null;
}

/**
 * Open one of my files: the copy kept on this device for live mode when
 * there's no signal (or the link can't be reached), else the stored file.
 */
const openMyFile = async (f: PersonalFile) => {
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (f.local && offline) {
    const { openPackFile } = await import('@/lib/livePackFiles');
    if (await openPackFile(f as never)) return;
  }
  const opened = await openSongResource(f.ref);
  if (!opened && f.local) {
    const { openPackFile } = await import('@/lib/livePackFiles');
    await openPackFile(f as never);
  }
};

// ── the sheets, opened from anywhere ──

/** Where a band note goes: the section and line held (rehearsal notes, 167). */
export type BandNoteAt = { section: string | null; line: string };

type SheetState =
  | { kind: 'note'; song: PersonalSong; anchor: NoteAnchor; line?: string; note?: PersonalNote }
  | { kind: 'line'; song: PersonalSong; ref: LineRef; section: string | null; onBandNote?: (at: BandNoteAt) => void }
  | { kind: 'info'; then?: () => void }
  | null;
let sheet: SheetState = null;
// The sheet lives outside React (opened from anywhere) and outlives the
// signed-in app: it belongs to the account signed in when it opened, and no
// other account ever sees it (audit 09 #1: after a sign-out and sign-in in
// another tab, the next account was shown the first one's private note).
let viewer: string | null = null;
let sheetOwner: string | null = null;
const sheetListeners = new Set<() => void>();
const setSheet = (s: SheetState) => {
  sheet = s;
  sheetOwner = s ? viewer : null;
  sheetListeners.forEach((l) => l());
};
const useSheet = () =>
  React.useSyncExternalStore(
    (l) => {
      sheetListeners.add(l);
      return () => sheetListeners.delete(l);
    },
    () => sheet,
    () => sheet,
  );

/** The first time: what "My notes" are, then the action. Later: the "i". */
const withInfo = (then: () => void) => {
  if (myNotesInfoSeen()) then();
  else setSheet({ kind: 'info', then });
};

// ── scope ──

interface ScopeValue {
  song: PersonalSong | null;
  stage: boolean;
  /** At a rehearsal (Live mode): holding a line can also write a band note there. */
  onBandNote?: (at: BandNoteAt) => void;
  show: boolean;
  setShow: (v: boolean) => void;
  picking: boolean;
  setPicking: (v: boolean) => void;
  notes: PersonalNote[];
  files: PersonalFile[];
  placed: ReturnType<typeof placeNotes>;
}
const Scope = React.createContext<ScopeValue | null>(null);
export const usePersonalScope = () => React.useContext(Scope);

export const PersonalLayerScope: React.FC<{
  song: PersonalSong | null;
  stage?: boolean;
  onBandNote?: (at: BandNoteAt) => void;
  children: React.ReactNode;
}> = ({ song, stage = false, onBandNote, children }) => {
  const layer = usePersonalLayer(song?.id);
  const [show, setShow] = useShowMyNotes();
  const [picking, setPicking] = React.useState(false);
  React.useEffect(() => setPicking(false), [song?.id]);
  const placed = React.useMemo(() => placeNotes(song?.lyrics, layer.notes), [song?.lyrics, layer.notes]);
  const value = React.useMemo<ScopeValue>(
    () => ({ song, stage, onBandNote, show, setShow, picking, setPicking, notes: layer.notes, files: layer.files, placed }),
    [song, stage, onBandNote, show, setShow, picking, layer.notes, layer.files, placed],
  );
  return <Scope.Provider value={value}>{children}</Scope.Provider>;
};

/** Lines of the drawn lyrics → their note refs ("section:index"). */
export const useLineRefs = (lyrics?: string | null) => {
  const scope = usePersonalScope();
  return React.useMemo(() => {
    if (!scope?.song) return null;
    const m = new Map<string, LineRef>();
    for (const r of songLineRefs(lyrics)) m.set(`${r.section}:${r.index}`, r);
    return m;
  }, [scope?.song, lyrics]);
};

export const openNoteFor = (song: PersonalSong, ref: LineRef | null, note?: PersonalNote) => {
  const anchor: NoteAnchor = note?.anchor ?? (ref ? { type: 'line', line: ref.key, occ: ref.occ } : { type: 'song' });
  setSheet({ kind: 'note', song, anchor, line: ref?.text, note });
};

/** Hold this long on a line for "Note on this line". */
export const HOLD_MS = 500;

/**
 * A drawn line of a song with My notes: hold it for "Note on this line" (for
 * me, or for the band at a rehearsal); while adding a note, tap it.
 */
export const PickableLine: React.FC<{ refLine: LineRef; sectionName?: string | null; children: React.ReactNode }> = ({ refLine, sectionName = null, children }) => {
  const t = useT();
  const scope = usePersonalScope();
  const timer = React.useRef<number | null>(null);
  const start = React.useRef<{ x: number; y: number } | null>(null);
  const held = React.useRef(false);
  React.useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);
  if (!scope?.song) return <>{children}</>;
  const song = scope.song;
  const cancel = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };
  const openMenu = () => {
    held.current = true;
    haptic.medium();
    scope.setPicking(false);
    setSheet({ kind: 'line', song, ref: refLine, section: sectionName, onBandNote: scope.onBandNote });
  };
  const hold = {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      held.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        openMenu();
      }, HOLD_MS);
    },
    // Scrolling the lyrics is not a hold.
    onPointerMove: (e: React.PointerEvent) => {
      if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onContextMenu: (e: React.MouseEvent) => {
      // Right click / the system's long press: the same menu, not the browser's.
      e.preventDefault();
      cancel();
      if (!held.current) openMenu();
    },
  };
  const pick = () => {
    scope.setPicking(false);
    openNoteFor(song, refLine);
  };
  if (!scope.picking) {
    return (
      <div {...hold} className="select-none [-webkit-touch-callout:none]">
        {children}
      </div>
    );
  }
  return (
    <div
      {...hold}
      role="button"
      tabIndex={0}
      aria-label={t('Add a note on this line')}
      onClick={() => {
        if (held.current) {
          held.current = false;
          return;
        }
        pick();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          pick();
        }
      }}
      className={cn(
        'rounded-lg -mx-2 px-2 my-0.5 cursor-pointer outline-dashed outline-2 -outline-offset-1 select-none [-webkit-touch-callout:none]',
        scope.stage ? 'outline-white/60 bg-white/5 active:bg-white/20' : 'outline-foreground/45 bg-foreground/[0.03] active:bg-foreground/10 hover:bg-foreground/5',
      )}
    >
      {children}
    </div>
  );
};

const NoteCard: React.FC<{ note: PersonalNote; line?: string; stage: boolean; onOpen: () => void }> = ({ note, line, stage, onOpen }) => {
  const t = useT();
  const label = anchorLabel(note.anchor, line);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t('My note: {text}', { text: note.body })}
      className={cn(
        'w-full text-left flex gap-2 items-start border-l-[3px] border-accent pl-3 pr-2 py-1 my-1 rounded-r-lg text-[0.62em] leading-snug font-normal',
        stage ? 'bg-white/10 text-white' : 'bg-accent/15 text-foreground',
      )}
    >
      <StickyNote className="w-[1.1em] h-[1.1em] shrink-0 mt-[0.15em]" aria-hidden />
      <span className="min-w-0 break-words whitespace-pre-wrap">
        {label && <strong className="font-bold mr-1">{note.anchor.type === 'chord' ? chordLabel(label) : `“${label}”`}</strong>}
        {note.body}
      </span>
    </button>
  );
};

/** My notes under one drawn line (nothing when "My notes" is off). */
export const LineNotes: React.FC<{ id: string; line: string }> = ({ id, line }) => {
  const scope = usePersonalScope();
  if (!scope?.show || !scope.song) return null;
  const notes = scope.placed.byLine.get(id);
  if (!notes?.length) return null;
  const song = scope.song;
  return (
    <>
      {notes.map((n) => (
        <NoteCard key={n.id} note={n} line={line} stage={scope.stage} onOpen={() => openNoteFor(song, refFor(song, n, line), n)} />
      ))}
    </>
  );
};

const refFor = (_song: PersonalSong, n: PersonalNote, line?: string): LineRef | null =>
  n.anchor.type === 'song' || !line ? null : { section: 0, index: 0, key: lineKey(line), occ: 'occ' in n.anchor ? n.anchor.occ : 0, text: line };

// ── the bar: on/off, i, add note, add file, my files, notes on the song ──

export const MyNotesBar: React.FC<{ className?: string }> = ({ className }) => {
  const t = useT();
  const scope = usePersonalScope();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  if (!scope?.song) return null;
  const { song, stage, show, setShow, picking, setPicking, files, placed } = scope;
  const muted = stage ? 'text-white/60' : 'text-muted-foreground';
  // Stage: compact buttons, so the bar stays one row above the lyrics.
  const btn = cn(
    'min-h-9 rounded-full bw-label-sm flex items-center justify-center gap-1.5 border whitespace-nowrap',
    stage ? 'h-11' : 'px-3',
    stage ? 'border-white/30 text-white' : 'border-border text-foreground',
  );

  const pickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setError(null);
    const { error: err } = await addPersonalFile(song.id, file);
    setBusy(false);
    if (err) setError(userMessage(err, t('Couldn’t add the file. Try again.')));
  };

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 min-h-9 cursor-pointer">
          <Toggle checked={show} onCheckedChange={(v) => withInfo(() => setShow(v))} aria-label={t('My notes')} />
          <span className={cn('bw-label-sm', stage ? 'text-white' : 'text-foreground')}>{t('My notes')}</span>
        </label>
        <button
          type="button"
          onClick={() => setSheet({ kind: 'info' })}
          aria-label={t('About my notes')}
          className={cn('w-9 h-9 rounded-full flex items-center justify-center', muted)}
        >
          <Info className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2 ml-auto">
          {/* Always here: adding a note turns My notes on (no need to switch them on first). */}
          <button
            type="button"
            aria-label={t('Add note')}
            aria-pressed={picking}
            onClick={() =>
              withInfo(() => {
                if (!picking) setShow(true);
                setPicking(!picking);
              })
            }
            className={cn(btn, stage && 'px-3', picking && (stage ? 'bg-white text-black border-white' : 'bg-foreground text-background border-foreground'))}
          >
            <Pencil className="w-4 h-4" aria-hidden />
            {stage ? t('Note') : t('Add note')}
          </button>
          {show && (
            <>
              <button type="button" title={t('Add file')} disabled={busy} onClick={() => withInfo(() => fileRef.current?.click())} className={cn(btn, stage && 'w-11', busy && 'opacity-60')}>
                <Paperclip className="w-4 h-4" />
                {stage ? <span className="sr-only">{busy ? t('Uploading…') : t('Add file')}</span> : busy ? t('Uploading…') : t('Add file')}
              </button>
              <input ref={fileRef} type="file" accept={SONG_FILE_ACCEPT} className="hidden" onChange={pickFile} />
            </>
          )}
        </div>
      </div>
      {picking && (
        <PickingBar
          stage={stage}
          onWholeSong={() => {
            setPicking(false);
            openNoteFor(song, null);
          }}
          onCancel={() => setPicking(false)}
        />
      )}
      {show && files.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={t('My files')}>
          {files.map((f) => (
            <li key={f.id} className={cn('flex items-center rounded-full border max-w-full', stage ? 'border-accent text-white' : 'border-accent bg-accent/15')}>
              <button type="button" onClick={() => void openMyFile(f)} className="flex items-center gap-1.5 min-h-9 pl-3 pr-1 min-w-0 bw-label-sm">
                {f.kind === 'audio' ? <Music2 className="w-4 h-4 shrink-0" /> : <FileText className="w-4 h-4 shrink-0" />}
                <span className="truncate normal-case">{f.name}</span>
              </button>
              <button
                type="button"
                aria-label={t('Remove {name}', { name: f.name })}
                onClick={async () => {
                  if (!window.confirm(t('Remove this file? Only you had it.'))) return;
                  const { error: err } = await deletePersonalFile(f);
                  if (err) setError(userMessage(err, t('Couldn’t remove the file. Try again.')));
                }}
                className="w-9 h-9 flex items-center justify-center shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {show && placed.song.length > 0 && (
        <div className="flex flex-col" style={{ fontSize: 24 }}>
          {placed.song.map((n) => (
            <NoteCard key={n.id} note={n} stage={stage} onOpen={() => openNoteFor(song, null, n)} />
          ))}
        </div>
      )}
      {error && <p className={cn('bw-body-sm', stage ? 'text-white' : 'text-destructive')} role="alert">{error}</p>}
    </div>
  );
};

/**
 * While adding a note: a bar fixed at the bottom of the screen (it doesn't
 * scroll away with the lyrics). Portaled to body, so it sits over Stage and
 * the Duo's hubs alike.
 */
const PickingBar: React.FC<{ stage: boolean; onWholeSong: () => void; onCancel: () => void }> = ({ stage, onWholeSong, onCancel }) => {
  const t = useT();
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  const bar = (
    <div
      role="status"
      aria-label={t('Adding a note')}
      className="fixed inset-x-0 bottom-0 z-[160] flex justify-center px-4 pointer-events-none"
      style={{ paddingBottom: 'calc(var(--safe-bottom, 0px) + 16px)' }}
    >
      <div
        className={cn(
          'pointer-events-auto w-full max-w-xl flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[24px] pl-5 pr-2 py-2 shadow-lg',
          stage ? 'bg-white text-black' : 'bg-foreground text-background',
        )}
      >
        <Pencil className="w-5 h-5 shrink-0" aria-hidden />
        <span className="bw-label-md flex-1 min-w-[10rem]">{t('Tap the line for your note')}</span>
        <span className="flex items-center gap-1 ml-auto">
          <button type="button" onClick={onWholeSong} className="min-h-11 px-3 rounded-full bw-label-sm underline underline-offset-2">
            {t('Whole song')}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className={cn('min-h-11 px-4 rounded-full bw-label-sm border', stage ? 'border-black/25' : 'border-background/40')}
          >
            {t('Cancel')}
          </button>
        </span>
      </div>
    </div>
  );
  return typeof document === 'undefined' ? bar : createPortal(bar, document.body);
};

/** "Note saved on “…”": where the note went, for a moment. */
let savedMsg: string | null = null;
let savedOwner: string | null = null;
const savedListeners = new Set<() => void>();
const setSaved = (m: string | null) => {
  savedMsg = m;
  savedOwner = m ? viewer : null;
  savedListeners.forEach((l) => l());
};
const SavedToast: React.FC = () => {
  const uid = useOptionalAuth()?.user?.id ?? null;
  const shown = React.useSyncExternalStore(
    (l) => {
      savedListeners.add(l);
      return () => savedListeners.delete(l);
    },
    () => savedMsg,
    () => savedMsg,
  );
  // It quotes a line of the song: only for the account that saved the note.
  const msg = shown && savedOwner === uid ? shown : null;
  React.useEffect(() => {
    if (!msg) return;
    const id = window.setTimeout(() => setSaved(null), 3500);
    return () => window.clearTimeout(id);
  }, [msg]);
  const node = (
    <div role="status" aria-live="polite" className="fixed inset-x-0 bottom-0 z-[170] flex justify-center px-4 pointer-events-none" style={{ paddingBottom: 'calc(var(--safe-bottom, 0px) + 16px)' }}>
      {msg && (
        <p className="pointer-events-auto max-w-xl flex items-center gap-2 rounded-full bg-foreground text-background px-5 py-3 bw-label-md shadow-lg">
          <StickyNote className="w-5 h-5 shrink-0" aria-hidden />
          <span className="min-w-0 break-words">{msg}</span>
        </p>
      )}
    </div>
  );
  return typeof document === 'undefined' ? node : createPortal(node, document.body);
};

// ── sheets ──

export const PersonalLayerSheets: React.FC = () => (
  <>
    <Sheets />
    <SavedToast />
  </>
);

const Sheets: React.FC = () => {
  const t = useT();
  const uid = useOptionalAuth()?.user?.id ?? null;
  viewer = uid;
  const open = useSheet();
  // Opened under another account: never shown, and dropped.
  const s = open && sheetOwner === uid ? open : null;
  React.useEffect(() => {
    if (open && sheetOwner !== uid) setSheet(null);
  }, [open, uid]);
  const [, setShow] = useShowMyNotes();
  const [body, setBody] = React.useState('');
  const [anchor, setAnchor] = React.useState<NoteAnchor>({ type: 'song' });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (s?.kind !== 'note') return;
    setBody(s.note?.body ?? '');
    setAnchor(s.anchor);
    setError(null);
  }, [s]);

  const close = () => {
    if (busy) return;
    setSheet(null);
  };

  if (s?.kind === 'line') {
    const { song, ref, section, onBandNote } = s;
    const text = lyricsLineText(ref.text);
    const choice = 'w-full min-h-14 px-4 py-3 rounded-[20px] border border-border flex items-center gap-3 text-left';
    return (
      <BwSheet open onClose={() => setSheet(null)} overline={song.title} title={t('Note on this line')} zIndex={165}>
        <div className="dark flex flex-col gap-3">
          <p className="bw-body-lg text-foreground">“{text}”</p>
          <button
            type="button"
            className={choice}
            onClick={() =>
              withInfo(() => {
                setShow(true);
                openNoteFor(song, ref);
              })
            }
          >
            <Lock className="w-5 h-5 shrink-0" aria-hidden />
            <span className="flex flex-col">
              <span className="bw-label-md">{t('Note for me')}</span>
              <span className="bw-body-sm text-muted-foreground">{t('Only you see it, on this line.')}</span>
            </span>
          </button>
          {onBandNote && (
            <button
              type="button"
              className={choice}
              onClick={() => {
                setSheet(null);
                onBandNote({ section, line: text });
              }}
            >
              <Users className="w-5 h-5 shrink-0" aria-hidden />
              <span className="flex flex-col">
                <span className="bw-label-md">{t('Note for the band')}</span>
                <span className="bw-body-sm text-muted-foreground">{t('A rehearsal note on this point: the whole band sees it.')}</span>
              </span>
            </button>
          )}
        </div>
      </BwSheet>
    );
  }

  if (s?.kind === 'info' || !s) {
    const then = s?.kind === 'info' ? s.then : undefined;
    return (
      <BwSheet
        open={s?.kind === 'info'}
        onClose={() => {
          markMyNotesInfoSeen();
          setSheet(null);
        }}
        overline={t('My notes')}
        title={t('Only you see them')}
        zIndex={165}
        footer={
          <PillButton
            onClick={() => {
              markMyNotesInfoSeen();
              setSheet(null);
              then?.();
            }}
          >
            {t('Got it')}
          </PillButton>
        }
      >
        <div className="flex flex-col gap-3 bw-body-md">
          <p className="flex gap-3 items-start">
            <Lock className="w-5 h-5 shrink-0 mt-0.5" />
            {t('Your notes and files are yours only: nobody else in the band sees them, admins included.')}
          </p>
          <p className="flex gap-3 items-start">
            <StickyNote className="w-5 h-5 shrink-0 mt-0.5" />
            {t('Put a note on the whole song, a line, a word or a chord. On Stage they show over the band’s version; turn My notes off to hide them.')}
          </p>
          <p className="flex gap-3 items-start">
            <Send className="w-5 h-5 shrink-0 mt-0.5" />
            {t('The band’s song doesn’t change for the others. To change it for everyone, use Suggest to the band.')}
          </p>
        </div>
      </BwSheet>
    );
  }

  const { song, line, note } = s;
  const words = line ? lineWords(line) : [];
  const chords = line ? lineChords(line) : [];
  const base = anchor.type === 'song' ? null : { line: anchor.line, occ: anchor.occ };
  const canSave = body.trim().length > 0 && !busy;

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    const { error: err, queued } = await savePersonalNote(song.id, anchor, body, note?.id);
    setBusy(false);
    if (err) setError(userMessage(err, t('Couldn’t save the note. Try again.')));
    else {
      setSheet(null);
      haptic.confirm();
      setSaved(
        queued
          ? t('Note saved on this phone. It reaches your account when you’re back online.')
          : anchor.type !== 'song' && line
          ? t('Note saved on “{line}”', { line: lyricsLineText(line) })
          : t('Note saved on the whole song'),
      );
    }
  };
  const remove = async () => {
    if (!note || busy) return;
    setBusy(true);
    const { error: err } = await deletePersonalNote(song.id, note.id);
    setBusy(false);
    if (err) setError(userMessage(err, t('Couldn’t delete the note. Try again.')));
    else setSheet(null);
  };
  const suggest = () => {
    setSheet(null);
    // "“Lanterns in the rain” · Am: let it ring", so the admin knows where.
    const label = anchorLabel(anchor, line);
    const at = anchor.type === 'chord' && label ? chordLabel(label) : label;
    const where = line ? [`“${lyricsLineText(line)}”`, at].filter(Boolean).join(' · ') : null;
    openSuggestChange({
      id: song.id,
      band_id: song.band_id,
      title: song.title,
      lyrics: song.lyrics,
      notes: song.notes,
      start: 'note',
      note: where ? `${where}: ${body.trim()}` : body.trim(),
    });
  };

  return (
    <BwSheet
      open
      onClose={close}
      overline={note ? t('My note') : t('New note')}
      title={song.title}
      zIndex={165}
      footer={
        <div className="flex flex-col gap-2">
          <PillButton onClick={save} disabled={!canSave} loading={busy}>
            {t('Save note')}
          </PillButton>
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <button type="button" onClick={suggest} disabled={!body.trim()} className="min-h-11 px-4 rounded-full bw-label-sm flex items-center gap-2 disabled:opacity-40">
              <Send className="w-4 h-4" />
              {t('Suggest to the band')}
            </button>
            {note && (
              <button type="button" onClick={remove} disabled={busy} className="min-h-11 px-4 rounded-full bw-label-sm flex items-center gap-2 text-destructive">
                <Trash2 className="w-4 h-4" />
                {t('Delete note')}
              </button>
            )}
          </div>
        </div>
      }
    >
      <div className="dark flex flex-col gap-4">
        <p className="flex items-center gap-2 bw-body-sm text-muted-foreground">
          <Lock className="w-4 h-4 shrink-0" />
          {t('Only you see this note. The band’s song doesn’t change.')}
        </p>
        {line && base && (
          <div className="flex flex-col gap-2">
            <p className="bw-body-md text-foreground">“{lyricsLineText(line)}”</p>
            <div className="flex flex-wrap gap-2" role="group" aria-label={t('Note on')}>
              <Selector selected={anchor.type === 'line'} onClick={() => setAnchor({ type: 'line', ...base })}>
                {t('Whole line')}
              </Selector>
              {words.map((w, i) => (
                <Selector key={`w${i}`} selected={anchor.type === 'word' && anchor.word === i} onClick={() => setAnchor({ type: 'word', ...base, word: i })}>
                  <span className="normal-case">{w}</span>
                </Selector>
              ))}
              {chords.map((c) => (
                <Selector key={`c${c}`} selected={anchor.type === 'chord' && anchor.chord === c} onClick={() => setAnchor({ type: 'chord', ...base, chord: c })}>
                  <span className="normal-case font-bold"><ChordToken token={c} /></span>
                </Selector>
              ))}
            </div>
          </div>
        )}
        <label className="flex flex-col gap-2 p-4 rounded-[24px] bg-field border border-border focus-within:border-2 focus-within:border-foreground transition-[border-color]">
          <span className="flex items-center gap-2 bw-label-sm text-muted-foreground">
            <StickyNote className="w-4 h-4" />
            {t('My note')}
          </span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={line ? t('e.g. Breathe before this line') : t('e.g. Watch the tempo in the bridge')}
            rows={4}
            maxLength={2000}
            className="w-full bg-transparent outline-none bw-body-lg text-foreground placeholder:text-muted-foreground/60 min-h-[96px] resize-none"
          />
        </label>
        {error && <FormError>{error}</FormError>}
      </div>
    </BwSheet>
  );
};

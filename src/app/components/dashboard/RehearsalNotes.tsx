import React, { useEffect, useMemo, useState } from 'react';
import { BwSheet, PillButton, Selector, FormError } from '@/app/components/bw';
import { Check, Pencil, Plus, StickyNote, Trash2 } from '@/app/components/icons';
import { haptic } from '@/lib/haptics';
import { useT } from '@/lib/i18n';
import { cn } from '@/app/components/ui/utils';
import { formatClock } from '@/lib/rehearsalSession';
import { sectionLabel } from '@/lib/songFormat';
import { voiceClass, voicePartLabel } from '@/app/components/ui/VoiceParts';
import { isFlagOn, useFlag } from '@/lib/appFlags';
import {
  MAX_BODY,
  assigneesAllowed,
  canDeleteNote,
  canEditNote,
  canMarkOk,
  groupBySong,
  isForMe,
  linePart,
  myNoteState,
  presetsFor,
  sectionLines,
  songSections,
  validateNote,
  type NotePreset,
  type RehearsalNote,
} from '@/lib/rehearsalNotes';
import type { RehearsalNotesControls } from '@/app/components/event/useRehearsalNotes';
import { dismissRejected, OUTBOX_EVENT, readRejected, rejectedKey, type RejectedNote } from '@/lib/rehearsalNotesOutbox';
import type { EarlierNotes } from './FromLastTime';

type T = ReturnType<typeof useT>;

/** A song the notes can be about (the rehearsal's focus songs). */
export interface NoteSong {
  songId?: string;
  title: string;
  lyrics?: string | null;
}

/** Someone a note can be for (the rehearsal's members). */
export interface NoteMember {
  userId?: string;
  name: string;
}

export const presetLabel = (p: NotePreset, t: T) =>
  ({
    review: t('Review', { context: 'note' }),
    repeat_section: t('Repeat a section'),
    tempo: t('Tempo'),
    key: t('Key'),
    ending: t('Ending'),
    solo: t('Solo'),
    nailed: t('Nailed it'),
  })[p];

/**
 * Where in the song: "Chorus · “Lanterns in the rain”" (empty for the whole
 * song). With the song's lyrics, a line sung by a part says so: "Chorus ·
 * Backing · line 2 · “(ooh, yeah)”" (not with voice_parts switched off, docs/flags.md).
 */
export function noteWhere(n: Pick<RehearsalNote, 'section' | 'line'>, t: T, lyrics?: string | null): string {
  const part = n.line && isFlagOn('voice_parts') ? linePart(lyrics, n.section, n.line) : null;
  return [
    n.section ? sectionLabel(n.section, t) : '',
    part && part.voice !== 'lead' ? `${voicePartLabel(part.voice, t)} · ${t('line {n}', { n: part.index })}` : '',
    n.line ? `“${n.line}”` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** "Tempo · Verse 3", "Chorus · “Hold on”: too fast", "Bridge too fast", "Marked at 12:34". */
export function noteHeadline(n: RehearsalNote, t: T, lyrics?: string | null): string {
  if (n.status === 'marked') return n.markedAtS != null ? t('Marked at {time}', { time: formatClock(n.markedAtS) }) : t('Marked');
  const where = noteWhere(n, t, lyrics);
  if (n.preset) return [presetLabel(n.preset, t), where].filter(Boolean).join(' · ');
  if (where) return n.body ? `${where}: ${n.body}` : where;
  return n.body || '';
}

const forLabel = (n: RehearsalNote, members: NoteMember[], t: T) => {
  if (n.scope === 'band') return t('For the band');
  const names = n.assignees.map((a) => members.find((m) => m.userId === a.userId)?.name ?? t('Member'));
  return t('For {names}', { names: names.join(', ') });
};

const stateLabel = (n: RehearsalNote, userId: string | undefined, t: T) => {
  const s = myNoteState(n, userId);
  if (s === 'ok') return t('OK', { context: 'note' });
  if (s === 'practised') return t('Practised');
  if (s === 'marked') return t('To write');
  return t('Open', { context: 'note' });
};

// --------------------------------------------------------------- editor --

/**
 * Write a note (or a mark): the song, a preset, a section when the song has
 * structure, text, and who it's for. Members write for the band or for
 * themselves; admins assign anyone (plan §5 Q-A1).
 */
export const NoteEditorSheet: React.FC<{
  open: boolean;
  note: RehearsalNote | null;
  controls: RehearsalNotesControls;
  songs: NoteSong[];
  members: NoteMember[];
  onClose: () => void;
}> = ({ open, note, controls, songs, members, onClose }) => {
  const t = useT();
  const [draft, setDraft] = useState<RehearsalNote | null>(note);
  const [tried, setTried] = useState(false);
  // Kill switch voice_parts (docs/flags.md): off, the line picker shows plain lines.
  const voicesOn = useFlag('voice_parts');
  useEffect(() => {
    if (open) {
      setDraft(note);
      setTried(false);
    }
  }, [open, note]);

  const songOptions = useMemo(() => {
    const list = songs.filter((s): s is NoteSong & { songId: string } => !!s.songId);
    if (draft?.songId && !list.some((s) => s.songId === draft.songId)) {
      list.push({ songId: draft.songId, title: draft.songTitle ?? t('Song') });
    }
    return list;
  }, [songs, draft?.songId, draft?.songTitle, t]);

  if (!draft) return <BwSheet open={false} onClose={onClose} title="" />;
  const lyrics = songs.find((s) => s.songId === draft.songId)?.lyrics ?? null;
  const presets = draft.songId ? presetsFor(lyrics) : presetsFor(null).filter((p) => p !== 'nailed');
  // Where in the song (any note on a song with structure) and, optionally, one line of it.
  const sections = songSections(lyrics);
  if (draft.section && !sections.includes(draft.section)) sections.push(draft.section);
  const lines = sectionLines(lyrics, draft.section);
  if (draft.line && !lines.includes(draft.line)) lines.push(draft.line);
  const hadLine = !!note?.line;
  const setWhere = (section: string | null, line: string | null) => set({ section, line: line ?? (hadLine ? '' : null) });
  const writing = { ...draft, status: draft.status === 'marked' ? ('open' as const) : draft.status };
  const problem = validateNote(writing);
  const me = controls.userId;
  const pickable = controls.isAdmin ? members.filter((m) => !!m.userId) : members.filter((m) => m.userId === me);
  const assigned = draft.assignees.map((a) => a.userId);
  const set = (p: Partial<RehearsalNote>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const toggleAssignee = (uid: string) => {
    const next = assigned.includes(uid) ? assigned.filter((a) => a !== uid) : [...assigned, uid];
    if (!assigneesAllowed(controls.isAdmin, me ?? '', next)) return;
    set({ assignees: next.map((u) => draft.assignees.find((a) => a.userId === u) ?? { userId: u, practisedAt: null }) });
  };
  const save = () => {
    setTried(true);
    if (problem) return;
    // "For members" with nobody picked is a note for the band.
    const scope = draft.scope === 'members' && assigned.length > 0 ? 'members' : 'band';
    haptic.confirm();
    controls.save({ ...writing, scope, assignees: scope === 'band' ? [] : draft.assignees });
    onClose();
  };
  const problemText =
    problem === 'empty'
      ? t('Pick what to work on or write a few words.')
      : problem === 'section'
        ? t('Pick the section to repeat.')
        : problem === 'too_long'
          ? t('Up to {max} characters.', { max: MAX_BODY })
          : null;

  return (
    <BwSheet
      open={open}
      onClose={onClose}
      closeLabel={t('Close sheet')}
      overline={draft.status === 'marked' && draft.markedAtS != null ? t('Marked at {time}', { time: formatClock(draft.markedAtS) }) : t('Rehearsal note')}
      title={draft.id ? t('Edit note') : t('New note')}
      footer={
        <div className="flex gap-3">
          {draft.id && canDeleteNote(draft, me, controls.isAdmin) && (
            <PillButton
              variant="outline"
              icon={<Trash2 className="w-4 h-4" />}
              onClick={() => {
                haptic.tap();
                controls.remove(draft.id);
                onClose();
              }}
            >
              {t('Delete')}
            </PillButton>
          )}
          <PillButton icon={<Check className="w-4 h-4" />} onClick={save} disabled={tried && !!problem}>
            {t('Save note')}
          </PillButton>
        </div>
      }
    >
      <div className="dark flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <span className="bw-label-sm text-muted-foreground">{t('Song')}</span>
          <div className="flex flex-wrap gap-2" role="group" aria-label={t('Song')}>
            {songOptions.map((s) => (
              <Selector
                key={s.songId}
                size="md"
                selected={draft.songId === s.songId}
                onClick={() =>
                  set({ songId: s.songId, songTitle: s.title, section: null, line: hadLine ? '' : null, preset: draft.preset === 'repeat_section' ? null : draft.preset })
                }
              >
                {s.title}
              </Selector>
            ))}
            <Selector
              size="md"
              selected={!draft.songId}
              onClick={() =>
                set({ songId: null, songTitle: null, section: null, line: hadLine ? '' : null, preset: draft.preset === 'nailed' || draft.preset === 'repeat_section' ? null : draft.preset })
              }
            >
              {t('General')}
            </Selector>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="bw-label-sm text-muted-foreground">{t('What to work on')}</span>
          <div className="flex flex-wrap gap-2" role="group" aria-label={t('What to work on')}>
            {presets.map((p) => (
              <Selector key={p} size="md" selected={draft.preset === p} onClick={() => set({ preset: draft.preset === p ? null : p })}>
                {presetLabel(p, t)}
              </Selector>
            ))}
          </div>
        </div>

        {!!draft.songId && sections.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="bw-label-sm text-muted-foreground">
              {draft.preset === 'repeat_section' ? t('Section to repeat') : t('Where in the song')}
            </span>
            <div className="flex flex-wrap gap-2" role="group" aria-label={t('Where in the song')}>
              {draft.preset !== 'repeat_section' && (
                <Selector size="md" selected={!draft.section} onClick={() => setWhere(null, null)}>
                  {t('Whole song')}
                </Selector>
              )}
              {sections.map((s) => (
                <Selector key={s} size="md" selected={draft.section === s} onClick={() => setWhere(s, null)}>
                  {sectionLabel(s, t)}
                </Selector>
              ))}
            </div>
          </div>
        )}

        {!!draft.songId && lines.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="bw-label-sm text-muted-foreground">{t('Line (optional)')}</span>
            <div className="flex flex-col gap-1" role="group" aria-label={t('Line (optional)')}>
              {lines.map((l) => {
                const on = draft.line === l;
                return (
                  <button
                    key={l}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setWhere(draft.section, on ? null : l)}
                    className={cn(
                      'text-left min-h-11 px-4 py-2 rounded-2xl border bw-body-md transition-colors',
                      on ? 'bg-foreground text-background border-foreground' : 'border-border text-foreground hover:bg-foreground/5',
                    )}
                  >
                    {(() => {
                      const part = voicesOn ? linePart(lyrics, draft.section, l) : null;
                      return part && part.voice !== 'lead' ? (
                        <span className="flex flex-col">
                          <span className="bw-label-xs opacity-70">{voicePartLabel(part.voice, t)}</span>
                          <span className={on ? undefined : voiceClass(part.voice)}>{l}</span>
                        </span>
                      ) : (
                        l
                      );
                    })()}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <label className="flex flex-col gap-2 p-4 rounded-[24px] bg-field border border-border focus-within:border-2 focus-within:border-foreground transition-[border-color]">
          <span className="flex items-center gap-2 bw-label-sm text-muted-foreground">
            <StickyNote className="w-4 h-4" />
            {t('Note')}
          </span>
          <textarea
            value={draft.body ?? ''}
            onChange={(e) => set({ body: e.target.value })}
            placeholder={t('e.g. Bridge rushes, count it in')}
            rows={3}
            maxLength={MAX_BODY}
            className="w-full bg-transparent outline-none bw-body-lg text-foreground placeholder:text-muted-foreground/60 min-h-[72px] resize-none"
          />
        </label>

        <div className="flex flex-col gap-2">
          <span className="bw-label-sm text-muted-foreground">{t('Who it’s for')}</span>
          <div className="flex flex-wrap gap-2" role="group" aria-label={t('Who it’s for')}>
            <Selector size="md" selected={draft.scope === 'band'} onClick={() => set({ scope: 'band', assignees: [] })}>
              {t('Whole band')}
            </Selector>
            {pickable.map((m) => (
              <Selector
                key={m.userId}
                size="md"
                selected={draft.scope === 'members' && assigned.includes(m.userId!)}
                onClick={() => {
                  if (draft.scope !== 'members') {
                    set({ scope: 'members', assignees: [{ userId: m.userId!, practisedAt: null }] });
                  } else toggleAssignee(m.userId!);
                }}
              >
                {m.userId === me ? t('Me') : m.name}
              </Selector>
            ))}
          </div>
        </div>
        {tried && problemText && <FormError>{problemText}</FormError>}
      </div>
    </BwSheet>
  );
};

// ----------------------------------------------------------------- list --

/** One note: what, for whom, its state, and what I can do with it. */
export const NoteItem: React.FC<{
  note: RehearsalNote;
  controls: RehearsalNotesControls;
  members: NoteMember[];
  onEdit: (n: RehearsalNote) => void;
  dark?: boolean;
  /** The song's lyrics: a line's voice part in the headline. */
  lyrics?: string | null;
}> = ({ note, controls, members, onEdit, dark, lyrics }) => {
  const t = useT();
  // The headline names the line's part only with voice_parts on: redraw when it flips.
  useFlag('voice_parts');
  const me = controls.userId;
  const mine = note.assignees.some((a) => a.userId === me);
  const state = myNoteState(note, me);
  const pill = cn(
    'flex items-center gap-1.5 min-h-11 px-3 rounded-full bw-label-sm whitespace-nowrap border',
    dark ? 'border-white/40 text-white' : 'border-border text-foreground',
  );
  const on = dark ? 'bg-white text-black border-white' : 'bg-foreground text-background border-foreground';
  const headline = noteHeadline(note, t, lyrics);
  return (
    <li className={cn('flex flex-col gap-2 py-3 border-b last:border-b-0', dark ? 'border-white/15' : 'border-border')} aria-label={headline}>
      <span className="flex items-baseline justify-between gap-3">
        <span className="bw-label-md min-w-0">{headline}</span>
        <span className={cn('bw-label-xs shrink-0', dark ? 'text-white/70' : 'text-muted-foreground')}>{stateLabel(note, me, t)}</span>
      </span>
      {note.body && note.status !== 'marked' && !!note.preset && (
        <span className={cn('bw-body-sm whitespace-pre-wrap', dark ? 'text-white/85' : 'text-foreground')}>{note.body}</span>
      )}
      <span className={cn('bw-body-sm', dark ? 'text-white/60' : 'text-muted-foreground')}>{forLabel(note, members, t)}</span>
      <span className="flex flex-wrap gap-2">
        {note.status === 'marked' && canEditNote(note, me, controls.isAdmin) && (
          <button type="button" className={cn(pill, on)} onClick={() => onEdit(note)}>
            <Pencil className="w-4 h-4" aria-hidden /> {t('Write', { context: 'note' })}
          </button>
        )}
        {mine && note.status === 'open' && (
          <button
            type="button"
            aria-pressed={state === 'practised'}
            className={cn(pill, state === 'practised' && on)}
            onClick={() => {
              haptic.tap();
              controls.practised(note.id, state !== 'practised');
            }}
          >
            <Check className="w-4 h-4" aria-hidden /> {t('Practised')}
          </button>
        )}
        {canMarkOk(note, me, controls.isAdmin) && (
          <button
            type="button"
            aria-pressed={note.status === 'ok'}
            className={cn(pill, note.status === 'ok' && on)}
            onClick={() => {
              haptic.confirm();
              controls.ok(note.id, note.status !== 'ok');
            }}
          >
            <Check className="w-4 h-4" aria-hidden /> {t('OK', { context: 'note' })}
          </button>
        )}
        {note.status !== 'marked' && canEditNote(note, me, controls.isAdmin) && (
          <button type="button" className={pill} onClick={() => onEdit(note)} aria-label={t('Edit note: {title}', { title: headline })}>
            <Pencil className="w-4 h-4" aria-hidden /> {t('Edit')}
          </button>
        )}
      </span>
    </li>
  );
};

/** The notes grouped by song (setlist order), general notes last. */
export const NoteGroups: React.FC<{
  notes: RehearsalNote[];
  songs: NoteSong[];
  controls: RehearsalNotesControls;
  members: NoteMember[];
  onEdit: (n: RehearsalNote) => void;
  dark?: boolean;
}> = ({ notes, songs, controls, members, onEdit, dark }) => {
  const t = useT();
  const groups = groupBySong(notes, songs.map((s) => s.songId ?? '').filter(Boolean));
  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => (
        <section key={g.songId ?? 'general'} aria-label={g.title ?? t('General')} className="flex flex-col">
          <span className={cn('bw-label-sm uppercase', dark ? 'text-white/60' : 'text-muted-foreground')}>{g.title ?? t('General')}</span>
          <ul className="flex flex-col">
            {g.notes.map((n) => (
              <NoteItem key={n.id} note={n} controls={controls} members={members} onEdit={onEdit} dark={dark} lyrics={songs.find((s) => s.songId === n.songId)?.lyrics} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
};

/** The words of a note the band couldn't take, to copy: its lyric line too (#296 round 8). */
const rejectedText = (n: RehearsalNote, t: T) =>
  [n.songTitle, n.preset ? presetLabel(n.preset, t) : '', n.section ? sectionLabel(n.section, t) : '', n.line ? `“${n.line}”` : '', n.body]
    .filter(Boolean)
    .join(' · ') || noteHeadline(n, t);

/**
 * Notes the server refused for good (no longer allowed, the rehearsal gone):
 * they are not saved, but their words are still here to copy (audit 06 #5).
 */
export const RejectedNotes: React.FC<{ controls: RehearsalNotesControls; dark?: boolean }> = ({ controls, dark }) => (
  <RejectedNotesList notes={controls.rejected ?? []} onRemove={(id) => controls.dismissRejected?.(id)} dark={dark} />
);

/**
 * Every note of mine the server refused, whatever rehearsal it was for (one
 * deleted meanwhile included): Settings › Offline & live (#296).
 */
export const RejectedNotesForUser: React.FC<{ userId?: string | null }> = ({ userId }) => {
  const [notes, setNotes] = useState<RejectedNote[]>(() => readRejected(userId));
  useEffect(() => {
    const sync = () => setNotes(readRejected(userId));
    sync();
    window.addEventListener(OUTBOX_EVENT, sync);
    return () => window.removeEventListener(OUTBOX_EVENT, sync);
  }, [userId]);
  return <RejectedNotesList notes={notes} onRemove={(id) => userId && dismissRejected(userId, id)} />;
};

const RejectedNotesList: React.FC<{ notes: RejectedNote[]; onRemove: (id: string) => void; dark?: boolean }> = ({ notes: list, onRemove, dark }) => {
  const t = useT();
  const [copied, setCopied] = useState<string | null>(null);
  /** A note the clipboard refused (none in this browser, or blocked): say so, the text stays selectable. */
  const [copyFailed, setCopyFailed] = useState<string | null>(null);
  if (!list.length) return null;
  const pill = cn(
    'flex items-center gap-1.5 min-h-11 px-3 rounded-full bw-label-sm whitespace-nowrap border',
    dark ? 'border-white/40 text-white' : 'border-border text-foreground',
  );
  const copy = async (id: string, text: string) => {
    haptic.tap();
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
      await navigator.clipboard.writeText(text);
      setCopyFailed(null);
      setCopied(id);
    } catch {
      setCopied(null);
      setCopyFailed(id);
    }
  };
  return (
    <section
      aria-label={t('Not saved')}
      className={cn('flex flex-col gap-2 rounded-[12px] border p-3 min-w-0', dark ? 'border-white/30 text-white' : 'border-border')}
    >
      {/* Static text: read once as a status, not an alert (#296 round 3). */}
      <span className="bw-label-sm" role="status">
        {t("These notes weren't saved. Copy what you need, then remove them.")}
      </span>
      <ul className="flex flex-col">
        {list.map((note) => {
          // One entry per refused version (#296 round 6): keyed by it, removed by it.
          const n = { ...note, id: rejectedKey(note) };
          const text = rejectedText(note, t);
          const short = text.length > 60 ? `${text.slice(0, 59)}…` : text;
          return (
            <li key={n.id} className={cn('flex flex-col gap-2 py-2 border-b last:border-b-0 min-w-0', dark ? 'border-white/15' : 'border-border')}>
              <span className="bw-body-sm whitespace-pre-wrap break-words select-text">{text}</span>
              <span className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={pill}
                  // The same name after a copy: "Copied" is announced once, by the live region below (Claude r8 N3).
                  aria-label={t('Copy note: {note}', { note: short })}
                  onClick={() => void copy(n.id, text)}
                >
                  {copied === n.id ? t('Copied') : t('Copy')}
                </button>
                <button type="button" className={pill} aria-label={t('Remove note: {note}', { note: short })} onClick={() => onRemove(n.id)}>
                  {t('Remove')}
                </button>
              </span>
              {n.spaceFull && (
                // The device had no room to keep it apart: it is only here now (#296 round 4).
                <span className={cn('bw-label-sm', dark ? 'text-white' : 'text-destructive')}>{t('Space full: copy your note now')}</span>
              )}
              <span className={cn('bw-body-sm', dark ? 'text-white' : 'text-destructive')} aria-live="polite">
                {copyFailed === n.id ? t('Couldn’t copy. Select the text and copy it yourself.') : null}
                {copied === n.id ? <span className="sr-only">{t('Copied')}</span> : null}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

/** All the rehearsal's notes, in a sheet (Live mode). */
export const NotesListSheet: React.FC<{
  open: boolean;
  controls: RehearsalNotesControls;
  songs: NoteSong[];
  members: NoteMember[];
  onEdit: (n: RehearsalNote) => void;
  onNew: () => void;
  onClose: () => void;
}> = ({ open, controls, songs, members, onEdit, onNew, onClose }) => {
  const t = useT();
  const { notes } = controls;
  return (
    <BwSheet
      open={open}
      onClose={onClose}
      closeLabel={t('Close sheet')}
      overline={controls.waiting > 0 ? t('Saved when back online') : t('Rehearsal')}
      title={t('Notes · {count}', { count: notes.length })}
      footer={
        <PillButton icon={<Plus className="w-4 h-4" />} onClick={onNew}>
          {t('New note')}
        </PillButton>
      }
    >
      <div className="dark flex flex-col gap-3">
        <RejectedNotes controls={controls} dark />
        {notes.length === 0 ? (
          <p className="bw-body-md text-muted-foreground">{t('No notes yet. Tap Mark while you play, write it at the pause.')}</p>
        ) : (
          <NoteGroups notes={notes} songs={songs} controls={controls} members={members} onEdit={onEdit} />
        )}
      </div>
    </BwSheet>
  );
};

// ---------------------------------------------------- live mode pieces --

/** What Live mode (and the Laptop pose) needs for notes. */
export interface LiveNotes {
  controls: RehearsalNotesControls;
  songs: NoteSong[];
  members: NoteMember[];
  /** Seconds into the session now (null before it starts). */
  elapsed: () => number | null;
  /** Open notes from earlier rehearsals on these songs (A3): the badges. */
  earlier?: EarlierNotes;
}

/** Which sheet is up: the list, or a note being written. */
export function useNoteSheets(controls: RehearsalNotesControls | undefined) {
  const [listOpen, setListOpen] = useState(false);
  const [editing, setEditing] = useState<RehearsalNote | null>(null);
  const newNote = (m: Partial<RehearsalNote> = {}) => {
    const d = controls?.draft(m);
    if (d) setEditing(d);
  };
  return { listOpen, setListOpen, editing, setEditing, newNote };
}

export type NoteSheets = ReturnType<typeof useNoteSheets>;

/** The two sheets, for whatever screen holds the notes. */
export const NoteSheetsHost: React.FC<{
  sheets: NoteSheets;
  controls: RehearsalNotesControls;
  songs: NoteSong[];
  members: NoteMember[];
  /** The song the new note is about (Live mode: the one playing). */
  currentSongId?: string | null;
}> = ({ sheets, controls, songs, members, currentSongId }) => {
  const current = songs.find((s) => s.songId === currentSongId);
  return (
    <>
      <NotesListSheet
        open={sheets.listOpen && !sheets.editing}
        controls={controls}
        songs={songs}
        members={members}
        onEdit={(n) => sheets.setEditing(n)}
        onNew={() => sheets.newNote(current ? { songId: current.songId!, songTitle: current.title } : {})}
        onClose={() => sheets.setListOpen(false)}
      />
      <NoteEditorSheet
        open={!!sheets.editing}
        note={sheets.editing}
        controls={controls}
        songs={songs}
        members={members}
        onClose={() => sheets.setEditing(null)}
      />
    </>
  );
};

/** Marks still to write (status 'marked'), mine first. */
export const marksToWrite = (c: RehearsalNotesControls) =>
  c.notes.filter((n) => n.status === 'marked' && canEditNote(n, c.userId, c.isAdmin));

/** The line under Mark: a refused note first (audit 06 #5), then changes waiting for a signal. */
const notSavedStatus = (c: RehearsalNotesControls, t: T) =>
  c.rejected?.length ? t("A note wasn't saved") : c.waiting > 0 ? t('Saved when back online') : '';

/**
 * Live mode: Mark (one tap: this song, this minute) and the notes. At the
 * pause it says how many marks are waiting to be written.
 */
export const RehearsalNotesBar: React.FC<{
  controls: RehearsalNotesControls;
  sheets: NoteSheets;
  onMark: () => void;
  accentColor: string;
  paused?: boolean;
  className?: string;
}> = ({ controls, sheets, onMark, accentColor, paused, className }) => {
  const t = useT();
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (!flash) return;
    const id = window.setTimeout(() => setFlash(false), 1600);
    return () => window.clearTimeout(id);
  }, [flash]);
  const toWrite = marksToWrite(controls).length;
  const pill = 'flex items-center justify-center gap-2 min-h-11 px-4 rounded-full bw-label-sm whitespace-nowrap';
  return (
    <section aria-label={t('Rehearsal notes')} className={cn('flex items-center gap-2 shrink-0 min-w-0', className)}>
      <button
        type="button"
        onClick={() => {
          haptic.confirm();
          onMark();
          setFlash(true);
        }}
        className={cn(pill, 'border border-white text-white')}
      >
        <Plus className="w-4 h-4" aria-hidden /> {t('Mark', { context: 'note' })}
      </button>
      <button
        type="button"
        onClick={() => {
          haptic.tap();
          sheets.setListOpen(true);
        }}
        className={cn(pill, paused && toWrite > 0 ? 'text-black' : 'border border-white/40 text-white')}
        style={paused && toWrite > 0 ? { backgroundColor: accentColor } : undefined}
      >
        <StickyNote className="w-4 h-4" aria-hidden />
        {toWrite > 0 ? t('To write: {count}', { count: toWrite }) : t('Notes · {count}', { count: controls.notes.length })}
      </button>
      <span className="bw-label-xs text-white/70 truncate min-w-0" role="status" aria-live="polite">
        {flash ? t('Marked') : notSavedStatus(controls, t)}
      </span>
    </section>
  );
};

/**
 * iPhone Duo, Laptop pose: the notes pad on the deck. Mark, a preset in one
 * tap for the song playing, or Write… for the full note.
 */
export const WedgeNotesPad: React.FC<{
  controls: RehearsalNotesControls;
  sheets: NoteSheets;
  song: NoteSong | null;
  onMark: () => void;
}> = ({ controls, sheets, song, onMark }) => {
  const t = useT();
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    if (!flash) return;
    const id = window.setTimeout(() => setFlash(null), 1600);
    return () => window.clearTimeout(id);
  }, [flash]);
  // One-tap presets need nothing else (no section to pick).
  const quick = (song?.songId ? presetsFor(song.lyrics) : []).filter((p) => p !== 'repeat_section');
  const chip = 'flex items-center gap-1.5 min-h-11 px-3 rounded-full bw-label-sm whitespace-nowrap border border-white/40 text-white';
  return (
    <section aria-label={t('Notes pad')} className="flex flex-col gap-2 shrink-0">
      <div className="flex items-center gap-2 overflow-x-auto -mx-4 px-4 [scrollbar-width:none]">
        <button
          type="button"
          onClick={() => {
            haptic.confirm();
            onMark();
            setFlash(t('Marked'));
          }}
          className={cn(chip, 'bg-white text-black border-white')}
        >
          <Plus className="w-4 h-4" aria-hidden /> {t('Mark', { context: 'note' })}
        </button>
        {song?.songId &&
          quick.map((p) => (
            <button
              key={p}
              type="button"
              className={chip}
              onClick={() => {
                const d = controls.draft({ songId: song.songId!, songTitle: song.title, preset: p });
                if (!d) return;
                haptic.confirm();
                controls.save(d);
                setFlash(t('Saved: {what}', { what: presetLabel(p, t) }));
              }}
            >
              {presetLabel(p, t)}
            </button>
          ))}
        <button
          type="button"
          className={chip}
          onClick={() => sheets.newNote(song?.songId ? { songId: song.songId, songTitle: song.title } : {})}
        >
          <Pencil className="w-4 h-4" aria-hidden /> {t('Write…')}
        </button>
        <button type="button" className={chip} onClick={() => sheets.setListOpen(true)}>
          <StickyNote className="w-4 h-4" aria-hidden /> {t('Notes · {count}', { count: controls.notes.length })}
        </button>
      </div>
      <span className="bw-label-xs text-white/70 min-h-4" role="status" aria-live="polite">
        {flash ?? notSavedStatus(controls, t)}
      </span>
    </section>
  );
};

// ------------------------------------------------------- rehearsal page --

/** The rehearsal's page: its notes, what's for me first. */
export const RehearsalNotesSection: React.FC<{
  controls: RehearsalNotesControls;
  songs: NoteSong[];
  members: NoteMember[];
  sheets: NoteSheets;
}> = ({ controls, songs, members, sheets }) => {
  const t = useT();
  const forMe = controls.notes.filter((n) => isForMe(n, controls.userId) && n.status !== 'ok').length;
  return (
    <div className="bg-card rounded-[16px] p-4 flex flex-col gap-3" role="group" aria-label={t('Rehearsal notes')}>
      <span className="flex items-baseline justify-between gap-3">
        <span className="bw-body-sm text-muted-foreground">
          {controls.notes.length === 0 ? t('No notes yet.') : t('Open for you: {count}', { count: forMe })}
          {controls.waiting > 0 ? ` · ${t('Saved when back online')}` : ''}
        </span>
        <button
          type="button"
          className="flex items-center gap-1.5 min-h-11 px-3 rounded-full bw-label-sm border border-border"
          onClick={() => sheets.newNote()}
        >
          <Plus className="w-4 h-4" aria-hidden /> {t('New note')}
        </button>
      </span>
      <RejectedNotes controls={controls} />
      {controls.notes.length > 0 && (
        <NoteGroups notes={controls.notes} songs={songs} controls={controls} members={members} onEdit={(n) => sheets.setEditing(n)} />
      )}
    </div>
  );
};

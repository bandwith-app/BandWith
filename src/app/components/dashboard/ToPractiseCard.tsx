import React from 'react';
import { Check, ChevronRight } from '@/app/components/icons';
import { haptic } from '@/lib/haptics';
import { useT, intlLocale } from '@/lib/i18n';
import { parseLocalDate } from '@/lib/dates';
import { cn } from '@/app/components/ui/utils';
import { myNoteState, type RehearsalNote } from '@/lib/rehearsalNotes';
import type { PractiseGroup } from '@/lib/toPractise';
import { noteHeadline } from './RehearsalNotes';

/** Songs shown on Home; the rest are counted. */
const MAX_SONGS = 4;

export const shortDay = (date: string) => {
  const d = parseLocalDate(date);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString(intlLocale('en-US'), { day: 'numeric', month: 'short' });
};

/** One note: what, from which rehearsal, and Practised (when it's mine to tick). */
export const PractiseNoteRow: React.FC<{
  note: RehearsalNote;
  userId?: string;
  onPractised?: (id: string, value: boolean) => void;
  /** Who wrote it ("Marco"), when known. */
  author?: string;
  /** The song's lyrics, when at hand: a line's voice part in the headline. */
  lyrics?: string | null;
}> = ({ note, userId, onPractised, author, lyrics }) => {
  const t = useT();
  const mine = note.scope === 'members' && note.assignees.some((a) => a.userId === userId);
  const done = myNoteState(note, userId) === 'practised';
  const headline = noteHeadline(note, t, lyrics);
  return (
    <li className="flex items-center gap-3 min-h-11 py-1" aria-label={headline}>
      <span className="flex flex-col min-w-0 flex-1">
        <span className="bw-body-md min-w-0 break-words">{headline}</span>
        <span className="bw-body-sm text-muted-foreground">
          {[note.body && note.preset ? note.body : null, author, shortDay(note.date)].filter(Boolean).join(' · ')}
        </span>
      </span>
      {mine && onPractised && (
        <button
          type="button"
          aria-pressed={done}
          onClick={() => {
            haptic.tap();
            onPractised(note.id, !done);
          }}
          className={cn(
            'flex items-center gap-1.5 min-h-11 px-3 rounded-full bw-label-sm whitespace-nowrap border shrink-0',
            done ? 'bg-foreground text-background border-foreground' : 'border-border',
          )}
        >
          <Check className="w-4 h-4" aria-hidden /> {t('Practised')}
        </button>
      )}
    </li>
  );
};

/**
 * Home "To practise" (plan A3): songs with open rehearsal notes for me or the
 * band, newest rehearsal first. A song opens its page (lyrics, the notes).
 */
export const ToPractiseCard: React.FC<{
  groups: PractiseGroup[];
  userId?: string;
  onOpenSong?: (songId: string) => void;
  onPractised: (id: string, value: boolean) => void;
}> = ({ groups, userId, onOpenSong, onPractised }) => {
  const t = useT();
  const shown = groups.slice(0, MAX_SONGS);
  const more = groups.length - shown.length;
  return (
    <div className="flex flex-col gap-3">
      {shown.map((g) => (
        <section key={g.songId} aria-label={t('To practise · {title}', { title: g.title ?? t('Song') })} className="rounded-[24px] p-4 flex flex-col gap-2 bg-card text-card-foreground min-w-0">
          <button
            type="button"
            disabled={!onOpenSong}
            onClick={() => onOpenSong?.(g.songId)}
            className="flex items-center justify-between gap-3 min-h-11 text-left min-w-0"
            aria-label={t('Open {title}', { title: g.title ?? t('Song') })}
          >
            <span className="flex flex-col min-w-0">
              <span className="bw-h3 line-clamp-2 break-words">{g.title ?? t('Song')}</span>
              <span className="bw-label-sm text-muted-foreground">{t('From the rehearsal of {date}', { date: shortDay(g.lastDate) })}</span>
            </span>
            {onOpenSong && <ChevronRight className="w-5 h-5 shrink-0 text-muted-foreground" aria-hidden />}
          </button>
          <ul className="flex flex-col divide-y divide-border">
            {g.notes.map((n) => (
              <PractiseNoteRow key={n.id} note={n} userId={userId} onPractised={onPractised} />
            ))}
          </ul>
        </section>
      ))}
      {more > 0 && <span className="bw-body-sm text-muted-foreground">{t('More songs: {count}', { count: more })}</span>}
    </div>
  );
};

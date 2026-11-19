import React from 'react';
import { BwSheet } from '@/app/components/bw';
import { Check } from '@/app/components/icons';
import { haptic } from '@/lib/haptics';
import { useT } from '@/lib/i18n';
import { cn } from '@/app/components/ui/utils';
import { canMarkOk, type RehearsalNote } from '@/lib/rehearsalNotes';
import type { PractiseGroup } from '@/lib/toPractise';
import { PractiseNoteRow } from './ToPractiseCard';

/** Open notes from earlier rehearsals, and what to do with them (plan A3). */
export interface EarlierNotes {
  notes: RehearsalNote[];
  userId?: string;
  isAdmin: boolean;
  practised: (id: string, value: boolean) => void;
  ok: (id: string, value: boolean) => void;
}

/** A note from last time with OK (the band has it now) for whoever may close it. */
const EarlierRow: React.FC<{ note: RehearsalNote; earlier: EarlierNotes; dark?: boolean }> = ({ note, earlier, dark }) => {
  const t = useT();
  const done = note.status === 'ok';
  return (
    <div className="flex items-center gap-2 min-w-0">
      <ul className="flex-1 min-w-0">
        <PractiseNoteRow note={note} userId={earlier.userId} onPractised={earlier.practised} />
      </ul>
      {canMarkOk(note, earlier.userId, earlier.isAdmin) && (
        <button
          type="button"
          aria-pressed={done}
          onClick={() => {
            haptic.confirm();
            earlier.ok(note.id, !done);
          }}
          className={cn(
            'flex items-center gap-1.5 min-h-11 px-3 rounded-full bw-label-sm whitespace-nowrap border shrink-0',
            done
              ? dark
                ? 'bg-white text-black border-white'
                : 'bg-foreground text-background border-foreground'
              : dark
                ? 'border-white/40 text-white'
                : 'border-border',
          )}
        >
          <Check className="w-4 h-4" aria-hidden /> {t('OK', { context: 'note' })}
        </button>
      )}
    </div>
  );
};

/** The next rehearsal's page: "From last time", open notes on its songs. */
export const FromLastTimeSection: React.FC<{ groups: PractiseGroup[]; earlier: EarlierNotes }> = ({ groups, earlier }) => {
  const t = useT();
  return (
    <div className="bg-card rounded-[16px] p-4 flex flex-col gap-4" role="group" aria-label={t('From last time')}>
      {groups.map((g) => (
        <section key={g.songId} aria-label={g.title ?? t('Song')} className="flex flex-col gap-1">
          <span className="bw-label-sm uppercase text-muted-foreground">{g.title ?? t('Song')}</span>
          <div className="flex flex-col divide-y divide-border">
            {g.notes.map((n) => (
              <EarlierRow key={n.id} note={n} earlier={earlier} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
};

/** Live mode: a song's notes from last time (its badge opens it), to mark OK or keep. */
export const EarlierNotesSheet: React.FC<{
  songId: string | null;
  title: string;
  earlier: EarlierNotes;
  onClose: () => void;
}> = ({ songId, title, earlier, onClose }) => {
  const t = useT();
  const list = songId ? earlier.notes.filter((n) => n.songId === songId) : [];
  return (
    <BwSheet open={!!songId} onClose={onClose} closeLabel={t('Close sheet')} overline={t('From last time')} title={title}>
      <div className="dark flex flex-col divide-y divide-border">
        {list.map((n) => (
          <EarlierRow key={n.id} note={n} earlier={earlier} />
        ))}
      </div>
    </BwSheet>
  );
};

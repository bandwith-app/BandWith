import React, { useState } from 'react';
import { useT } from '@/lib/i18n';
import { haptic } from '@/lib/haptics';
import { useOptionalAuth } from '@/lib/AuthContext';
import { useOptionalBand } from '@/lib/BandContext';
import { useBandFlag } from '@/lib/flags';
import { songChangeFromNote, songNotes, type SongChange } from '@/lib/toPractise';
import type { RehearsalNote } from '@/lib/rehearsalNotes';
import { useBandNotes } from '@/app/components/event/useBandNotes';
import { PractiseNoteRow, shortDay } from '@/app/components/dashboard/ToPractiseCard';
import { noteHeadline } from '@/app/components/dashboard/RehearsalNotes';
import { openSuggestChange } from '@/lib/services/songSuggestions';
import { updateSong } from '@/lib/services/songs';

const changeLabel = (c: SongChange, t: ReturnType<typeof useT>) =>
  c.kind === 'tempo' ? t('{bpm} BPM', { bpm: c.bpm }) : t('Key: {key}', { key: c.key });

/**
 * The song page (plan A3): "From rehearsals", the band's open notes on this
 * song (above My notes; 109 stays private and untouched). Practised for the
 * ones for me. A Tempo or Key note naming the value becomes a song change:
 * members suggest it (108), admins set it on the song.
 */
export const FromRehearsalStrip: React.FC<{
  songId: string;
  bandId: string;
  title: string;
  lyrics?: string | null;
  className?: string;
}> = ({ songId, bandId, title, lyrics, className }) => {
  const t = useT();
  const userId = useOptionalAuth()?.user?.id;
  const band = useOptionalBand();
  const isAdmin = !!band?.isAdmin && band?.selectedBand?.id === bandId;
  const on = useBandFlag(bandId, 'rehearsal_notes');
  const { notes, practised } = useBandNotes(bandId, userId, on);
  const [applied, setApplied] = useState<Record<string, 'saving' | 'done' | 'error'>>({});
  const list = songNotes(notes, songId, userId);
  if (!on || list.length === 0) return null;

  const change = (n: RehearsalNote, c: SongChange) => {
    haptic.tap();
    if (!isAdmin) {
      const what = `${changeLabel(c, t)} · ${t('From the rehearsal of {date}', { date: shortDay(n.date) })}`;
      openSuggestChange({ id: songId, band_id: bandId, title, lyrics, start: 'note', note: n.body ? `${what}\n${n.body}` : what });
      return;
    }
    setApplied((s) => ({ ...s, [n.id]: 'saving' }));
    void updateSong(songId, c.kind === 'tempo' ? { bpm: c.bpm } : { key: c.key }).then(({ error }) =>
      setApplied((s) => ({ ...s, [n.id]: error ? 'error' : 'done' })),
    );
  };

  return (
    <details open className={className ?? 'mb-4 rounded-[20px] bg-card text-card-foreground px-4 py-3'} aria-label={t('From rehearsals')}>
      <summary className="bw-label-sm text-muted-foreground cursor-pointer select-none">{t('From rehearsals · {count}', { count: list.length })}</summary>
      <ul className="flex flex-col divide-y divide-border pt-1">
        {list.map((n) => {
          const c = songChangeFromNote(n);
          const state = applied[n.id];
          return (
            <React.Fragment key={n.id}>
              <PractiseNoteRow note={n} userId={userId} onPractised={practised} />
              {c && (
                <li className="flex items-center gap-2 pb-2 border-t-0">
                  <button
                    type="button"
                    disabled={state === 'saving' || state === 'done'}
                    onClick={() => change(n, c)}
                    aria-label={
                      isAdmin
                        ? t('Set on the song: {what}', { what: changeLabel(c, t) })
                        : t('Suggest to the band: {what}', { what: changeLabel(c, t) })
                    }
                    className="min-h-11 px-3 rounded-full bw-label-sm border border-border disabled:opacity-60"
                  >
                    {state === 'done'
                      ? t('Saved: {what}', { what: changeLabel(c, t) })
                      : isAdmin
                        ? t('Set on the song: {what}', { what: changeLabel(c, t) })
                        : t('Suggest to the band: {what}', { what: changeLabel(c, t) })}
                  </button>
                  {state === 'error' && <span className="bw-body-sm text-destructive">{t('Not saved')}</span>}
                  <span className="sr-only">{noteHeadline(n, t)}</span>
                </li>
              )}
            </React.Fragment>
          );
        })}
      </ul>
    </details>
  );
};

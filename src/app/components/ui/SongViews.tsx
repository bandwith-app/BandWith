import React from 'react';
import { useOptionalBand } from '@/lib/BandContext';
import { useOptionalAuth } from '@/lib/AuthContext';
import { useT } from '@/lib/i18n';
import { transposeChord } from '@/lib/transpose';
import { chordLabel } from '@/lib/ireal';
import {
  availableViews,
  defaultSongView,
  resolveView,
  sectionLabel,
  sectionProgressions,
  SONG_VIEWS,
  type SongContent,
  type SongView,
} from '@/lib/songFormat';
import { ChordChartView } from './ChordChart';
import { LyricsText } from './LyricsViewer';
import { useTranspose } from './Transpose';
import { cn } from './utils';

const VIEW_KEY = 'bw-song-view';
const listeners = new Set<() => void>();

const readChoice = (): SongView | null => {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v && (SONG_VIEWS as string[]).includes(v) ? (v as SongView) : null;
  } catch {
    return null;
  }
};

/**
 * The song view this person reads: the one they last picked on this device,
 * else the one for their instrument in the band (singers: lyrics; guitar,
 * keys, bass: chords; drums and horns: structure). Shared by the lyrics
 * reader and Stage mode, so one tap changes both.
 */
export function useSongViewPreference(): [SongView, (v: SongView) => void] {
  const band = useOptionalBand();
  const auth = useOptionalAuth();
  const uid = auth?.user?.id;
  const instrument = band?.selectedBand?.members?.find((m) => m.user_id === uid)?.instrument ?? null;
  const [choice, setChoice] = React.useState<SongView | null>(readChoice);
  React.useEffect(() => {
    const l = () => setChoice(readChoice());
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  const set = React.useCallback((v: SongView) => {
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* per-device preference */
    }
    setChoice(v);
    listeners.forEach((l) => l());
  }, []);
  return [choice ?? defaultSongView(instrument), set];
}

export const songViewLabel = (v: SongView, t: (k: string) => string) =>
  v === 'lyrics' ? t('Lyrics') : v === 'chords' ? t('Chords') : t('Structure');

/** Lyrics · Chords · Structure: one tap switches (only the views this song has). */
export const SongViewTabs: React.FC<{
  song: SongContent;
  view: SongView;
  onChange: (v: SongView) => void;
  className?: string;
  /** Classes of the selected and the other tabs (Stage mode is always dark). */
  on?: string;
  off?: string;
}> = ({ song, view, onChange, className, on = 'bg-foreground text-background', off = 'text-muted-foreground' }) => {
  const t = useT();
  const views = availableViews(song);
  if (views.length < 2) return null;
  return (
    <div role="tablist" aria-label={t('Song view')} className={cn('flex items-center gap-1', className)}>
      {views.map((v) => (
        <button
          key={v}
          type="button"
          role="tab"
          aria-selected={view === v}
          onClick={() => onChange(v)}
          className={cn('min-h-9 px-3 rounded-full bw-label-sm transition-colors whitespace-nowrap', view === v ? on : off)}
        >
          {songViewLabel(v, t)}
        </button>
      ))}
    </div>
  );
};

/**
 * Structure from the lyrics when there's no chart: each section with its
 * chord progression, as boxes.
 */
const LyricsStructure: React.FC<{ lyrics: string; size: number; muted: string; line: string; className?: string }> = ({
  lyrics,
  size,
  muted,
  line,
  className,
}) => {
  const t = useT();
  const { semitones, flats } = useTranspose();
  const sections = React.useMemo(() => sectionProgressions(lyrics), [lyrics]);
  return (
    <div className={className ?? 'w-full flex flex-col gap-6 pt-4'} style={{ fontSize: size, lineHeight: 1.2 }}>
      {sections.map((s, i) => (
        <section key={i} className="flex flex-col gap-2">
          {s.name && <h3 className={cn('bw-label-md uppercase', muted)}>{sectionLabel(s.name, t)}</h3>}
          {s.chords.length > 0 ? (
            <div className="grid grid-cols-4 gap-y-[0.5em]">
              {s.chords.map((c, j) => (
                <span key={j} className={cn('border-l px-[0.4em] min-h-[1.6em] flex items-center font-semibold whitespace-nowrap', line)}>
                  {chordLabel(transposeChord(c, semitones, flats))}
                </span>
              ))}
            </div>
          ) : (
            <p className={cn('bw-body-sm', muted)}>{t('No chords in this section.')}</p>
          )}
        </section>
      ))}
    </div>
  );
};

/** A song in the chosen view (or the nearest one it has). */
export const SongBody: React.FC<{
  song: SongContent;
  view: SongView;
  size: number;
  muted?: string;
  line?: string;
  className?: string;
  chartClassName?: string;
}> = ({ song, view, size, muted = 'text-muted-foreground', line = 'border-border', className, chartClassName }) => {
  const t = useT();
  const shown = resolveView(view, song);
  if (!shown) return <p className={cn('bw-body-lg', muted)}>{t('No lyrics for this song yet.')}</p>;
  if (shown === 'structure') {
    return song.chart ? (
      <ChordChartView chart={song.chart} size={size} muted={muted} line={line} className={chartClassName} />
    ) : (
      <LyricsStructure lyrics={song.lyrics || ''} size={size} muted={muted} line={line} className={className} />
    );
  }
  if (shown === 'chords' && !/\[[A-G]/.test(song.lyrics || '') && song.chart) {
    // No chords in the lyrics: the chart is what there is to play.
    return <ChordChartView chart={song.chart} size={size} muted={muted} line={line} className={chartClassName} />;
  }
  return <LyricsText lyrics={song.lyrics} size={size} muted={muted} className={className} hideChords={shown === 'lyrics'} />;
};

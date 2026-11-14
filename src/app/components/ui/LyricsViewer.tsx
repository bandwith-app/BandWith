import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Minus, Music2, Pause, Play, Plus, X } from '@/app/components/icons';
import { IconButton } from '@/app/components/bw/Screen';
import { LineNotes, MyNotesBar, PersonalLayerScope, PickableLine, useLineRefs } from '@/app/components/songs/PersonalLayer';
import { closeLyrics, openLyrics, parseInline, parseLyrics, splitChords, useLyricsDoc } from '@/lib/lyrics';
import { useOptionalBand } from '@/lib/BandContext';
import { openChordEditor, SONG_SAVED } from '@/app/components/songs/ChordEditor';
import { chordLabel, keyLabel } from '@/lib/ireal';
import { transposeChord } from '@/lib/transpose';
import { TransposeControl, TransposeProvider, useSongTranspose, useTranspose } from './Transpose';
import { togglePlay, usePlayer } from '@/lib/audioPlayer';
import { useSystemBack } from '@/lib/backStack';
import { useT } from '@/lib/i18n';
import { availableViews, hasInlineChords, normalizeLyrics, resolveView, sectionLabel } from '@/lib/songFormat';
import { SongBody, SongViewTabs, useSongViewPreference } from './SongViews';
import type { SongView } from '@/lib/songFormat';
import { cn } from '@/app/components/ui/utils';
import { ErrorBoundary } from './ErrorBoundary';

const SIZES = [18, 21, 24, 28, 33, 40];
const SIZE_KEY = 'bw-lyrics-size';

/** Lyrics text size (A− / A+), kept per device and shared with Stage mode. */
export function useLyricsSize() {
  const [size, setSize] = React.useState(() => {
    try {
      const v = Number(localStorage.getItem(SIZE_KEY));
      return SIZES.includes(v) ? v : 24;
    } catch {
      return 24;
    }
  });
  const step = React.useCallback(
    (d: number) => {
      const i = Math.max(0, Math.min(SIZES.length - 1, SIZES.indexOf(size) + d));
      setSize(SIZES[i]);
      try {
        localStorage.setItem(SIZE_KEY, String(SIZES[i]));
      } catch {
        /* per-device preference */
      }
    },
    [size],
  );
  return { size, step, min: size === SIZES[0], max: size === SIZES[SIZES.length - 1] };
}

const Inline: React.FC<{ text: string }> = ({ text }) => (
  <>
    {parseInline(text).map((part, k) => (
      <span key={k} className={part.bold ? 'font-bold' : part.italic ? 'italic' : undefined}>
        {part.text}
      </span>
    ))}
  </>
);

/**
 * One line of lyrics. ChordPro-style chords (`[Am]words`) sit above the word
 * they start on; that word and its chord make one box (never overlapping the
 * next chord), the rest of the words wrap like text on narrow screens.
 */
const LyricsLine: React.FC<{ line: string; hideChords?: boolean }> = ({ line, hideChords }) => {
  const segments = React.useMemo(() => splitChords(line), [line]);
  const { semitones, flats } = useTranspose();
  if (!segments || hideChords) {
    // Lyrics only: the words, chords dropped (a chords-only line disappears).
    const words = segments ? segments.map((s) => s.text).join('').replace(/\s{2,}/g, ' ') : line;
    if (!words.trim()) return null;
    return (
      <p className="font-medium break-words">
        <Inline text={words} />
      </p>
    );
  }
  return (
    <p className="font-medium break-words">
      {segments.map((seg, k) => {
        if (!seg.chord) return <Inline key={k} text={seg.text} />;
        const [, head, tail] = seg.text.match(/^(\S*)([\s\S]*)$/) || ['', '', seg.text];
        const label = chordLabel(transposeChord(seg.chord, semitones, flats));
        return (
          <React.Fragment key={k}>
            {/* Text first in the DOM: the box's baseline is the lyric's, the chord shows above it. */}
            {/* An inline-block's baseline is its last line: the word stays on the line, the chord sits above it. */}
            <span className="inline-block align-baseline">
              <span className="block text-[0.62em] font-bold leading-[1.3] pr-[0.35em] whitespace-nowrap">{label}</span>
              <span className="block whitespace-pre">{head ? <Inline text={head} /> : '\u00a0'}</span>
            </span>
            {/* A chord on a space already holds one: no double gap. */}
            {(head ? tail : tail.replace(/^ /, '')) && <Inline text={head ? tail : tail.replace(/^ /, '')} />}
          </React.Fragment>
        );
      })}
    </p>
  );
};

/**
 * Lyrics as sections of lines (Markdown / JSON, see src/lib/lyrics.ts).
 * `muted` is the class for section names and the empty message.
 */
type LyricsTextProps = { lyrics?: string | null; size: number; muted?: string; className?: string; hideChords?: boolean };

export const LyricsText: React.FC<LyricsTextProps> = (props) => {
  const tr = useT();
  // Lyrics that can't be drawn show a line instead of taking the screen down.
  return (
    <ErrorBoundary
      resetKey={props.lyrics}
      fallback={<p className={`bw-body-lg ${props.muted ?? 'text-muted-foreground'}`}>{tr('These lyrics can’t be shown. Check their format in Edit song.')}</p>}
    >
      <LyricsSections {...props} />
    </ErrorBoundary>
  );
};

const LyricsSections: React.FC<LyricsTextProps> = ({
  lyrics,
  size,
  muted = 'text-muted-foreground',
  className,
  hideChords,
}) => {
  const tr = useT();
  // Shown in the band's format (section names, chords on their words), whatever was saved.
  const sections = React.useMemo(() => parseLyrics(normalizeLyrics(lyrics)), [lyrics]);
  // My notes (109): under their lines, and lines to tap while adding one.
  const refs = useLineRefs(lyrics);
  return (
    <div className={className ?? 'max-w-3xl mx-auto w-full flex flex-col gap-8 pt-4'} style={{ fontSize: size, lineHeight: 1.45 }}>
      {sections.length === 0 ? (
        <p className={`bw-body-lg ${muted}`}>{tr('No lyrics for this song yet.')}</p>
      ) : (
        sections.map((s, i) => (
          <section key={i} className="flex flex-col gap-1">
            {s.name && <h3 className={`bw-label-md ${muted} uppercase mb-1`}>{sectionLabel(s.name, tr)}</h3>}
            {s.lines.map((line, j) =>
              line.trim() ? (
                refs?.get(`${i}:${j}`) ? (
                  <React.Fragment key={j}>
                    <PickableLine refLine={refs.get(`${i}:${j}`)!}>
                      <LyricsLine line={line} hideChords={hideChords} />
                    </PickableLine>
                    <LineNotes id={`${i}:${j}`} line={line} />
                  </React.Fragment>
                ) : (
                  <LyricsLine key={j} line={line} hideChords={hideChords} />
                )
              ) : (
                <span key={j} className="block h-[0.8em]" aria-hidden />
              )
            )}
          </section>
        ))
      )}
    </div>
  );
};

/**
 * Full-screen lyrics reader (stage-friendly: big text, A−/A+ sizes kept
 * between songs). Mounted once (AuthenticatedApp); opened with openLyrics().
 * When the song is playing in the mini player, play/pause sits in the header.
 * Songs with a chord chart (songs.chord_chart) can switch to it.
 */
export const LyricsViewer: React.FC = () => {
  const doc = useLyricsDoc();
  const player = usePlayer();
  const tr = useT();
  const { size, step, min, max } = useLyricsSize();
  useSystemBack(!!doc, () => {
    closeLyrics();
    return true;
  });

  const isThisTrack = !!doc?.songId && player.track?.id === doc.songId;
  // Admins fix the chords from the reader (the band song, the same for everyone).
  const band = useOptionalBand();
  const canEditChords = !!band?.isAdmin && !!doc?.songId && !!doc.lyrics?.trim();
  React.useEffect(() => {
    const onSaved = (e: Event) => {
      const d = (e as CustomEvent<{ id: string; lyrics: string }>).detail;
      if (d && doc?.songId === d.id) openLyrics({ ...doc, lyrics: d.lyrics });
    };
    window.addEventListener(SONG_SAVED, onSaved);
    return () => window.removeEventListener(SONG_SAVED, onSaved);
  }, [doc]);
  const hasChart = !!doc?.chart;
  // The person's view (instrument or last pick); a menu item can open another one.
  const [preferred, setPreferred] = useSongViewPreference();
  const [opened, setOpened] = React.useState<SongView | null>(null);
  React.useEffect(() => {
    setOpened(doc?.view ?? null);
  }, [doc]);
  const song = React.useMemo(() => ({ lyrics: normalizeLyrics(doc?.lyrics), chart: doc?.chart }), [doc]);
  const view = resolveView(opened ?? preferred, song) ?? 'lyrics';
  const pick = (v: SongView) => {
    setOpened(null);
    setPreferred(v);
  };
  const showChords = view !== 'lyrics' && (hasChart || hasInlineChords(doc?.lyrics));
  const kind = view === 'structure' ? tr('Structure') : view === 'chords' ? tr('Chords') : tr('Lyrics');
  // Transpose on this device: only when there are chords to move.
  const [semitones, setSemitones] = useSongTranspose(doc?.songId);
  const songKey = doc?.songKey || keyLabel(doc?.chart?.key) || null;
  const hasChords = hasChart || /\[[A-G][^\]\s]{0,15}\]/.test(doc?.lyrics || '');
  // My notes and files on this band song (109), only for its band's members.
  const bandId = doc?.bandId ?? band?.selectedBand?.id ?? null;
  const mine = React.useMemo(
    () => (doc?.songId && bandId ? { id: doc.songId, band_id: bandId, title: doc.title, lyrics: song.lyrics } : null),
    [doc?.songId, doc?.title, bandId, song.lyrics],
  );

  return (
    <AnimatePresence>
      {doc && (
        <motion.div
          key="lyrics"
          role="dialog"
          aria-modal="true"
          aria-label={`${kind} · ${doc.title}`}
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ type: 'spring', damping: 32, stiffness: 340 }}
          className="bw-pane-detail fixed inset-0 z-[150] bg-background text-foreground flex flex-col"
        >
          <div
            className="shrink-0 px-4 pb-3 flex items-center gap-3 bw-status-clear"
            style={{ paddingTop: 'calc(var(--safe-top) + 8px)' }}
          >
            <span className="flex-1 min-w-0 flex flex-col">
              <span className="bw-label-sm text-muted-foreground truncate">{doc.artist ? `${kind} · ${doc.artist}` : kind}</span>
              <span className="bw-h2 truncate">{doc.title}</span>
            </span>
            {isThisTrack && (
              <IconButton
                label={player.status === 'playing' ? tr('Pause') : tr('Play')}
                variant="filled"
                size="sm"
                icon={player.status === 'playing' ? <Pause /> : <Play />}
                onClick={togglePlay}
              />
            )}
            {canEditChords && (
              <IconButton label={tr('Edit chords')} size="sm" icon={<Music2 />} onClick={() => openChordEditor(doc.songId!)} />
            )}
            <IconButton label={tr('Smaller text')} size="sm" icon={<Minus />} onClick={() => step(-1)} disabled={min} />
            <IconButton label={tr('Bigger text')} size="sm" icon={<Plus />} onClick={() => step(1)} disabled={max} />
            <IconButton label={showChords ? tr('Close') : tr('Close lyrics')} size="sm" icon={<X />} onClick={closeLyrics} />
          </div>
          {(availableViews(song).length > 1 || hasChords) && (
            <div className="shrink-0 px-4 pb-2 flex flex-wrap items-center justify-between gap-2">
              <SongViewTabs song={song} view={view} onChange={pick} />
              {hasChords && showChords && <TransposeControl semitones={semitones} onChange={setSemitones} songKey={songKey} />}
            </div>
          )}
          <PersonalLayerScope song={mine}>
            {mine && <MyNotesBar className="shrink-0 px-4 pb-2" />}
            <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-16">
              <TransposeProvider semitones={semitones} songKey={songKey}>
                <SongBody song={song} view={view} size={size} />
              </TransposeProvider>
            </div>
          </PersonalLayerScope>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronLeft, ChevronRight, Maximize, Minimize, Minus, Plus, StickyNote, X } from '@/app/components/icons';
import { useLyricsSize } from '@/app/components/ui/LyricsViewer';
import { MyNotesBar, PersonalLayerScope } from '@/app/components/songs/PersonalLayer';
import { SongBody, SongViewTabs, songViewLabel, useSongViewPreference } from '@/app/components/ui/SongViews';
import { availableViews, normalizeLyrics, resolveView } from '@/lib/songFormat';
import type { SongChart } from '@/lib/ireal';
import { durations, easings } from '@/styles/motion';
import { haptic } from '@/lib/haptics';
import { FIT, FitText } from '@/app/components/bw/FitText';
import { HeaderAction, IconButton } from '@/app/components/bw/Screen';
import { RailCover, useRailTone } from '@/lib/railActions';
import { setStatusBarTone } from '@/lib/systemBars';
import { useRailLayout } from '@/lib/deviceRegions';
import { exitBrowserFullScreen, requestBrowserFullScreen, setStageSongOnly, useBrowserFullScreenExit, useStageBarHidden, useStageFullScreen, useStageSongOnly } from '@/lib/stageChrome';
import { useLaptopPose } from '@/app/components/duo/FoldSplit';
import { StageSongOnly } from './StageSongOnly';
import '@/styles/stage.css';
import { useT } from '@/lib/i18n';
import { useSystemBack } from '@/lib/backStack';
import { timelineDates } from '@/lib/gigTiming';
import { cn } from '@/app/components/ui/utils';
import { SortableSongList } from '@/app/components/ui/SortableSongList';
import { TransposeControl, TransposeProvider, useSongTranspose } from '@/app/components/ui/Transpose';
import { keyLabel } from '@/lib/ireal';
import { StageClickButton, StageClickFrame, useStageClickUi, type StageClickControls } from './StageClick';
import { useKeepAwake } from '@/lib/posture';
import type { StageSaveState } from '@/app/components/event/useStageLive';
import type { StageBleStatus } from '@/app/components/event/useStageBle';
import type { LiveKind } from '@/lib/liveMode';
import type { RehearsalSessionControls } from '@/app/components/event/useRehearsalSession';
import { RehearsalSessionBar, RehearsalSummaryDialog, summaryOf } from './RehearsalSession';
import { NoteSheetsHost, RehearsalNotesBar, marksToWrite, useNoteSheets, type LiveNotes } from './RehearsalNotes';
import { EarlierNotesSheet } from './FromLastTime';
import { openCountBySong } from '@/lib/toPractise';
import type { StageRegia } from '@/app/components/event/useStageRegia';
import { NowPlayingStrip, RegiaBar, RegiaExtraSheet, RegiaRowPlay } from './StageRegia';
import { enterScreen } from '@/lib/appAnalytics';

export interface StageStep {
  label: string;
  /** Raw "HH:MM" (24h) used to work out what comes next. */
  time?: string;
  /** Formatted time shown on screen. */
  display: string;
}

export interface StageSong {
  /** setlist_songs row id (live order and current song follow it). */
  id?: string;
  /** songs.id, needed to save a new order. */
  songId?: string;
  setNumber?: number;
  title: string;
  artist?: string;
  duration?: string;
  key?: string;
  /** songs.bpm: the visual metronome's tempo. */
  bpm?: number;
  /** songs.lyrics (Markdown / JSON, src/lib/lyrics.ts). */
  lyrics?: string;
  /** songs.chord_chart (iReal Pro import, src/lib/ireal.ts). */
  chart?: SongChart;
  /** songs.audio_url: what the Regia plays (stage manager mode). */
  audio?: string;
}

/**
 * Live Stage mode (useStageLive): the current song, PREV / NEXT, "follow the
 * leader" for members, and reordering for the band admin. Without it Stage
 * mode is the plain read-only view.
 */
export interface StageLiveControls {
  index: number;
  select: (index: number) => void;
  go: (delta: number) => void;
  following: boolean;
  setFollowing: (on: boolean) => void;
  leaderSeen: boolean;
  connected: boolean;
  /** Bluetooth link in the native apps (offline on stage). */
  bluetooth?: StageBleStatus;
  isLeader: boolean;
  canReorder: boolean;
  move: (from: number, to: number) => void;
  saveState: StageSaveState;
  /** Songs struck off tonight (row ids): crossed out, Prev / Next skip them. */
  skipped?: ReadonlySet<string>;
  /** The leader can strike songs off. */
  canStrike?: boolean;
  toggleSkip?: (index: number) => void;
  /** Visual metronome (useStageLive): newest click, ours or the leader's. */
  click?: StageClickControls;
}

interface StageModeProps {
  /**
   * 'gig' (default): Stage mode with the evening's run of show.
   * 'rehearsal': Live mode, the same live screen without phases and times
   * (pass no steps) and without striking songs off for tonight.
   */
  kind?: LiveKind;
  title: string;
  venue?: string;
  /** Venue city, shown after the venue ("Venue · City"). */
  city?: string;
  dateLabel: string;
  /** ISO date of the event, used with each step's time to find the next step. */
  date?: string;
  steps: StageStep[];
  songs: StageSong[];
  /** The event's band: my notes on its songs (109). */
  bandId?: string;
  songsLoading?: boolean;
  /** The setlist couldn't be loaded (offline, nothing kept on the device). */
  songsError?: boolean;
  onRetrySongs?: () => void;
  accentColor?: string;
  live?: StageLiveControls;
  /** Rehearsal session (Live mode timer, plan A1b): rehearsals only. */
  session?: RehearsalSessionControls;
  /** Rehearsal notes (plan A2): Mark, the notes, writing them at the pause. */
  notes?: LiveNotes;
  /** Stage manager mode (useStageRegia): the admin device that plays the audio. */
  regia?: StageRegia;
  /**
   * Song view open (controlled, optional): shared with the Laptop pose
   * (FloorWedgeMode) so folding keeps the lyrics up.
   */
  songOpen?: boolean;
  onSongOpenChange?: (open: boolean) => void;
  onClose: () => void;
}

// fonts.css forces `font-family: inherit` on every element, which beats the
// Tailwind mono utility class, so the mono face is set inline.
const MONO: React.CSSProperties = { fontFamily: 'var(--font-mono)' };

/** Stage mode reads times in 24h ("19:30"). */
const to24h = (time?: string): string => {
  const m = time?.match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
};

/**
 * Stage mode: an OLED-black, glanceable view for gig day. Big times, the next
 * step highlighted, the setlist in large type. No decoration and no looping
 * animation; the only motion is the 200ms fade on entry.
 */
export const StageMode: React.FC<StageModeProps> = ({
  kind = 'gig',
  title,
  venue,
  city,
  dateLabel,
  date,
  steps,
  songs,
  bandId,
  songsLoading,
  songsError,
  onRetrySongs,
  accentColor = 'var(--accent-gig, #D5FB46)',
  live,
  session: sessionProp,
  notes: notesProp,
  regia,
  songOpen,
  onSongOpenChange,
  onClose,
}) => {
  const t = useT();
  const rehearsal = kind === 'rehearsal';
  const session = rehearsal && sessionProp?.enabled ? sessionProp : undefined;
  const notes = rehearsal && notesProp?.controls.enabled ? notesProp : undefined;
  const noteSheets = useNoteSheets(notes?.controls);
  // A3: each song's open notes from last time, as a badge that opens them.
  const earlier = notes?.earlier;
  const earlierCounts = useMemo(() => (earlier ? openCountBySong(earlier.notes) : {}), [earlier]);
  const [earlierSong, setEarlierSong] = useState<string | null>(null);
  // The summary: up when the session ends, or on request once ended.
  const [summaryAsked, setSummaryAsked] = useState(false);
  const summaryOpen = !!session && session.status === 'ended' && (session.justEnded || summaryAsked);
  const summary = summaryOpen ? summaryOf(session.state, songs.length) : null;
  const closeSummary = () => {
    setSummaryAsked(false);
    session?.dismissSummary();
  };
  // Struck off for tonight is a gig-night thing: not on rehearsals.
  const canStrike = !rehearsal && !!live?.canStrike;
  // Stage manager mode: the Regia's ▶ on each song with audio, and a song off the setlist.
  const regiaOn = !!regia?.on && !!live;
  const [extraOpen, setExtraOpen] = useState(false);
  const inSetlist = useMemo(() => new Set(songs.map((s) => s.songId).filter((id): id is string => !!id)), [songs]);
  // The screen stays on while Stage mode is open (lyrics and chords are read
  // hands-free; a locked leader's phone stops the band's sync too).
  useKeepAwake(true);
  const [now, setNow] = useState(() => new Date());
  const current = live && songs.length > 0 ? live.index : -1;
  // Struck off tonight by the leader (crossed out; Prev / Next skip them).
  const isStruck = (song: StageSong) => !!song.id && !!live?.skipped?.has(song.id);
  const struckCount = live?.skipped ? songs.filter((s) => !!s.id && live.skipped!.has(s.id)).length : 0;
  // One song: singular ("1 tolto", not "1 tolti").
  const struckText = struckCount === 1 ? t('1 struck off') : t('{count} struck off', { count: struckCount });
  // Rows for the sortable list (dnd-kit needs a stable id per row).
  const stageRows = useMemo(
    () => songs.map((song, i) => ({ uid: song.id ?? `${song.title}-${i}`, title: song.title, song })),
    [songs],
  );
  const listRef = useRef<HTMLDivElement | null>(null);
  // Usage analytics: Stage (gigs) or Live mode (rehearsals) while open.
  useEffect(() => enterScreen(rehearsal ? 'Live mode' : 'Stage'), [rehearsal]);
  // The leader's save status shows while saving, on an error, and briefly once saved.
  const saveState = live?.saveState ?? 'idle';
  const [showSaved, setShowSaved] = useState(false);
  useEffect(() => {
    if (saveState !== 'saved') return;
    setShowSaved(true);
    const id = window.setTimeout(() => setShowSaved(false), 2000);
    return () => window.clearTimeout(id);
  }, [saveState]);
  const showSave = saveState === 'saving' || saveState === 'error' || (saveState === 'saved' && showSaved);
  // Lyrics view: the current song's lyrics, following it (also when the leader moves).
  // Chords view: the same for its chord chart.
  // Song view: lyrics, chords or structure, from the player's instrument or last pick (one tap switches).
  const hasSong = songs.some((s) => !!s.lyrics?.trim() || !!s.chart);
  type StageView = 'setlist' | 'song';
  const views: StageView[] = ['setlist', ...(hasSong ? (['song'] as const) : [])];
  const [ownView, setOwnView] = useState<StageView>('setlist');
  const view: StageView = songOpen === undefined ? ownView : songOpen ? 'song' : 'setlist';
  const setView = (v: StageView) => {
    setOwnView(v);
    onSongOpenChange?.(v === 'song');
  };
  const [songView, setSongView] = useSongViewPreference();
  const showLyrics = view === 'song' && hasSong;
  const lyricsSong = songs[Math.max(0, current)];
  const lyricsContent = useMemo(() => ({ lyrics: normalizeLyrics(lyricsSong?.lyrics), chart: lyricsSong?.chart }), [lyricsSong?.lyrics, lyricsSong?.chart]);
  const shownView = resolveView(songView, lyricsContent);
  const showChords = showLyrics && shownView !== 'lyrics';
  const lyricsSize = useLyricsSize();
  // Transpose for this player only (kept per song on the device).
  const [semitones, setSemitones] = useSongTranspose(lyricsSong?.songId);
  const lyricsKey = lyricsSong?.key || keyLabel(lyricsSong?.chart?.key) || null;
  // My notes and files over the band's version (109), only I see them.
  const mine = useMemo(
    () =>
      lyricsSong?.songId && bandId
        ? { id: lyricsSong.songId, band_id: bandId, title: lyricsSong.title, lyrics: lyricsContent.lyrics }
        : null,
    [lyricsSong?.songId, lyricsSong?.title, bandId, lyricsContent.lyrics],
  );
  const lyricsHasChords = !!lyricsSong && showChords && (!!lyricsSong.chart || /\[[A-G][^\]\s]{0,15}\]/.test(lyricsSong.lyrics || ''));

  // Visual metronome: shows while a click runs on the current song.
  const click = live?.click;
  const currentSong = songs[Math.max(0, current)];
  const clickUi = useStageClickUi(click, currentSong);
  const { state: clickState, running: clickRunning, hidden: clickHidden, show: showClick, press: pressClick } = clickUi;
  const lyricsRef = useRef<HTMLDivElement | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    lyricsRef.current?.scrollTo?.({ top: 0 });
    sectionRef.current?.scrollTo?.({ top: 0 });
  }, [lyricsSong?.id, lyricsSong?.title, showLyrics, shownView]);

  // Keep the current song in view when it changes (also when the leader
  // moves), and after the layout changes (full screen, turning the device,
  // back to the setlist tab), which leaves the list at its old scroll.
  const [layoutTick, setLayoutTick] = useState(0);
  useEffect(() => {
    const bump = () => setLayoutTick((n) => n + 1);
    window.addEventListener('resize', bump);
    window.addEventListener('bwlayout', bump);
    return () => {
      window.removeEventListener('resize', bump);
      window.removeEventListener('bwlayout', bump);
    };
  }, []);
  useEffect(() => {
    const id = requestAnimationFrame(() =>
      listRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }),
    );
    return () => cancelAnimationFrame(id);
  }, [current, layoutTick, view]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // Android Back and Escape leave Stage mode first, not the gig beneath.
  // An Escape that just left the browser's full screen leaves only that.
  const fsLeftAt = useRef(0);
  useSystemBack(true, () => {
    if (Date.now() - fsLeftAt.current < 600) return true;
    onClose();
  });
  // …and the rehearsal summary on top of it first.
  useSystemBack(summaryOpen, closeSummary);

  // Steps in order on the gig day; an end after midnight lands on the next day.
  const stepDates = useMemo(() => timelineDates(date, steps.map((s) => s.time)), [date, steps]);

  const nextIndex = useMemo(
    () => stepDates.findIndex((at) => (at ? at.getTime() > now.getTime() : false)),
    [stepDates, now],
  );

  const isDone = (i: number) => {
    const at = stepDates[i];
    return at ? at.getTime() <= now.getTime() : false;
  };

  const handleClose = () => {
    haptic.tap();
    onClose();
  };

  // Black canvas: light system icons, and the iPhone Duo rail in dark glass.
  useEffect(() => setStatusBarTone('dark'), []);
  useRailTone('dark');

  // Full screen (src/lib/stageChrome.ts), on every device: the app's chrome
  // (the iPhone Duo rail, the list pane on two-pane layouts, the nav) and the
  // system bars go, the header shrinks to one line, the screen stays on.
  // Remembered per device; system Back or the button leaves it.
  const { twoPane } = useRailLayout();
  const [full, setFull] = useStageBarHidden();
  // Song only: the song clean and full screen (StageSongOnly; the Laptop
  // pose shows it on the floor wedge). Full screen while it is on.
  const [songOnlyOn, setSongOnly] = useStageSongOnly();
  const laptop = useLaptopPose();
  const songOnly = songOnlyOn && showLyrics && !!lyricsSong;
  useStageFullScreen(full || songOnly);
  // Leaving Stage mode leaves Song only: it always opens with everything shown.
  useEffect(() => () => setStageSongOnly(false), []);
  // Full screen moves the list into another column: bring the current song back into view.
  useEffect(() => setLayoutTick((n) => n + 1), [full]);
  const exitFull = () => {
    setFull(false);
    void exitBrowserFullScreen();
  };
  // Full screen with songs to read is Song only (11-20, the band's ask): only
  // the song, nothing above it. The chrome-less setlist stays for setlists
  // with no lyrics or charts; an older choice of it gives way to Song only.
  useEffect(() => {
    if (full && hasSong) setFull(false);
  }, [full, hasSong, setFull]);
  const toggleFull = () => {
    if (full) {
      haptic.tap();
      exitFull();
      return;
    }
    if (hasSong) {
      openSongOnly();
      return;
    }
    haptic.tap();
    setFull(true);
    // The browser's own full screen needs this tap (web build, iPad Safari).
    void requestBrowserFullScreen();
  };
  // Escape or the browser's UI left the browser's full screen: follow it (Song only too).
  useBrowserFullScreenExit(full || songOnlyOn, () => {
    fsLeftAt.current = Date.now();
    setFull(false);
    leaveSongOnly();
  });
  // System Back (Android Back, Escape, the web's Back) leaves full screen before Stage mode.
  useSystemBack(full, exitFull);
  // Song only opened from the setlist goes back to the setlist.
  const songOnlyFrom = useRef<StageView | null>(null);
  const leaveSongOnly = () => {
    setSongOnly(false);
    if (songOnlyFrom.current && songOnlyFrom.current !== view) setView(songOnlyFrom.current);
    songOnlyFrom.current = null;
  };
  const openSongOnly = () => {
    haptic.tap();
    songOnlyFrom.current = view;
    if (view !== 'song') setView('song');
    setSongOnly(true);
    // The browser's own full screen needs this tap (web build, iPad Safari).
    void requestBrowserFullScreen();
  };
  const showAll = () => {
    leaveSongOnly();
    if (!full) void exitBrowserFullScreen();
  };
  // …and Song only before full screen.
  useSystemBack(songOnlyOn, showAll);
  // Closing Stage mode leaves the browser's full screen; the choice stays for next time.
  useEffect(() => () => void exitBrowserFullScreen(), []);
  const fullLabel = full ? t('Exit full screen') : t('Full screen');
  const fullIcon = full ? <Minimize /> : <Maximize />;
  const exitLabel = rehearsal ? t('Exit live mode') : t('Exit stage mode');

  // Full screen across two panes: times and steps on the leading pane, the
  // setlist / lyrics on the trailing one, split at the panes' edge (the fold
  // on the Duo) so nothing sits on the crease.
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [split, setSplit] = useState<{ col: number; gap: number } | null>(null);
  useLayoutEffect(() => {
    if (!full || !twoPane) {
      setSplit(null);
      return;
    }
    const measure = () => {
      const el = contentRef.current;
      if (!el) return;
      const root = getComputedStyle(document.documentElement);
      const leading = parseFloat(root.getPropertyValue('--bw-pane-leading-w'));
      const trailingX = parseFloat(root.getPropertyValue('--bw-pane-trailing-x'));
      const box = el.getBoundingClientRect();
      const own = getComputedStyle(el);
      const left = box.left + (parseFloat(own.paddingLeft) || 0);
      const right = box.right - (parseFloat(own.paddingRight) || 0);
      const col = Math.round(leading - 16 - left);
      const gap = Math.round(trailingX - leading + 32);
      // Both columns need room for the step cards and song titles.
      const ok = Number.isFinite(col) && Number.isFinite(gap) && col >= 260 && right - left - col - gap >= 300;
      setSplit((prev) => (ok ? (prev?.col === col && prev.gap === gap ? prev : { col, gap }) : null));
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('bwlayout', measure);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('bwlayout', measure);
    };
  }, [full, twoPane]);

  // Reading a song in one pane (phone, or the Duo's Book posture beside the
  // app): a one-line header so the lyrics get the room.
  const compactHead = (showLyrics || full) && !split;
  // Reading a song with room to the side (phone on its side, iPad, both Duo
  // panes): the setlist stays beside it, one tap to another song.
  // The layout's breakpoints read the window, but next to a list pane (iPad,
  // the open Duo when not full screen) Stage mode only has that pane: there
  // the side column would squeeze the lyrics to a few letters, so it keeps
  // the tabs, as on a phone.
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [inNarrowPane, setInNarrowPane] = useState(false);
  useLayoutEffect(() => {
    if (!twoPane || full) {
      setInNarrowPane(false);
      return;
    }
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setInNarrowPane(el.getBoundingClientRect().width < 900);
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [twoPane, full]);
  const showSide = showLyrics && songs.length > 1 && (!!split || !inNarrowPane);
  const sideRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!showSide) return;
    sideRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [current, showSide]);

  return (
    <motion.div
      ref={stageRef}
      role="dialog"
      aria-modal="true"
      aria-label={rehearsal ? t('Live mode: {title}', { title }) : t('Stage mode: {title}', { title })}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: durations.normal, ease: easings.standard }}
      className={cn('bw-stage bw-pane-detail fixed inset-0 z-[120] flex flex-col bg-black text-white select-none', full && 'bw-stage-full')}
      style={{
        paddingTop: 'calc(var(--safe-top) + 12px)',
        paddingBottom: 'calc(var(--safe-bottom) + 16px)',
      }}
    >
      {/* Short and wide (phone or closed Duo on its side): times and steps on
          the left, the setlist on the right. */}
      <div
        ref={contentRef}
        aria-hidden={songOnly && !laptop ? true : undefined}
        className={cn(
          'flex flex-col flex-1 min-h-0 w-full max-w-[640px] mx-auto px-4',
          // Song only covers it: nothing of it to read or tab to underneath.
          songOnly && !laptop && 'invisible',
          compactHead ? 'gap-3' : 'gap-6',
          '[@media(max-height:520px)_and_(min-width:600px)]:grid [@media(max-height:520px)_and_(min-width:600px)]:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] [@media(max-height:520px)_and_(min-width:600px)]:grid-rows-[auto_auto_1fr] [@media(max-height:520px)_and_(min-width:600px)]:max-w-[1100px] [@media(max-height:520px)_and_(min-width:600px)]:gap-x-6 [@media(max-height:520px)_and_(min-width:600px)]:gap-y-3',
          // Full screen on two panes: the whole width, one column per pane.
          full && twoPane && 'max-w-none [@media(max-height:520px)_and_(min-width:600px)]:max-w-none',
          split && (showSide ? 'grid grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-y-3' : 'grid grid-rows-[auto_auto_1fr] gap-y-3'),
          showSide &&
            !split &&
            '[@media(max-height:520px)_and_(min-width:600px)]:grid-rows-[auto_minmax(0,1fr)_auto] [@media(min-width:900px)_and_(min-height:521px)]:grid [@media(min-width:900px)_and_(min-height:521px)]:grid-cols-[minmax(0,300px)_minmax(0,1fr)] [@media(min-width:900px)_and_(min-height:521px)]:grid-rows-[auto_minmax(0,1fr)_auto] [@media(min-width:900px)_and_(min-height:521px)]:max-w-[1100px] [@media(min-width:900px)_and_(min-height:521px)]:gap-x-8 [@media(min-width:900px)_and_(min-height:521px)]:gap-y-3',
        )}
        style={split ? { gridTemplateColumns: `${split.col}px minmax(0,1fr)`, columnGap: split.gap } : undefined}
      >
        {/* Header */}
        <div className={cn('flex items-start justify-between gap-4 shrink-0 bw-status-clear-shift [@media(max-height:520px)_and_(min-width:600px)]:col-start-1 [@media(max-height:520px)_and_(min-width:600px)]:row-start-1', split && 'col-start-1 row-start-1', showSide && !split && '[@media(min-width:900px)_and_(min-height:521px)]:col-span-2')}>
          <div className="flex flex-col gap-2 min-w-0">
            <span className="flex items-center gap-2 bw-label-sm text-white">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: accentColor }} />
              {rehearsal ? t('Live mode · {date}', { date: dateLabel }) : t('Stage mode · {date}', { date: dateLabel })}
            </span>
            <FitText as="h1" text={title} sizes={compactHead ? FIT.stageCompact : FIT.stage} maxLines={compactHead ? 1 : 2} className="bw-display-lg text-white" />
            {(venue || city) && !compactHead && (
              <span className="bw-label-md text-white truncate">
                {[venue, city && city !== venue ? city : ''].filter(Boolean).join(' · ')}
              </span>
            )}
          </div>
          <RailCover pane />
          {full ? (
            // The rail is hidden: Exit full screen and Exit stay on screen
            // here, stacked in the narrow column of the short-and-wide layout.
            <span className="flex items-center gap-2 shrink-0 [@media(max-height:520px)_and_(min-width:600px)]:flex-col">
              <IconButton label={fullLabel} variant="sheet" icon={fullIcon} onClick={toggleFull} className="border-white/40 text-white" />
              <IconButton label={exitLabel} variant="sheet" icon={<X />} onClick={handleClose} className="border-white text-white" />
            </span>
          ) : (
            <span className="flex items-center gap-2 shrink-0">
              <HeaderAction pane label={fullLabel} variant="sheet" icon={fullIcon} onClick={toggleFull} className="border-white/40 text-white" />
              <HeaderAction pane label={exitLabel} variant="sheet" icon={<X />} onClick={handleClose} className="border-white text-white" />
            </span>
          )}
        </div>

        {/* Run of show (its own container: one row of four when short and wide enough) */}
        {/* Hidden while reading lyrics: the song needs the room more than the times. */}
        {/* None on a rehearsal (no steps): no load in, soundcheck or show. */}
        {steps.length > 0 && (
        <div
          className={cn(
            '@container shrink-0 [@media(max-height:520px)_and_(min-width:600px)]:col-start-1 [@media(max-height:520px)_and_(min-width:600px)]:row-start-2',
            split && 'col-start-1 row-start-2',
            // Split across two panes the times keep their own column.
            showLyrics && !split && 'hidden',
            // The Regia's player needs the room on a short screen (the Duo closed or as a book):
            // the stage manager runs the songs, the setlist must stay in view under the player.
            regia?.on && !split && '[@media(max-height:760px)_and_(min-height:521px)]:hidden',
          )}
        >
        <ol
          className="grid grid-cols-2 gap-3 shrink-0 [@media(max-height:760px)]:@min-[330px]:grid-cols-[repeat(4,minmax(min-content,1fr))] [@media(max-height:760px)]:@min-[330px]:gap-2"
          aria-label={t('Run of show')}
        >
          {steps.map((s, i) => {
            const next = i === nextIndex;
            const done = isDone(i);
            return (
              <li
                key={s.label}
                className="flex flex-col gap-1 min-w-0 rounded-[16px] px-4 py-3 border @max-[260px]:px-3 [@media(max-height:760px)]:@min-[330px]:px-2 [@media(max-height:760px)]:@min-[330px]:py-2"
                style={{
                  borderColor: next ? accentColor : 'rgba(255,255,255,0.15)',
                  opacity: done && !next ? 0.4 : 1,
                }}
              >
                <span className="bw-label-xs text-white">
                  {next ? t('Next · {label}', { label: s.label }) : s.label}
                </span>
                <span
                  className="bw-num text-[clamp(20px,9cqw,32px)] [@media(max-height:760px)]:@min-[330px]:text-[clamp(18px,5.2cqw,28px)] leading-[1.1] whitespace-nowrap"
                  style={{ ...MONO, color: next ? accentColor : '#fff' }}
                >
                  {to24h(s.time) || s.display || t('TBD')}
                </span>
              </li>
            );
          })}
        </ol>
        </div>
        )}

        {/* Setlist beside the song (wide layouts only; a phone held upright keeps the tabs). */}
        {showSide && (
          <nav
            ref={sideRef}
            aria-label={t('Setlist')}
            className={cn(
              'hidden min-h-0 overflow-y-auto overscroll-contain -mx-2 px-2',
              split ? 'block col-start-1 row-start-3' : '[@media(max-height:520px)_and_(min-width:600px)]:block [@media(max-height:520px)_and_(min-width:600px)]:col-start-1 [@media(max-height:520px)_and_(min-width:600px)]:row-start-2 [@media(min-width:900px)_and_(min-height:521px)]:block [@media(min-width:900px)_and_(min-height:521px)]:col-start-1 [@media(min-width:900px)_and_(min-height:521px)]:row-start-2 [@media(min-width:900px)_and_(min-height:521px)]:row-span-2',
            )}
          >
            <ol className="flex flex-col">
              {songs.map((song, i) => {
                const isCurrent = i === current;
                return (
                  <li key={song.id ?? `${song.title}-${i}`} className="border-b border-white/10 last:border-b-0">
                    <button
                      type="button"
                      disabled={!live}
                      aria-current={isCurrent ? 'true' : undefined}
                      onClick={() => {
                        haptic.tap();
                        live?.select(i);
                      }}
                      aria-label={isCurrent ? t('Now playing: {title}', { title: song.title }) : t('Go to {title}', { title: song.title })}
                      className="flex w-full min-w-0 items-center gap-3 min-h-11 py-2 text-left"
                    >
                      <span
                        className="bw-num text-[14px] font-medium w-6 shrink-0"
                        style={{ ...MONO, color: isCurrent ? accentColor : 'rgba(255,255,255,0.5)' }}
                      >
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span
                        className={cn('flex-1 min-w-0 bw-label-md normal-case truncate', !isCurrent && 'text-white/80', isStruck(song) && 'line-through text-white/40')}
                        style={isCurrent ? { color: accentColor } : undefined}
                      >
                        {song.title}
                        {isStruck(song) && <span className="sr-only"> · {t('struck off')}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>
        )}

        {/* Setlist */}
        <section ref={sectionRef} className={cn('flex flex-col flex-1 min-h-0 gap-1 [@media(max-height:520px)_and_(min-width:600px)]:col-start-2 [@media(max-height:520px)_and_(min-width:600px)]:row-start-1 [@media(max-height:520px)_and_(min-width:600px)]:row-span-3', split && 'col-start-2 row-start-1 row-span-3', split && showSide && 'row-span-4', showSide && !split && '[@media(min-width:900px)_and_(min-height:521px)]:col-start-2 [@media(min-width:900px)_and_(min-height:521px)]:row-start-2',
          // A phone sideways: the bars above a song's chart or lyrics leave it no
          // height, so the whole column scrolls and the chart gets its full length.
          showLyrics && !split && '[@media(max-height:520px)_and_(min-width:600px)]:overflow-y-auto [@media(max-height:520px)_and_(min-width:600px)]:overscroll-contain [@media(max-height:520px)_and_(min-width:600px)]:-mx-2 [@media(max-height:520px)_and_(min-width:600px)]:px-2')} aria-label={t('Setlist')}>
          {session && (
            <RehearsalSessionBar session={session} accentColor={accentColor} onShowSummary={() => setSummaryAsked(true)} className="pb-2" />
          )}
          {notes && (
            <RehearsalNotesBar
              controls={notes.controls}
              sheets={noteSheets}
              accentColor={accentColor}
              paused={session?.status === 'paused'}
              onMark={() =>
                notes.controls.mark({
                  songId: songs[current]?.songId ?? null,
                  songTitle: songs[current]?.title ?? null,
                  markedAtS: notes.elapsed(),
                })
              }
              className="pb-2"
            />
          )}
          {regia && live && songs.length > 0 && (
            <RegiaBar
              regia={regia}
              songs={songs}
              currentIndex={Math.max(0, current)}
              canAddSongs={live.canReorder && !!bandId}
              onAddSong={() => setExtraOpen(true)}
              accent={accentColor}
              className="mb-2"
            />
          )}
          {regia?.nowPlaying && live && (
            <NowPlayingStrip
              nowPlaying={regia.nowPlaying}
              inView={regia.nowPlaying.state.songId === songs[Math.max(0, current)]?.id}
              onGo={!live.isLeader ? () => live.setFollowing(true) : undefined}
              accent={accentColor}
              className="pb-1"
            />
          )}
          <div className="flex items-center justify-between gap-3 shrink-0 pb-2 min-h-11">
            {views.length > 1 ? (
              <span className="flex items-center gap-1 min-w-0" role="tablist" aria-label={t('Setlist')}>
                {views.map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="tab"
                    aria-selected={view === v}
                    onClick={() => {
                      haptic.tap();
                      setView(v);
                    }}
                    className={cn(
                      'min-h-11 px-2 bw-label-sm whitespace-nowrap border-b-2',
                      view === v ? 'text-white border-white' : 'text-white/50 border-transparent',
                    )}
                  >
                    {v === 'setlist' ? t('Setlist') : songViewLabel(songView, t)}
                    {/* With tabs there is no room for the "· 1 struck off" line: a short count on the tab. */}
                    {v === 'setlist' && !songsLoading && struckCount > 0 && (
                      <>
                        <span aria-hidden className="ml-1.5 bw-num text-[12px] text-white/60" style={MONO}>−{struckCount}</span>
                        <span className="sr-only"> · {struckText}</span>
                      </>
                    )}
                  </button>
                ))}
              </span>
            ) : (
              <span className="flex items-baseline gap-3 min-w-0">
                <span className="bw-label-sm text-white shrink-0">{t('Setlist')}</span>
                <span className="bw-num text-[14px] font-medium text-white/70 whitespace-nowrap truncate" style={MONO}>
                  {songsLoading ? '…' : songs.length === 1 ? t('{count} song', { count: songs.length }) : t('{count} songs', { count: songs.length })}
                  {!songsLoading && struckCount > 0 ? ` · ${struckText}` : ''}
                </span>
              </span>
            )}
            {live && songs.length > 0 && (
              <span className="flex items-center gap-2 min-w-0 shrink-0 max-w-[70%]">
                {live.isLeader ? (
                  <LiveStatus
                    on={live.connected || live.bluetooth === 'leading'}
                    label={
                      showSave
                        ? saveLabel(live.saveState, t)
                        : live.connected
                          ? `${t('Live')}${live.bluetooth === 'leading' ? ' · BT' : ''}`
                          : live.bluetooth === 'leading'
                            ? t('Bluetooth')
                            : t('Offline')
                    }
                    hint={live.connected ? t('Band follows you') : undefined}
                    accentColor={accentColor}
                  />
                ) : (
                  <button
                    type="button"
                    aria-pressed={live.following}
                    onClick={() => {
                      haptic.tap();
                      live.setFollowing(!live.following);
                    }}
                    className={cn(
                      'flex items-center gap-2 min-h-11 px-3 rounded-full border bw-label-xs whitespace-nowrap min-w-0',
                      live.following ? 'border-transparent text-black' : 'border-white/40 text-white',
                    )}
                    style={live.following ? { backgroundColor: accentColor } : undefined}
                  >
                    <span
                      aria-hidden
                      className={cn('w-2 h-2 rounded-full shrink-0', live.following ? 'bg-black' : 'border border-white')}
                    />
                    <span className="truncate">
                      {followLabel(live, t)}
                      {live.bluetooth === 'connected' ? ' · BT' : ''}
                    </span>
                  </button>
                )}
              </span>
            )}
          </div>
          {live && songs.length > 0 && bluetoothHint(live, t) && (
            <p className="bw-body-sm text-white/70 shrink-0 pb-2" role="status">
              {bluetoothHint(live, t)}
            </p>
          )}
          {showLyrics && lyricsSong ? (
            <div className={cn('flex flex-col flex-1 min-h-0', !split && '[@media(max-height:520px)_and_(min-width:600px)]:flex-none')} role="tabpanel" aria-label={showChords ? t('Chords · {title}', { title: lyricsSong.title }) : t('Lyrics · {title}', { title: lyricsSong.title })}>
              <div className="flex items-center gap-3 shrink-0 pb-2">
                <span className="bw-num text-[16px] font-medium shrink-0" style={{ ...MONO, color: accentColor }}>
                  {String(Math.max(0, current) + 1).padStart(2, '0')}
                </span>
                <span className="flex-1 min-w-0 bw-h2 normal-case leading-[1.15] truncate" style={{ color: accentColor }} aria-live="polite">
                  {lyricsSong.title}
                </span>
                <button
                  type="button"
                  disabled={lyricsSize.min}
                  onClick={() => lyricsSize.step(-1)}
                  aria-label={t('Smaller text')}
                  className="w-11 h-11 flex items-center justify-center rounded-full border border-white/30 shrink-0 disabled:opacity-30"
                >
                  <Minus className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  disabled={lyricsSize.max}
                  onClick={() => lyricsSize.step(1)}
                  aria-label={t('Bigger text')}
                  className="w-11 h-11 flex items-center justify-center rounded-full border border-white/30 shrink-0 disabled:opacity-30"
                >
                  <Plus className="w-5 h-5" />
                </button>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 shrink-0 pb-2">
                <SongViewTabs
                  song={lyricsContent}
                  view={shownView ?? songView}
                  onChange={(v) => {
                    haptic.tap();
                    setSongView(v);
                  }}
                  on="bg-white text-black"
                  off="text-white/60"
                  className="min-w-0 -ml-1 overflow-x-auto scrollbar-hide"
                />
                {lyricsHasChords && <TransposeControl tone="stage" semitones={semitones} onChange={setSemitones} songKey={lyricsKey} className="ml-auto" />}
              </div>
              <PersonalLayerScope
                song={mine}
                stage
                onBandNote={
                  notes?.controls && lyricsSong?.songId
                    ? ({ section, line }) => noteSheets.newNote({ songId: lyricsSong.songId!, songTitle: lyricsSong.title, section, line })
                    : undefined
                }
              >
              {mine && <MyNotesBar className="shrink-0 pb-2" />}
              <TransposeProvider semitones={semitones} songKey={lyricsKey}>
              <div ref={lyricsRef} className={cn('flex-1 min-h-0 overflow-y-auto overscroll-contain -mx-4 px-4 pb-6', !split && '[@media(max-height:520px)_and_(min-width:600px)]:flex-none [@media(max-height:520px)_and_(min-width:600px)]:overflow-visible')}>
                <SongBody
                  song={lyricsContent}
                  view={songView}
                  size={lyricsSize.size}
                  muted="text-white/60"
                  line="border-white/25"
                  className="w-full flex flex-col gap-6 pt-1 text-white"
                  chartClassName="w-full flex flex-col gap-5 pt-1 text-white"
                />
              </div>
              </TransposeProvider>
              </PersonalLayerScope>
            </div>
          ) : (
          <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain -mx-4 px-4">
            {songs.length === 0 && !songsLoading && songsError ? (
              <div className="flex flex-col items-start gap-3">
                <p className="bw-body-md text-white/70">{t('Offline: the setlist couldn’t be loaded.')}</p>
                {onRetrySongs && (
                  <button
                    type="button"
                    onClick={() => {
                      haptic.tap();
                      onRetrySongs();
                    }}
                    className="min-h-11 px-4 rounded-full border border-white/40 text-white bw-label-sm"
                  >
                    {t('Try again')}
                  </button>
                )}
              </div>
            ) : songs.length === 0 && !songsLoading ? (
              <p className="bw-body-md text-white/70">
                {rehearsal ? t('No songs picked for this rehearsal yet.') : t('No setlist attached to this gig.')}
              </p>
            ) : (
              <SortableSongList
                songs={stageRows}
                canReorder={!!live?.canReorder}
                onMove={(from, to) => {
                  live?.move(from, to);
                }}
                label={t('Setlist')}
                tone="stage"
                rowClassName="rounded-none pl-0 border-b border-white/15 last:border-b-0"
                isCurrent={(_, i) => i === current}
                rowAction={
                  regiaOn
                    ? (row, i) => {
                        const struck = isStruck(row.song);
                        return (
                          <span className="flex items-center gap-2">
                            {row.song.audio && !struck && (
                              <RegiaRowPlay
                                title={row.song.title}
                                playing={regia!.status === 'playing' && regia!.loadedId === row.song.id}
                                audio={row.song.audio ? regia!.audio[row.song.audio] : undefined}
                                onPlay={() => void regia!.play(i)}
                                accent={accentColor}
                              />
                            )}
                            {canStrike && live?.toggleSkip && (
                              <button
                                type="button"
                                aria-pressed={struck}
                                onClick={() => {
                                  haptic.tap();
                                  live.toggleSkip?.(i);
                                }}
                                aria-label={struck ? t('Bring back {title}', { title: row.song.title }) : t('Strike {title} off tonight', { title: row.song.title })}
                                className={cn('w-11 h-11 flex items-center justify-center rounded-full border', struck ? 'border-white/60 text-white' : 'border-white/25 text-white/60')}
                              >
                                {struck ? <Plus className="w-5 h-5" /> : <Minus className="w-5 h-5" />}
                              </button>
                            )}
                          </span>
                        );
                      }
                    : earlier
                    ? (row) => {
                        const id = row.song.songId;
                        const count = id ? earlierCounts[id] ?? 0 : 0;
                        if (!id || count === 0) return null;
                        return (
                          <button
                            type="button"
                            onClick={() => {
                              haptic.tap();
                              setEarlierSong(id);
                            }}
                            aria-label={t('From last time · {title}: {count}', { title: row.song.title, count })}
                            className="min-w-11 h-11 px-3 flex items-center justify-center gap-1 rounded-full border border-white/40 text-white bw-label-sm"
                          >
                            <StickyNote className="w-4 h-4" aria-hidden />
                            {count}
                          </button>
                        );
                      }
                    : canStrike && live?.toggleSkip
                    ? (row, i) => {
                        const struck = isStruck(row.song);
                        return (
                          <button
                            type="button"
                            aria-pressed={struck}
                            onClick={() => {
                              haptic.tap();
                              live.toggleSkip?.(i);
                            }}
                            aria-label={struck ? t('Bring back {title}', { title: row.song.title }) : t('Strike {title} off tonight', { title: row.song.title })}
                            className={cn(
                              'w-11 h-11 flex items-center justify-center rounded-full border',
                              struck ? 'border-white/60 text-white' : 'border-white/25 text-white/60',
                            )}
                          >
                            {struck ? <Plus className="w-5 h-5" /> : <Minus className="w-5 h-5" />}
                          </button>
                        );
                      }
                    : undefined
                }
                onRowClick={
                  live
                    ? (_, i) => {
                        haptic.tap();
                        live.select(i);
                      }
                    : undefined
                }
                rowLabel={(row, i) =>
                  i === current ? t('Now playing: {title}', { title: row.song.title }) : t('Go to {title}', { title: row.song.title })
                }
                renderRow={(row, { index, overlay }) => {
                  const isCurrent = index === current;
                  const struck = isStruck(row.song);
                  const meta = [row.song.key, row.song.duration].filter(Boolean).join(' · ');
                  return (
                    <>
                      <span
                        className="bw-num text-[16px] font-medium w-7 shrink-0"
                        style={{ ...MONO, color: isCurrent ? accentColor : struck ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.5)' }}
                      >
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <span
                        className={cn('flex-1 min-w-0 bw-h2 normal-case leading-[1.15] truncate', struck && 'line-through decoration-2 text-white/40')}
                        style={isCurrent ? { color: accentColor } : undefined}
                      >
                        {row.song.title}
                        {struck && <span className="sr-only"> · {t('struck off')}</span>}
                      </span>
                      {/* The Regia's ▶ takes the room of the key and length on a phone. */}
                      {meta && !overlay && !struck && !regiaOn && (
                        <span className="bw-num text-[14px] font-medium text-white/70 shrink-0" style={MONO}>
                          {meta}
                        </span>
                      )}
                    </>
                  );
                }}
              />
            )}
          </div>
          )}
        </section>

        {/* Song steps: the leader's reach the whole band. */}
        {live && songs.length > 0 && (
          <div className={cn('grid gap-3 shrink-0', click ? 'grid-cols-[1fr_auto_1fr]' : 'grid-cols-2', ' [@media(max-height:520px)_and_(min-width:600px)]:col-start-1 [@media(max-height:520px)_and_(min-width:600px)]:row-start-3 [@media(max-height:520px)_and_(min-width:600px)]:self-end', split && 'col-start-1 row-start-3 self-end', split && showSide && 'row-start-4', showSide && !split && '[@media(min-width:900px)_and_(min-height:521px)]:col-start-2 [@media(min-width:900px)_and_(min-height:521px)]:row-start-3')}>
            <button
              type="button"
              disabled={current <= 0}
              onClick={() => {
                haptic.tap();
                live.go(-1);
              }}
              aria-label={t('Previous song')}
              className="flex items-center justify-center gap-2 min-h-14 rounded-[20px] bg-white/10 text-white bw-button-sm disabled:opacity-40"
            >
              {/* Closed Duo on its side: the left column is too narrow for the words. */}
              <ChevronLeft className="w-6 h-6 shrink-0" /> <span className="[@media(max-height:520px)_and_(min-width:600px)_and_(max-width:760px)]:sr-only">{t('Prev')}</span>
            </button>
            {click && (
              <StageClickButton
                bpm={currentSong?.bpm}
                running={clickRunning}
                following={clickRunning && !click.mine}
                hidden={clickHidden}
                onPress={pressClick}
                accent={accentColor}
              />
            )}
            <button
              type="button"
              disabled={current >= songs.length - 1}
              onClick={() => {
                haptic.tap();
                live.go(1);
              }}
              aria-label={t('Next song')}
              className="flex items-center justify-center gap-2 min-h-14 rounded-[20px] text-black bw-button-sm disabled:opacity-40"
              style={{ backgroundColor: accentColor }}
            >
              <span className="[@media(max-height:520px)_and_(min-width:600px)_and_(max-width:760px)]:sr-only">{t('Next')}</span> <ChevronRight className="w-6 h-6 shrink-0" />
            </button>
          </div>
        )}
      </div>
      {showClick && clickState && click && !(songOnly && !laptop) && (
        <StageClickFrame state={clickState} offset={click.offset} accent={accentColor} onDone={clickUi.onDone} />
      )}
      {songOnly && !laptop && lyricsSong && (
        <StageSongOnly
          title={lyricsSong.title}
          index={Math.max(0, current)}
          count={songs.length}
          song={lyricsContent}
          view={songView}
          size={lyricsSize.size}
          semitones={semitones}
          songKey={lyricsKey}
          canPrev={!!live && current > 0}
          canNext={!!live && current < songs.length - 1}
          onStep={(d) => live?.go(d)}
          accent={accentColor}
          onShowAll={showAll}
          click={
            click ? (
              <StageClickButton
                bpm={currentSong?.bpm}
                running={clickRunning}
                following={clickRunning && !click.mine}
                hidden={clickHidden}
                onPress={pressClick}
                accent={accentColor}
              />
            ) : undefined
          }
          clickFrame={
            showClick && clickState && click ? (
              <StageClickFrame state={clickState} offset={click.offset} accent={accentColor} onDone={clickUi.onDone} />
            ) : undefined
          }
        />
      )}
      <AnimatePresence>
        {summary && session && (
          <RehearsalSummaryDialog
            summary={summary}
            accentColor={accentColor}
            onResume={
              session.canControl
                ? () => {
                    closeSummary();
                    session.resume();
                  }
                : undefined
            }
            onClose={closeSummary}
            marks={notes ? marksToWrite(notes.controls).length : 0}
            onWriteMarks={notes ? () => noteSheets.setListOpen(true) : undefined}
          />
        )}
      </AnimatePresence>
      {regiaOn && (
        <RegiaExtraSheet
          open={extraOpen}
          bandId={bandId}
          inSetlist={inSetlist}
          onPick={(song) => {
            setExtraOpen(false);
            void regia!.playExtra(song);
          }}
          onClose={() => setExtraOpen(false)}
          accent={accentColor}
        />
      )}
      {earlier && (
        <EarlierNotesSheet
          songId={earlierSong}
          title={songs.find((s) => s.songId === earlierSong)?.title ?? ''}
          earlier={earlier}
          onClose={() => setEarlierSong(null)}
        />
      )}
      {notes && (
        <NoteSheetsHost
          sheets={noteSheets}
          controls={notes.controls}
          songs={notes.songs}
          members={notes.members}
          currentSongId={songs[current]?.songId ?? null}
        />
      )}
    </motion.div>
  );
};

/** A member's follow button: says so when nothing can reach this phone any more. */
const followLabel = (live: StageLiveControls, t: ReturnType<typeof useT>) =>
  !live.following
    ? t('Follow leader')
    : !live.leaderSeen
      ? t('Waiting for leader')
      : !live.connected && live.bluetooth !== 'connected'
        ? t('Offline')
        : t('Following leader');

/** Why the Bluetooth sync (offline on stage) isn't running, when it matters. */
const bluetoothHint = (live: StageLiveControls, t: ReturnType<typeof useT>) =>
  live.bluetooth === 'outdated'
    ? t('This phone has an older setlist. Connect to the internet once to follow over Bluetooth.')
    : live.bluetooth === 'unavailable' && !live.connected
      ? t('Bluetooth is off or not allowed. Turn it on in Settings to stay in sync without internet.')
      : null;

const saveLabel = (state: StageSaveState, t: ReturnType<typeof useT>) =>
  state === 'saving' ? t('Saving…') : state === 'error' ? t('Not saved') : state === 'saved' ? t('Saved') : t('Live');

/** Leader's live dot and status. */
const LiveStatus: React.FC<{ on: boolean; label: string; hint?: string; accentColor: string }> = ({ on, label, hint, accentColor }) => (
  <span className="flex items-center gap-2 bw-label-xs text-white/80 whitespace-nowrap min-w-0" role="status" title={hint}>
    <span
      aria-hidden
      className="w-2 h-2 rounded-full shrink-0"
      style={on ? { backgroundColor: accentColor } : { border: '1px solid rgba(255,255,255,0.6)' }}
    />
    <span className="truncate">{label}</span>
    {hint && <span className="sr-only">{` · ${hint}`}</span>}
  </span>
);

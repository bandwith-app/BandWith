import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { stepOver } from '@/lib/stageLive';
import { ChevronLeft, ChevronRight, LayoutTemplate, Minimize, Minus, Pause, Play, Plus, ScrollText, X } from '@/app/components/icons';
import { cn } from '@/app/components/ui/utils';
import { haptic } from '@/lib/haptics';
import { useKeepAwake } from '@/lib/posture';
import { FoldSplit } from '../FoldSplit';
import { DeckButton, clock, durationSeconds } from './shared';
import { useLyricsSize } from '@/app/components/ui/LyricsViewer';
import { MyNotesBar, PersonalLayerScope } from '@/app/components/songs/PersonalLayer';
import { SongBody, SongViewTabs, useSongViewPreference } from '@/app/components/ui/SongViews';
import { VoiceAssignmentScope } from '@/app/components/songs/WhoSingsWhat';
import { TransposeControl, TransposeProvider, useSongTranspose } from '@/app/components/ui/Transpose';
import { normalizeLyrics, resolveView } from '@/lib/songFormat';
import { keyLabel, type SongChart } from '@/lib/ireal';
import { useT } from '@/lib/i18n';
import { exitBrowserFullScreen, requestBrowserFullScreen, useStageBarHidden, useStageSongOnly } from '@/lib/stageChrome';
import { StageClickButton, StageClickFrame, useStageClickUi, type StageClickControls } from '@/app/components/dashboard/StageClick';
import { CountInButton, CountInSheetButton } from '@/app/components/dashboard/StageCountIn';
import { useSessionSeconds } from '@/app/components/dashboard/RehearsalSession';
import type { RehearsalSessionControls } from '@/app/components/event/useRehearsalSession';
import { formatClock } from '@/lib/rehearsalSession';
import type { StageBleStatus } from '@/lib/stageBleNotice';
import { StageBleNoticeLine } from '@/app/components/event/StageBleNoticeLine';
import { NoteSheetsHost, WedgeNotesPad, useNoteSheets, type LiveNotes } from '@/app/components/dashboard/RehearsalNotes';

/**
 * Floor wedge (Stage mode in Laptop pose): the phone stands on the stage
 * floor like a wedge monitor. Display (OLED black, largest type): song
 * counter, title, key, BPM, next song and elapsed time. Deck: big PREV /
 * NEXT pads and the set's progress. The screen stays awake while mounted,
 * so mount it only alongside Stage mode.
 *
 * Songs use Stage mode's shape (src/app/components/dashboard/StageMode.tsx
 * `StageSong`), plus an optional BPM. Arrow keys, Page Up/Down and Space
 * also step, so Bluetooth page-turner pedals work.
 */

export interface WedgeSong {
  /** setlist_songs row id (the click belongs to a song). */
  id?: string;
  /** songs.id: transpose and My notes are kept per song. */
  songId?: string;
  title: string;
  artist?: string;
  key?: string | null;
  bpm?: number | null;
  /** "3:45" or seconds. */
  duration?: string | number | null;
  /** songs.lyrics: the display can show them instead of the big title. */
  lyrics?: string | null;
  /** songs.chord_chart (also the time signature for the click's accent). */
  chart?: SongChart | null;
}

export interface FloorWedgeModeProps {
  songs: WedgeSong[];
  /** Rehearsal Live mode: "who sings what" has no per-gig override there. */
  rehearsal?: boolean;
  /** Gig title shown above the counter. */
  title?: string;
  /** The gig's band: my notes on its songs (109), as in Stage mode. */
  bandId?: string;
  /** e.g. "Set 1". */
  setLabel?: string;
  songsLoading?: boolean;
  initialIndex?: number;
  /** Current song when Stage mode is live (useStageLive); omitted = own counter. */
  index?: number;
  onIndexChange?: (index: number) => void;
  /** Songs struck off tonight (row ids, Stage mode live): Prev / Next skip them. */
  skipped?: ReadonlySet<string>;
  /** Live follow state: members get a "follow leader" switch, the admin a status. */
  follow?: {
    isLeader: boolean;
    following: boolean;
    leaderSeen: boolean;
    connected: boolean;
    /** Bluetooth link (native apps): 'leading' for the admin, 'connected' for a member. */
    bluetooth?: StageBleStatus;
    /** Leader: phones linked over Bluetooth. */
    bluetoothFollowers?: number;
    /** Allow Bluetooth / turn it on. */
    fixBluetooth?: () => void | Promise<void>;
    onToggle: (on: boolean) => void;
  };
  /** Visual metronome (useStageLive().click): the button on the Deck, the glow above the wedge. */
  click?: StageClickControls;
  /** The leader's Count in (StageCountIn), next to the click; the countdown itself is Stage mode's, above the wedge. */
  countIn?: { counting: boolean; onPress: () => void } | null;
  /**
   * Count-in options (this phone's vibration and sound; leader: Count in
   * anyway, the band's direction). The setlist row's button is under the wedge.
   */
  countInOptions?: () => void;
  /** When the set started (elapsed time); defaults to when the mode mounted. */
  startedAt?: Date | number;
  /** See FoldSplit. Default 125 (above Stage mode). */
  zIndex?: number;
  /** Song view on (controlled, optional): shared with Stage mode's song view. */
  lyricsOn?: boolean;
  onLyricsOnChange?: (on: boolean) => void;
  /**
   * Leaves Stage mode. Shown on the Deck only while the side bar is hidden
   * (src/lib/stageChrome.ts); otherwise Exit is in the rail.
   */
  onClose?: () => void;
  /** Name of the Exit button: "Exit live mode" on a rehearsal (default "Exit stage mode"). */
  exitLabel?: string;
  /**
   * Rehearsal session (plan A1b): the wedge shows its clock instead of the
   * time since the mode opened, and the admin can pause / resume it here
   * (starting and ending stay in Live mode, unfolded).
   */
  session?: RehearsalSessionControls;
  /** Rehearsal notes (plan A2): the notes pad on the deck. */
  notes?: LiveNotes;
}

export const FloorWedgeMode: React.FC<FloorWedgeModeProps> = ({
  songs,
  rehearsal,
  title,
  bandId,
  setLabel,
  songsLoading,
  initialIndex = 0,
  index: controlledIndex,
  onIndexChange,
  skipped,
  follow,
  click,
  countIn,
  countInOptions,
  startedAt,
  // Set inline, so the wedge stays when a hub (search, Calendar) lies under
  // Stage mode: the Laptop rule hides inline-less page splits while a hub is open.
  zIndex = 125,
  lyricsOn: lyricsOnProp,
  onLyricsOnChange,
  onClose,
  exitLabel: exitLabelProp,
  session: sessionProp,
  notes: notesProp,
}) => {
  const t = useT();
  const exitLabel = exitLabelProp ?? t('Exit stage mode');
  // Stage mode full screen hides the rail, which holds Exit and Full screen:
  // the Deck shows Exit full screen and Exit instead.
  const [barHidden, setBarHidden] = useStageBarHidden();
  const ownChrome = !!onClose && barHidden;
  useKeepAwake(true);
  const count = songs.length;
  const [ownIndex, setIndex] = useState(() => Math.min(Math.max(0, initialIndex), Math.max(0, count - 1)));
  const index = controlledIndex ?? ownIndex;
  const [mountedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // A shorter setlist (reload) must not leave the counter past its end.
  useEffect(() => {
    if (controlledIndex === undefined && count > 0 && ownIndex > count - 1) setIndex(count - 1);
  }, [count, ownIndex, controlledIndex]);

  const go = useCallback(
    (delta: number) => {
      const next = skipped?.size
        ? stepOver(songs as { id?: string }[], index, delta, skipped)
        : Math.min(Math.max(0, index + delta), Math.max(0, count - 1));
      if (next === index) return;
      haptic.tap();
      setIndex(next);
      onIndexChange?.(next);
    },
    [index, count, onIndexChange, skipped, songs],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) {
        e.preventDefault();
        go(1);
      } else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) {
        e.preventDefault();
        go(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  const song = count > 0 ? songs[index] : null;
  const notes = notesProp?.controls.enabled ? notesProp : undefined;
  const noteSheets = useNoteSheets(notes?.controls);
  // Song view as in Stage mode (Lyrics / Chords / Structure, transpose, My
  // notes): the same per-device preference and per-song transpose, so folding
  // from Book keeps what the player picked there.
  const hasLyrics = songs.some((s) => !!s.lyrics?.trim() || !!s.chart);
  const [ownLyricsOn, setOwnLyricsOn] = useState(false);
  const lyricsOn = lyricsOnProp ?? ownLyricsOn;
  const setLyricsOn = (on: boolean) => {
    setOwnLyricsOn(on);
    onLyricsOnChange?.(on);
  };
  const showLyrics = lyricsOn && hasLyrics && !!song;
  // Song only (src/lib/stageChrome.ts), shared with Stage mode: only the song
  // on the Display, only Show everything, Prev, the click and Next on the Deck.
  const [songOnlyOn, setSongOnly] = useStageSongOnly();
  const songOnly = songOnlyOn && showLyrics;
  const showAll = () => {
    haptic.tap();
    setSongOnly(false);
    if (!barHidden) void exitBrowserFullScreen();
  };
  const lyricsSize = useLyricsSize();
  const [songView, setSongView] = useSongViewPreference();
  const content = useMemo(() => ({ lyrics: normalizeLyrics(song?.lyrics), chart: song?.chart ?? undefined }), [song?.lyrics, song?.chart]);
  const shownView = resolveView(songView, content);
  const [semitones, setSemitones] = useSongTranspose(song?.songId);
  const songKey = song?.key || keyLabel(song?.chart?.key) || null;
  const hasChords = showLyrics && shownView !== 'lyrics' && (!!song?.chart || /\[[A-G][^\]\s]{0,15}\]/.test(song?.lyrics || ''));
  const mine = useMemo(
    () => (song?.songId && bandId ? { id: song.songId, band_id: bandId, title: song.title, lyrics: content.lyrics } : null),
    [song?.songId, song?.title, bandId, content.lyrics],
  );
  const lyricsRef = React.useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    lyricsRef.current?.scrollTo?.({ top: 0 });
  }, [index, showLyrics, shownView, songOnly]);
  const next = index + 1 < count ? songs[index + 1] : null;
  const clickUi = useStageClickUi(click, song);
  const start = startedAt !== undefined ? new Date(startedAt).getTime() : mountedAt;
  const session = sessionProp?.enabled && sessionProp.status !== 'idle' ? sessionProp : undefined;
  const sessionSeconds = useSessionSeconds(session?.state ?? null, session?.status ?? 'idle');
  const elapsed = session ? formatClock(sessionSeconds) : clock(Math.max(0, (now - start) / 1000));
  const sessionToggle =
    session?.canControl && (session.status === 'live' || session.status === 'paused') ? session : undefined;

  // Time left in the set, when every remaining song has a duration.
  const remaining = songs.slice(index).map((s) => durationSeconds(s.duration ?? null));
  const left = remaining.length > 0 && remaining.every((s) => s !== null)
    ? remaining.reduce<number>((sum, s) => sum + (s ?? 0), 0)
    : null;

  const display = (
    <div className={cn('bw-fold-pad flex flex-col gap-3 pt-3 pb-4 bg-black text-white select-none', showLyrics ? 'h-full' : 'min-h-full')}>
      <div className={cn('flex items-baseline justify-between gap-4 bw-label-md uppercase text-white/60', songOnly && 'hidden')}>
        <span className="truncate">{[setLabel, title].filter(Boolean).join(' · ') || t('Stage')}</span>
        <span className="shrink-0 tabular-nums" aria-label={session ? t('Rehearsed {time}', { time: elapsed }) : t('Elapsed {time}', { time: elapsed })}>
          {session?.status === 'paused' ? `${t('Paused')} · ` : ''}
          {elapsed}
        </span>
      </div>
      {songOnly && song ? (
        <div
          ref={lyricsRef}
          data-song-only-body
          className="bw-fold-clear flex-1 min-h-0 overflow-y-auto overscroll-contain"
          aria-label={t('Song only: {title}', { title: song.title })}
        >
          {/* Which song this is, in one small line (as StageSongOnly): the song takes the rest. */}
          <p className="flex items-baseline gap-2 min-w-0 pb-2" aria-live="polite">
            <span className="sr-only">{t('Song {index} of {count}', { index: index + 1, count })} · </span>
            <span aria-hidden className="bw-num text-[13px] font-medium shrink-0 text-white/50">
              {String(index + 1).padStart(2, '0')}/{String(count).padStart(2, '0')}
            </span>
            <span className="bw-label-md normal-case truncate min-w-0 text-accent">{song.title}</span>
          </p>
          <VoiceAssignmentScope songId={song.songId} setlistSongId={rehearsal ? undefined : song.id} songTitle={song.title} lyrics={content.lyrics}>
          <SongBody
            song={content}
            view={songView}
            size={lyricsSize.size}
            muted="text-white/60"
            line="border-white/25"
            className="w-full flex flex-col gap-6 pb-4 text-white"
            chartClassName="w-full flex flex-col gap-5 pb-4 text-white"
            showLegend={false}
          />
          </VoiceAssignmentScope>
        </div>
      ) : !song ? (
        <p className="bw-display-lg text-white/70">{songsLoading ? t('Loading setlist…') : t('No setlist')}</p>
      ) : showLyrics ? (
        <>
          <div className="bw-fold-clear flex items-center gap-3 min-w-0">
            <p className="bw-value-lg tabular-nums shrink-0" aria-live="polite">
              {index + 1}
              <span className="text-white/40"> / {count}</span>
            </p>
            <h1 className="flex-1 min-w-0 bw-h2 truncate text-accent">{song.title}</h1>
          </div>
          {/* Only the words on the Display; their controls are on the Deck
              (the text size buttons sat under the clock block here). */}
          <div
            ref={lyricsRef}
            className="flex-1 min-h-0 overflow-y-auto overscroll-contain"
            aria-label={shownView !== 'lyrics' ? t('Chords · {title}', { title: song.title }) : t('Lyrics · {title}', { title: song.title })}
          >
            <VoiceAssignmentScope songId={song.songId} setlistSongId={rehearsal ? undefined : song.id} songTitle={song.title} lyrics={content.lyrics}>
            <SongBody
              song={content}
              view={songView}
              size={lyricsSize.size}
              muted="text-white/60"
              line="border-white/25"
              className="w-full flex flex-col gap-6 pb-4 text-white"
              chartClassName="w-full flex flex-col gap-5 pb-4 text-white"
              showLegend={false}
            />
            </VoiceAssignmentScope>
          </div>
        </>
      ) : (
        <>
          <p className="bw-fold-clear bw-value-lg tabular-nums" aria-live="polite">
            {index + 1}
            <span className="text-white/40"> / {count}</span>
          </p>
          <h1 className="bw-display-xl line-clamp-2 [overflow-wrap:anywhere]" style={{ fontSize: 'clamp(44px, 9vw, 88px)' }}>
            {song.title}
          </h1>
          {(song.key || song.bpm) && (
            <dl className="flex gap-8">
              {song.key && (
                <div>
                  <dt className="bw-label-sm uppercase text-white/50">{t('Key')}</dt>
                  <dd className="bw-value-lg">{song.key}</dd>
                </div>
              )}
              {song.bpm ? (
                <div>
                  <dt className="bw-label-sm uppercase text-white/50">BPM</dt>
                  <dd className="bw-value-lg tabular-nums">{song.bpm}</dd>
                </div>
              ) : null}
            </dl>
          )}
          <p className="mt-auto bw-h3 text-white/70 truncate">
            {next ? (
              <>
                <span className="bw-label-sm uppercase text-white/45 mr-2">{t('Next')}</span>
                {next.title}
                {/* Keys keep their case (Ab, not AB) inside the uppercase heading. */}
                {next.key ? <> · <span className="normal-case">{next.key}</span></> : null}
              </>
            ) : (
              <span className="bw-label-sm uppercase text-white/45">{t('Last song')}</span>
            )}
          </p>
        </>
      )}
    </div>
  );

  const deck = songOnly ? (
    <div className="min-h-full flex flex-col px-4 pt-3 pb-3 text-white">
      <div className={cn('grid gap-3 flex-1 min-h-[88px]', click && countIn ? 'grid-cols-[auto_1fr_auto_auto_1fr]' : click || countIn ? 'grid-cols-[auto_1fr_auto_1fr]' : 'grid-cols-[auto_1fr_1fr]')}>
        <button
          type="button"
          onClick={showAll}
          aria-label={t('Show everything')}
          title={t('Show everything')}
          className="w-16 h-full flex items-center justify-center rounded-[20px] border border-white/40 text-white [&_svg]:w-7 [&_svg]:h-7"
        >
          <LayoutTemplate aria-hidden />
        </button>
        <DeckButton
          size="pad"
          tone="muted"
          className="h-full bg-white/10 text-white"
          disabled={index === 0}
          onClick={() => go(-1)}
          aria-label={t('Previous song')}
        >
          <ChevronLeft className="w-7 h-7" /> {t('Prev')}
        </DeckButton>
        {click && (
          <StageClickButton
            bpm={song?.bpm ?? undefined}
            running={clickUi.running}
            following={clickUi.following}
            hidden={clickUi.hidden}
            onPress={clickUi.press}
            accent="var(--accent)"
          />
        )}
        {countIn && <CountInButton counting={countIn.counting} onPress={countIn.onPress} className="h-full" />}
        <DeckButton
          size="pad"
          tone="accent"
          className="h-full"
          disabled={index >= count - 1}
          onClick={() => go(1)}
          aria-label={t('Next song')}
        >
          {t('Next')} <ChevronRight className="w-7 h-7" />
        </DeckButton>
      </div>
    </div>
  ) : (
    <div className="min-h-full flex flex-col gap-3 px-4 pt-3 pb-3 text-white">
      {(follow || hasLyrics || ownChrome || sessionToggle) && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 min-h-11 shrink-0">
          {hasLyrics ? (
            <button
              type="button"
              aria-pressed={lyricsOn}
              onClick={() => {
                haptic.tap();
                setLyricsOn(!lyricsOn);
              }}
              className={cn(
                'flex items-center gap-2 min-h-11 px-4 rounded-full bw-label-md uppercase border',
                lyricsOn ? 'bg-white text-black border-white' : 'border-white/40 text-white',
              )}
            >
              {t('Lyrics')}
            </button>
          ) : (
            <span />
          )}
          {sessionToggle && (
            <button
              type="button"
              onClick={() => {
                haptic.tap();
                if (sessionToggle.status === 'live') sessionToggle.pause();
                else sessionToggle.resume();
              }}
              className="flex items-center gap-2 min-h-11 px-4 rounded-full bw-label-md uppercase border border-white/40 text-white"
            >
              {sessionToggle.status === 'live' ? <Pause className="w-4 h-4" aria-hidden /> : <Play className="w-4 h-4" aria-hidden />}
              {sessionToggle.status === 'live' ? t('Pause') : t('Resume')}
            </button>
          )}
          {!follow ? null : follow.isLeader ? (
            <span className="flex items-center gap-2 bw-label-md uppercase text-white/70" role="status">
              <span
                aria-hidden
                className={cn('w-2 h-2 rounded-full', follow.connected || follow.bluetooth === 'leading' ? 'bg-accent' : 'border border-white/60')}
              />
              {follow.connected || (follow.bluetooth === 'leading' && (follow.bluetoothFollowers ?? 0) > 0)
                ? t('Band follows you')
                : follow.bluetooth === 'leading'
                  ? t('Live')
                  : t('Offline')}
            </span>
          ) : (
            <button
              type="button"
              aria-pressed={follow.following}
              onClick={() => {
                haptic.tap();
                follow.onToggle(!follow.following);
              }}
              className={cn(
                'flex items-center gap-2 min-h-11 px-4 rounded-full bw-label-md uppercase border',
                follow.following ? 'bg-accent text-accent-foreground border-transparent' : 'border-white/40 text-white',
              )}
            >
              <span aria-hidden className={cn('w-2 h-2 rounded-full', follow.following ? 'bg-accent-foreground' : 'border border-white')} />
              {!follow.following
                ? t('Follow leader')
                : !follow.leaderSeen
                  ? t('Waiting for leader')
                  : !follow.connected && follow.bluetooth !== 'connected'
                    ? t('Offline')
                    : t('Following leader')}
            </button>
          )}
          {countInOptions && <CountInSheetButton onPress={countInOptions} />}
          {ownChrome && (
            <span className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                aria-label={t('Exit full screen')}
                title={t('Exit full screen')}
                onClick={() => {
                  haptic.tap();
                  setBarHidden(false);
                  void exitBrowserFullScreen();
                }}
                className="w-11 h-11 flex items-center justify-center rounded-full border border-white/40 text-white [&_svg]:w-5 [&_svg]:h-5"
              >
                <Minimize />
              </button>
              <button
                type="button"
                aria-label={exitLabel}
                title={exitLabel}
                onClick={() => {
                  haptic.tap();
                  onClose?.();
                }}
                className="w-11 h-11 flex items-center justify-center rounded-full border border-white text-white [&_svg]:w-5 [&_svg]:h-5"
              >
                <X />
              </button>
            </span>
          )}
        </div>
      )}
      {follow && (
        <StageBleNoticeLine
          className="shrink-0"
          status={follow.bluetooth}
          online={follow.connected}
          isLeader={follow.isLeader}
          followers={follow.bluetoothFollowers}
          onFix={follow.fixBluetooth}
        />
      )}
      {showLyrics && (
        <div className="flex flex-col gap-2 shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            <SongViewTabs
              song={content}
              view={shownView ?? songView}
              onChange={(v) => {
                haptic.tap();
                setSongView(v);
              }}
              on="bg-white text-black"
              off="text-white/60"
              className="min-w-0 -ml-1 overflow-x-auto scrollbar-hide"
            />
            <span className="flex items-center gap-2 ml-auto shrink-0">
              <button
                type="button"
                onClick={() => {
                  haptic.tap();
                  setSongOnly(true);
                  void requestBrowserFullScreen();
                }}
                aria-label={t('Song only')}
                title={t('Song only')}
                className="w-11 h-11 flex items-center justify-center rounded-full border border-white/30 shrink-0 [&_svg]:w-5 [&_svg]:h-5"
              >
                <ScrollText aria-hidden />
              </button>
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
            </span>
          </div>
          {hasChords && <TransposeControl tone="stage" semitones={semitones} onChange={setSemitones} songKey={songKey} />}
          {mine && <MyNotesBar />}
        </div>
      )}
      {notes && (
        <WedgeNotesPad
          controls={notes.controls}
          sheets={noteSheets}
          song={song ? { songId: song.songId, title: song.title, lyrics: song.lyrics } : null}
          onMark={() => notes.controls.mark({ songId: song?.songId ?? null, songTitle: song?.title ?? null, markedAtS: notes.elapsed() })}
        />
      )}
      <div className={cn('grid gap-3 flex-1 min-h-[88px]', click && countIn ? 'grid-cols-[1fr_auto_auto_1fr]' : click || countIn ? 'grid-cols-[1fr_auto_1fr]' : 'grid-cols-2')}>
        <DeckButton
          size="pad"
          tone="muted"
          className="h-full bg-white/10 text-white"
          disabled={!song || index === 0}
          onClick={() => go(-1)}
          aria-label={t('Previous song')}
        >
          <ChevronLeft className="w-7 h-7" /> {t('Prev')}
        </DeckButton>
        {click && (
          <StageClickButton
            bpm={song?.bpm ?? undefined}
            running={clickUi.running}
            following={clickUi.following}
            hidden={clickUi.hidden}
            onPress={clickUi.press}
            accent="var(--accent)"
          />
        )}
        {countIn && <CountInButton counting={countIn.counting} onPress={countIn.onPress} className="h-full" />}
        <DeckButton
          size="pad"
          tone="accent"
          className="h-full"
          disabled={!song || index >= count - 1}
          onClick={() => go(1)}
          aria-label={t('Next song')}
        >
          {t('Next')} <ChevronRight className="w-7 h-7" />
        </DeckButton>
      </div>
      {count > 0 && (
        <div className="flex flex-col gap-1.5" aria-label={t('Song {index} of {count}', { index: index + 1, count })}>
          <div className="flex gap-1" aria-hidden>
            {songs.map((song, i) => (
              <span
                key={i}
                className={cn(
                  'h-1.5 flex-1 rounded-full',
                  i === index ? 'bg-accent' : skipped?.has((song as { id?: string }).id ?? '') ? 'bg-white/[0.06]' : i < index ? 'bg-white/60' : 'bg-white/15',
                )}
              />
            ))}
          </div>
          <p className="bw-label-md uppercase text-white/60 flex justify-between">
            <span>{t('Song {index} of {count}', { index: index + 1, count })}</span>
            {left !== null && <span className="tabular-nums">{t('{time} left', { time: clock(left) })}</span>}
          </p>
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* Both halves read the song's transpose and My notes (as in Stage mode). */}
      <PersonalLayerScope song={showLyrics && !songOnly ? mine : null} stage>
        <TransposeProvider semitones={semitones} songKey={songKey}>
          <FoldSplit zIndex={zIndex} variant="stage" displayLabel={t('Now playing')} deckLabel={t('Song controls')} display={display} deck={deck} />
        </TransposeProvider>
      </PersonalLayerScope>
      {/* The click's glow goes above the wedge (Stage mode's own sits under it). */}
      {click && clickUi.show && clickUi.state && typeof document !== 'undefined' &&
        createPortal(
          <StageClickFrame state={clickUi.state} offset={click.offset} accent="var(--accent)" onDone={clickUi.onDone} zIndex={zIndex + 1} />,
          document.body,
        )}
      {notes && (
        <NoteSheetsHost sheets={noteSheets} controls={notes.controls} songs={notes.songs} members={notes.members} currentSongId={song?.songId ?? null} />
      )}
    </>
  );
};

export default FloorWedgeMode;

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronRight, Loader2, Pause, Play, Plus, RotateCw, Search, Square, Volume2, X } from '@/app/components/icons';
import { haptic } from '@/lib/haptics';
import { cn } from '@/app/components/ui/utils';
import { useT } from '@/lib/i18n';
import { formatClock, playPosition } from '@/lib/stageRegia';
import { getSongs } from '@/lib/services/songs';
import { useSystemBack } from '@/lib/backStack';
import type { PlayFailure, SongAudio, StageRegia } from '@/app/components/event/useStageRegia';
import { audioReasonText } from '@/app/components/event/audioReason';

/**
 * Stage manager mode ("Regia") in Stage mode. The Regia's bar (an admin's
 * device wired to the mixer: play, pause, hold to stop, a song off the
 * setlist) and the musicians' "Now playing" strip.
 * See useStageRegia and docs/plans/stage-manager-mode.md.
 */

const MONO: React.CSSProperties = { fontFamily: 'var(--font-mono)' };
/** Stop needs a hold this long (no song cut off by a stray tap on stage). */
const HOLD_MS = 700;

/** Re-renders every `ms` while `on` (a running clock on screen). */
const useTick = (on: boolean, ms = 500) => {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!on) return;
    const id = window.setInterval(() => setN((n) => n + 1), ms);
    return () => window.clearInterval(id);
  }, [on, ms]);
};

const Progress: React.FC<{ positionMs: number; durationMs: number | null; accent: string }> = ({ positionMs, durationMs, accent }) => {
  const pct = durationMs ? Math.min(100, (positionMs / durationMs) * 100) : 0;
  return (
    <span aria-hidden className="block h-1 w-full shrink-0 rounded-full bg-white/15 overflow-hidden">
      <span className="block h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: accent }} />
    </span>
  );
};

/** Why a song's audio can't come down or play, and what to do about it. */
/** A button that acts only once held down for HOLD_MS. */
const HoldButton: React.FC<{ label: string; hint: string; onHold: () => void; disabled?: boolean; children: React.ReactNode; className?: string }> = ({
  label,
  hint,
  onHold,
  disabled,
  children,
  className,
}) => {
  const timer = useRef<number | undefined>(undefined);
  const [holding, setHolding] = useState(false);
  const cancel = () => {
    window.clearTimeout(timer.current);
    setHolding(false);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const start = () => {
    if (disabled) return;
    setHolding(true);
    timer.current = window.setTimeout(() => {
      setHolding(false);
      haptic.medium();
      onHold();
    }, HOLD_MS);
  };
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={`${label} · ${hint}`}
      title={hint}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      // Keyboard and screen readers: Enter / Space act at once (no hold possible).
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onHold();
        }
      }}
      onContextMenu={(e) => e.preventDefault()}
      className={cn('relative overflow-hidden touch-none', className)}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 bg-white/25"
        style={{ width: holding ? '100%' : '0%', transition: holding ? `width ${HOLD_MS}ms linear` : 'none' }}
      />
      <span className="relative flex items-center justify-center gap-2">{children}</span>
    </button>
  );
};

interface BarProps {
  regia: StageRegia;
  /** The setlist in its live order (titles for the "next" button, which songs have audio). */
  songs: { id?: string; title: string; audio?: string | null }[];
  currentIndex: number;
  /** A setlist the song off it can be added to. */
  canAddSongs: boolean;
  onAddSong: () => void;
  accent: string;
  className?: string;
}

/** The admin's Regia: off (turn it on), or on (the player). */
export const RegiaBar: React.FC<BarProps> = ({ regia, songs, currentIndex, canAddSongs, onAddSong, accent, className }) => {
  const t = useT();
  const [asking, setAsking] = useState(false);
  const [showFailed, setShowFailed] = useState(false);
  const playing = regia.status === 'playing';

  if (!regia.available) return null;

  if (regia.lostTo !== null && !regia.on) {
    return (
      <div className={cn('flex items-center justify-between gap-3 shrink-0 rounded-[16px] border border-white/25 px-4 py-2', className)} role="status">
        <span className="bw-body-sm text-white/80 min-w-0">
          {regia.lostTo ? t('{name} is now the stage manager. Your audio stopped.', { name: regia.lostTo }) : t('Another admin is now the stage manager. Your audio stopped.')}
        </span>
        <button
          type="button"
          onClick={() => {
            haptic.tap();
            regia.dismissLost();
          }}
          aria-label={t('Close')}
          className="w-11 h-11 flex items-center justify-center rounded-full border border-white/30 shrink-0"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
    );
  }

  if (!regia.on) {
    if (asking && regia.heldBy !== null) {
      return (
        <div className={cn('flex flex-col gap-2 shrink-0 rounded-[16px] border border-white/25 px-4 py-3', className)} role="alertdialog" aria-label={t('Take over as stage manager')}>
          <p className="bw-body-sm text-white">
            {regia.heldBy ? t('{name}’s device is the stage manager. Take over? Their audio stops.', { name: regia.heldBy }) : t('Another device is the stage manager. Take over? Its audio stops.')}
          </p>
          <span className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                haptic.medium();
                setAsking(false);
                regia.turnOn();
              }}
              className="min-h-11 px-4 rounded-full text-black bw-label-sm"
              style={{ backgroundColor: accent }}
            >
              {t('Take over')}
            </button>
            <button type="button" onClick={() => setAsking(false)} className="min-h-11 px-4 rounded-full border border-white/40 text-white bw-label-sm">
              {t('Cancel')}
            </button>
          </span>
        </div>
      );
    }
    return (
      <div className={cn('flex items-center gap-3 shrink-0', className)}>
        <button
          type="button"
          onClick={() => {
            haptic.tap();
            if (regia.heldBy !== null) setAsking(true);
            else regia.turnOn();
          }}
          className="flex items-center gap-2 min-h-11 px-3 rounded-full border border-white/40 text-white bw-label-xs whitespace-nowrap"
        >
          <Volume2 className="w-4 h-4 shrink-0" aria-hidden />
          {t('Stage manager: play audio here')}
        </button>
        <span className="bw-body-sm text-white/60 min-w-0 truncate">
          {regia.heldBy !== null ? (regia.heldBy ? t('Stage manager: {name}', { name: regia.heldBy }) : t('Another device is the stage manager')) : t('Cable to the mixer')}
        </span>
      </div>
    );
  }

  const loadedIndex = songs.findIndex((s) => s.id === regia.loadedId);
  const shownIndex = loadedIndex >= 0 ? loadedIndex : currentIndex;
  const shown = songs[shownIndex];
  const next = regia.nextIndex != null ? songs[regia.nextIndex] : null;
  const ended = regia.status === 'ended';
  const loading = regia.status === 'loading';
  const { readiness, downloading, failed } = regia;
  const pct = downloading ? Math.round(downloading.progress * 100) : 0;
  const statusText = regia.checking
    ? t('Checking the audio…')
    : downloading
      ? t('Downloading {done}/{total} · {pct}%', { done: Math.min(downloading.total, downloading.done + 1), total: downloading.total, pct })
      : readiness.withAudio === 0
        ? t('No song in this setlist has audio')
        : readiness.missing > 0 && failed.length === 0
          ? t('Audio ready {ready}/{total} · {missing} need internet', { ready: readiness.ready, total: readiness.withAudio, missing: readiness.missing })
          : t('Audio ready {ready}/{total}', { ready: readiness.ready, total: readiness.withAudio });

  // The song shown can't play here: no audio, or its link already failed (and it isn't on the device).
  const shownAudio = shown?.audio ? regia.audio[shown.audio] : undefined;
  const shownFailed = !!shown?.audio && shownAudio?.state === 'failed' && !regia.cached.has(shown.audio) ? shownAudio.reason : null;
  const loadFailed = regia.error?.kind === 'load' && regia.loadedId === shown?.id;
  const cantPlay = !!shown && !playing && (!shown.audio || !!shownFailed || loadFailed);
  const nextOk = regia.nextPlayable != null ? songs[regia.nextPlayable] : null;
  // What the card says about the song shown (after Play, or before it when it is already known).
  const notice =
    regia.error?.kind === 'insert'
      ? t('The song couldn’t be added to the setlist.')
      : regia.error?.kind === 'changed'
        ? t('The setlist changed meanwhile. Pick the song again.')
      : regia.error?.kind === 'load'
        ? `${t('“{title}” can’t be played.', { title: regia.error.title })} ${audioReasonText(regia.error.reason, t)}`
        : regia.error?.kind === 'no-audio' || (cantPlay && !shown?.audio && !nextOk)
          ? t('“{title}” has no audio: the band plays it live.', { title: regia.error?.kind === 'no-audio' ? regia.error.title : shown!.title })
          : cantPlay && shownFailed
            ? `${t('“{title}” can’t be played.', { title: shown!.title })} ${audioReasonText(shownFailed, t)}`
            : null;
  const listOpen = showFailed && !downloading && failed.length > 0;
  const playNext = !playing && ((ended && next && regia.nextIndex != null) || (cantPlay && nextOk && regia.nextPlayable != null));

  return (
    <>
      <section
        aria-label={t('Stage manager')}
        // Shrinks when the screen is short (a phone with the times grid above): only the output
        // line scrolls, the status and the Play controls always stay in view.
        className={cn('flex flex-col gap-2 min-h-0 overflow-hidden rounded-[16px] border px-4 py-3', className)}
        style={{ borderColor: accent }}
      >
        {/* Label and status share the Turn off button's height (the setlist below keeps its room on short screens). */}
        <div className="flex items-center gap-3 min-w-0 shrink-0">
          <Volume2 className="w-4 h-4 shrink-0" style={{ color: accent }} aria-hidden />
          <span className="flex-1 min-w-0 flex flex-col">
            <span className="bw-label-xs text-white truncate">{t('Stage manager')}</span>
            <span className="flex items-center gap-1.5 min-w-0">
              {downloading && <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin text-white/70" aria-hidden />}
              <span className="bw-body-sm text-white/70 truncate" role="status">
                {statusText}
              </span>
            </span>
            {!downloading && failed.length > 0 && (
              // Its own line (only when something failed): the status above never gets cut. The list opens in a sheet.
              <button
                type="button"
                onClick={() => {
                  haptic.tap();
                  setShowFailed((v) => !v);
                }}
                aria-haspopup="dialog"
                aria-label={failed.length === 1 ? t('1 song can’t be downloaded') : t('{n} songs can’t be downloaded', { n: failed.length })}
                className="self-start flex items-center gap-1 min-h-11 -my-2.5 text-white bw-body-sm max-w-full"
              >
                <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: accent }} aria-hidden />
                <span className="underline underline-offset-2 truncate">{failed.length === 1 ? t('1 not downloaded') : t('{n} not downloaded', { n: failed.length })}</span>
                <ChevronRight className="w-4 h-4 shrink-0" aria-hidden />
              </button>
            )}
            {downloading && (
              <span
                role="progressbar"
                aria-label={t('Downloading audio')}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
                className="block h-1 w-full mt-1 rounded-full bg-white/15 overflow-hidden"
              >
                <span className="block h-full rounded-full transition-[width] duration-300" style={{ width: `${pct}%`, backgroundColor: accent }} />
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={() => {
              haptic.tap();
              regia.turnOff();
            }}
            className="min-h-11 px-3 rounded-full border border-white/30 text-white/80 bw-label-xs whitespace-nowrap shrink-0"
          >
            {t('Turn off')}
          </button>
        </div>
        {(regia.outputWarning || regia.output) && (
          // Scrolls when the screen is too short for it: the status above and Play below stay in view.
          <div className="flex flex-col min-h-0 overflow-y-auto overscroll-contain">
            {regia.outputWarning ? (
              <p className="bw-body-sm text-black shrink-0 rounded-[12px] px-3 py-2" role="alert" style={{ backgroundColor: accent }}>
                {regia.outputWarning === 'speaker'
                  ? t('The sound is coming from this device’s speaker. Plug in the cable to the mixer.')
                  : t('The sound goes over Bluetooth: it arrives late and can drop out. Use a cable to the mixer.')}
              </p>
            ) : regia.output ? (
              <p className="bw-body-sm text-white/60 truncate shrink-0">
                {t('Output: {name}', { name: regia.output.name || outputKindLabel(regia.output.kind, t) })}
                {!playing ? ` · ${t('Turn on Do Not Disturb: notifications come out of the PA too.')}` : ''}
              </p>
            ) : null}
          </div>
        )}
        <div className="flex items-baseline gap-3 min-w-0 shrink-0">
          <span className="flex-1 min-w-0 bw-label-md normal-case text-white truncate">{shown?.title ?? '—'}</span>
          {cantPlay && !shown?.audio ? (
            // No audio: said here (the band plays it live), Play below offers the next song.
            <span className="bw-label-xs text-white/60 shrink-0">{t('No audio')}</span>
          ) : (
            <span className="bw-num text-[14px] text-white/80 shrink-0" style={MONO}>
              {formatClock(regia.positionMs)}
              {regia.durationMs ? ` / ${formatClock(regia.durationMs)}` : ''}
            </span>
          )}
        </div>
        <Progress positionMs={regia.positionMs} durationMs={regia.durationMs} accent={accent} />
        {notice && (
          <p className="bw-body-sm text-white shrink-0" role="alert">
            {notice}
          </p>
        )}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              haptic.medium();
              if (loading) return;
              if (playNext) {
                const i = ended && next && regia.nextIndex != null ? regia.nextIndex : regia.nextPlayable!;
                void regia.play(i);
              } else void regia.toggle();
            }}
            aria-busy={loading || undefined}
            className="flex-1 min-w-0 flex items-center justify-center gap-2 min-h-14 rounded-[20px] text-black bw-button-sm"
            style={{ backgroundColor: accent }}
          >
            {loading ? (
              <Loader2 className="w-6 h-6 shrink-0 animate-spin" aria-hidden />
            ) : playing ? (
              <Pause className="w-6 h-6 shrink-0" />
            ) : (
              <Play className="w-6 h-6 shrink-0" />
            )}
            <span className="truncate">
              {loading
                ? t('Loading…')
                : playing
                  ? t('Pause')
                  : ended && next
                    ? t('Next: {title}', { title: next.title })
                    : playNext && nextOk
                      ? t('Play next: {title}', { title: nextOk.title })
                      : t('Play')}
            </span>
          </button>
          <HoldButton
            label={t('Stop')}
            hint={t('Hold to stop')}
            disabled={!['playing', 'paused', 'ended'].includes(regia.status)}
            onHold={() => void regia.stop()}
            className="min-h-14 px-4 rounded-[20px] bg-white/10 text-white bw-button-sm disabled:opacity-40"
          >
            <Square className="w-5 h-5 shrink-0" />
            <span className="[@media(max-width:380px)]:sr-only">{t('Stop')}</span>
          </HoldButton>
          {canAddSongs && (
            <button
              type="button"
              onClick={() => {
                haptic.tap();
                onAddSong();
              }}
              aria-label={t('Play a song not in the setlist')}
              className="w-14 h-14 flex items-center justify-center rounded-[20px] bg-white/10 text-white shrink-0"
            >
              <Plus className="w-6 h-6" />
            </button>
          )}
        </div>
      </section>
      {listOpen && (
        <FailedSheet
          failed={failed}
          onRetry={() => {
            setShowFailed(false);
            void regia.retry();
          }}
          onClose={() => setShowFailed(false)}
        />
      )}
    </>
  );
};

const outputKindLabel = (kind: string, t: ReturnType<typeof useT>) =>
  kind === 'usb' ? t('USB') : kind === 'wired' ? t('Cable') : kind === 'hdmi' ? t('HDMI') : kind === 'speaker' ? t('Speaker') : t('Other');

/**
 * The Regia's ▶ on a setlist row (songs with audio only). Its ring shows the
 * song's download: dimmed while waiting, filling up while it comes down, a
 * warning when it can't.
 */
export const RegiaRowPlay: React.FC<{ title: string; playing: boolean; audio?: SongAudio; onPlay: () => void; accent: string }> = ({
  title,
  playing,
  audio,
  onPlay,
  accent,
}) => {
  const t = useT();
  const state = playing ? 'playing' : audio?.state ?? 'ready';
  const progress = audio?.state === 'downloading' ? audio.progress : null;
  const label = playing
    ? t('Playing: {title}', { title })
    : state === 'downloading'
      ? progress != null
        ? t('Play {title} · downloading {pct}%', { title, pct: Math.round(progress * 100) })
        : t('Play {title} · downloading', { title })
      : state === 'queued'
        ? t('Play {title} · waiting to download', { title })
        : state === 'failed'
          ? t('Play {title} · can’t be downloaded', { title })
          : t('Play {title}', { title });
  // Ring: r=20.5 in a 44 box (stroke 2) → circumference ≈ 128.8.
  const C = 2 * Math.PI * 20.5;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        haptic.medium();
        onPlay();
      }}
      aria-label={label}
      aria-pressed={playing}
      className={cn(
        'relative w-11 h-11 flex items-center justify-center rounded-full border',
        playing
          ? 'border-transparent text-black'
          : state === 'downloading'
            ? 'border-white/15 text-white'
            : state === 'queued'
              ? 'border-dashed border-white/30 text-white/50'
              : state === 'failed'
                ? 'border-white/25 text-white/60'
                : 'border-white/40 text-white',
      )}
      style={playing ? { backgroundColor: accent } : undefined}
    >
      {state === 'downloading' && (
        <svg aria-hidden viewBox="0 0 44 44" className={cn('absolute -inset-px w-[calc(100%+2px)] h-[calc(100%+2px)] -rotate-90', progress == null && 'animate-spin')}>
          <circle
            cx="22"
            cy="22"
            r="20.5"
            fill="none"
            stroke={accent}
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={progress == null ? C * 0.75 : C * (1 - Math.max(0.04, progress))}
            style={{ transition: 'stroke-dashoffset 300ms linear' }}
          />
        </svg>
      )}
      <Play className="w-5 h-5" />
      {state === 'failed' && (
        <span aria-hidden className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-black flex items-center justify-center">
          <AlertTriangle className="w-4 h-4" style={{ color: accent }} />
        </span>
      )}
    </button>
  );
};

interface StripProps {
  nowPlaying: NonNullable<StageRegia['nowPlaying']>;
  /** The song shown here is the one playing. */
  inView: boolean;
  /** Bring this device to the playing song (a member not following). */
  onGo?: () => void;
  accent: string;
  className?: string;
}

/** The musicians' "Now playing · 1:12 / 3:58" (from the Regia). */
export const NowPlayingStrip: React.FC<StripProps> = ({ nowPlaying, inView, onGo, accent, className }) => {
  const t = useT();
  const { state, receivedAt } = nowPlaying;
  useTick(state.playing);
  const pos = playPosition(state, receivedAt, Date.now());
  const label = state.playing ? t('Now playing') : t('Paused');
  return (
    <div className={cn('flex items-center gap-3 shrink-0 min-h-11', className)} role="status" aria-live="off">
      <span aria-hidden className="w-2 h-2 rounded-full shrink-0" style={state.playing ? { backgroundColor: accent } : { border: '1px solid rgba(255,255,255,0.6)' }} />
      <span className="flex-1 min-w-0 bw-label-xs text-white truncate">
        {label}
        {!inView && state.title ? ` · ${state.title}` : ''}
      </span>
      <span className="bw-num text-[14px] text-white/80 shrink-0" style={MONO}>
        {formatClock(pos)}
        {state.durationMs ? ` / ${formatClock(state.durationMs)}` : ''}
      </span>
      {!inView && onGo && (
        <button
          type="button"
          onClick={() => {
            haptic.tap();
            onGo();
          }}
          className="min-h-11 px-3 rounded-full text-black bw-label-xs shrink-0"
          style={{ backgroundColor: accent }}
        >
          {t('Go')}
        </button>
      )}
    </div>
  );
};

interface ExtraProps {
  open: boolean;
  bandId?: string;
  /** songs.id already in tonight's setlist (not offered again). */
  inSetlist: ReadonlySet<string>;
  onPick: (song: { id: string; title: string; audio?: string | null }) => void;
  onClose: () => void;
  accent: string;
}

/** The repertoire, to play a song that isn't in tonight's setlist. */
/** Songs whose audio didn't download: which, why, what to fix. A sheet over Stage (the card keeps its size). */
const FailedSheet: React.FC<{ failed: { title: string; reason: PlayFailure }[]; onRetry: () => void; onClose: () => void }> = ({ failed, onRetry, onClose }) => {
  const t = useT();
  useSystemBack(true, onClose);
  const title = failed.length === 1 ? t('1 song can’t be downloaded') : t('{n} songs can’t be downloaded', { n: failed.length });
  // Like the extra-song sheet: it covers Stage (its own pane on the Duo and iPad), not the whole app.
  return (
    <div className="fixed inset-0 z-[130] flex flex-col bg-black text-white" role="dialog" aria-modal="true" aria-label={title} style={{ paddingTop: 'calc(var(--safe-top) + 12px)', paddingBottom: 'calc(var(--safe-bottom) + 16px)' }}>
      <div className="flex flex-col flex-1 min-h-0 w-full max-w-[640px] mx-auto px-4 gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="bw-h2 normal-case text-white">{title}</h2>
          <button type="button" onClick={onClose} aria-label={t('Close')} className="w-11 h-11 flex items-center justify-center rounded-full border border-white shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>
        <ul className="flex-1 min-h-0 overflow-y-auto overscroll-contain -mx-4 px-4">
          {failed.map((f) => (
            <li key={f.title} className="flex flex-col gap-1 py-3 border-b border-white/15 last:border-b-0 min-w-0">
              <span className="bw-label-md normal-case text-white truncate">{f.title}</span>
              <span className="bw-body-sm text-white/70">{audioReasonText(f.reason, t)}</span>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => {
            haptic.tap();
            onRetry();
          }}
          className="flex items-center justify-center gap-2 min-h-14 rounded-[20px] border border-white/40 text-white bw-button-sm shrink-0"
        >
          <RotateCw className="w-5 h-5" aria-hidden />
          {t('Try again')}
        </button>
      </div>
    </div>
  );
};

export const RegiaExtraSheet: React.FC<ExtraProps> = ({ open, bandId, inSetlist, onPick, onClose, accent }) => {
  const t = useT();
  const [query, setQuery] = useState('');
  const [songs, setSongs] = useState<{ id: string; title: string; artist?: string; audio_url?: string }[] | null>(null);
  const [failed, setFailed] = useState(false);
  useSystemBack(open, onClose);

  useEffect(() => {
    if (!open || !bandId) return;
    let cancelled = false;
    setFailed(false);
    void getSongs(bandId, { columns: 'list', status: ['ready', 'learning'] }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) setFailed(true);
      setSongs(data ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [open, bandId]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (songs ?? [])
      .filter((s) => !inSetlist.has(s.id))
      .filter((s) => !q || s.title.toLowerCase().includes(q) || (s.artist ?? '').toLowerCase().includes(q));
  }, [songs, query, inSetlist]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[130] flex flex-col bg-black text-white" role="dialog" aria-modal="true" aria-label={t('Play a song not in the setlist')} style={{ paddingTop: 'calc(var(--safe-top) + 12px)', paddingBottom: 'calc(var(--safe-bottom) + 16px)' }}>
      <div className="flex flex-col flex-1 min-h-0 w-full max-w-[640px] mx-auto px-4 gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="bw-h2 normal-case text-white">{t('Play a song not in the setlist')}</h2>
          <button type="button" onClick={onClose} aria-label={t('Close')} className="w-11 h-11 flex items-center justify-center rounded-full border border-white shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="bw-body-sm text-white/70">{t('It goes in the setlist right after the current song, and everyone sees it.')}</p>
        <label className="flex items-center gap-2 min-h-11 px-3 rounded-full border border-white/30">
          <Search className="w-4 h-4 text-white/60 shrink-0" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('Search songs')}
            aria-label={t('Search songs')}
            className="flex-1 min-w-0 bg-transparent text-white bw-body-md outline-none placeholder:text-white/40"
          />
        </label>
        <ul className="flex-1 min-h-0 overflow-y-auto overscroll-contain -mx-4 px-4">
          {songs === null ? (
            <li className="bw-body-md text-white/70 py-3">…</li>
          ) : failed ? (
            <li className="bw-body-md text-white/70 py-3">{t('Offline: the songs couldn’t be loaded.')}</li>
          ) : list.length === 0 ? (
            <li className="bw-body-md text-white/70 py-3">{t('No songs found')}</li>
          ) : (
            list.map((s) => (
              <li key={s.id} className="border-b border-white/15 last:border-b-0">
                <button
                  type="button"
                  onClick={() => {
                    haptic.medium();
                    onPick({ id: s.id, title: s.title, audio: s.audio_url ?? null });
                  }}
                  className="flex w-full min-w-0 items-center gap-3 min-h-14 py-2 text-left"
                >
                  <span className="flex-1 min-w-0 flex flex-col">
                    <span className="bw-label-md normal-case text-white truncate">{s.title}</span>
                    {s.artist && <span className="bw-body-sm text-white/60 truncate">{s.artist}</span>}
                  </span>
                  <span className="bw-label-xs shrink-0" style={{ color: s.audio_url ? accent : 'rgba(255,255,255,0.5)' }}>
                    {s.audio_url ? t('Play') : t('No audio')}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
};

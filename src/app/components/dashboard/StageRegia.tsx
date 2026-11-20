import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, Plus, Search, Square, Volume2, X } from '@/app/components/icons';
import { haptic } from '@/lib/haptics';
import { cn } from '@/app/components/ui/utils';
import { useT } from '@/lib/i18n';
import { formatClock, playPosition } from '@/lib/stageRegia';
import { getSongs } from '@/lib/services/songs';
import { useSystemBack } from '@/lib/backStack';
import type { StageRegia } from '@/app/components/event/useStageRegia';

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
    <span aria-hidden className="block h-1 w-full rounded-full bg-white/15 overflow-hidden">
      <span className="block h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: accent }} />
    </span>
  );
};

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
  /** The setlist in its live order (titles for the "next" button). */
  songs: { id?: string; title: string }[];
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
  const { readiness, downloading } = regia;
  const statusText = downloading
    ? t('Downloading audio {done}/{total}…', { done: downloading.done, total: downloading.total })
    : readiness.withAudio === 0
      ? t('No song in this setlist has audio')
      : readiness.missing > 0
        ? t('Audio ready {ready}/{total} · {missing} need internet', { ready: readiness.ready, total: readiness.withAudio, missing: readiness.missing })
        : t('Audio ready {ready}/{total}', { ready: readiness.ready, total: readiness.withAudio });

  return (
    <section
      aria-label={t('Stage manager')}
      className={cn('flex flex-col gap-2 shrink-0 rounded-[16px] border px-4 py-3', className)}
      style={{ borderColor: accent }}
    >
      <div className="flex items-center justify-between gap-3 min-w-0">
        <span className="flex items-center gap-2 min-w-0">
          <Volume2 className="w-4 h-4 shrink-0" style={{ color: accent }} aria-hidden />
          <span className="bw-label-xs text-white shrink-0">{t('Stage manager')}</span>
          <span className="bw-body-sm text-white/60 truncate" role="status">
            {statusText}
          </span>
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
      {regia.outputWarning ? (
        <p className="bw-body-sm text-black rounded-[12px] px-3 py-2" role="alert" style={{ backgroundColor: accent }}>
          {regia.outputWarning === 'speaker'
            ? t('The sound is coming from this device’s speaker. Plug in the cable to the mixer.')
            : t('The sound goes over Bluetooth: it arrives late and can drop out. Use a cable to the mixer.')}
        </p>
      ) : regia.output ? (
        <p className="bw-body-sm text-white/60 truncate">
          {t('Output: {name}', { name: regia.output.name || outputKindLabel(regia.output.kind, t) })}
          {!playing ? ` · ${t('Turn on Do Not Disturb: notifications come out of the PA too.')}` : ''}
        </p>
      ) : null}
      <div className="flex items-baseline gap-3 min-w-0">
        <span className="flex-1 min-w-0 bw-label-md normal-case text-white truncate">{shown?.title ?? '—'}</span>
        <span className="bw-num text-[14px] text-white/80 shrink-0" style={MONO}>
          {formatClock(regia.positionMs)}
          {regia.durationMs ? ` / ${formatClock(regia.durationMs)}` : ''}
        </span>
      </div>
      <Progress positionMs={regia.positionMs} durationMs={regia.durationMs} accent={accent} />
      {regia.error && (
        <p className="bw-body-sm text-white" role="alert">
          {regia.error === 'load' ? t('This song’s audio can’t be played on this device.') : t('The song couldn’t be added to the setlist.')}
        </p>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            haptic.medium();
            if (ended && next && regia.nextIndex != null) void regia.play(regia.nextIndex);
            else void regia.toggle();
          }}
          className="flex-1 min-w-0 flex items-center justify-center gap-2 min-h-14 rounded-[20px] text-black bw-button-sm"
          style={{ backgroundColor: accent }}
        >
          {playing ? <Pause className="w-6 h-6 shrink-0" /> : <Play className="w-6 h-6 shrink-0" />}
          <span className="truncate">{playing ? t('Pause') : ended && next ? t('Next: {title}', { title: next.title }) : t('Play')}</span>
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
  );
};

const outputKindLabel = (kind: string, t: ReturnType<typeof useT>) =>
  kind === 'usb' ? t('USB') : kind === 'wired' ? t('Cable') : kind === 'hdmi' ? t('HDMI') : kind === 'speaker' ? t('Speaker') : t('Other');

/** The Regia's ▶ on a setlist row (songs with audio only). */
export const RegiaRowPlay: React.FC<{ title: string; playing: boolean; onPlay: () => void; accent: string }> = ({ title, playing, onPlay, accent }) => {
  const t = useT();
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        haptic.medium();
        onPlay();
      }}
      aria-label={playing ? t('Playing: {title}', { title }) : t('Play {title}', { title })}
      aria-pressed={playing}
      className={cn('w-11 h-11 flex items-center justify-center rounded-full border', playing ? 'border-transparent text-black' : 'border-white/40 text-white')}
      style={playing ? { backgroundColor: accent } : undefined}
    >
      <Play className="w-5 h-5" />
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

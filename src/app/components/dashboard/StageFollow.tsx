/**
 * Follow the tempo in Stage and rehearsal Live mode (plan §4.1–4.2).
 *
 * A per-device switch (off by default, remembered like the song view). When
 * it is on and the leader starts the song, this phone works out from the
 * shared playhead (useStageLive().playhead, src/lib/playhead.ts) where the
 * band is, many times a second, and shows it:
 * - the chart's current bar lit, its section marked, kept in view;
 * - the lyrics' current line lit, scrolled smoothly (no line timing: section
 *   by section, the lines spread over the section's bars);
 * - one line above the song: "Next: Bridge in 4 bars" (or Starting…,
 *   Waiting for the leader, Repeating…);
 * - on the floor wedge (Duo Laptop pose) a big "Chorus in 4" instead of the
 *   lyrics.
 * The leader also gets Start, Hold / Let go, Go on (a fermata, ad lib) and
 * Stop, and taps a bar, a line or a section to move everyone there. Members
 * only switch the view on or off.
 *
 * The position lives in a small store outside React state, so only the
 * strip, the lit elements and the countdown update while the song plays,
 * not the whole of Stage mode.
 */
import React, { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { cn } from '@/app/components/ui/utils';
import { haptic } from '@/lib/haptics';
import { useT } from '@/lib/i18n';
import { barMs } from '@/lib/meter';
import { sectionLabel } from '@/lib/songFormat';
import { nowMs } from '@/lib/stageClick';
import {
  buildTimeline,
  canFollow as songCanFollow,
  continuePlayhead,
  holdSection,
  playheadAt,
  realign,
  releaseHold,
  startPlayhead,
  stopPlayhead,
  type PlayheadState,
} from '@/lib/playhead';
import { barForCell, barForLine, barForSection, followContext, followFrame, leaderStartAt, type FollowContext, type FollowFrame, type FollowStatus } from '@/lib/followTempo';
import type { SongChart } from '@/lib/ireal';
import type { StageClickControls } from './StageClick';
import { useFlag } from '@/lib/appFlags';
import '@/styles/follow.css';

/** useStageLive().playhead */
export interface StageFollowPlayhead {
  state: PlayheadState | null;
  mine: boolean;
  /** Their clock minus mine (0 for my own playhead). */
  offset: number;
  set: (next: PlayheadState) => void;
  clientId: string;
}

/** The song as Follow the tempo reads it (StageSong / WedgeSong). */
export interface FollowSong {
  id?: string;
  bpm?: number | null;
  chart?: SongChart | null;
  /** Shown as drawn: normalizeLyrics() of songs.lyrics (the line keys match the screen). */
  lyrics?: string | null;
  timeSignature?: string | null;
  lineTiming?: unknown;
  /** "3:45", or seconds. */
  duration?: string | number | null;
}

// ── The per-device switch ──────────────────────────────────────────────────

export const FOLLOW_TEMPO_KEY = 'bw-follow-tempo';
const prefListeners = new Set<() => void>();
const readPref = () => {
  try {
    return localStorage.getItem(FOLLOW_TEMPO_KEY) === '1';
  } catch {
    return false;
  }
};

/** Follow the tempo on this device: off by default, remembered like the song view. */
export function useFollowTempoPreference(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(
    (cb) => {
      prefListeners.add(cb);
      return () => prefListeners.delete(cb);
    },
    readPref,
    () => false,
  );
  const set = useCallback((next: boolean) => {
    try {
      if (next) localStorage.setItem(FOLLOW_TEMPO_KEY, '1');
      else localStorage.removeItem(FOLLOW_TEMPO_KEY);
    } catch {
      /* per-device preference */
    }
    prefListeners.forEach((l) => l());
  }, []);
  return [on, set];
}

// ── The position, as a store ───────────────────────────────────────────────

interface FrameStore {
  get: () => FollowFrame | null;
  subscribe: (cb: () => void) => () => void;
}

/** How often the position is worked out: enough for a bar or a line, light on the battery. */
const TICK_MS = 40;

const sameFrame = (a: FollowFrame | null, b: FollowFrame | null) =>
  a === b ||
  (!!a &&
    !!b &&
    a.cell === b.cell &&
    a.chartSection === b.chartSection &&
    a.lyricSection === b.lyricSection &&
    a.line === b.line &&
    a.label === b.label &&
    a.bar === b.bar &&
    JSON.stringify(a.status) === JSON.stringify(b.status));

const secondsOf = (d: string | number | null | undefined) => {
  if (typeof d === 'number') return d > 0 ? d : null;
  const m = typeof d === 'string' ? d.match(/^(\d+):(\d{2})$/) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

export interface FollowTempo {
  /** Stage is live (there is a shared playhead to follow). */
  available: boolean;
  /** The switch on this device. */
  on: boolean;
  setOn: (on: boolean) => void;
  /** The song can be followed (a BPM, and a chart or lyrics). */
  canFollow: boolean;
  /** It can't for want of a BPM: "Add a BPM to follow this song". */
  needsBpm: boolean;
  /** Switched on, and the playhead runs on this song. */
  active: boolean;
  /** Switched on and followable: the strip shows. */
  shown: boolean;
  leader: boolean;
  ctx: FollowContext | null;
  store: FrameStore;
  start: () => void;
  hold: () => void;
  release: () => void;
  goOn: () => void;
  stop: () => void;
  /** Leader: a tap on the song (a bar, a line, a section heading) moves everyone there. */
  tap: (target: EventTarget | null) => boolean;
}

export function useFollowTempo(opts: {
  playhead?: StageFollowPlayhead;
  song?: FollowSong | null;
  isLeader: boolean;
  click?: StageClickControls;
}): FollowTempo {
  const { playhead, song, isLeader, click } = opts;
  const [on, setOn] = useFollowTempoPreference();
  // The kill switch (app_flags follow_tempo, docs/flags.md): off, there is nothing to follow, so
  // the switch, the strip, the leader's buttons and the lit bar all go. This device's own choice
  // (`on`) is kept for when it is back.
  const flagOn = useFlag('follow_tempo');
  const available = flagOn && !!playhead;
  const canFollow = !!song && songCanFollow({ bpm: song.bpm, chart: song.chart, lyrics: song.lyrics });
  const needsBpm = !!song && !(song.bpm && song.bpm > 0);
  const timeline = useMemo(
    () =>
      song && canFollow
        ? buildTimeline({
            chart: song.chart,
            lyrics: song.lyrics,
            timeSignature: song.timeSignature,
            bpm: song.bpm,
            durationSeconds: secondsOf(song.duration),
            lineTiming: song.lineTiming,
          })
        : null,
    [song, canFollow],
  );
  const ctx = useMemo(() => (timeline ? followContext(timeline, song?.lyrics) : null), [timeline, song?.lyrics]);
  const state = playhead?.state ?? null;
  const offset = playhead?.offset ?? 0;
  const active = available && on && !!ctx && !!state?.on && (state.songId ?? null) === (song?.id ?? null);

  // The store: the frame, worked out every TICK_MS while active.
  const frameRef = useRef<FollowFrame | null>(null);
  const listeners = useRef(new Set<() => void>());
  const store = useMemo<FrameStore>(
    () => ({
      get: () => frameRef.current,
      subscribe: (cb) => {
        listeners.current.add(cb);
        return () => listeners.current.delete(cb);
      },
    }),
    [],
  );
  useEffect(() => {
    const emit = (next: FollowFrame | null) => {
      if (sameFrame(frameRef.current, next)) return;
      frameRef.current = next;
      listeners.current.forEach((l) => l());
    };
    if (!active || !ctx || !state) {
      emit(null);
      return;
    }
    const tick = () => emit(followFrame(ctx, playheadAt(ctx.timeline, state, nowMs(), offset), state));
    tick();
    const id = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(id);
  }, [active, ctx, state, offset]);

  // The leader's taps. A state from another phone is first put in my clock.
  const leader = isLeader && available;
  const mineNow = () => (state && !playhead?.mine ? { ...state, startAt: state.startAt - offset } : state);
  const send = (next: PlayheadState) => {
    haptic.tap();
    playhead?.set(next);
  };
  const start = () => {
    if (!leader || !ctx || !song?.bpm || !playhead) return;
    const clickState = click?.mine && click.state?.on ? click.state : null;
    const startAt = leaderStartAt({ now: nowMs(), click: clickState, barMs: barMs(ctx.timeline.bars[0].meter, song.bpm) });
    send(startPlayhead({ from: playhead.clientId, songId: song.id ?? null, bpm: song.bpm, startAt, prev: state }));
  };
  const withState = (fn: (s: PlayheadState, now: number, c: FollowContext) => PlayheadState) => () => {
    const s = mineNow();
    if (!leader || !ctx || !s?.on) return;
    send(fn(s, nowMs(), ctx));
  };
  const hold = withState((s, now, c) => holdSection(s, now, c.timeline));
  const release = withState((s, now, c) => releaseHold(s, now, c.timeline));
  const goOn = withState((s, now, c) => continuePlayhead(s, now, c.timeline));
  const stop = withState((s) => stopPlayhead(s));
  const tap = (target: EventTarget | null) => {
    const s = mineNow();
    if (!leader || !active || !ctx || !s || !(target instanceof Element)) return false;
    const near = frameRef.current?.bar ?? 0;
    let bar: number | null = null;
    const cell = target.closest('[data-cell]')?.getAttribute('data-cell');
    const line = target.closest('[data-line]')?.getAttribute('data-line');
    const chartSec = target.closest('[data-chart-section]')?.getAttribute('data-chart-section');
    const lyricSec = target.closest('[data-lyric-section],[data-structure-section]');
    if (cell) {
      const [a, b] = cell.split(':').map(Number);
      bar = barForCell(ctx, a, b, near);
    } else if (line) {
      bar = barForLine(ctx, line, near);
    } else if (chartSec != null) {
      bar = barForSection(ctx, { chart: Number(chartSec) }, near);
    } else if (lyricSec) {
      const n = Number(lyricSec.getAttribute('data-lyric-section') ?? lyricSec.getAttribute('data-structure-section'));
      bar = barForSection(ctx, { lyric: n }, near);
    }
    if (bar == null) return false;
    send(realign(s, bar, nowMs(), ctx.timeline));
    return true;
  };

  return {
    available,
    on,
    setOn,
    canFollow,
    needsBpm,
    active,
    shown: available && on && canFollow,
    leader,
    ctx,
    store,
    start,
    hold,
    release,
    goOn,
    stop,
    tap,
  };
}

const useFrame = (follow: FollowTempo) => useSyncExternalStore(follow.store.subscribe, follow.store.get, () => null);

// ── Words ──────────────────────────────────────────────────────────────────

type T = ReturnType<typeof useT>;
const nameOf = (label: string | null, t: T) => (label ? sectionLabel(label, t) : null);

/** The one line above the song. */
export function statusText(status: FollowStatus, t: T): string {
  switch (status.kind) {
    case 'starting':
      return t('Starting…');
    case 'waiting':
      return t('Waiting for the leader');
    case 'end':
      return t('End of the song');
    case 'holding': {
      const name = nameOf(status.label, t);
      return name ? t('Repeating {section} until the leader lets go', { section: name }) : t('Repeating this section until the leader lets go');
    }
    case 'last': {
      const name = nameOf(status.label, t);
      return name ? t('Last section: {section}', { section: name }) : t('Last section');
    }
    case 'next': {
      const name = nameOf(status.label, t);
      if (!name) return status.bars === 1 ? t('Next section in 1 bar') : t('Next section in {n} bars', { n: status.bars });
      return status.bars === 1 ? t('Next: {section} in 1 bar', { section: name }) : t('Next: {section} in {n} bars', { section: name, n: status.bars });
    }
  }
}

// ── The switch ─────────────────────────────────────────────────────────────

export const FollowTempoSwitch: React.FC<{ follow: FollowTempo; accent: string; className?: string }> = ({ follow, accent, className }) => {
  const t = useT();
  if (!follow.available) return null;
  const disabled = !follow.canFollow;
  const checked = follow.on && !disabled;
  return (
    <span className={cn('flex items-center gap-2 min-w-0', className)}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        aria-describedby={disabled && follow.needsBpm ? 'bw-follow-needs-bpm' : undefined}
        onClick={() => {
          haptic.tap();
          follow.setOn(!follow.on);
        }}
        className={cn(
          'flex items-center gap-2 min-h-9 px-3 rounded-full border bw-label-sm whitespace-nowrap shrink-0 disabled:opacity-40',
          checked ? 'border-transparent text-black' : 'border-white/40 text-white',
        )}
        style={checked ? { backgroundColor: accent } : undefined}
      >
        <span aria-hidden className={cn('w-2 h-2 rounded-full shrink-0', checked ? 'bg-black' : 'border border-white')} />
        {t('Follow the tempo')}
      </button>
      {disabled && follow.needsBpm && (
        <span id="bw-follow-needs-bpm" className="bw-label-xs normal-case text-white/60 min-w-0">
          {t('Add a BPM to follow this song')}
        </span>
      )}
    </span>
  );
};

// ── The strip, with the leader's buttons ───────────────────────────────────

const FollowButton: React.FC<{ onPress: () => void; children: React.ReactNode; tone?: 'accent' | 'plain'; pressed?: boolean; accent: string; big?: boolean }> = ({
  onPress,
  children,
  tone = 'plain',
  pressed,
  accent,
  big,
}) => (
  <button
    type="button"
    aria-pressed={pressed}
    onClick={onPress}
    className={cn(
      'flex items-center justify-center rounded-full bw-label-sm whitespace-nowrap shrink-0 border',
      big ? 'min-h-14 px-5' : 'min-h-11 px-4',
      tone === 'accent' ? 'border-transparent text-black' : pressed ? 'border-white bg-white text-black' : 'border-white/40 text-white',
    )}
    style={tone === 'accent' ? { backgroundColor: accent } : undefined}
  >
    {children}
  </button>
);

/** Start · Hold / Let go · Go on · Stop: the leader's, one row. */
export const FollowLeaderButtons: React.FC<{ follow: FollowTempo; accent: string; big?: boolean; className?: string }> = ({ follow, accent, big, className }) => {
  const t = useT();
  const frame = useFrame(follow);
  if (!follow.leader || !follow.shown) return null;
  const running = follow.active && !!frame && frame.status.kind !== 'end';
  const held = frame?.status.kind === 'holding';
  return (
    <span className={cn('flex items-center gap-2 shrink-0', className)}>
      {!running ? (
        <FollowButton onPress={follow.start} tone="accent" accent={accent} big={big}>
          {t('Start', { context: 'follow' })}
        </FollowButton>
      ) : frame?.status.kind === 'waiting' ? (
        <FollowButton onPress={follow.goOn} tone="accent" accent={accent} big={big}>
          {t('Go on')}
        </FollowButton>
      ) : (
        <FollowButton onPress={held ? follow.release : follow.hold} pressed={held} accent={accent} big={big}>
          {held ? t('Let go') : t('Hold', { context: 'follow' })}
        </FollowButton>
      )}
      {(running || (follow.active && frame?.status.kind === 'end')) && (
        <FollowButton onPress={follow.stop} accent={accent} big={big}>
          {t('Stop', { context: 'follow' })}
        </FollowButton>
      )}
    </span>
  );
};

/** "Next: Bridge in 4 bars": the one line above the song, and the leader's buttons beside it. */
export const FollowStrip: React.FC<{ follow: FollowTempo; accent: string; className?: string }> = ({ follow, accent, className }) => {
  const t = useT();
  const frame = useFrame(follow);
  if (!follow.shown) return null;
  const text = follow.active && frame ? statusText(frame.status, t) : follow.leader ? t('The band follows when you start') : t('Starts when the leader starts the song');
  // How to re-align, said while bar 1 is coming (then the song needs the room).
  const hint = follow.leader && follow.active && frame?.status.kind === 'starting';
  return (
    <div className={cn('flex flex-col gap-1 shrink-0', className)} data-follow-strip>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 min-h-11">
        <p role="status" aria-live="polite" className="bw-label-md normal-case min-w-0 flex-1" style={follow.active && frame ? { color: accent } : undefined}>
          {text}
        </p>
        <FollowLeaderButtons follow={follow} accent={accent} />
      </div>
      {hint && <p className="bw-label-xs normal-case text-white/60">{t('Tap a bar, line or section to move everyone there.')}</p>}
    </div>
  );
};

// ── The lit bar / line / section ───────────────────────────────────────────

/** The nearest scrolling box (the song's own column). */
const scroller = (el: Element | null): HTMLElement | null => {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
};

/** After the player scrolls by hand, the song stays where they put it for a moment. */
const HANDS_OFF_MS = 4000;

/**
 * Wraps the song (SongBody): lights what is being played (data-follow-now),
 * keeps it in view, and takes the leader's taps to re-align.
 */
export const FollowArea: React.FC<{ follow: FollowTempo; accent: string; children: React.ReactNode; className?: string }> = ({ follow, accent, children, className }) => {
  const frame = useFrame(follow);
  const ref = useRef<HTMLDivElement | null>(null);
  const touchedAt = useRef(0);
  const lastTarget = useRef<Element | null>(null);
  const on = follow.active && !!frame;

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.querySelectorAll('[data-follow-now]').forEach((el) => el.removeAttribute('data-follow-now'));
    if (!on || !frame) {
      lastTarget.current = null;
      return;
    }
    const mark = (sel: string) => {
      const el = root.querySelector(sel);
      el?.setAttribute('data-follow-now', '');
      return el;
    };
    const cell = frame.cell ? mark(`[data-cell="${frame.cell}"]`) : null;
    if (frame.chartSection != null) mark(`[data-chart-section="${frame.chartSection}"]`);
    if (frame.lyricSection != null) mark(`[data-structure-section="${frame.lyricSection}"]`);
    const line = frame.line ? mark(`[data-line="${frame.line}"]`) : null;
    const structure = frame.lyricSection != null ? root.querySelector(`[data-structure-section="${frame.lyricSection}"]`) : null;
    // Keep it in view: the line when the lyrics show, else the bar, else the section.
    const target = line ?? cell ?? structure;
    if (!target || target === lastTarget.current) return;
    lastTarget.current = target;
    if (Date.now() - touchedAt.current < HANDS_OFF_MS) return;
    const box = scroller(target);
    if (!box) return;
    const top = target.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    // A third of the way down: what comes next stays readable.
    box.scrollTo?.({ top: Math.max(0, top - box.clientHeight / 3), behavior: 'smooth' });
  });

  return (
    <div
      ref={ref}
      data-follow-on={on ? '' : undefined}
      className={className}
      style={{ ['--bw-follow' as string]: accent }}
      onTouchMove={() => (touchedAt.current = Date.now())}
      onWheel={() => (touchedAt.current = Date.now())}
      onClick={(e) => {
        if (follow.tap(e.target)) e.stopPropagation();
      }}
    >
      {children}
    </div>
  );
};

// ── The floor wedge's countdown ────────────────────────────────────────────

/** Duo Laptop pose: "Chorus in 4", read from the floor, instead of the lyrics. */
export const FollowCountdown: React.FC<{ follow: FollowTempo; className?: string }> = ({ follow, className }) => {
  const t = useT();
  const frame = useFrame(follow);
  if (!follow.active || !frame) return null;
  const s = frame.status;
  const now = nameOf(frame.label, t);
  let big: string;
  let small: string | null = now ? t('Now: {section}', { section: now }) : null;
  if (s.kind === 'next') {
    const name = nameOf(s.label, t) ?? t('Next section');
    big = t('{section} in {n}', { section: name, n: s.bars });
  } else if (s.kind === 'last') {
    big = now ?? t('Last section');
    small = t('Last section');
  } else if (s.kind === 'holding') {
    big = now ? t('Repeating {section}', { section: now }) : t('Repeating this section');
    small = t('Until the leader lets go');
  } else {
    big = statusText(s, t);
    small = null;
  }
  return (
    <div className={cn('flex flex-col justify-center gap-2 min-h-0', className)} data-follow-countdown>
      {small && <p className="bw-label-md uppercase text-white/60">{small}</p>}
      <p role="status" aria-live="polite" className="bw-display-xl text-accent [overflow-wrap:anywhere]" style={{ fontSize: 'clamp(44px, 10vw, 96px)', lineHeight: 1.05 }}>
        {big}
      </p>
    </div>
  );
};

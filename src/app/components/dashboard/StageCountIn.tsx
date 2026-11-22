import React from 'react';
import { createPortal } from 'react-dom';
import { Timer, X } from '@/app/components/icons';
import { cn } from '@/app/components/ui/utils';
import { useT } from '@/lib/i18n';
import { haptic } from '@/lib/haptics';
import { useSystemBack } from '@/lib/backStack';
import { songMeter } from '@/lib/meter';
import { clickForSong } from '@/lib/stageClick';
import { startPlayhead, stopPlayhead, type PlayheadState } from '@/lib/playhead';
import { countInAt, countInPlan, countInSounds, startCountIn, stopCountIn, type CountInState, type CountInStyle } from '@/lib/countIn';
import { countInAudible, setCountInPrefs, useCountInPrefs } from '@/lib/countInPrefs';
import { startAudioScheduler, unlockAudio, wallNow } from '@/lib/liveAudio';
import { currentAudioOutput, onAudioOutputChange, type AudioOutput } from '@/lib/audioOutput';
import { getCountInStyle, setCountInStyle } from '@/lib/services/countInStyle';
import type { StageClickControls } from './StageClick';

/** useStageLive().countIn */
export interface StageCountInControls {
  state: CountInState | null;
  mine: boolean;
  offset: number;
  set: (next: CountInState) => void;
}

/** useStageLive().playhead (only what the count-in needs). */
export interface StagePlayheadControls {
  state: PlayheadState | null;
  set: (next: PlayheadState) => void;
  clientId: string;
}

/** The song as the count-in reads it (StageSong / WedgeSong). */
export interface CountInSong {
  id?: string;
  title?: string;
  bpm?: number | null;
  timeSignature?: string | null;
  chart?: { time?: string; sections?: { bars: { text?: string }[] }[] } | null;
  countInBars?: number | null;
  pickupBeats?: number | null;
  backingTrack?: boolean | null;
}

// The band's direction, read once per band while Stage is open (two screens share it).
const styles = new Map<string, CountInStyle>();
const styleListeners = new Set<() => void>();

/** The band's count-in direction (bands.count_in_style), and (admins) a way to change it. */
export function useBandCountInStyle(bandId: string | undefined): [CountInStyle, (s: CountInStyle) => void] {
  const [, bump] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    styleListeners.add(bump);
    return () => void styleListeners.delete(bump);
  }, []);
  React.useEffect(() => {
    if (!bandId || styles.has(bandId)) return;
    let live = true;
    void getCountInStyle(bandId).then((s) => {
      if (!live) return;
      if (!styles.has(bandId)) styles.set(bandId, s);
      styleListeners.forEach((l) => l());
    });
    return () => {
      live = false;
    };
  }, [bandId]);
  const set = React.useCallback(
    (s: CountInStyle) => {
      if (!bandId) return;
      styles.set(bandId, s);
      styleListeners.forEach((l) => l());
      void setCountInStyle(bandId, s);
    },
    [bandId],
  );
  return [(bandId && styles.get(bandId)) || 'down', set];
}

/** Test hook. */
export const __resetCountInStyles = () => styles.clear();

/**
 * The leader's count-in for the current song (plan §6): offered when the
 * song has a BPM, isn't played with a backing track and the stage manager
 * isn't playing it; forced from the count-in sheet otherwise. At GO the
 * playhead (Follow the tempo) starts on bar 1 and a running click carries on
 * in time.
 */
export function useCountInUi(opts: {
  countIn?: StageCountInControls;
  click?: StageClickControls;
  playhead?: StagePlayheadControls;
  song: CountInSong | null | undefined;
  isLeader: boolean;
  regiaPlaying?: boolean;
  style: CountInStyle;
}) {
  const { countIn, click, playhead, song, isLeader, regiaPlaying, style } = opts;
  const state = countIn?.state ?? null;
  const offset = countIn?.offset ?? 0;
  // Counting until bar 1 (re-rendered then, so the button goes back to Count in).
  const endsAt = state?.on ? state.startAt + countInPlan(state).endAt - offset : 0;
  const [, bump] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    if (!endsAt) return;
    const id = window.setTimeout(bump, Math.max(0, endsAt - wallNow()) + 50);
    return () => window.clearTimeout(id);
  }, [endsAt]);
  const counting = !!state?.on && !!song && (state.songId == null || state.songId === song.id) && wallNow() < endsAt;
  const forceable = !!countIn && isLeader && !!song?.bpm;
  const available = forceable && !song?.backingTrack && !regiaPlaying;
  const start = () => {
    if (!countIn || !song?.bpm || !isLeader) return;
    unlockAudio();
    haptic.medium();
    const meter = songMeter(song);
    const next = startCountIn({
      from: playhead?.clientId ?? 'me',
      songId: song.id ?? null,
      bpm: song.bpm,
      meter,
      bars: song.countInBars,
      pickup: song.pickupBeats,
      style,
      now: wallNow(),
      prev: state,
    });
    countIn.set(next);
    const plan = countInPlan(next);
    // Follow the tempo: bar 1 of the song where the count-in ends.
    playhead?.set(startPlayhead({ from: playhead.clientId, songId: song.id ?? null, bpm: song.bpm, startAt: next.startAt + plan.endAt, prev: playhead.state }));
    // A running click keeps going, in time with the count.
    const clickOn = !!click?.state?.on && click.mine && (click.state.songId == null || click.state.songId === song.id);
    if (clickOn) click!.setOn(true, { ...clickForSong(song.bpm, meter), startAt: next.startAt });
  };
  const stop = () => {
    if (!countIn || !state) return;
    haptic.tap();
    countIn.set(stopCountIn(state));
    if (playhead?.state?.on) playhead.set(stopPlayhead(playhead.state));
  };
  return { state, counting, available, forceable, start, stop, mine: !!countIn?.mine };
}

/** Where the sound comes out now (native apps; null in a browser). */
function useAudioOutput(): AudioOutput | null {
  const [out, setOut] = React.useState<AudioOutput | null>(null);
  React.useEffect(() => {
    let live = true;
    void currentAudioOutput().then((o) => live && setOut(o));
    const off = onAudioOutputChange((o) => setOut(o));
    return () => {
      live = false;
      off();
    };
  }, []);
  return out;
}

const prefersReducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * The countdown, full screen on every phone (portalled to <body>): a huge
 * number per beat with a ring that fills bar by bar, small dots for the
 * eighths of 6/8 or 7/8, then GO. Drawn with requestAnimationFrame straight
 * on the elements. The leader can Stop it for everyone; anyone can hide it
 * on their own phone. Vibration and the headphone sound follow this
 * phone's choices.
 */
export const StageCountInOverlay: React.FC<{
  state: CountInState;
  offset: number;
  title?: string;
  accent: string;
  /** Leader: Stop for everyone; others: hide here. */
  canStop: boolean;
  onStop: () => void;
  /** Floor wedge (Laptop pose): biggest. */
  big?: boolean;
}> = ({ state, offset, title, accent, canStop, onStop, big }) => {
  const t = useT();
  const plan = React.useMemo(() => countInPlan(state), [state]);
  const prefs = useCountInPrefs();
  const output = useAudioOutput();
  const audible = countInAudible(prefs, output);
  const [phase, setPhase] = React.useState<'before' | 'count' | 'go' | 'done'>(() => countInAt(plan, state, wallNow(), offset).stage);
  const [hiddenSeq, setHiddenSeq] = React.useState<number | null>(null);
  const numRef = React.useRef<HTMLSpanElement>(null);
  const ringRef = React.useRef<SVGCircleElement>(null);
  const dotsRef = React.useRef<HTMLDivElement>(null);
  const subRef = React.useRef<HTMLSpanElement>(null);
  const offsetRef = React.useRef(offset);
  offsetRef.current = offset;
  const vibrateRef = React.useRef(prefs.vibrate);
  vibrateRef.current = prefs.vibrate;

  // Draw every frame; buzz on each new count.
  React.useEffect(() => {
    if (!state.on) return;
    const still = prefersReducedMotion();
    let raf = 0;
    let last = -2;
    let lastStage = '';
    const draw = () => {
      const pos = countInAt(plan, state, wallNow(), offsetRef.current);
      if (pos.stage !== lastStage) {
        lastStage = pos.stage;
        setPhase(pos.stage);
      }
      if (pos.stage === 'done') return;
      if (pos.stage === 'before' && last !== -1) {
        last = -1;
        if (subRef.current) subRef.current.textContent = t('Get ready');
      }
      const e = pos.event >= 0 ? plan.events[pos.event] : null;
      if (e && pos.event !== last) {
        last = pos.event;
        if (numRef.current) numRef.current.textContent = e.go ? t('GO') : e.label;
        if (subRef.current) subRef.current.textContent = e.half ? t('Half time') : plan.endAt > plan.barMs + 1 ? t('Bar {n} of {total}', { n: e.bar + 1, total: Math.round(plan.endAt / plan.barMs) }) : '';
        if (dotsRef.current) {
          const n = e.dots > 1 ? e.dots : 0;
          dotsRef.current.replaceChildren(...Array.from({ length: n }, () => Object.assign(document.createElement('span'), { className: 'bw-countin-dot' })));
        }
        if (vibrateRef.current) (e.downbeat || e.go ? haptic.medium : haptic.tap)();
      }
      if (e && numRef.current && !still) {
        const s = 1 + 0.14 * Math.exp(-pos.phase * 6);
        numRef.current.style.transform = `scale(${s.toFixed(3)})`;
      }
      // GO: the song has started, the screen is back; the word only fades away over it.
      if (numRef.current) numRef.current.style.opacity = pos.stage === 'go' ? (1 - pos.phase).toFixed(3) : '1';
      if (e && dotsRef.current && e.dots > 1) {
        const lit = Math.min(e.dots - 1, Math.floor(pos.phase * e.dots));
        Array.from(dotsRef.current.children).forEach((d, i) => ((d as HTMLElement).dataset.on = i <= lit ? '1' : '0'));
      }
      if (ringRef.current) ringRef.current.style.strokeDashoffset = String(1 - (pos.stage === 'go' ? 1 : pos.barProgress));
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [plan, state, t]);

  // The count in headphones, on the shared clock.
  React.useEffect(() => {
    if (!state.on || !audible) return;
    const sounds = countInSounds(plan, state, 0, { voice: null });
    return startAudioScheduler((from, to) =>
      sounds.map((s) => ({ ...s, at: s.at - offsetRef.current })).filter((s) => s.at >= from - 5 && s.at <= to),
    );
  }, [plan, state, audible]);

  if (!state.on || phase === 'done' || hiddenSeq === state.seq || typeof document === 'undefined') return null;
  const go = phase === 'go';
  const size = big ? 'min(86cqmin, 720px)' : 'min(72cqmin, 520px)';
  return createPortal(
    <div
      // At GO the band is playing: the black layer goes at once and lets every
      // touch through, so the song, the chords and the click are there from
      // the first beat; GO just fades away on top.
      className={cn('bw-countin fixed inset-0 z-[150] flex flex-col items-center justify-center text-white select-none', go ? 'pointer-events-none bg-transparent' : 'bg-black')}
      role="dialog"
      aria-modal={!go}
      aria-label={title ? t('Count-in · {title}', { title }) : t('Count-in')}
      data-stage={phase}
    >
      {title && <p className={cn('bw-label text-white/70 truncate max-w-[90cqw] px-4 shrink-0', go && 'invisible')}>{title}</p>}
      <div className="relative flex items-center justify-center my-auto" style={{ '--bw-countin-ring': size, width: 'var(--bw-countin-ring)', height: 'var(--bw-countin-ring)' } as React.CSSProperties}>
        <svg viewBox="0 0 100 100" className={cn('absolute inset-0 w-full h-full -rotate-90', go && 'invisible')} aria-hidden>
          <circle cx="50" cy="50" r="47" fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="3" />
          <circle ref={ringRef} cx="50" cy="50" r="47" fill="none" stroke={accent} strokeWidth="3" strokeLinecap="round" pathLength={1} strokeDasharray="1" style={{ strokeDashoffset: 1 }} />
        </svg>
        <div className="flex flex-col items-center justify-center gap-[2cqmin]">
          <span
            ref={numRef}
            data-testid="countin-number"
            className="bw-num font-semibold leading-none tabular-nums"
            style={{
              fontSize: big ? 'min(52cqmin, 440px)' : go ? 'min(30cqmin, 220px)' : 'min(42cqmin, 320px)',
              color: go ? accent : undefined,
              textShadow: go ? '0 0 24px rgba(0,0,0,0.85), 0 0 4px rgba(0,0,0,0.9)' : undefined,
              willChange: 'transform, opacity',
            }}
          />
          <div ref={dotsRef} className="flex gap-[2.4cqmin] h-[3cqmin] items-center" aria-hidden />
        </div>
      </div>
      <span ref={subRef} className={cn('bw-label-xs text-white/60 h-5 shrink-0', go && 'invisible')} aria-hidden />
      {/* Gone at GO: the band is playing, nothing left to stop or hide. */}
      {!go && (
        <button
          type="button"
          onClick={() => {
            if (canStop) onStop();
            else {
              haptic.tap();
              setHiddenSeq(state.seq);
            }
          }}
          className={cn('mt-4 min-h-14 px-8 rounded-[20px] bw-button-sm shrink-0', canStop ? 'bg-white text-black' : 'bg-white/10 text-white')}
        >
          {canStop ? t('Stop the count-in') : t('Hide on this phone')}
        </button>
      )}
    </div>,
    document.body,
  );
};

/** The leader's Count in, next to the click: starts it for the band, or stops it. */
export const CountInButton: React.FC<{ counting: boolean; onPress: () => void; className?: string }> = ({ counting, onPress, className }) => {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onPress}
      aria-label={counting ? t('Stop the count-in') : t('Count in the band')}
      className={cn('min-h-14 min-w-16 px-3 rounded-[20px] flex flex-col items-center justify-center leading-none bg-white/10 text-white', className)}
    >
      <Timer className="w-5 h-5" aria-hidden />
      <span className="bw-label-xs mt-1">{counting ? t('Stop') : t('Count in')}</span>
    </button>
  );
};

/** The header button that opens the count-in sheet (everyone: this phone's sound and vibration). */
export const CountInSheetButton: React.FC<{ onPress: () => void }> = ({ onPress }) => {
  const t = useT();
  return (
    <button
      type="button"
      onClick={() => {
        haptic.tap();
        onPress();
      }}
      aria-label={t('Count-in options')}
      className="w-11 h-11 flex items-center justify-center rounded-full border border-white/30 shrink-0"
    >
      <Timer className="w-5 h-5" />
    </button>
  );
};

const Chip: React.FC<{ on: boolean; onPress: () => void; children: React.ReactNode; label?: string }> = ({ on, onPress, children, label }) => (
  <button
    type="button"
    aria-pressed={on}
    aria-label={label}
    onClick={() => {
      haptic.selection();
      onPress();
    }}
    className={cn('min-h-11 px-4 rounded-full bw-button-sm', on ? 'bg-white text-black' : 'border border-white/30 text-white')}
  >
    {children}
  </button>
);

const Row: React.FC<{ label: string; hint?: string; checked: boolean; disabled?: boolean; onChange: (on: boolean) => void }> = ({ label, hint, checked, disabled, onChange }) => {
  const id = React.useId();
  return (
    <div className="flex items-start gap-3 py-2">
      <label htmlFor={id} className={cn('flex-1 min-w-0', disabled && 'opacity-50')}>
        <span className="block bw-body text-white">{label}</span>
        {hint && <span className="block bw-body-sm text-white/60 mt-0.5">{hint}</span>}
      </label>
      {/* Stage is always black: a switch drawn for it (the app's follows the light theme). */}
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => {
          haptic.selection();
          onChange(!checked);
        }}
        className={cn('inline-flex h-8 w-[52px] shrink-0 items-center rounded-full p-1 transition-colors disabled:opacity-40', checked ? 'bg-white' : 'bg-white/25')}
      >
        <span className={cn('block size-6 rounded-full transition-transform', checked ? 'translate-x-5 bg-black' : 'translate-x-0 bg-white')} />
      </button>
    </div>
  );
};

/**
 * The count-in sheet (the song's menu in Stage): this phone's vibration and
 * sound, the band's direction (admins), and for the leader "Count in
 * anyway" on a song played with a backing track or by the stage manager.
 */
export const CountInSheet: React.FC<{
  open: boolean;
  onClose: () => void;
  /** Leader, when the button is hidden: why, and the forced start. */
  force?: { reason: string; start: () => void } | null;
  /** Admins: the band's direction. */
  style?: { value: CountInStyle; set: (s: CountInStyle) => void } | null;
}> = ({ open, onClose, force, style }) => {
  const t = useT();
  const prefs = useCountInPrefs();
  useSystemBack(open, onClose);
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="bw-countin-sheet fixed inset-0 z-[140] flex flex-col bg-black text-white"
      role="dialog"
      aria-modal="true"
      aria-label={t('Count-in')}
    >
      <div className="flex flex-col flex-1 min-h-0 w-full max-w-[560px] mx-auto px-4 gap-4 overflow-y-auto overscroll-contain">
        <div className="flex items-center justify-between gap-3 shrink-0">
          <h2 className="bw-h2 normal-case text-white">{t('Count-in')}</h2>
          <button type="button" onClick={onClose} aria-label={t('Close')} className="w-11 h-11 flex items-center justify-center rounded-full border border-white shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>
        {force && (
          <section className="flex flex-col gap-2">
            <p className="bw-body-sm text-white/70">{force.reason}</p>
            <button
              type="button"
              onClick={() => {
                onClose();
                force.start();
              }}
              className="min-h-14 rounded-[20px] bg-white text-black bw-button-sm"
            >
              {t('Count in anyway')}
            </button>
          </section>
        )}
        <section className="flex flex-col" aria-label={t('On this phone')}>
          <h3 className="bw-label text-white/60 pb-1">{t('On this phone')}</h3>
          <Row label={t('Vibrate on every beat')} hint={t('Stronger on the first beat of the bar.')} checked={prefs.vibrate} onChange={(on) => setCountInPrefs({ vibrate: on })} />
          <div className="flex flex-col gap-2 py-2">
            <span className="bw-body text-white">{t('Sound in headphones')}</span>
            <div className="flex flex-wrap gap-2" role="group" aria-label={t('Sound in headphones')}>
              <Chip on={prefs.sound === 'off'} onPress={() => setCountInPrefs({ sound: 'off' })}>
                {t('Off')}
              </Chip>
              <Chip
                on={prefs.sound === 'click'}
                onPress={() => {
                  unlockAudio();
                  setCountInPrefs({ sound: 'click' });
                }}
              >
                {t('Click')}
              </Chip>
            </div>
          </div>
          <Row
            label={t('Also through the phone’s speaker')}
            hint={t('Off: only in headphones or an audio interface. A browser can’t tell them apart, so turn this on there to hear it.')}
            checked={prefs.speaker}
            disabled={prefs.sound === 'off'}
            onChange={(on) => setCountInPrefs({ speaker: on })}
          />
        </section>
        {style && (
          <section className="flex flex-col gap-2" aria-label={t('For the whole band')}>
            <h3 className="bw-label text-white/60">{t('For the whole band')}</h3>
            <div className="flex flex-wrap gap-2" role="group" aria-label={t('How the band counts')}>
              <Chip on={style.value === 'down'} onPress={() => style.set('down')} label={t('Count down: 4 3 2 1')}>
                4 3 2 1
              </Chip>
              <Chip on={style.value === 'up'} onPress={() => style.set('up')} label={t('Count up: 1 2 3 4')}>
                1 2 3 4
              </Chip>
            </div>
            <p className="bw-body-sm text-white/60">{t('Every phone in the band counts this way.')}</p>
          </section>
        )}
      </div>
    </div>,
    document.body,
  );
};

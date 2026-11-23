/**
 * Sounds on the band's shared clock (count-in in headphones §6.1, the
 * audible click §7): Web Audio, scheduled ahead on the AudioContext's own
 * clock, so a beat is on time to the millisecond even when the screen is
 * busy ("A tale of two clocks").
 *
 * A small look-ahead loop asks the caller for the sounds due in the next
 * LOOKAHEAD_MS (times in this phone's wall clock, ms since epoch: the shared
 * time minus the measured offset) and hands each one to the audio clock once.
 * The caller can change its mind (a new offset, Stop) until then.
 *
 * Sounds: a synthesised click (bar / beat / tick), or a counted number
 * spoken by a short recorded voice (public/audio/count/<lang>/<n>.mp3); a
 * voice not loaded yet plays as a click.
 */

export type LiveSound = { kind: 'bar' | 'beat' | 'tick' } | { kind: 'voice'; word: string; lang: string };

export interface ScheduledSound {
  /** Unique per sound (scheduled once). */
  key: string;
  /** When, in this phone's wall clock (ms since epoch). */
  at: number;
  sound: LiveSound;
}

const LOOKAHEAD_MS = 160;
const TICK_MS = 25;

/** Wall-clock ms with sub-ms steps (as useStageLive). */
export const wallNow = () => performance.timeOrigin + performance.now();

let ctx: AudioContext | null = null;
const voices = new Map<string, AudioBuffer | 'loading' | 'missing'>();

type Ctor = typeof AudioContext;
const AudioCtor = (): Ctor | null =>
  typeof window === 'undefined' ? null : ((window.AudioContext || (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext) ?? null);

/** The shared AudioContext, created on first use. Null where there is no Web Audio. */
export function audioContext(): AudioContext | null {
  if (ctx) return ctx;
  const C = AudioCtor();
  if (!C) return null;
  try {
    ctx = new C({ latencyHint: 'interactive' });
  } catch {
    ctx = null;
  }
  return ctx;
}

/** Call from a tap: browsers start audio only after a user gesture. */
export function unlockAudio(): void {
  const c = audioContext();
  if (c && c.state !== 'running') void c.resume().catch(() => {});
}

/** A wall-clock time (ms) on the AudioContext's clock (s), output latency included. */
export function contextTimeAt(c: Pick<AudioContext, 'currentTime' | 'getOutputTimestamp'> & { outputLatency?: number }, wallMs: number, now = wallNow()): number {
  let base = c.currentTime;
  let baseWall = now;
  const ts = typeof c.getOutputTimestamp === 'function' ? c.getOutputTimestamp() : null;
  if (ts && typeof ts.contextTime === 'number' && typeof ts.performanceTime === 'number' && ts.performanceTime > 0) {
    base = ts.contextTime;
    baseWall = performance.timeOrigin + ts.performanceTime;
  }
  const latency = typeof c.outputLatency === 'number' && Number.isFinite(c.outputLatency) ? c.outputLatency : 0;
  return base + (wallMs - baseWall) / 1000 - latency;
}

const CLICK = { bar: { hz: 1760, gain: 0.9 }, beat: { hz: 1175, gain: 0.65 }, tick: { hz: 880, gain: 0.25 } } as const;

function playClick(c: AudioContext, when: number, kind: 'bar' | 'beat' | 'tick') {
  const { hz, gain } = CLICK[kind];
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(hz, when);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(gain, when + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.06);
  osc.connect(g).connect(c.destination);
  osc.start(when);
  osc.stop(when + 0.08);
  return () => {
    try {
      osc.stop();
    } catch {
      /* already stopped */
    }
  };
}

const voiceKey = (lang: string, word: string) => `${lang}/${word}`;
const voiceUrl = (lang: string, word: string) => `/audio/count/${lang}/${word}.mp3`;

/** Loads the spoken numbers for a count (1…12) ahead of time. */
export function preloadVoice(lang: string, words: string[]): void {
  const c = audioContext();
  if (!c || typeof fetch !== 'function') return;
  for (const word of words) {
    const key = voiceKey(lang, word);
    if (voices.has(key)) continue;
    voices.set(key, 'loading');
    void fetch(voiceUrl(lang, word))
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((data) => c.decodeAudioData(data))
      .then((buf) => voices.set(key, buf))
      .catch(() => voices.set(key, 'missing'));
  }
}

function playSound(c: AudioContext, when: number, sound: LiveSound): () => void {
  if (sound.kind !== 'voice') return playClick(c, when, sound.kind);
  const buf = voices.get(voiceKey(sound.lang, sound.word));
  if (!buf || typeof buf === 'string') return playClick(c, when, 'beat');
  const src = c.createBufferSource();
  src.buffer = buf;
  src.connect(c.destination);
  src.start(when);
  return () => {
    try {
      src.stop();
    } catch {
      /* already stopped */
    }
  };
}

/**
 * Plays the sounds `due(from, to)` returns, each at its time, until the
 * returned function is called (which also silences what was scheduled).
 */
export function startAudioScheduler(due: (from: number, to: number) => ScheduledSound[]): () => void {
  const c = audioContext();
  if (!c) return () => {};
  const done = new Map<string, () => void>();
  let horizon = wallNow();
  const pump = () => {
    const now = wallNow();
    const to = now + LOOKAHEAD_MS;
    for (const s of due(Math.min(horizon, now), to)) {
      if (done.has(s.key) || s.at < now - 5 || s.at > to) continue;
      done.set(s.key, playSound(c, Math.max(c.currentTime, contextTimeAt(c, s.at, now)), s.sound));
    }
    horizon = to;
  };
  pump();
  const timer = setInterval(pump, TICK_MS);
  return () => {
    clearInterval(timer);
    done.forEach((stop) => stop());
    done.clear();
  };
}

/** Test hook: forget the context and voices. */
export function __resetLiveAudio() {
  ctx = null;
  voices.clear();
}

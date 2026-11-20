/**
 * Stage mode "Regia" (the stage manager device), the parts without React,
 * Supabase or audio so they can be tested.
 *
 * One admin device per gig is the Regia: it is wired to the mixer, and only
 * it plays the songs' audio. Pressing Play on a song there makes it the
 * current song for the whole band (the usual StageLiveState, useStageLive)
 * and sends a RegiaState on the same private channel (migration 085), so
 * the musicians see "Now playing · 1:12 / 3:58". No other device ever loads
 * the audio. See docs/plans/stage-manager-mode.md.
 */
import { isNewer, type SetlistRowRef } from './stageLive';

/** Realtime broadcast event on the stage channel (stageTopic). */
export const REGIA_EVENT = 'regia';

/** How often the Regia repeats its state while a song plays (late joiners, drift). */
export const REGIA_RESEND_MS = 5_000;

export interface RegiaState {
  /** Lamport clock, as for the stage state (nextSeq). */
  seq: number;
  /** Random id of the sending app (useStageLive's clientId). */
  from: string;
  /** The sender is (still) the Regia; false when it turns the Regia off. */
  on: boolean;
  /** First name of the admin holding it ("The Regia passed to Anna"). */
  name: string | null;
  /** setlist_songs row id of the song loaded or playing. */
  songId: string | null;
  /** Its title, for members whose setlist hasn't caught up yet (a song added on stage). */
  title: string | null;
  playing: boolean;
  /** Position in the song when the message was sent (ms). */
  positionMs: number;
  durationMs: number | null;
}

const MAX_NAME = 60;
const MAX_TITLE = 200;
const MAX_MS = 6 * 60 * 60 * 1000;

const finite = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/** Checks a broadcast payload; anything malformed is dropped. */
export const parseRegiaState = (payload: unknown): RegiaState | null => {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  if (!finite(p.seq, 0, Number.MAX_SAFE_INTEGER) || typeof p.from !== 'string' || !p.from) return null;
  if (typeof p.on !== 'boolean' || typeof p.playing !== 'boolean') return null;
  if (p.songId !== null && typeof p.songId !== 'string') return null;
  if (!finite(p.positionMs, 0, MAX_MS)) return null;
  if (p.durationMs != null && !finite(p.durationMs, 0, MAX_MS)) return null;
  return {
    seq: p.seq,
    from: p.from,
    on: p.on,
    name: text(p.name, MAX_NAME),
    songId: (p.songId as string | null) ?? null,
    title: text(p.title, MAX_TITLE),
    playing: p.playing,
    positionMs: p.positionMs,
    durationMs: (p.durationMs as number | null | undefined) ?? null,
  };
};

/**
 * Where the song is now, from a state that arrived at `receivedAt` (my
 * clock). The network adds a few hundred ms at most: plenty for a clock on
 * screen, so no clock sync is needed.
 */
export function playPosition(state: Pick<RegiaState, 'playing' | 'positionMs' | 'durationMs'>, receivedAt: number, now: number): number {
  const run = state.playing ? Math.max(0, now - receivedAt) : 0;
  const pos = state.positionMs + run;
  return state.durationMs != null ? Math.min(state.durationMs, pos) : pos;
}

/** "1:12", "59:59", "1:02:05". */
export function formatClock(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/**
 * Another device turned the Regia on after this one: this one stops (one
 * Regia per gig, the newest wins, as with the stage state).
 */
export function takesOver(incoming: RegiaState, mine: RegiaState | null): boolean {
  if (!mine?.on || !incoming.on || incoming.from === mine.from) return false;
  return isNewer(incoming, mine);
}

/** `order` with `id` right after `after` (at the start when there is no current song, at the end when it isn't found). */
export function insertAfter(order: string[], after: string | null, id: string): string[] {
  const rest = order.filter((x) => x !== id);
  if (after === null) return [id, ...rest];
  const at = rest.indexOf(after);
  if (at < 0) return [...rest, id];
  return [...rest.slice(0, at + 1), id, ...rest.slice(at + 1)];
}

/**
 * setlist_songs rows to save once a song played off the setlist has its new
 * row: positions 1..n in the live order, with the new row right after the
 * current song. The new row takes the current song's set; every other slot
 * keeps the set it had (as reorderRows does), so the sets keep their songs.
 * Null when the live order names a row the saved setlist doesn't have.
 */
export function rowsWithInserted(
  setlistId: string,
  saved: SetlistRowRef[],
  liveOrder: string[],
  currentId: string | null,
  added: { id: string; songId: string },
) {
  const byId = new Map(saved.map((s) => [s.id, s]));
  const live = liveOrder.length ? liveOrder : saved.map((s) => s.id);
  if (live.some((id) => !byId.has(id))) return null;
  const order = insertAfter(live, currentId, added.id);
  const currentSet = (currentId && byId.get(currentId)?.setNumber) || 1;
  const setOf = new Map(saved.map((s) => [s.id, s.setNumber ?? 1]));
  setOf.set(added.id, currentSet);
  const songOf = new Map(saved.map((s) => [s.id, s.songId]));
  songOf.set(added.id, added.songId);
  return order.map((id, i) => ({
    id,
    setlist_id: setlistId,
    song_id: songOf.get(id)!,
    position: i + 1,
    set_number: setOf.get(id) ?? 1,
  }));
}

export interface RegiaReadiness {
  /** Songs with an audio file. */
  withAudio: number;
  /** …already downloaded on this device (plays without internet). */
  ready: number;
  /** …not downloaded yet. */
  missing: number;
  /** Songs without audio (they still move the band, nothing plays). */
  noAudio: number;
}

/** What tonight's setlist has ready on the Regia device. */
export function regiaReadiness(songs: { audio?: string | null }[], cached: ReadonlySet<string>): RegiaReadiness {
  let withAudio = 0;
  let ready = 0;
  for (const s of songs) {
    if (!s.audio) continue;
    withAudio += 1;
    if (cached.has(s.audio)) ready += 1;
  }
  return { withAudio, ready, missing: withAudio - ready, noAudio: songs.length - withAudio };
}

import { saveProfileChoice } from './livePackStatus';

/**
 * May the live packs come down by themselves on this device (plan §3.2–3.3)?
 * Only after the person said yes: "Download and keep it automatic" (every
 * setlist of the next 7 days, silently) or "Only this gig". Kept per user
 * on the device; the server copy (profiles.live_pack_auto, A2) tells the
 * daily job not to ask again.
 *
 * Opening an event while online still keeps its songs on the device (what
 * Stage mode did since PR #93, for Bluetooth on stage): that's the person
 * using the setlist, not a download ahead.
 */

export interface LivePackChoice {
  /** "Download and keep it automatic". */
  auto: boolean;
  /** "Only this gig": these events. */
  events: string[];
  /** Download only on Wi-Fi. */
  wifiOnly: boolean;
  /** Last time the sheet was answered "Not now" (ISO). */
  notNowAt?: string;
}

const MAX_EVENTS = 50;

const EMPTY: LivePackChoice = { auto: false, events: [], wifiOnly: false };
const keyOf = (userId: string) => `bw-live-pack:${userId}`;
export const LIVE_PACK_CHOICE_EVENT = 'bw:live-pack-choice';

export function readChoice(userId: string | null | undefined): LivePackChoice {
  if (!userId) return EMPTY;
  try {
    const v = JSON.parse(localStorage.getItem(keyOf(userId)) || 'null');
    if (!v || typeof v !== 'object') return EMPTY;
    return {
      auto: v.auto === true,
      events: Array.isArray(v.events) ? v.events.filter((e: unknown): e is string => typeof e === 'string') : [],
      wifiOnly: v.wifiOnly === true,
      notNowAt: typeof v.notNowAt === 'string' ? v.notNowAt : undefined,
    };
  } catch {
    return EMPTY;
  }
}

export function writeChoice(userId: string, choice: LivePackChoice) {
  try {
    localStorage.setItem(keyOf(userId), JSON.stringify(choice));
  } catch {
    /* per-device preference */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(LIVE_PACK_CHOICE_EVENT, { detail: { userId } }));
}

/** The person said yes for this event (or for all of them). */
export const packAllowed = (choice: LivePackChoice, eventId: string): boolean => choice.auto || choice.events.includes(eventId);

/** Anything may come down ahead at all. */
export const anyPackAllowed = (choice: LivePackChoice): boolean => choice.auto || choice.events.length > 0;

/** The sheet was answered at least once on this device (any answer). */
export const hasAnswered = (choice: LivePackChoice): boolean =>
  choice.auto || choice.events.length > 0 || !!choice.notNowAt;

const withEvent = (events: string[], eventId?: string) =>
  eventId ? [...events.filter((e) => e !== eventId), eventId].slice(-MAX_EVENTS) : events;

/** "Download and keep it automatic": this and every future setlist, silently. */
export function chooseAutomatic(userId: string, eventId?: string, now: Date = new Date()) {
  const c = readChoice(userId);
  writeChoice(userId, { ...c, auto: true, events: withEvent(c.events, eventId), notNowAt: undefined });
  void saveProfileChoice(userId, { auto: true, askedAt: now.toISOString() });
}

/** "Only this gig". */
export function chooseThisEvent(userId: string, eventId: string, now: Date = new Date()) {
  const c = readChoice(userId);
  writeChoice(userId, { ...c, events: withEvent(c.events, eventId), notNowAt: undefined });
  void saveProfileChoice(userId, { askedAt: now.toISOString() });
}

/** "Not now": asked again at most once, the day before (server, migration 170). */
export function chooseNotNow(userId: string, now: Date = new Date()) {
  const c = readChoice(userId);
  writeChoice(userId, { ...c, notNowAt: now.toISOString() });
  void saveProfileChoice(userId, { askedAt: now.toISOString() });
}

/** Settings → Offline & live: automatic on/off. */
export function setAutomatic(userId: string, on: boolean) {
  const c = readChoice(userId);
  writeChoice(userId, { ...c, auto: on });
  void saveProfileChoice(userId, { auto: on });
}

/** Settings → Offline & live: download only on Wi-Fi (this device). */
export function setWifiOnly(userId: string, on: boolean) {
  writeChoice(userId, { ...readChoice(userId), wifiOnly: on });
}

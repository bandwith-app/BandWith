/**
 * What a member's phone remembers of the admins' signed Stage states, per
 * gig (useStageBle): when it last checked one (band-key states are refused
 * for a while after, SIGNED_TRUST_MS) and the highest signed seq followed
 * from each leader id (one below it is a recording played back).
 *
 * Kept in storage per account and gig, so an app restart at the venue
 * doesn't forget it (Claude on #288). It goes with the gig's pack
 * (livePackStore), and with every other kept Bluetooth key when the
 * account signs out or another one signs in (stageBleNative: the keys share
 * its 'bw-stage-key:' prefix). With no account known (tests, or before
 * sign-in) it lives for this run only.
 */
export interface StageSignedMemory {
  /** When a signed state last checked (Date.now()), or 0. */
  seen: number;
  /** The highest signed seq followed, per leader id. */
  tops: Record<string, number>;
}

/** Leader ids kept per gig: a new one comes with every Stage opening (useStageLive), the oldest go. */
export const SIGNED_TOPS_KEPT = 16;
const PREFIX = 'bw-stage-key:signed:';
const storageKey = (userId: string, eventId: string) => `${PREFIX}${userId}:${eventId}`;

let user: string | null = null;
/** This run's copy (and the only one with no account known). */
const memo = new Map<string, StageSignedMemory>();

const asMemory = (v: unknown): StageSignedMemory | null => {
  const o = v as { seen?: unknown; tops?: unknown } | null;
  if (!o || typeof o.seen !== 'number' || !o.tops || typeof o.tops !== 'object') return null;
  const tops: Record<string, number> = {};
  for (const [k, n] of Object.entries(o.tops as Record<string, unknown>)) if (typeof n === 'number') tops[k] = n;
  return { seen: o.seen, tops };
};

/** The signed-in account (stageBleNative): another one starts from what it kept. */
export function setSignedMemoryUser(id: string | null) {
  if (id !== user) memo.clear();
  user = id;
}

/** Every gig's copy in memory (the stored ones go with the other kept keys). */
export const clearSignedMemoryCache = () => memo.clear();

export function signedMemory(eventId: string): StageSignedMemory {
  const inMemory = memo.get(eventId);
  if (inMemory) return inMemory;
  let stored: StageSignedMemory | null = null;
  if (user) {
    try {
      stored = asMemory(JSON.parse(localStorage.getItem(storageKey(user, eventId)) ?? 'null'));
    } catch {
      stored = null;
    }
  }
  const m = stored ?? { seen: 0, tops: {} };
  memo.set(eventId, m);
  return m;
}

function save(eventId: string, m: StageSignedMemory) {
  memo.set(eventId, m);
  if (!user) return;
  try {
    localStorage.setItem(storageKey(user, eventId), JSON.stringify(m));
  } catch {
    /* kept for this run only */
  }
}

/** A signed state checked just now. */
export function noteSignedSeen(eventId: string, at: number = Date.now()) {
  save(eventId, { ...signedMemory(eventId), seen: at });
}

/** A signed seq followed from `from`; only the latest SIGNED_TOPS_KEPT leader ids stay. */
export function noteSignedTop(eventId: string, from: string, seq: number) {
  const m = signedMemory(eventId);
  const entries = Object.entries({ ...m.tops, [from]: seq })
    .sort((a, b) => b[1] - a[1])
    .slice(0, SIGNED_TOPS_KEPT);
  save(eventId, { ...m, tops: Object.fromEntries(entries) });
}

/** The gig's pack went: what was kept for it goes too. */
export function forgetSignedMemory(userId: string, eventId: string) {
  if (userId === user) memo.delete(eventId);
  try {
    localStorage.removeItem(storageKey(userId, eventId));
  } catch {
    /* storage not available */
  }
}

/** Tests: start with no signed leader seen. */
export const forgetAllSignedMemory = () => memo.clear();

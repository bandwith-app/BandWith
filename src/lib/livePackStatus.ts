import { Capacitor } from '@capacitor/core';
import * as client from './supabase';

const { supabase } = client;

/** Demo mode, read when needed; unknown (a partial test mock) counts as demo: skip. */
const inDemo = (): boolean => {
  try {
    return client.isDemoMode !== false;
  } catch {
    return true;
  }
};

/**
 * What the server knows about the live packs (migration 170):
 * - each device reports the version of the pack it holds
 *   (live_pack_status: admins see "Offline: 4 of 5 members ready");
 * - the person's answer on the consent sheet (profiles.live_pack_auto /
 *   live_pack_asked_at): the daily job then stops asking.
 * Only the native apps report: the web keeps no pack for the venue.
 * Every call is best effort: no network, an old database without the table,
 * the demo… just skip.
 */

const DEVICE_KEY = 'bw-device-id';
const REPORTED_KEY = 'bw-live-pack-reported';

export function deviceId(): string {
  try {
    const known = localStorage.getItem(DEVICE_KEY);
    if (known) return known;
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    return 'unknown-device';
  }
}

const canReport = () => !inDemo() && Capacitor.isNativePlatform();

type Reported = Record<string, string>;
const readReported = (): Reported => {
  try {
    const v = JSON.parse(localStorage.getItem(REPORTED_KEY) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
};
const writeReported = (r: Reported) => {
  try {
    localStorage.setItem(REPORTED_KEY, JSON.stringify(r));
  } catch {
    /* only saves a request */
  }
};

/**
 * reportPackStatus: this device holds this version of the event's pack. Sent
 * once per version. `partial`: held, but not complete (live_pack off, or a
 * part not loaded yet): the admins don't count it as ready, the server still
 * keeps it current.
 */
/**
 * One write at a time per event, in order: reports and the forgetting of a
 * pack ("Delete all", expiry) queue behind each other, so a write already in
 * flight can't bring a row back after it was deleted. The delete goes through
 * the same chain and cancels the writes still queued before it (they would
 * report a pack that is gone). "Delete all" holds back every event's next
 * write, queued or not, until it is done. The server also drops a write
 * older than its row (170).
 */
const writing = new Map<string, Promise<void>>();
/** Moved on by a forget: a queued write of an older epoch is skipped. */
const epochs = new Map<string, number>();
let allEpoch = 0;
/** The "Delete all" still running, if any: every write waits for it. */
let forgettingAll: Promise<void> | null = null;
const epochOf = (key: string) => `${allEpoch}:${epochs.get(key) ?? 0}`;

function enqueue(key: string, job: () => Promise<void>): Promise<void> {
  const at = epochOf(key);
  // Forgotten since it was queued: not sent.
  const run = () => (epochOf(key) === at ? job() : undefined);
  const tail = writing.get(key);
  const wait = tail && forgettingAll ? Promise.all([tail, forgettingAll]) : (tail ?? forgettingAll);
  // Nothing ahead: it starts now (so it is in flight, not queued).
  const next = wait ? wait.then(run, run) : Promise.resolve(run());
  writing.set(key, next);
  void next.finally(() => {
    if (writing.get(key) === next) writing.delete(key);
  });
  return next;
}

export function reportPackStatus(p: { eventId: string; userId: string; version: string; savedAt: string; partial?: boolean }): Promise<void> {
  if (!canReport() || !p.eventId || !p.userId || !p.version) return Promise.resolve();
  const key = `${p.userId}:${p.eventId}`;
  return enqueue(key, () => writeStatus(key, p));
}

/**
 * The stamp the server orders a device's writes by (170 keeps the newest).
 * The pack's save time, but never at or below the last one this device sent
 * for the event: a clock set back must not make the next save look older.
 */
const STAMPS_KEY = 'bw-live-pack-stamps';
const readStamps = (): Record<string, number> => {
  try {
    const v = JSON.parse(localStorage.getItem(STAMPS_KEY) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
};
const saveStamp = (key: string, ms: number | null) => {
  try {
    const all = readStamps();
    if (ms === null) delete all[key];
    else all[key] = ms;
    localStorage.setItem(STAMPS_KEY, JSON.stringify(all));
  } catch {
    /* the server's re-read below covers it */
  }
};
const msOf = (iso: unknown) => {
  const ms = Date.parse(String(iso ?? ''));
  return Number.isFinite(ms) ? ms : 0;
};

async function writeStatus(key: string, p: Parameters<typeof reportPackStatus>[0]): Promise<void> {
  const reported = readReported();
  const stamp = p.partial ? `${p.version}|partial` : p.version;
  if (reported[key] === stamp) return;
  const row = (ms: number) => ({
    event_id: p.eventId,
    user_id: p.userId,
    device_id: deviceId(),
    version: p.version.slice(0, 64),
    downloaded_at: new Date(ms).toISOString(),
    partial: !!p.partial,
  });
  const send = (ms: number) =>
    supabase.from('live_pack_status').upsert(row(ms), { onConflict: 'event_id,user_id,device_id' }).select('downloaded_at');
  try {
    let ms = Math.max(msOf(p.savedAt), (readStamps()[key] ?? 0) + 1);
    let { data, error } = await send(ms);
    // No row back: the server kept a newer stamp (this device's clock, or a
    // stamp list cleared with the storage). Sent once more, just above it.
    if (!error && Array.isArray(data) && data.length === 0) {
      const cur = await supabase
        .from('live_pack_status')
        .select('downloaded_at')
        .eq('event_id', p.eventId)
        .eq('user_id', p.userId)
        .eq('device_id', deviceId())
        .maybeSingle();
      ms = Math.max(Date.now(), msOf((cur.data as { downloaded_at?: unknown } | null)?.downloaded_at) + 1, ms + 1);
      ({ data, error } = await send(ms));
      if (!error && Array.isArray(data) && data.length === 0) return;
    }
    if (!error) {
      saveStamp(key, ms);
      writeReported({ ...readReported(), [key]: stamp });
    }
  } catch {
    /* next save tries again */
  }
}

/** The pack left this device (expired, band left, deleted in Settings). */
export function forgetPackStatus(userId: string, eventIds?: string[]): Promise<void> {
  const mine = (k: string) => k.startsWith(`${userId}:`) && (!eventIds || eventIds.includes(k.slice(userId.length + 1)));
  if (eventIds) {
    // Through each event's chain: after the write in flight, instead of the queued ones.
    const ids = [...new Set(eventIds)];
    for (const id of ids) epochs.set(`${userId}:${id}`, (epochs.get(`${userId}:${id}`) ?? 0) + 1);
    return Promise.all(
      ids.map((id) => enqueue(`${userId}:${id}`, () => forgetNow(userId, [id], (k) => k === `${userId}:${id}`))),
    ).then(() => undefined);
  }
  // Delete all: after every write in flight; the queued ones are cancelled,
  // and every later write waits for this delete.
  allEpoch++;
  const ahead = [...writing.values(), ...(forgettingAll ? [forgettingAll] : [])].map((w) => w.catch(() => undefined));
  const done = Promise.all(ahead).then(() => forgetNow(userId, undefined, mine));
  const barrier = done.catch(() => undefined);
  forgettingAll = barrier;
  void barrier.finally(() => {
    if (forgettingAll === barrier) forgettingAll = null;
  });
  return done;
}

async function forgetNow(userId: string, eventIds: string[] | undefined, mine: (k: string) => boolean): Promise<void> {
  const reported = readReported();
  const keys = Object.keys(reported).filter(mine);
  if (keys.length) {
    for (const k of keys) delete reported[k];
    writeReported(reported);
  }
  if (!canReport()) return;
  try {
    let q = supabase.from('live_pack_status').delete().eq('user_id', userId).eq('device_id', deviceId());
    if (eventIds) q = q.in('event_id', eventIds);
    await q;
  } catch {
    /* the row only says "ready"; the daily job may ask once more */
  }
}

export interface MemberPackStatus {
  userId: string;
  version: string;
  downloadedAt: string;
}

/** Admins: who has this event's whole pack (one row per person, latest device; partial ones don't count). */
export async function fetchEventPackStatus(eventId: string): Promise<MemberPackStatus[] | null> {
  try {
    const { data, error } = await supabase
      .from('live_pack_status')
      .select('user_id, version, downloaded_at, partial')
      .eq('event_id', eventId);
    if (error || !Array.isArray(data)) return null;
    const byUser = new Map<string, MemberPackStatus>();
    for (const r of data as Array<{ user_id: string; version: string; downloaded_at: string; partial?: boolean }>) {
      if (r.partial) continue;
      const prev = byUser.get(r.user_id);
      if (!prev || String(r.downloaded_at) > prev.downloadedAt) {
        byUser.set(r.user_id, { userId: r.user_id, version: r.version, downloadedAt: String(r.downloaded_at) });
      }
    }
    return [...byUser.values()];
  } catch {
    return null;
  }
}

/** Admins: one push asking a member to download (at most every 6 hours). */
export async function remindPackDownload(eventId: string, userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('bw_live_pack_remind', { p_event_id: eventId, p_user_id: userId });
    return !error && data !== false;
  } catch {
    return false;
  }
}

/** The answer on the consent sheet, for every device of the account. */
export async function saveProfileChoice(userId: string, patch: { auto?: boolean; askedAt?: string }): Promise<void> {
  if (inDemo()) return;
  const row: Record<string, unknown> = {};
  if (patch.auto !== undefined) row.live_pack_auto = patch.auto;
  if (patch.askedAt !== undefined) row.live_pack_asked_at = patch.askedAt;
  if (!Object.keys(row).length) return;
  try {
    await supabase.from('profiles').update(row).eq('id', userId);
  } catch {
    /* the device keeps its own copy */
  }
}

/** "Keep it automatic" chosen on another device; null when unknown. */
export async function readProfileAuto(userId: string): Promise<boolean | null> {
  if (inDemo()) return null;
  try {
    const { data, error } = await supabase.from('profiles').select('live_pack_auto').eq('id', userId).maybeSingle();
    if (error || !data) return null;
    return (data as { live_pack_auto?: unknown }).live_pack_auto === true;
  } catch {
    return null;
  }
}

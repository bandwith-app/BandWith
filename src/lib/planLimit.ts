/**
 * Limit prompts (paid plans P3b, docs/plans/paid-plans.md §5.2). The server
 * refuses an action over the band's plan with `BW_PLAN_LIMIT:<key>` (161);
 * this module turns that refusal into one app-wide event, `bw:plan-limit`,
 * which `PlanLimitSheet` shows. It is wired once, in the Supabase client's
 * fetch, so every screen gets the prompt without its own error code.
 *
 * Storage is the exception: a full band refuses uploads through a storage
 * policy, whose error does not name the limit. An upload refused on a band
 * bucket is reported as a *possible* storage limit, and the sheet only opens
 * when the band's entitlements confirm it is full.
 */
import { LIMIT_KEYS, canUse, planLimitKey, type Entitlements, type LimitKey } from './plans';

export const PLAN_LIMIT_EVENT = 'bw:plan-limit';

export interface PlanLimitHit {
  key: LimitKey;
  /** The band the refusal is about, when the request names it (uploads). */
  bandId?: string | null;
  used?: number | null;
  limit?: number | null;
  /** Storage refusals: to be confirmed against the entitlements. */
  unconfirmed?: boolean;
}

const DETAIL_RE = /BW_PLAN_LIMIT:([a-z_]+) used=(\d+) limit=(\d+)/;

/** The key, and the numbers from the DETAIL when the server sent them. */
export function planLimitHit(error: unknown): PlanLimitHit | null {
  if (!error || typeof error !== 'object') return null;
  const e = error as { message?: string | null; details?: string | null; hint?: string | null };
  const key = planLimitKey(e);
  if (!key) return null;
  const m = typeof e.details === 'string' ? DETAIL_RE.exec(e.details) : null;
  return m && m[1] === key ? { key, used: Number(m[2]), limit: Number(m[3]) } : { key };
}

// Band buckets counted by 161's storage policy; avatars and personal files never count.
const STORAGE_RE = /\/storage\/v1\/object\/(song-files|band-branding|quotes)\/(?:quotes\/)?([0-9a-f-]{36})\//i;

/** What a failed Supabase response means for the plan, if anything. */
export function planLimitFromResponse(url: string, status: number, body: string): PlanLimitHit | null {
  if (status < 400) return null;
  if (url.includes('/rest/v1/')) {
    if (!body.includes('BW_PLAN_LIMIT:')) return null;
    try {
      return planLimitHit(JSON.parse(body));
    } catch {
      return planLimitHit({ message: body });
    }
  }
  const s = STORAGE_RE.exec(url);
  if (s && (status === 400 || status === 403) && /row-level security|unauthori[sz]ed|policy/i.test(body)) {
    return { key: 'storage_mb', bandId: s[2], unconfirmed: true };
  }
  return null;
}

export function showPlanLimit(hit: PlanLimitHit) {
  if (typeof window === 'undefined' || !(LIMIT_KEYS as readonly string[]).includes(hit.key)) return;
  window.dispatchEvent(new CustomEvent<PlanLimitHit>(PLAN_LIMIT_EVENT, { detail: hit }));
}

/** Reports a refusal from any error object; true when it was one. */
export function reportPlanLimit(error: unknown): boolean {
  const hit = planLimitHit(error);
  if (hit) showPlanLimit(hit);
  return !!hit;
}

export function onPlanLimit(cb: (hit: PlanLimitHit) => void): () => void {
  const h = (e: Event) => cb((e as CustomEvent<PlanLimitHit>).detail);
  window.addEventListener(PLAN_LIMIT_EVENT, h);
  return () => window.removeEventListener(PLAN_LIMIT_EVENT, h);
}

/**
 * The Supabase client's fetch: unchanged, except that a failed response is
 * read once (a clone, after it is returned) for a plan refusal.
 */
export function planAwareFetch(base: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const res = await base(input, init);
    if (!res.ok) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
      if (url.includes('/rest/v1/') || url.includes('/storage/v1/object/')) {
        void res
          .clone()
          .text()
          .then((body) => {
            const hit = planLimitFromResponse(url, res.status, body);
            if (hit) showPlanLimit(hit);
          })
          .catch(() => {});
      }
    }
    return res;
  };
}

/** A storage refusal is a plan limit only when the band is full on its plan. */
export function confirmStorageLimit(ent: Entitlements | null): boolean {
  if (!ent?.enforced) return false;
  const used = ent.usage.storage_mb ?? 0;
  return !canUse(ent, 'storage_mb', used, 1);
}

/**
 * Paid plans (docs/plans/paid-plans.md, P1, migration 160). Pure: no network.
 *
 * - The plan is on the band (`band_plans`, no row = Free).
 * - Limit values live in the database (`plan_limits`), never in code. A key
 *   with no value written, or NULL, is unlimited.
 * - Everything is switched off until `platform_switches.plans_enforced` is
 *   on. While it is off every band behaves as in the beta: no limits.
 * - The server enforces the limits (P2). The app only explains them, so when
 *   it knows nothing (offline, first launch) it never blocks.
 *
 * `resolvePlan` mirrors the SQL `bw_band_effective_plan`; both are checked
 * against `__fixtures__/planCases.json`.
 */

export const PLAN_IDS = ['free', 'pro', 'maestro'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export const LIMIT_KEYS = [
  'quotes_sent_month',
  'contracts_sent_month',
  'deputies',
  'admins',
  'custom_templates',
  'gear_items',
  'storage_mb',
  'analytics_days',
  'branding',
  'bands_as_admin',
] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];

export type PlanSource = 'paddle' | 'apple' | 'google' | 'grant' | 'trial';
export type PlanStatus = 'active' | 'trialing' | 'past_due' | 'paused' | 'canceled' | 'ended';

/** A `band_plans` row, as far as the effective plan is concerned. */
export interface BandPlanRow {
  plan: string;
  source: string;
  status: string;
  trial_ends_at?: string | null;
  grant_until?: string | null;
  past_due_since?: string | null;
}

export interface Entitlements {
  /** `plans_enforced`: off = the beta, every limit unlimited. */
  enforced: boolean;
  plan: PlanId;
  /** Admins only (members: null). */
  source: PlanSource | null;
  status: PlanStatus | null;
  trialEndsAt: string | null;
  grantUntil: string | null;
  /** The caller pays for this band (sees the billing links). */
  isPayer: boolean;
  isAdmin: boolean;
  /** Per key: a number, or null = unlimited. A missing key is unlimited too. */
  limits: Record<string, number | null>;
  /** Counters the server keeps (storage, sends this month). */
  usage: Record<string, number>;
  /** `plans_checkout`: buy buttons allowed (admins only). */
  checkout: boolean;
  /** Admins, while the plans are off: the launch notice from `plan_settings`. */
  notice: Record<string, unknown> | null;
}

const isPlan = (v: unknown): v is PlanId => typeof v === 'string' && (PLAN_IDS as readonly string[]).includes(v);
const time = (v: string | null | undefined): number | null => {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
};
const DAY_MS = 86_400_000;

/**
 * The plan a band actually has now. `graceDays` is `plan_settings.grace_days`
 * (null when not written: a past-due band then keeps its plan until the
 * provider ends the subscription).
 */
export function resolvePlan(row: BandPlanRow | null | undefined, now: Date, graceDays: number | null | undefined): PlanId {
  if (!row || !isPlan(row.plan) || row.plan === 'free') return 'free';
  const at = now.getTime();
  if (row.source === 'trial') {
    const end = time(row.trial_ends_at);
    return row.status === 'trialing' && end !== null && end > at ? row.plan : 'free';
  }
  if (row.source === 'grant') {
    if (row.status !== 'active') return 'free';
    const until = time(row.grant_until);
    return until === null || until > at ? row.plan : 'free';
  }
  if (row.status === 'active' || row.status === 'trialing') return row.plan;
  if (row.status === 'past_due') {
    const since = time(row.past_due_since);
    if (since === null || graceDays === null || graceDays === undefined) return row.plan;
    return since + graceDays * DAY_MS > at ? row.plan : 'free';
  }
  return 'free';
}

export const plansEnforced = (ent: Entitlements | null | undefined): boolean => !!ent?.enforced;

/** The limit for a key: a number, or null = unlimited (always null while switched off). */
export function limitFor(ent: Entitlements | null | undefined, key: LimitKey): number | null {
  if (!ent?.enforced) return null;
  const v = ent.limits[key];
  return typeof v === 'number' ? v : null;
}

/** Whether `add` more fit, with `used` already there. */
export function canUse(ent: Entitlements | null | undefined, key: LimitKey, used: number, add = 1): boolean {
  const limit = limitFor(ent, key);
  return limit === null || used + add <= limit;
}

/** Above the limit (after a downgrade): existing things stay, adding is refused. */
export function isOverLimit(ent: Entitlements | null | undefined, key: LimitKey, used: number): boolean {
  const limit = limitFor(ent, key);
  return limit !== null && used > limit;
}

const LIMIT_RE = /BW_PLAN_LIMIT:([a-z_]+)/;

/** The limit key in a server refusal (`BW_PLAN_LIMIT:<key>`, P2), or null. */
export function planLimitKey(error: { message?: string | null; hint?: string | null; details?: string | null } | null | undefined): LimitKey | null {
  if (!error) return null;
  for (const s of [error.message, error.details, error.hint]) {
    const m = typeof s === 'string' ? LIMIT_RE.exec(s) : null;
    if (m && (LIMIT_KEYS as readonly string[]).includes(m[1])) return m[1] as LimitKey;
  }
  return null;
}

// ------------------------------------------------------------- parsing --

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const SOURCES: readonly string[] = ['paddle', 'apple', 'google', 'grant', 'trial'];
const STATUSES: readonly string[] = ['active', 'trialing', 'past_due', 'paused', 'canceled', 'ended'];

/** What `bw_band_entitlements` returns, or null if unreadable. */
export function parseEntitlements(v: unknown): Entitlements | null {
  if (!isObj(v)) return null;
  const limits: Record<string, number | null> = {};
  if (isObj(v.limits)) {
    for (const [k, n] of Object.entries(v.limits)) if (n === null || (typeof n === 'number' && Number.isFinite(n))) limits[k] = n;
  }
  const usage: Record<string, number> = {};
  if (isObj(v.usage)) {
    for (const [k, n] of Object.entries(v.usage)) if (typeof n === 'number' && Number.isFinite(n)) usage[k] = n;
  }
  const source = str(v.source);
  const status = str(v.status);
  return {
    enforced: v.enforced === true,
    plan: isPlan(v.plan) ? v.plan : 'free',
    source: source && SOURCES.includes(source) ? (source as PlanSource) : null,
    status: status && STATUSES.includes(status) ? (status as PlanStatus) : null,
    trialEndsAt: str(v.trial_ends_at),
    grantUntil: str(v.grant_until),
    isPayer: v.is_payer === true,
    isAdmin: v.is_admin === true,
    limits,
    usage,
    checkout: v.checkout === true,
    notice: isObj(v.notice) ? v.notice : null,
  };
}

// ------------------------------------------------ local (demo) answer --

export interface LocalPlanInput {
  switches: { key: string; enabled: boolean }[];
  planLimits: { plan: string; key: string; value: number | null }[];
  settings: { key: string; value: unknown }[];
  bandPlan: BandPlanRow | null;
  payerUserId: string | null;
  userId: string;
  isMember: boolean;
  isAdmin: boolean;
  now: Date;
}

/** `bw_band_entitlements` computed from local rows (demo mode), same rules as the SQL. */
export function computeEntitlements(input: LocalPlanInput): Entitlements | null {
  if (!input.isMember) return null;
  const sw = (key: string) => input.switches.some((s) => s.key === key && s.enabled === true);
  const setting = (key: string) => input.settings.find((s) => s.key === key)?.value;
  const grace = setting('grace_days');
  const plan = resolvePlan(input.bandPlan, input.now, typeof grace === 'number' ? grace : null);
  const enforced = sw('plans_enforced');
  const limits: Record<string, number | null> = {};
  for (const l of input.planLimits) if (l.plan === plan) limits[l.key] = l.value;
  const admin = input.isAdmin;
  const row = input.bandPlan;
  const notice = setting('launch_notice');
  return {
    enforced,
    plan,
    source: admin && row && SOURCES.includes(row.source) ? (row.source as PlanSource) : null,
    status: admin && row && STATUSES.includes(row.status) ? (row.status as PlanStatus) : null,
    trialEndsAt: admin ? row?.trial_ends_at ?? null : null,
    grantUntil: admin ? row?.grant_until ?? null : null,
    isPayer: !!input.payerUserId && input.payerUserId === input.userId,
    isAdmin: admin,
    limits,
    usage: {},
    checkout: admin && sw('plans_checkout'),
    notice: admin && !enforced && isObj(notice) ? notice : null,
  };
}

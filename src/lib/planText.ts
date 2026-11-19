/**
 * Words for the band's plan (Settings → Plan, the launch notice). Pure: the
 * plan comes from `usePlan` (bw_band_entitlements). Members see the plan
 * only; prices never appear in the app (they come from Paddle on the web).
 */
import { APP_URL } from '@/lib/appUrl';
import { dateName, t } from '@/lib/i18n';
import { limitFor, type Entitlements, type LimitKey } from '@/lib/plans';

/** The web page with the plans and the checkout (P6). Never linked from iOS. */
export const PLAN_SITE_URL = `${APP_URL}/plans`;

/** Product names stay English. While the plans are off every band is on Free. */
export function planName(ent: Entitlements | null | undefined): string {
  if (!ent?.enforced) return 'Free';
  return ent.plan === 'pro' ? 'Pro' : ent.plan === 'maestro' ? 'Maestro' : 'Free';
}

const DAY_MS = 86_400_000;
const longDate = (iso: string) => dateName(new Date(iso), { day: 'numeric', month: 'long', year: 'numeric' }, 'en-GB');

/** One line under the plan's name. */
export function planLine(ent: Entitlements | null | undefined, now: Date): string {
  if (!ent) return t('Checking your band’s plan…');
  if (!ent.enforced) return t('Free during the beta: every tool, as your role allows.');
  if (!ent.isAdmin) return t('Your band is on {plan}. Your band admin looks after the plan.', { plan: planName(ent) });
  if (ent.plan === 'free') return t('Every tool, with limits on how many.');
  if (ent.source === 'trial' && ent.trialEndsAt) {
    const days = Math.max(1, Math.ceil((Date.parse(ent.trialEndsAt) - now.getTime()) / DAY_MS));
    return days === 1 ? t('Trial: 1 day left.') : t('Trial: {count} days left.', { count: days });
  }
  if (ent.source === 'grant') {
    return ent.grantUntil ? t('Offered by BandWith until {date}.', { date: longDate(ent.grantUntil) }) : t('Offered by BandWith.');
  }
  if (ent.status === 'past_due') return t('The last payment didn’t go through. Update the card to keep {plan}.', { plan: planName(ent) });
  return ent.isPayer ? t('Paid by you.') : t('Paid by another admin of the band.');
}

export interface PlanUsageRow {
  key: LimitKey;
  label: string;
  value: string;
  /** 0–1, for the meter. */
  fill: number;
  over: boolean;
}

/** The counted limits, in this order, for the meters. */
const METERED: { key: LimitKey; label: () => string; unit?: 'mb' }[] = [
  { key: 'quotes_sent_month', label: () => t('Quotes sent this month') },
  { key: 'contracts_sent_month', label: () => t('Contracts sent this month') },
  { key: 'deputies', label: () => t('Deputies') },
  { key: 'admins', label: () => t('Admins') },
  { key: 'custom_templates', label: () => t('Your own to-do lists') },
  { key: 'gear_items', label: () => t('Band gear') },
  { key: 'storage_mb', label: () => t('Storage'), unit: 'mb' },
];

/** Meters for admins while the plans are on: only limits with a number. */
export function planUsageRows(ent: Entitlements | null | undefined): PlanUsageRow[] {
  if (!ent?.enforced || !ent.isAdmin) return [];
  const rows: PlanUsageRow[] = [];
  for (const m of METERED) {
    const limit = ent.limits[m.key];
    if (typeof limit !== 'number') continue;
    const used = ent.usage[m.key] ?? 0;
    const vars = { used, limit };
    rows.push({
      key: m.key,
      label: m.label(),
      value: m.unit === 'mb' ? t('{used} of {limit} MB', vars) : t('{used} of {limit}', vars),
      fill: limit > 0 ? Math.min(1, used / limit) : 1,
      over: used > limit,
    });
  }
  return rows;
}

export interface PlanNotice {
  date: string;
}

/** The launch notice (§5.3): admins only, while the plans are off, with a date. */
export function planNotice(ent: Entitlements | null | undefined): PlanNotice | null {
  if (!ent || ent.enforced || !ent.isAdmin || !ent.notice) return null;
  const date = ent.notice.date;
  return typeof date === 'string' && !Number.isNaN(Date.parse(date)) ? { date } : null;
}

export const noticeDate = (n: PlanNotice): string => longDate(n.date);

// ------------------------------------------------------------ branding --

/** "Made with BandWith" on quote and setlist PDFs: plans on and `branding` = 0 (§4.3). */
export function madeWithMark(ent: Entitlements | null | undefined): boolean {
  return !!ent?.enforced && limitFor(ent, 'branding') === 0;
}

/**
 * The contract PDF's "Generated with BandWith" line, there since before the
 * plans: kept while they are off, dropped once the band's plan includes branding.
 */
export function bandWithFooter(ent: Entitlements | null | undefined): boolean {
  return !ent?.enforced || madeWithMark(ent);
}

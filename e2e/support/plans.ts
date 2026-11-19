import { expect, FIXED_NOW, type App } from '../fixtures';
import { escapeRe } from './flows';
import { hubRow, openHub } from './hub';

/**
 * Paid plans in the demo (src/lib/demo/demoClient.ts answers
 * bw_band_entitlements from its own rows): turn the plans on, give the band
 * a plan, open Settings → Plan.
 */
export type Db = Record<string, Record<string, unknown>[]>;

export const bandOf = (db: Db, me: string) => String(db.band_members.find((m) => m.user_id === me)?.band_id);
const DAY = 86_400_000;
export const daysFromNow = (days: number) => new Date(FIXED_NOW.getTime() + days * DAY).toISOString();

/** Plans switched on, with test limits (the real values live only in the database). */
export function switchPlansOn(db: Db) {
  db.platform_switches = [...(db.platform_switches ?? []).filter((r) => r.key !== 'plans_enforced'), { key: 'plans_enforced', enabled: true }];
  db.plan_limits = [
    { plan: 'free', key: 'deputies', value: 7 },
    { plan: 'free', key: 'storage_mb', value: 50 },
    { plan: 'pro', key: 'deputies', value: null },
  ];
}

/** The band's plan row (null = Free). A paid plan is paid by the demo user. */
export function setBandPlan(db: Db, me: string, row: Record<string, unknown> | null) {
  const band = bandOf(db, me);
  db.band_plans = (db.band_plans ?? []).filter((r) => r.band_id !== band);
  db.billing_accounts = (db.billing_accounts ?? []).filter((r) => r.id !== 'e2e-account');
  if (!row) return;
  if (row.source === 'paddle') {
    db.billing_accounts.push({ id: 'e2e-account', payer_user_id: me, plan: row.plan, status: row.status, provider: 'paddle' });
    db.band_plans.push({ band_id: band, billing_account_id: 'e2e-account', ...row });
  } else {
    db.band_plans.push({ band_id: band, ...row });
  }
}

export const planSection = (app: App) => app.page.getByTestId('plan-section').filter({ visible: true }).first();

/** Settings tab → hub → Settings & account → Plan. */
export async function openPlan(app: App) {
  await openHub(app);
  await hubRow(app, 'Settings & account').click();
  await app.settle();
  const row = app.page.getByRole('button', { name: new RegExp(`^${escapeRe(app.t('Plan'))}\\b`) }).filter({ visible: true }).first();
  await row.scrollIntoViewIfNeeded();
  await row.click();
  await app.settle();
  await expect(planSection(app)).toBeVisible();
}

import { test, expect, DEMO_USER_ID, type App } from '../fixtures';
import { bandOf, openPlan, planSection, switchPlansOn, type Db } from '../support/plans';

/**
 * Paid plans, P3a (docs/plans/paid-plans.md §5.1, §5.3): Settings → Plan and
 * the launch notice. The demo answers bw_band_entitlements from its own rows
 * (src/lib/demo/demoClient.ts), so a test turns the plans on by writing
 * platform_switches.plans_enforced, as the server would on 1 January. The
 * plan's lifecycle (trial, paid, past due, grant) is the band-plan model.
 */

const section = (app: App) => planSection(app);

const plansOn = (extra: (db: Db, band: string) => void = () => {}) => (db: Db, { me }: { me: string }) => {
  switchPlansOn(db);
  extra(db, bandOf(db, me));
};

test.describe('Plan, switched off (the beta)', () => {
  test('@smoke admin: Free during the beta, no meters, no prices', async ({ app }) => {
    await openPlan(app);
    await expect(section(app)).toContainText('Free');
    await expect(section(app)).toContainText(app.t('Free during the beta: every tool, as your role allows.'));
    await expect(section(app).getByRole('list', { name: app.t('What your band uses') })).toHaveCount(0);
    expect(await section(app).innerText()).not.toMatch(/€|\$|£/);
    await app.check('Plan (beta, admin)');
  });

  test('member: the same beta line', async ({ app }) => {
    await app.setRole('member');
    await openPlan(app);
    await expect(section(app)).toContainText(app.t('Free during the beta: every tool, as your role allows.'));
    await app.check('Plan (beta, member)');
  });
});

test.describe('Plan, switched on (demo)', () => {
  test('@smoke admin on Free: the meters of the counted limits', async ({ app }) => {
    await app.editDb(plansOn());
    await openPlan(app);
    await expect(section(app)).toContainText(app.t('Every tool, with limits on how many.'));
    const meters = section(app).getByRole('list', { name: app.t('What your band uses') });
    await expect(meters).toContainText(app.t('Deputies'));
    await expect(meters).toContainText(app.t('Storage'));
    // What the demo band has, counted like the server (bw_plan_count).
    const db = (await app.readDb()) as Db;
    const band = bandOf(db, DEMO_USER_ID);
    const deputies = (db.band_deputies ?? []).filter((d) => d.band_id === band).length;
    await expect(meters).toContainText(app.t('{used} of {limit}', { used: deputies, limit: 7 }));
    expect(await section(app).innerText()).not.toMatch(/€|\$|£/);
    await app.check('Plan (on, Free admin)');
  });

  test('admin on a Pro band offered by BandWith', async ({ app }) => {
    await app.editDb(
      plansOn((db, band) => {
        db.band_plans = [{ band_id: band, plan: 'pro', source: 'grant', status: 'active', grant_until: null }];
      }),
    );
    await openPlan(app);
    await expect(section(app)).toContainText('Pro');
    await expect(section(app)).toContainText(app.t('Offered by BandWith.'));
    await app.check('Plan (on, Pro grant)');
  });

  test('member: the plan only, never how it is paid', async ({ app }) => {
    await app.editDb(
      plansOn((db, band) => {
        db.band_plans = [{ band_id: band, plan: 'pro', source: 'grant', status: 'active', grant_until: null }];
      }),
    );
    await app.setRole('member');
    await openPlan(app);
    await expect(section(app)).toContainText(app.t('Your band is on {plan}. Your band admin looks after the plan.', { plan: 'Pro' }));
    await expect(section(app)).not.toContainText(app.t('Offered by BandWith.'));
    await expect(section(app).getByRole('list', { name: app.t('What your band uses') })).toHaveCount(0);
    await app.check('Plan (on, member)');
  });
});

test.describe('Launch notice on Home', () => {
  const withNotice = (db: Db) => {
    db.plan_settings = [{ key: 'launch_notice', value: { date: '2027-01-01' } }];
  };

  test('admin sees it while the plans are off, and can dismiss it', async ({ app }) => {
    await app.editDb(withNotice);
    const notice = app.page.getByTestId('plan-launch-notice').filter({ visible: true }).first();
    await notice.scrollIntoViewIfNeeded();
    await expect(notice).toContainText('2027');
    await app.check('Home with the launch notice');
    await app.page.getByRole('button', { name: app.t('Dismiss plans notice') }).filter({ visible: true }).first().click();
    await expect(app.page.getByTestId('plan-launch-notice').filter({ visible: true })).toHaveCount(0);
  });

  test('members never see it', async ({ app }) => {
    await app.editDb(withNotice);
    await app.setRole('member');
    await app.settle();
    await expect(app.page.getByTestId('plan-launch-notice')).toHaveCount(0);
  });
});

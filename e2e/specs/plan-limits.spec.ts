import { test, expect, DEMO_USER_ID, type App } from '../fixtures';
import { openEvent, SEED } from '../support/flows';
import { openHubPage } from '../support/hub';
import { bandOf, planSection, switchPlansOn, type Db } from '../support/plans';

/**
 * Paid plans, P3b (docs/plans/paid-plans.md §5.2): the limit prompt. The demo
 * refuses like the server's 161 (BW_PLAN_LIMIT:<key>) and reports it like
 * planAwareFetch does, so the prompt opens from the action that hit it.
 */

const prompt = (app: App) => app.page.getByTestId('plan-limit-sheet').filter({ visible: true });
const promptActions = (app: App) => app.page.getByTestId('plan-limit-actions').filter({ visible: true });

/**
 * A refusal the app did not cause itself (as planAwareFetch would report it).
 * The urgent pop-up of an unanswered invitation shows up a moment after
 * launch: it is closed first, like a person would, so the fixture's handler
 * never has to reach it under the prompt's scrim.
 */
async function refuse(app: App, key: string, used?: number, limit?: number) {
  const urgent = app.page.getByRole('button', { name: app.t('Dismiss alert'), exact: true });
  if (await urgent.waitFor({ state: 'visible', timeout: 3_000 }).then(() => true, () => false)) {
    await urgent.click().catch(() => {});
    await expect(urgent).toHaveCount(0);
  }
  await app.page.evaluate(
    ([k, u, l]) => window.dispatchEvent(new CustomEvent('bw:plan-limit', { detail: { key: k, used: u, limit: l } })),
    [key, used ?? null, limit ?? null] as const,
  );
}

/** Plans on, the band's gear full at what the demo already has. */
const gearFull = (db: Db) => {
  switchPlansOn(db);
  const band = bandOf(db, DEMO_USER_ID);
  const bandGear = (db.inventory ?? []).filter((r) => r.band_id === band && !r.owner_id).length;
  db.plan_limits.push({ plan: 'free', key: 'gear_items', value: bandGear });
};

test.describe('Limit prompt (admin)', () => {
  test('@smoke one more band gear item than the plan allows: the prompt, the item kept, the way to the plan', async ({ app }) => {
    await app.editDb(gearFull);
    await openHubPage(app, 'Gear & inventory');
    await app.page.getByRole('button', { name: app.t('Add equipment'), exact: true }).first().click();
    const sheet = app.page.getByRole('dialog').filter({ has: app.page.getByPlaceholder(app.t('e.g. Vocal mic, drum kit, DI box')) });
    await sheet.getByPlaceholder(app.t('e.g. Vocal mic, drum kit, DI box')).fill('Spare IEM pack');
    await sheet.getByRole('button', { name: app.t('Save item'), exact: true }).click();

    await expect(prompt(app)).toBeVisible();
    await expect(prompt(app)).toHaveAttribute('data-key', 'gear_items');
    await expect(app.page.getByRole('heading', { name: app.t('No room for more band gear') })).toBeVisible();
    expect(await prompt(app).innerText()).not.toMatch(/€|\$|£/);
    await app.check('Limit prompt: band gear');

    // Not now: the item sheet is still there, with what was typed and the reason.
    await promptActions(app).getByRole('button', { name: app.t('Not now') }).click();
    await expect(prompt(app)).toHaveCount(0);
    await expect(sheet.getByPlaceholder(app.t('e.g. Vocal mic, drum kit, DI box'))).toHaveValue('Spare IEM pack');
    await expect(sheet).toContainText(app.t('Your band’s plan has no room for this.'));

    // Saving again, then the way to the plan.
    await sheet.getByRole('button', { name: app.t('Save item'), exact: true }).click();
    await promptActions(app).getByRole('button', { name: app.t('See your plan') }).click();
    await expect(planSection(app)).toBeVisible();
  });

  test('a second Free band: the account wording, no way to a plan from here', async ({ app }) => {
    await app.editDb((db) => switchPlansOn(db));
    await refuse(app, 'bands_as_admin');
    await expect(prompt(app)).toBeVisible();
    await expect(app.page.getByRole('heading', { name: app.t('One Free band per account') })).toBeVisible();
    await expect(promptActions(app).getByRole('button', { name: app.t('See your plan') })).toHaveCount(0);
    await app.check('Limit prompt: second band');
    await promptActions(app).getByRole('button', { name: app.t('OK') }).click();
    await expect(prompt(app)).toHaveCount(0);
  });
});

test.describe('Limit prompt (member)', () => {
  test('@smoke a member is told to ask the band admin: no plan, no prices, one button', async ({ app }) => {
    await app.editDb((db) => switchPlansOn(db));
    await app.setRole('member');
    await refuse(app, 'deputies', 7, 7);
    await expect(prompt(app)).toBeVisible();
    await expect(prompt(app)).toContainText(app.t('Your band’s plan has no room for this. Ask your band admin about the plan.'));
    await expect(promptActions(app).getByRole('button')).toHaveCount(1);
    expect(await prompt(app).innerText()).not.toMatch(/€|\$|£/);
    await app.check('Limit prompt: member');
  });
});

test.describe('Limit prompt and Stage mode', () => {
  test('never over Stage mode', async ({ app }) => {
    await app.editDb((db) => switchPlansOn(db));
    await openEvent(app, SEED.gigToday);
    await app.button('Open stage mode', { exact: true }).first().click();
    await expect(app.page.locator('.bw-stage').first()).toBeAttached();
    await app.settle();
    await refuse(app, 'deputies', 7, 7);
    await app.settle();
    await expect(app.page.getByTestId('plan-limit-sheet')).toHaveCount(0);
  });
});

test.describe('Analytics window (analytics_days)', () => {
  const note = (app: App) => app.page.getByTestId('analytics-window').filter({ visible: true });
  /** Home → View Analytics (in the Duo Laptop pose, on the Band desk's Deck). */
  const openAnalytics = async (app: App) => {
    await app.button('View Analytics', { exact: true }).first().click();
    await app.settle();
  };

  test('@smoke on a plan with a window: the last days only, and a note about older history', async ({ app }) => {
    await app.editDb((db) => {
      switchPlansOn(db);
      db.plan_limits.push({ plan: 'free', key: 'analytics_days', value: 30 });
    });
    await openAnalytics(app);
    await expect(note(app)).toBeVisible();
    await expect(note(app)).toContainText(app.t('Your plan shows the last {days} days. Older history is on Pro.', { days: 30 }));
    expect(await note(app).innerText()).not.toMatch(/€|\$|£/);
    await app.check('Analytics with a window');
  });

  test('plans off (the beta): everything, no note', async ({ app }) => {
    await openAnalytics(app);
    await expect(app.page.getByRole('heading', { name: app.t('Monthly breakdown') }).filter({ visible: true }).first()).toBeVisible();
    await expect(app.page.getByTestId('analytics-window')).toHaveCount(0);
  });
});

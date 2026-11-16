import { test, expect, type App } from '../fixtures';
import { escapeRe } from '../support/flows';
import { goBack, hubRow, openHub, openHubPage } from '../support/hub';

/**
 * The Account hub (Settings) and its pages: Members, Pricing (every tab),
 * Deputy gigs, Contracts & docs. Members see only what is theirs.
 */

const PRICING_TABS = ['LINEUP & RATES', 'SETS & ADD-ONS', 'TRAVEL & SOUND', 'RULES & TAX', 'BRANDING & PAYMENT'];
const pricingTab = (app: App, label: string) =>
  app.page.getByRole('button', { name: new RegExp(`^${escapeRe(app.t(label))}(\\s+\\d+)?$`, 'i') }).first();

test.describe('Account hub as admin', () => {
  test('@smoke the hub lists identity, band, band assets and app settings', async ({ app }) => {
    await openHub(app);
    for (const row of ['Deputy gigs', 'Repertoire', 'Gear & inventory', 'Contracts & docs', 'To-do lists']) {
      await expect(hubRow(app, row), row).toBeVisible();
    }
    await expect(app.page.getByRole('button', { name: new RegExp(`^${escapeRe(app.t('Members'))} \\(\\d+\\)`) }).first()).toBeVisible();
    await expect(app.page.getByRole('button', { name: new RegExp(`^${escapeRe(app.t('PRICING, FEES & SERVICES'))}`, 'i') }).first()).toBeVisible();
    await app.check('Account hub');
  });

  test('Members: the list opens a member and comes back', async ({ app }) => {
    await openHub(app);
    await app.page.getByRole('button', { name: new RegExp(`^${escapeRe(app.t('Members'))} \\(\\d+\\)`) }).first().click();
    await app.settle();
    await expect(app.page.getByRole('button', { name: 'Open Marta C.' })).toBeVisible();
    await expect(app.page.getByRole('button', { name: app.t('Invite member') }).first()).toBeVisible();
    await app.check('Members');
    await app.page.getByRole('button', { name: 'Open Marta C.' }).click();
    await app.settle();
    await expect(app.page.getByText('Marta C.').first()).toBeVisible();
    await app.check('member detail');
  });

  test('Pricing: every tab opens, healthy, and shows Save changes', async ({ app }) => {
    await openHub(app);
    await app.page.getByRole('button', { name: new RegExp(`^${escapeRe(app.t('PRICING, FEES & SERVICES'))}`, 'i') }).first().click();
    await app.settle();
    for (const tab of PRICING_TABS) {
      await test.step(tab, async () => {
        await pricingTab(app, tab).click();
        await expect(pricingTab(app, tab)).toHaveAttribute('aria-pressed', 'true');
        for (const other of PRICING_TABS.filter((o) => o !== tab)) {
          await expect(pricingTab(app, other)).toHaveAttribute('aria-pressed', 'false');
        }
        await expect(app.page.getByRole('button', { name: new RegExp(`^${escapeRe(app.t('SAVE CHANGES'))}$`, 'i') }).first()).toBeVisible();
        await app.check(`Pricing: ${tab}`);
      });
    }
    await app.page.getByRole('button', { name: app.t('Close pricing') }).first().click();
    await app.settle();
    await expect(hubRow(app, 'Gear & inventory')).toBeVisible();
  });

  test('Deputy gigs: the request from another band can be answered', async ({ app }) => {
    await openHubPage(app, 'Deputy gigs');
    await expect(app.button('YES').first()).toBeVisible();
    await expect(app.button("NO, I CAN'T").first()).toBeVisible();
    await app.check('Deputy gigs');
    await goBack(app).catch(async () => {
      await app.page.getByRole('button', { name: app.t('Back'), exact: true }).last().click();
    });
    await expect(hubRow(app, 'Deputy gigs')).toBeVisible();
  });

  test('Contracts & docs: filters and a document, never "Seen"', async ({ app }) => {
    await openHubPage(app, 'Contracts & docs');
    const docs = /Wedding performance agreement/i;
    await expect(app.page.getByRole('button', { name: docs }).first()).toBeVisible();
    await app.page.getByRole('button', { name: new RegExp(`^${escapeRe(app.t('RIDERS'))}`, 'i') }).first().click();
    await expect(app.page.getByRole('button', { name: /^STAGE & TECH RIDER/i }).first()).toBeVisible();
    await expect(app.page.getByRole('button', { name: /^WEDDING PERFORMANCE AGREEMENT/i })).toHaveCount(0);
    await app.page.getByRole('button', { name: new RegExp(`^${escapeRe(app.t('ALL'))}`, 'i') }).first().click();
    expect(await app.page.locator('body').innerText()).not.toMatch(/\bseen\b/i);
    await app.check('Contracts & docs');

    await app.page.getByRole('button', { name: /^WEDDING PERFORMANCE AGREEMENT/i }).first().click();
    await app.settle();
    expect(await app.page.locator('body').innerText()).not.toMatch(/\bseen\b/i);
    await app.check('a contract');
  });
});

test.describe('Account hub as member', () => {
  test.use({ role: 'member' });

  test('@smoke a member sees no band settings, pricing or contracts, and no invite', async ({ app }) => {
    await openHub(app);
    await expect(hubRow(app, 'Gear & inventory')).toBeVisible();
    await expect(app.page.getByRole('button', { name: new RegExp(`^${escapeRe(app.t('PRICING, FEES & SERVICES'))}`, 'i') })).toHaveCount(0);
    await expect(app.page.getByRole('button', { name: new RegExp(`^${escapeRe(app.t('BAND SETTINGS'))}$`, 'i') })).toHaveCount(0);
    await expect(app.page.getByRole('button', { name: new RegExp(`^${escapeRe(app.t('Contracts & docs'))}`, 'i') })).toHaveCount(0);
    await app.check('Account hub (member)');

    await app.page.getByRole('button', { name: new RegExp(`^${escapeRe(app.t('Members'))} \\(\\d+\\)`) }).first().click();
    await app.settle();
    await expect(app.page.getByRole('button', { name: 'Open Marta C.' })).toBeVisible();
    await expect(app.page.getByRole('button', { name: app.t('Invite member') })).toHaveCount(0);
    await expect(app.page.getByRole('button', { name: app.t('Add deputy') })).toHaveCount(0);
    await app.check('Members (member)');
  });
});

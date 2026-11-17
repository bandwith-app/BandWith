import type { Locator } from '@playwright/test';
import { test, expect, type App } from '../fixtures';
import { escapeRe } from '../support/flows';
import { openChatTab, openHub } from '../support/hub';

/**
 * Duo in Laptop pose: the full-screen layers the Account hub opens sit on
 * top of the page they were opened from, and keep their rows off the fold.
 *
 * Seen on the EV Duo simulator (1.0.6 gate): from Home or Calendar,
 * "Settings & account" left the page on screen. Its layer is z-70 like the
 * page's own FoldSplit (Band desk, Planner), which comes later in #root, and
 * only a `.bw-pane-hub` makes that split step aside; Settings was a hub only
 * when two-pane. From Chat (no split) Settings showed, but its "Privacy &
 * account" row rested on the fold band.
 */

const PAGES = ['Home', 'Calendar', 'Chat'] as const;
type Source = (typeof PAGES)[number];

async function goTo(app: App, page: Source) {
  if (page === 'Chat') await openChatTab(app);
  else await app.tab(page);
}

/**
 * A hub row, scrolled onto the Deck (under the pinned header, above the Deck
 * bar) and tapped there, as a person does.
 */
async function tapHubRow(app: App, row: Locator, deckTop: number) {
  // The hub slides up: measure once it rests.
  await app.settle();
  await row.evaluate((el, y) => {
    let s = el.parentElement;
    while (s && !/(auto|scroll)/.test(getComputedStyle(s).overflowY)) s = s.parentElement;
    if (s) s.scrollTop += el.getBoundingClientRect().top - y;
  }, deckTop + 24);
  // The hub header shrinks once scrolled: let it, then tap where the row rests.
  await app.settle();
  await row.click();
  await app.settle();
}

/** A row of the Account hub itself (the page under it has look-alikes). */
const hubRow = (app: App, source: string | RegExp): Locator =>
  app.page
    .locator('.bw-pane-hub')
    .filter({ has: app.page.getByRole('heading', { name: app.t('Who you are'), exact: true }) })
    .getByRole('button', { name: typeof source === 'string' ? new RegExp(`^${escapeRe(app.t(source))}`, 'i') : source })
    .first();

/** Tags the page's own fold splits, so a test can tell them from the layer's. */
async function markPageSplits(app: App) {
  await app.page.evaluate(() => {
    document.querySelectorAll('.bw-fold-split').forEach((e) => e.setAttribute('data-e2e-page-split', ''));
  });
}

/** Nothing of the page's splits is on top anywhere on the screen. */
async function expectPageCovered(app: App, where: string) {
  const onTop = await app.page.evaluate(() => {
    const hits: string[] = [];
    for (let y = 40; y < innerHeight - 120; y += 60) {
      for (const x of [innerWidth * 0.25, innerWidth * 0.5, innerWidth * 0.75]) {
        const t = document.elementFromPoint(x, y);
        if (t && t.closest('[data-e2e-page-split]')) hits.push(`${Math.round(x)},${y}`);
      }
    }
    return hits;
  });
  expect(onTop, `${where}: the page under it is on top at ${onTop.join(' ')}`).toEqual([]);
}

/** The element is the top-most thing at its own centre (can be tapped). */
async function expectOnTop(el: Locator, what: string) {
  await expect(el).toBeVisible();
  const top = await el.evaluate((e) => {
    const r = e.getBoundingClientRect();
    const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { ok: !!t && (t === e || e.contains(t)), at: `${Math.round(r.top)}–${Math.round(r.bottom)}` };
  });
  expect(top.ok, `${what} (${top.at}) is covered`).toBe(true);
}

test.describe('Duo Laptop pose: Account hub layers on top', () => {
  for (const page of PAGES) {
    test(`@laptop Settings & account opened from ${page} sits on top, its rows off the fold`, async ({ app, duo }) => {
      await goTo(app, page);
      await markPageSplits(app);
      await openHub(app);
      await tapHubRow(app, hubRow(app, 'Settings & account'), duo!.foldBand!.bottom);
      const title = app.page.getByRole('heading', { name: app.t('App settings'), exact: true }).filter({ visible: true }).first();
      await expectOnTop(title, 'the App settings title');
      await expectPageCovered(app, `Settings from ${page}`);
      // Every section row can be tapped where it rests: scrolled into the
      // Deck, never on the fold band (app.check measures the band).
      for (const row of ['Notifications', 'Appearance', 'Privacy & account', 'Language', 'About']) {
        const btn = app.page.getByRole('button', { name: new RegExp(`^${escapeRe(app.t(row))}`) }).filter({ visible: true }).first();
        await btn.scrollIntoViewIfNeeded();
        await app.check(`Settings from ${page}: ${row} in view`);
        await btn.click({ trial: true });
      }
      await app.page.getByRole('button', { name: new RegExp(`^${escapeRe(app.t('Privacy & account'))}`) }).filter({ visible: true }).first().click();
      await app.settle();
      await expectOnTop(
        app.page.getByRole('heading', { name: app.t('Privacy & account'), exact: true }).filter({ visible: true }).first(),
        'the Privacy & account title',
      );
      await expectPageCovered(app, `Privacy & account from ${page}`);
      await app.check(`Privacy & account from ${page}`);
    });
  }

  // The other full-screen layers the hub opens, from the page with a split.
  for (const [row, title] of [
    ['Help & support', 'Help & support'],
    ['Deputy gigs', null],
    ['Repertoire', null],
    ['Gear & inventory', null],
    ['Contracts & docs', null],
    ['To-do lists', null],
  ] as const) {
    test(`@laptop ${row} opened from Home sits on top`, async ({ app, duo }) => {
      await app.tab('Home');
      await markPageSplits(app);
      await openHub(app);
      await tapHubRow(app, hubRow(app, row), duo!.foldBand!.bottom);
      if (title) await expectOnTop(app.page.getByRole('heading', { name: app.t(title), exact: true }).filter({ visible: true }).first(), `the ${title} title`);
      await expectPageCovered(app, `${row} from Home`);
      await app.check(`${row} from Home`);
    });
  }

  test('@laptop Members opened from Home sits on top', async ({ app, duo }) => {
    await app.tab('Home');
    await markPageSplits(app);
    await openHub(app);
    await tapHubRow(app, hubRow(app, new RegExp(`^${escapeRe(app.t('Members'))} \\(\\d+\\)`)), duo!.foldBand!.bottom);
    await expectPageCovered(app, 'Members from Home');
    await app.check('Members from Home');
  });

  test('@laptop Pricing opened from Home sits on top', async ({ app, duo }) => {
    await app.tab('Home');
    await markPageSplits(app);
    await openHub(app);
    await tapHubRow(app, hubRow(app, 'PRICING, FEES & SERVICES'), duo!.foldBand!.bottom);
    await expectPageCovered(app, 'Pricing from Home');
    await app.check('Pricing from Home');
  });
});

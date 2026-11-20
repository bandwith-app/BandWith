import AxeBuilder from '@axe-core/playwright';
import { test, expect, type App } from '../fixtures';
import { openEvent, eventDetail, isWide, leaveBand, openCreate, SEED } from '../support/flows';
import { editSheet, openEditor } from '../support/event';

/**
 * Accessibility (axe, WCAG 2.0/2.1 A and AA) on the screens the screen-map
 * crawler flagged: no critical or serious violation. A layer on top is
 * scanned on its own (what is under it is covered).
 *
 * Phone portrait (the Calendar month grid on the Duo in Laptop pose).
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function scan(app: App, where: string, layer?: import('@playwright/test').Locator | string) {
  // A CSS selector instead of a locator: for layers the fixture would close
  // as soon as a locator touches the page (tours), so only page.evaluate here.
  if (typeof layer === 'string') {
    await app.page.waitForFunction((sel) => {
      let o = 1;
      for (let n = document.querySelector(sel); n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
      return !!document.querySelector(sel) && o === 1;
    }, layer);
    await app.page.evaluate((sel) => {
      document.querySelectorAll('[data-a11y-scan]').forEach((x) => x.removeAttribute('data-a11y-scan'));
      document.querySelector(sel)!.setAttribute('data-a11y-scan', '');
    }, layer);
    await app.settle();
    return analyze(app, where, true);
  }
  // axe blends text with the opacity of its ancestors: a layer still fading
  // in (opacity 0 → 1 as it opens) fails color-contrast on every line. Wait
  // until the layer is fully opaque, then until nothing moves.
  if (layer) {
    await expect
      .poll(() =>
        layer.evaluate((e) => {
          let o = 1;
          for (let n: Element | null = e; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
          return o;
        }),
      )
      .toBe(1);
  }
  await app.settle();
  if (layer) {
    await layer.evaluate((e) => {
      document.querySelectorAll('[data-a11y-scan]').forEach((x) => x.removeAttribute('data-a11y-scan'));
      e.setAttribute('data-a11y-scan', '');
    });
  }
  return analyze(app, where, !!layer);
}

async function analyze(app: App, where: string, layer: boolean) {
  let builder = new AxeBuilder({ page: app.page }).setLegacyMode(true).withTags(TAGS);
  if (layer) builder = builder.include('[data-a11y-scan]');
  const { violations } = await builder.analyze();
  // The app chrome (bell, profile, the Duo rail's tabs) has no exception:
  // a count or initials on a button's face are part of its name (WCAG 2.5.3).
  const bad = violations
    .filter((v) => v.impact === 'critical' || v.impact === 'serious')
    .map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(' ') + ' ' + n.html.slice(0, 160)).join(' | ')}`);
  // Soft: one run lists every screen that fails.
  expect.soft(bad, `axe on "${where}"`).toEqual([]);
}

test.describe('axe: no critical or serious violations', () => {
  test.beforeEach(async ({ app }, info) => {
    test.skip(info.project.name !== 'phone-portrait' || (await isWide(app)), 'phone portrait');
  });

  test('Home', async ({ app }) => {
    await scan(app, 'Home');
  });

  test('Home with the profile initials showing', async ({ app }) => {
    // The profile button shows the initials for a second on Home (then
    // flips to the photo) and again on hover: its name holds the initials,
    // so both faces pass.
    await app.page.getByRole('button', { name: app.t('Open Identity and Account Hub') }).hover();
    await scan(app, 'Home (initials)');
  });

  test('Quotes, with an accepted quote on its coloured card', async ({ app }) => {
    // The accepted card is the quote tint (#9A8878): its client and date line
    // were black at 70% opacity, 4.2:1.
    await app.page.getByRole('button', { name: new RegExp(app.t('ACTIVE QUOTES'), 'i') }).first().click();
    await expect(app.page.getByRole('heading', { name: app.t('All quotes') })).toBeVisible();
    await scan(app, 'Quotes');
  });

  test('an availability check and a personal gig', async ({ app }) => {
    for (const title of [SEED.tentativeGig, SEED.personal]) {
      await openEvent(app, title);
      await scan(app, title, eventDetail(app));
      await app.page.keyboard.press('Escape');
    }
  });

  test('Calendar', async ({ app }) => {
    await app.tab('Calendar');
    await expect(app.page.getByRole('button', { name: new RegExp(SEED.gigToday) }).first()).toBeVisible();
    await scan(app, 'Calendar');
  });

  test('a gig: overview, Venue & location, Lineup and Setlist sheets', async ({ app }) => {
    await openEvent(app, SEED.gigToday);
    await scan(app, SEED.gigToday, eventDetail(app));
    const venue = await openEditor(app, eventDetail(app).getByRole('button', { name: app.t('Edit venue') }), 'Venue & location');
    await scan(app, 'Venue & location', venue);
    await app.page.keyboard.press('Escape');
    await expect(venue).toBeHidden();
    for (const [row, title] of [
      [/Lineup · \d+ of \d+ confirmed/, 'Lineup'],
      [/Setlist · \d+ songs/, 'Setlist'],
    ] as const) {
      await eventDetail(app).getByRole('button', { name: row }).click();
      const sheet = app.page.getByRole('dialog').last();
      await expect(sheet).toBeVisible();
      await scan(app, title, sheet);
      await app.page.keyboard.press('Escape');
      await expect(app.page.locator('[data-a11y-scan]')).toHaveCount(0);
    }
  });

  test('a rehearsal overview', async ({ app }) => {
    await openEvent(app, SEED.rehearsalTomorrow);
    await scan(app, SEED.rehearsalTomorrow, eventDetail(app));
  });

  test('Suggestions', async ({ app }) => {
    await app.page.getByRole('button', { name: /^Notifications/ }).filter({ visible: true }).first().click();
    await app.page.getByRole('button', { name: /Lyrics correction/ }).first().click();
    // The notification opens that suggestion (the list only shows while it
    // loads): wait for the detail itself, not for the list's heading.
    const view = app.page.getByRole('dialog', { name: app.t('Suggestions') });
    await expect(view.getByRole('group', { name: app.t('Before and after') })).toBeVisible();
    await scan(app, 'Suggestion', view);
    // Back in the view: the list with its Waiting / Reviewed picker.
    await view.getByRole('button', { name: app.t('Back'), exact: true }).first().click();
    await expect(view.getByRole('group', { name: app.t('Suggestions') })).toBeVisible();
    await scan(app, 'Suggestions', view);
  });

  test('New rehearsal', async ({ app }) => {
    await openCreate(app, 'New rehearsal');
    await scan(app, 'New rehearsal', app.page.locator('.bw-pane-detail').last());
  });
});

test.describe('axe: iPad', () => {
  test('New rehearsal (one-screen composer with the free-slot strip)', async ({ app }, info) => {
    test.skip(info.project.name !== 'ipad-landscape', 'the iPad composer');
    await openCreate(app, 'New rehearsal');
    const slot = app.page.getByLabel(/^\d{2}:\d{2}: \d+ of \d+ free$/).first();
    await expect(slot).toBeVisible();
    // The composer, not the gig open beside it.
    await scan(app, 'New rehearsal', app.page.getByRole('dialog').filter({ has: slot }));
  });
});

test.describe('axe: Duo Laptop pose', () => {
  test('@laptop a gig\'s Lineup and Setlist sheets (they scroll here)', async ({ app }) => {
    await openEvent(app, SEED.gigToday);
    for (const [row, title] of [
      [/Lineup · \d+ of \d+ confirmed/, 'Lineup'],
      [/Setlist · \d+ songs/, 'Setlist'],
    ] as const) {
      await eventDetail(app).getByRole('button', { name: row }).click();
      const sheet = app.page.getByRole('dialog').last();
      await expect(sheet).toBeVisible();
      await scan(app, title, sheet);
      await app.page.keyboard.press('Escape');
      await expect(app.page.locator('[data-a11y-scan]')).toHaveCount(0);
    }
  });

  test('@laptop a notification\'s detail (its pane scrolls)', async ({ app }) => {
    // The detail scrolls on its own on the Deck: a keyboard user must be able
    // to reach it (axe scrollable-region-focusable, seen on the Duo).
    await app.page.getByRole('button', { name: /^Notifications/ }).filter({ visible: true }).first().click();
    await app.page.getByRole('button', { name: new RegExp(SEED.tentativeGig) }).first().click();
    const detail = app.page.locator('.bw-pane-detail').filter({ hasText: SEED.tentativeGig }).last();
    await expect(detail).toBeVisible();
    await scan(app, `Notification: ${SEED.tentativeGig}`, detail);
  });

  test('@laptop an availability check', async ({ app }) => {
    await openEvent(app, SEED.tentativeGig);
    await scan(app, SEED.tentativeGig);
  });

  test('@laptop Calendar month grid', async ({ app }) => {
    await app.tab('Calendar');
    await expect(app.page.getByRole('grid').first()).toBeVisible();
    await scan(app, 'Calendar month grid');
  });

  // The first-run tours split over the fold: the dark sheet on the Deck, the
  // step's title on the Display. The title kept the dark theme's white on the
  // light Display (#fff on #E5E3E0, 1.2:1): seen on the Duo simulator.
  for (const role of ['deputy', 'admin', 'member'] as const) {
    test(`@laptop the ${role} tour reads on both screens`, async ({ app }) => {
      if (role === 'deputy') await leaveBand(app, true);
      else {
        if (role === 'member') await app.setRole('member');
        await app.page.evaluate((r) => localStorage.removeItem(`bw-role-tour-seen:${r}`), role);
        await app.page.reload();
      }
      // No expect() on the tour: the fixture closes tours as soon as one shows to an action or assertion.
      await app.page.waitForFunction(() => !!document.querySelector('.bw-fold-split .bw-fold-display #role-tour-title'), null, { timeout: 30_000 });
      await app.settle();
      const low = await app.page.evaluate(() => {
        const rgb = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number);
        const lum = ([r, g, b]: number[]) => {
          const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
          return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
        };
        const bgOf = (el: Element | null): number[] => {
          for (; el; el = el.parentElement) {
            const c = rgb(getComputedStyle(el).backgroundColor);
            if (c.length >= 3 && (c[3] ?? 1) > 0.9) return c;
          }
          return [255, 255, 255];
        };
        const out: string[] = [];
        const split = document.querySelector('#role-tour-title')!.closest('.bw-fold-split')!;
        const walker = document.createTreeWalker(split, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const el = n.parentElement!;
          if (!n.textContent?.trim() || !el.getClientRects().length) continue;
          const cs = getComputedStyle(el);
          const [l1, l2] = [lum(rgb(cs.color)), lum(bgOf(el))].sort((a, b) => b - a);
          const ratio = (l1 + 0.05) / (l2 + 0.05);
          const size = parseFloat(cs.fontSize);
          const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
          if (ratio < (large ? 3 : 4.5)) out.push(`"${n.textContent.trim().slice(0, 40)}" ${cs.color} on rgb(${bgOf(el).join(',')}) = ${ratio.toFixed(2)}:1`);
        }
        return out;
      });
      expect(low, `${role} tour: text below WCAG AA contrast`).toEqual([]);
      await scan(app, `${role} tour`, '.bw-fold-split:has(#role-tour-title)');
    });
  }
});

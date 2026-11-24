import { expect, test, type Page } from '@playwright/test';

/**
 * "The small things" on the channel pages: three numbered panels with the
 * product, then a spec sheet of one-line items under mono labels (the bento
 * of text is gone). site/test/pages.test.ts checks the content and the
 * markup; here, what only a browser can tell: the layout at each width, the
 * captures really load and are fitted, and the lines are set at a reading size.
 */
const quiet = async (page: Page) => {
  await page.route('**/api/geo', (r) => r.fulfill({ json: { country: null, region: '' } }));
  await page.addInitScript(() => {
    try { localStorage.setItem('bw-site-lang', 'no'); localStorage.setItem('bw-site-consent', 'denied'); } catch { /* private mode */ }
  });
};
const SLUGS = ['calendar-gigs', 'quotes-contracts', 'money', 'rehearsals-polls', 'chat', 'songs', 'stage', 'stage-plot-rider', 'people', 'privacy', 'devices'];

test.describe('capability sections', () => {
  test.beforeEach(async ({ page }) => { await quiet(page); });

  test('stage: three panels then the spec sheet, laid out for the screen', async ({ page }, info) => {
    await page.goto('/features/stage/');
    const sec = page.locator('section.details');
    await sec.scrollIntoViewIfNeeded();
    await expect(sec.locator('.bento')).toHaveCount(0);
    const feats = sec.locator('.feats > .feat');
    await expect(feats).toHaveCount(3);
    await expect(feats.locator('.feat__no')).toHaveText(['01', '02', '03']);
    await expect(feats.nth(0).locator('.feat__t')).toHaveText('Follow the tempo');
    await expect(sec.locator('.spec__head')).toContainText('And ten more');
    await expect(sec.locator('.spec__l')).toHaveText([/Keeping time\s*2/, /On your own screen\s*4/, /Running the set\s*4/]);
    await expect(sec.locator('.spec__i')).toHaveCount(10);

    // Layout positions (offsets), not painted ones: the panels rise into place as they are revealed.
    const boxes = await feats.evaluateAll((els) => els.map((e) => ({ x: (e as HTMLElement).offsetLeft, y: (e as HTMLElement).offsetTop })));
    const item = sec.locator('.spec__i p').first();
    const size = await item.evaluate((p) => parseFloat(getComputedStyle(p).fontSize));
    if (info.project.name === 'site-desktop') {
      // Side by side, one row.
      expect(new Set(boxes.map((b) => Math.round(b.y))).size).toBe(1);
      expect(boxes[0].x).toBeLessThan(boxes[1].x);
      // A comfortable reading size and measure: 18px, 45–75 characters a line.
      expect(size).toBeGreaterThanOrEqual(18);
      const chars = await item.evaluate((p) => p.getBoundingClientRect().width / (parseFloat(getComputedStyle(p).fontSize) * 0.48));
      expect(chars).toBeGreaterThan(45);
      expect(chars).toBeLessThan(75);
      // Two columns of lines beside the label.
      const xs = await sec.locator('.spec__g').first().locator('.spec__i').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().x)));
      expect(new Set(xs).size).toBe(2);
    } else {
      // Stacked on a phone, one scan path.
      expect(new Set(boxes.map((b) => Math.round(b.x))).size).toBe(1);
      expect(boxes[0].y).toBeLessThan(boxes[1].y);
      expect(size).toBeGreaterThanOrEqual(16);
      const xs = await sec.locator('.spec__i').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().x)));
      expect(new Set(xs).size).toBe(1);
    }
  });

  for (const slug of SLUGS) {
    test(`${slug}: the panels show the product and nothing runs off the page`, async ({ page }) => {
      await page.goto(`/features/${slug}/`);
      const sec = page.locator('section.details');
      await sec.scrollIntoViewIfNeeded();
      const feats = sec.locator('.feats > .feat');
      await expect(feats).toHaveCount(3);
      for (let i = 0; i < 3; i++) {
        const ui = feats.nth(i).locator('.feat__ui');
        const img = ui.locator('img.crop__img');
        if (await img.count()) {
          await ui.scrollIntoViewIfNeeded();
          // The capture loaded, and the crop component fitted it into its box (a transform is set).
          await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
          await expect.poll(() => ui.locator('.crop').evaluate((el) => getComputedStyle(el).getPropertyValue('--crop-t').includes('scale'))).toBe(true);
          const [box, pic] = await ui.locator('.crop').evaluate((el) => {
            const b = el.getBoundingClientRect();
            const p = el.querySelector('img')!.getBoundingClientRect();
            return [b, p].map((r) => ({ l: r.left, t: r.top, r: r.right, b: r.bottom }));
          });
          // No gap at the sides: the screen covers the width of its window.
          expect(pic.l).toBeLessThanOrEqual(box.l + 1);
          expect(pic.r).toBeGreaterThanOrEqual(box.r - 1);
        } else {
          await expect(ui).toHaveAttribute('role', 'img');
          // A drawn fragment stays inside its panel.
          const over = await ui.evaluate((el) => [...el.querySelectorAll('*')].some((c) => {
            const r = c.getBoundingClientRect();
            const b = el.getBoundingClientRect();
            return r.width > 0 && (r.right > b.right + 1 || r.left < b.left - 1);
          }));
          expect(over, 'a fragment part runs out of the panel').toBe(false);
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    });
  }

  test('italian: the drawn fragments speak the page’s language, lyrics stay as written', async ({ page }) => {
    await page.goto('/it/features/stage/');
    const sec = page.locator('section.details');
    await sec.scrollIntoViewIfNeeded();
    await expect(sec.locator('.fr-next')).toHaveText('Poi: Ritornello tra 2 battute');
    await expect(sec.locator('.fr-off b')).toHaveText('Offline: 4 membri pronti su 5');
    await expect(sec.locator('.fr-lyr .is-on')).toHaveText('Salt and silver on the shore');
    await expect(sec.locator('.spec__head')).toContainText('E altre dieci');
    // "In riproduzione" is longer than "Now playing": it still fits its small phone.
    const over = await sec.locator('.fr-mini').evaluateAll((els) => els.some((el) => el.scrollWidth > el.clientWidth + 1));
    expect(over).toBe(false);
  });
});

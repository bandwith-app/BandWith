import { expect, test, type Page } from '@playwright/test';

/**
 * No photos on the site: the mark is the layout of a channel hero, "One gig"
 * on Home runs on three flat fields with seven time cells. The markup is
 * checked in site/test/no-photos.test.ts; here, what needs a browser: nothing
 * asks the network for a photo, the mark is whole on a phone (never cut by
 * the edge of the screen), the fields have their colours, the cells follow
 * the night, and reduced motion stacks the night.
 */
const quiet = async (page: Page) => {
  await page.route('**/api/geo', (r) => r.fulfill({ json: { country: null, region: '' } }));
  await page.addInitScript(() => {
    try { localStorage.setItem('bw-site-lang', 'no'); localStorage.setItem('bw-site-consent', 'denied'); } catch { /* private mode */ }
  });
};
const LIME = 'rgb(213, 251, 70)';
const SLUGS = ['calendar-gigs', 'quotes-contracts', 'money', 'rehearsals-polls', 'chat', 'songs', 'stage', 'stage-plot-rider', 'people', 'privacy', 'devices'];

test.describe('no photos', () => {
  test.beforeEach(async ({ page }) => { await quiet(page); });

  for (const url of ['/', '/features/stage/']) {
    test(`${url}: no request for a photo, from top to bottom`, async ({ page }) => {
      const asked: string[] = [];
      page.on('request', (r) => { if (/\/photos\//.test(r.url())) asked.push(r.url()); });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(url);
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 700) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 40)); }
      });
      expect(asked).toEqual([]);
      expect(await page.locator('.photo, img[src*="/photos/"]').count()).toBe(0);
    });
  }

  for (const lang of ['', '/it', '/es']) {
    test(`${lang || '/en'}: on every channel page the mark is whole and the title stays in its column`, async ({ page }) => {
      test.slow();
      await page.emulateMedia({ reducedMotion: 'reduce' });
      for (const slug of SLUGS) {
        await page.goto(`${lang}/features/${slug}/`);
        const m = await page.evaluate(() => {
          const mark = document.querySelector('.fhero__mark')!.getBoundingClientRect();
          const parts = [...document.querySelectorAll('.fhero__mark .mk__c, .fhero__mark .mk__tall')].map((el) => el.getBoundingClientRect());
          const copy = document.querySelector('.fhero__copy')!.getBoundingClientRect();
          const title = [...document.querySelectorAll('.fhero__title, .fhero__title *')].map((el) => el.getBoundingClientRect());
          return {
            vw: window.innerWidth, left: mark.left, right: mark.right,
            cells: parts.length, square: parts.slice(0, 6).every((r) => Math.abs(r.width - r.height) < 1 && r.width > 60),
            inside: parts.every((r) => r.left >= -0.5 && r.right <= window.innerWidth + 0.5),
            titleOut: Math.max(0, ...title.filter((r) => r.width).map((r) => Math.max(r.right - copy.right, copy.left - r.left))),
            overflow: document.documentElement.scrollWidth - window.innerWidth,
          };
        });
        // Seven shapes, all of them on screen: the mark is scaled to the page, never cropped by it.
        expect(m.cells, slug).toBe(7);
        expect(m.square, `${slug}: six square cells`).toBe(true);
        expect(m.inside, `${slug}: mark ${m.left}..${m.right} of ${m.vw}`).toBe(true);
        expect(m.titleOut, `${slug}: title leaves its column`).toBeLessThanOrEqual(1);
        expect(m.overflow, slug).toBeLessThanOrEqual(0);
      }
    });
  }

  test('stage: the screen loads in the tall cell, the first chip is the lime cell, the band is lime', async ({ page }, info) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/features/stage/');
    const img = page.locator('.fhero__mark .mk__tall img');
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    // The whole capture, not a piece of it: the tall cell has a phone's shape.
    const shape = await page.locator('.mk__screen').evaluate((el) => { const r = el.getBoundingClientRect(); return r.height / r.width; });
    expect(shape).toBeCloseTo(1688 / 780, 1);
    const lime = page.locator('.fhero__mark .mk__c--lime');
    await expect(lime).toHaveCSS('background-color', LIME);
    const phone = info.project.name === 'site-phone';
    // Beside the mark the cells carry the chips' words; on a phone the list above them does.
    await expect(lime.locator('span')).toBeVisible({ visible: !phone });
    if (phone) await expect(page.locator('.fhero__chips li').first()).toBeVisible();
    else expect(await page.locator('.fhero__chips').evaluate((el) => el.getBoundingClientRect().width)).toBeLessThanOrEqual(1);
    await expect(page.locator('.fhero__chips li')).toHaveText(['Lead', 'Follow', 'Visual click', 'Works without Wi‑Fi']);

    const band = page.locator('section.band');
    await band.scrollIntoViewIfNeeded();
    await expect(band).toHaveCSS('background-color', LIME);
    await expect(band.locator('.band__h')).toHaveCSS('color', 'rgb(0, 0, 0)');
    // The step in view is the lit cell.
    await expect(page.locator('.flow__step.is-on .flow__n')).toHaveCSS('background-color', LIME);
  });

  test('home: with reduced motion the night is stacked and each card keeps its field', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const night = page.locator('#night');
    await night.scrollIntoViewIfNeeded();
    await expect(night).not.toHaveClass(/is-pinned/);
    const scenes = night.locator('[data-night-scene]');
    await expect(scenes).toHaveCount(7);
    const fields = await scenes.evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
    expect(fields[4]).toBe(LIME);                 // 21:00, the show
    expect(fields[3]).toBe('rgb(242, 240, 237)'); // 17:00, load-in, on paper
    expect(fields[6]).toBe(fields[3]);            // 23:45, the pay
    expect(new Set([fields[0], fields[1], fields[2], fields[5]]).size).toBe(1);
    // Stacked: one under the other, each with its own time.
    const tops = await scenes.evaluateAll((els) => els.map((e) => (e as HTMLElement).offsetTop));
    expect([...tops].sort((a, b) => a - b)).toEqual(tops);
    expect(new Set(tops).size).toBe(7);
    await expect(scenes.nth(4).locator('.nt__time .cell')).toHaveText('21:00');
    await expect(night.locator('.night__cells')).toBeHidden();
    // Ink on lime and on paper: the copy is black, not the grey it is on ink.
    await expect(scenes.nth(4).locator('.nt__title')).toHaveCSS('color', 'rgb(0, 0, 0)');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });

  test('home, desktop: the seven cells keep the time while the night slides', async ({ page }, info) => {
    test.skip(info.project.name !== 'site-desktop', 'the night pins on wide screens only');
    await page.goto('/');
    const night = page.locator('#night');
    await expect(night).toHaveClass(/is-pinned/);
    const cells = night.locator('[data-night-cell]');
    await expect(cells).toHaveText(['11:30', '14:02', '16:40', '17:00', '21:00', '22:10', '23:45']);
    const scrollTo = async (p: number) => {
      await page.evaluate((frac) => {
        const n = document.querySelector<HTMLElement>('#night')!;
        const t = document.querySelector<HTMLElement>('[data-night-track]')!;
        const top = n.getBoundingClientRect().top + window.scrollY;
        // A plain jump: a wheel event would hand the scroll to the smooth scroller, which resumes from where it last was.
        window.scrollTo(0, top + (t.scrollWidth - window.innerWidth) * frac);
      }, p);
    };
    await scrollTo(4 / 6);
    await expect(cells.nth(4)).toHaveClass(/is-on/);
    await expect(cells.nth(4)).toHaveCSS('background-color', LIME);
    await expect(cells.nth(5)).toHaveClass(/is-next/);
    await expect(cells.nth(3)).not.toHaveClass(/is-on|is-next/);
    await expect(night.locator('[data-night-scene].is-now')).toHaveAttribute('data-time', '21:00');
    await scrollTo(1);
    await expect(cells.nth(6)).toHaveClass(/is-on/);
    await expect(night.locator('.is-next')).toHaveCount(0);
  });
});

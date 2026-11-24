import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * What the site shows after the 11-22 release, in a real browser:
 * - the Stage demo: the click keeps flashing on the phone apps without
 *   internet (Bluetooth), never on the web app; Count in shows on every phone
 *   with a connection, and without one on the phone apps (Bluetooth, PR #311);
 * - the Money demo writes its log in the page's language for any order of taps;
 * - the Get page keeps the closed-beta blocks out of the page while open
 *   spots are left, and shows the right ones when they are gone;
 * - on a narrow phone the menu button stays inside the bar in every language,
 *   and the hero notice keeps its square LED when it wraps.
 */

type State = 'open' | 'invites' | 'full';
const CAP: Record<State, object> = {
  open: { cap: 300, reserved: 45, taken: 60, public_left: 195, invite_left: 240, state: 'open' },
  invites: { cap: 300, reserved: 45, taken: 271, public_left: 0, invite_left: 29, state: 'invites' },
  full: { cap: 300, reserved: 45, taken: 300, public_left: 0, invite_left: 0, state: 'full' },
};

async function open(browser: Browser, url: string, o: { width?: number; height?: number; state?: State } = {}): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: o.width ?? 1440, height: o.height ?? 900 }, locale: 'en-US', reducedMotion: 'reduce',
  });
  await context.addInitScript(() => {
    try { localStorage.setItem('bw-site-consent', 'denied'); localStorage.setItem('bw-site-lang', 'en'); } catch { /* storage blocked */ }
  });
  const page = await context.newPage();
  await page.route(/googletagmanager\.com|google-analytics\.com/, (r) => r.fulfill({ status: 204, body: '' }));
  await page.route('**/api/geo', (r) => r.fulfill({ contentType: 'application/json', body: '{"country":null}' }));
  await page.route('**/rest/v1/rpc/bw_capacity_status', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(CAP[o.state ?? 'open']) }));
  // ?capacity=… previews a state where the build has no counter of its own.
  await page.goto(o.state ? `${url}${url.includes('?') ? '&' : '?'}capacity=${o.state}` : url);
  return page;
}

test.beforeEach(({}, info) => { test.skip(info.project.name !== 'site-desktop', 'each test opens its own screen'); });

test.describe('Stage demo: the click and the count-in over Bluetooth', () => {
  const phone = (page: Page, who: string) => page.locator(who === 'leo' ? '[data-sd-leader] .sdp' : `[data-sd-member="${who}"] .sdp`);

  test('without the venue Wi‑Fi the click still starts, and flashes on the phone apps only', async ({ browser }) => {
    const page = await open(browser, '/features/stage/');
    const demo = page.locator('[data-stage-demo]');
    await demo.scrollIntoViewIfNeeded();
    await demo.locator('[data-sd-wifi]').click();
    await expect(demo.locator('[data-sd-note]')).toContainText('with the click and the count-in, over Bluetooth');
    await expect(demo.locator('[data-sd-note]')).toContainText('The web app has no Bluetooth');
    await expect(demo.locator('[data-sd-note]')).not.toContainText(/click needs the internet|needs a connection|only the leader/);
    const click = demo.locator('[data-act="click"]');
    await expect(click).toBeEnabled();
    await click.click();
    await expect(click).toHaveAttribute('aria-pressed', 'true');
    // Leo (leader), Sara (iPhone) and Nico (Android) flash; Tom's web app is offline.
    for (const who of ['leo', 'sara', 'nico']) await expect(phone(page, who), who).toHaveClass(/\bbeat1?\b/);
    await expect(phone(page, 'tom')).not.toHaveClass(/\bbeat1?\b/);
    await expect(phone(page, 'tom')).toHaveClass(/is-off/);
    await expect(demo.locator('[data-sd-log] li').first()).toContainText('over Bluetooth · the web app misses it');
    // Back online the web app gets it too, and the click never stopped.
    await demo.locator('[data-sd-wifi]').click();
    await expect(click).toHaveAttribute('aria-pressed', 'true');
    await expect(phone(page, 'tom')).toHaveClass(/\bbeat1?\b/);
    await page.context().close();
  });

  test('Count in: on every phone with a connection, on the phone apps over Bluetooth without one', async ({ browser }) => {
    const page = await open(browser, '/features/stage/');
    const demo = page.locator('[data-stage-demo]');
    await demo.scrollIntoViewIfNeeded();
    const count = demo.locator('[data-act="count"]');
    await count.click();
    await expect(demo.locator('[data-sd-count]')).toHaveCount(4);
    await expect(demo.locator('[data-sd-log] li').first()).toContainText('on every phone');
    // It runs to Go and clears by itself (5 beats at 100 BPM).
    await expect(demo.locator('[data-sd-count] .is-go')).toHaveCount(4, { timeout: 6000 });
    await expect(demo.locator('[data-sd-count]')).toHaveCount(0, { timeout: 6000 });
    await expect(count).toHaveAttribute('aria-pressed', 'false');

    // No internet: Leo, Sara (iPhone) and Nico (Android) count together; Tom's web app shows nothing.
    await demo.locator('[data-sd-wifi]').click();
    await count.click();
    await expect(demo.locator('[data-sd-count]')).toHaveCount(3);
    for (const who of ['leo', 'sara', 'nico']) await expect(phone(page, who).locator('[data-sd-count]'), who).toHaveCount(1);
    await expect(phone(page, 'tom').locator('[data-sd-count]')).toHaveCount(0);
    await expect(demo.locator('[data-sd-log] li').first()).toContainText('over Bluetooth · the web app misses it');
    // The count-in never starts the click by itself.
    await expect(demo.locator('[data-act="click"]')).toHaveAttribute('aria-pressed', 'false');
    // Count in again stops it on every phone.
    await count.click();
    await expect(demo.locator('[data-sd-count]')).toHaveCount(0);
    // Wi‑Fi back in the middle of a count: the web app joins on the beat the others are on.
    await count.click();
    await expect(demo.locator('[data-sd-count]')).toHaveCount(3);
    await demo.locator('[data-sd-wifi]').click();
    await expect(demo.locator('[data-sd-count]')).toHaveCount(4);
    const shown = await demo.locator('[data-sd-count] b').allTextContents();
    expect(new Set(shown).size, shown.join(' ')).toBe(1);
    // Another song ends it.
    await demo.locator('[data-act="next"]').click();
    await expect(demo.locator('[data-sd-count]')).toHaveCount(0);
    await page.context().close();
  });

  for (const lang of ['it', 'es'] as const) {
    test(`/${lang}/: the demo's new words are in the page's language`, async ({ browser }) => {
      const page = await open(browser, `/${lang}/features/stage/`);
      const demo = page.locator('[data-stage-demo]');
      await demo.scrollIntoViewIfNeeded();
      await expect(demo.locator('[data-act="count"]')).toHaveText(lang === 'it' ? 'Conta' : 'Cuenta');
      await demo.locator('[data-sd-wifi]').click();
      await demo.locator('[data-act="click"]').click();
      await demo.locator('[data-act="count"]').click();
      await expect(demo.locator('[data-sd-count] .is-go').first()).toHaveText(lang === 'it' ? 'Via' : 'Ya', { timeout: 6000 });
      await expect(demo.locator('[data-sd-count]')).toHaveCount(0, { timeout: 6000 });
      const misses = await page.evaluate(() => [...((window as unknown as { __bwI18nMisses?: Set<string> }).__bwI18nMisses ?? [])]);
      expect(misses).toEqual([]);
      await expect(demo).not.toContainText(/Bluetooth · the web app|Count-in|needs a connection|has no Bluetooth/);
      await page.context().close();
    });
  }
});

test.describe('Money demo: the log in the page’s language, in any order of taps', () => {
  for (const lang of ['it', 'es'] as const) {
    test(`/${lang}/features/money/: last musician first, then back to pending`, async ({ browser }) => {
      const page = await open(browser, `/${lang}/features/money/`);
      const demo = page.locator('#try');
      await demo.scrollIntoViewIfNeeded();
      const sw = (id: string) => demo.locator(`[data-md-act="toggle"][data-id="${id}"]`);
      const last = demo.locator('[data-md-log] li').first();
      await sw('ivo').click(); // not the scripted order (Leo first)
      await expect(last).toContainText(lang === 'it' ? 'Ivo M. pagato · mancano ancora 1.720 €' : 'Ivo M. pagado · quedan 1720 € por pagar');
      await sw('sara').click();
      await expect(last).toContainText(lang === 'it' ? 'Sara pagata · mancano ancora 1.320 €' : 'Sara pagada · quedan 1320 € por pagar');
      await sw('ivo').click(); // back to pending
      await expect(last).toContainText(lang === 'it' ? 'Ivo M. torna in attesa · mancano ancora 1.500 €' : 'Ivo M. vuelve a pendiente · quedan 1500 € por pagar');
      for (const id of ['tom', 'nico', 'ivo', 'leo']) await sw(id).click();
      await expect(last).toContainText(lang === 'it' ? 'Leo M. pagato · tutti pagati' : 'Leo M. pagado · todos pagados');
      await expect(demo.locator('[data-md-log]')).not.toContainText(/\bpaid\b|still due|back to pending/);
      const misses = await page.evaluate(() => [...((window as unknown as { __bwI18nMisses?: Set<string> }).__bwI18nMisses ?? [])]);
      expect(misses).toEqual([]);
      await page.context().close();
    });
  }
});

test.describe('Get page: the closed-beta blocks', () => {
  test('open: the waitlist and the invite lines are not on the page at all', async ({ browser }) => {
    const page = await open(browser, '/get/', { state: 'open' });
    await expect(page.locator('[data-cap-meter] i').first()).toBeAttached();
    for (const sel of ['#waitlist', '.full__inv-open', '.full__inv-shut', '.gdoors__inv']) await expect(page.locator(sel), sel).toHaveAttribute('hidden', '');
    // What a reader, a screen reader or a crawler that runs the page gets: no "full" anywhere.
    const text = await page.locator('main').innerText();
    expect(text).not.toMatch(/Tonight’s show is full|Sold out tonight|Your spot is kept|taken too|Your door is still open/i);
    await page.context().close();
  });

  test('invites only: the waitlist, "your spot is kept" and the open door line', async ({ browser }) => {
    const page = await open(browser, '/get/', { state: 'invites' });
    await expect(page.locator('#waitlist')).toBeVisible();
    await expect(page.locator('.full__inv-open')).toBeVisible();
    await expect(page.locator('.full__inv-shut')).toBeHidden();
    await expect(page.locator('.gdoors__inv')).toBeVisible();
    await page.context().close();
  });

  test('full: the waitlist and "the invite spots are taken too"', async ({ browser }) => {
    const page = await open(browser, '/get/', { state: 'full' });
    await expect(page.locator('#waitlist')).toBeVisible();
    await expect(page.locator('.full__inv-shut')).toBeVisible();
    await expect(page.locator('.full__inv-open')).toBeHidden();
    await expect(page.locator('.gdoors__inv')).toBeHidden();
    await page.context().close();
  });
});

test.describe('narrow phones', () => {
  for (const lang of ['en', 'it', 'es'] as const) {
    for (const width of [375, 360, 320]) {
      test(`${lang} at ${width}px: the menu button sits inside the bar, next to the app button`, async ({ browser }) => {
        const page = await open(browser, lang === 'en' ? '/' : `/${lang}/`, { width, height: 812 });
        const box = async (sel: string) => (await page.locator(sel).first().boundingBox())!;
        const [nav, cta, menu, brand] = [await box('.nav'), await box('.nav__cta'), await box('.nav__menu'), await box('.nav__brand')];
        expect(menu.x + menu.width, 'menu button inside the bar').toBeLessThanOrEqual(nav.x + nav.width - 4);
        expect(cta.x + cta.width, 'app button before the menu button').toBeLessThanOrEqual(menu.x);
        expect(brand.x + brand.width, 'brand before the app button').toBeLessThanOrEqual(cta.x);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
        await page.context().close();
      });
    }
  }

  for (const lang of ['en', 'it', 'es'] as const) {
    test(`${lang} at 375px, beta closed: the hero notice wraps and its LED stays square`, async ({ browser }) => {
      const page = await open(browser, lang === 'en' ? '/' : `/${lang}/`, { width: 375, height: 812, state: 'invites' });
      const notice = page.locator('.hero__cap');
      await expect(notice).toBeVisible();
      const led = (await notice.locator('.cap-line__led').boundingBox())!;
      const text = (await notice.locator('[data-cap-text]').boundingBox())!;
      expect(text.height, 'the notice takes more than one line').toBeGreaterThan(24);
      expect(Math.round(led.width)).toBe(7);
      expect(Math.round(led.height)).toBe(7);
      // On the first line, not floating in the middle of the block.
      expect(led.y - text.y).toBeLessThan(12);
      await page.context().close();
    });
  }
});

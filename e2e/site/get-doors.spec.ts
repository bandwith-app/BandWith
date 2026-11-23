import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

/**
 * The new visitor's path, on a phone (375×812):
 * - While open spots are left the site says "Open beta" and the home hero
 *   shows no spots count; with only invites, or nobody, getting in it says
 *   "Private beta" and the notice is back.
 * - /get/: the three doors come right under the headline, the visitor's own
 *   door first (TestFlight on iPhone and iPad, the APK on Android, the web
 *   app anywhere else), decided before the first paint: no page script needed.
 *   The counter sits with "Why a limit?"; it returns to the top when the open
 *   spots are gone.
 * - The analytics banner is compact on a phone: it never covers the first door.
 */

const PHONE = { width: 375, height: 812 };
const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  // iPadOS Safari and a Mac send the same string.
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
};
type State = 'open' | 'invites' | 'full';
const CAP: Record<State, object> = {
  open: { cap: 300, reserved: 45, taken: 60, public_left: 195, invite_left: 240, state: 'open' },
  invites: { cap: 300, reserved: 45, taken: 271, public_left: 0, invite_left: 29, state: 'invites' },
  full: { cap: 300, reserved: 45, taken: 300, public_left: 0, invite_left: 0, state: 'full' },
};

type Visitor = {
  ua?: string; touch?: number; viewport?: { width: number; height: number }; state?: State; consent?: 'denied' | null; noModules?: boolean;
  /** With the page's motion (the default visitor asks for reduced motion: same layout and words, a much lighter page to run). */
  motion?: boolean;
};

/** A visitor's browser: its own user agent, screen and touch points; the network answered here. */
async function visitor(browser: Browser, v: Visitor = {}): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    userAgent: v.ua ?? UA.windows,
    viewport: v.viewport ?? PHONE,
    locale: 'en-US',
    reducedMotion: v.motion ? 'no-preference' : 'reduce',
  });
  await context.addInitScript(([touch, consent]) => {
    Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => touch, configurable: true });
    try {
      localStorage.setItem('bw-site-lang', 'en');
      if (consent) localStorage.setItem('bw-site-consent', consent);
    } catch { /* storage blocked */ }
  }, [v.touch ?? 0, v.consent === undefined ? 'denied' : v.consent] as const);
  const page = await context.newPage();
  await page.route(/googletagmanager\.com|google-analytics\.com/, (r) => r.fulfill({ status: 204, body: '' }));
  await page.route('**/api/geo', (r) => r.fulfill({ contentType: 'application/json', body: '{"country":null}' }));
  await page.route('**/rest/v1/rpc/bw_capacity_status', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(CAP[v.state ?? 'open']) }));
  // Without the page's own scripts: what the HTML and its inline scripts do alone.
  if (v.noModules) await page.route(/\/assets\/[^?]+\.js(\?|$)/, (r) => r.abort());
  return { context, page };
}

const doorIds = (page: Page) => page.locator('[data-doors] > .gdoor').evaluateAll((els) => els.map((e) => e.id));
const doorNumbers = (page: Page) => page.locator('[data-doors] > .gdoor [data-door-no]').evaluateAll((els) => els.map((e) => e.textContent?.trim()));
/** The doors as the eye meets them, top to bottom, then left to right. */
const doorsOnScreen = (page: Page) => page.locator('[data-doors] > .gdoor').evaluateAll((els) =>
  els.map((e) => ({ id: e.id, r: e.getBoundingClientRect() })).sort((a, b) => a.r.top - b.r.top || a.r.left - b.r.left).map((x) => x.id));
const top = async (page: Page, sel: string) => (await page.locator(sel).first().boundingBox())!.y + (await page.evaluate(() => window.scrollY));
/** The capacity answer is on the page (the meter is drawn in the same step as every label and counter). */
const ready = (page: Page) => expect(page.locator('[data-cap-meter] i').first()).toBeAttached();

test.describe('Get page: the visitor’s own door first', () => {
  test.beforeEach(({}, info) => { test.skip(info.project.name !== 'site-desktop', 'each test opens its own device'); });

  const cases: [string, Visitor, string[]][] = [
    ['iPhone', { ua: UA.iphone, touch: 5 }, ['ios', 'web', 'android']],
    ['iPad (says it is a Mac, has a touch screen)', { ua: UA.mac, touch: 5, viewport: { width: 1024, height: 1366 } }, ['ios', 'web', 'android']],
    ['Android', { ua: UA.android, touch: 5 }, ['android', 'web', 'ios']],
    ['a Mac', { ua: UA.mac, touch: 0, viewport: { width: 1440, height: 900 } }, ['web', 'android', 'ios']],
    ['a Windows laptop with a touch screen', { ua: UA.windows, touch: 10, viewport: { width: 1440, height: 900 } }, ['web', 'android', 'ios']],
  ];
  for (const [name, v, order] of cases) {
    test(`${name}: ${order.join(', ')}`, async ({ browser }) => {
      const { context, page } = await visitor(browser, v);
      await page.goto('/get/');
      await ready(page);
      expect(await doorIds(page)).toEqual(order);
      expect(await doorsOnScreen(page)).toEqual(order);
      expect(await doorNumbers(page)).toEqual(['Door 01', 'Door 02', 'Door 03']);
      await context.close();
    });
  }

  test('the order is set by the page itself, before its scripts load', async ({ browser }) => {
    const { context, page } = await visitor(browser, { ua: UA.iphone, touch: 5, noModules: true });
    await page.goto('/get/', { waitUntil: 'domcontentloaded' });
    expect(await doorIds(page)).toEqual(['ios', 'web', 'android']);
    expect(await doorNumbers(page)).toEqual(['Door 01', 'Door 02', 'Door 03']);
    await expect(page.locator('html')).toHaveAttribute('data-device', 'ios');
    await context.close();
  });

  for (const [lang, word] of [['it', 'Porta'], ['es', 'Puerta']] as const) {
    test(`/${lang}/get/ on Android: numbered in order, in the page’s language`, async ({ browser }) => {
      const { context, page } = await visitor(browser, { ua: UA.android, touch: 5 });
      await page.goto(`/${lang}/get/`);
      await ready(page);
      expect(await doorIds(page)).toEqual(['android', 'web', 'ios']);
      expect(await doorNumbers(page)).toEqual([`${word} 01`, `${word} 02`, `${word} 03`]);
      await context.close();
    });
  }
});

test.describe('Get page on a phone: the action is on the first screen', () => {
  test.beforeEach(({}, info) => { test.skip(info.project.name !== 'site-desktop', 'each test opens its own device'); });

  for (const lang of ['', 'it/', 'es/']) {
    test(`/${lang}get/ on an iPhone: the TestFlight button shows without scrolling, above the cookie banner`, async ({ browser }) => {
      const { context, page } = await visitor(browser, { ua: UA.iphone, touch: 5, consent: null, motion: true });
      await page.goto(`/${lang}get/`);
      await ready(page);
      const banner = page.locator('[data-consent-banner]');
      await expect(banner).toBeVisible();
      await expect(banner).toHaveClass(/is-in/);
      await page.waitForTimeout(700);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      const btn = (await page.locator('[data-door="ios"]').boundingBox())!;
      const bar = (await banner.boundingBox())!;
      expect(btn.y).toBeGreaterThan(0);
      expect(btn.y + btn.height, 'button inside the first screen').toBeLessThanOrEqual(PHONE.height);
      expect(btn.y + btn.height, 'button above the banner').toBeLessThanOrEqual(bar.y);
      await context.close();
    });
  }

  test('on Android the APK button is the one on the first screen', async ({ browser }) => {
    const { context, page } = await visitor(browser, { ua: UA.android, touch: 5, consent: null, motion: true });
    await page.goto('/get/');
    await ready(page);
    const banner = page.locator('[data-consent-banner]');
    await expect(banner).toHaveClass(/is-in/);
    await page.waitForTimeout(700);
    const btn = (await page.locator('[data-door="android"]').boundingBox())!;
    expect(btn.y + btn.height).toBeLessThanOrEqual((await banner.boundingBox())!.y);
    await context.close();
  });
});

test.describe('Get page: doors first, the counter with "Why a limit?"', () => {
  test.beforeEach(({}, info) => { test.skip(info.project.name !== 'site-desktop', 'each test opens its own device'); });

  for (const viewport of [PHONE, { width: 1440, height: 900 }]) {
    test(`open, ${viewport.width}px: headline, doors, then the counter in the Why section`, async ({ browser }) => {
      const { context, page } = await visitor(browser, { viewport });
      await page.goto('/get/');
      await ready(page);
      await expect(page.locator('.gethead .label')).toHaveText('Open beta · free');
      await expect(page.locator('#waitlist')).toBeHidden();
      await expect(page.locator('#why [data-cap-block]')).toBeVisible();
      await expect(page.locator('.gethead [data-cap-block]')).toHaveCount(0);
      await expect(page.locator('#why [data-cap-num="left"]')).toHaveText('195');
      await expect(page.locator('#why [data-cap-num="kept"]')).toHaveText('45');
      await expect(page.locator('#why [data-cap-text]')).toHaveText('195 of 255 open spots left · 45 kept for band invites');
      expect(await top(page, '#get-h')).toBeLessThan(await top(page, '[data-doors]'));
      expect(await top(page, '[data-doors]')).toBeLessThan(await top(page, '[data-cap-block]'));
      // Nothing between the intro and the first door.
      const lead = (await page.locator('.gethead .lead').boundingBox())!;
      const first = (await page.locator('[data-doors] > .gdoor').first().boundingBox())!;
      expect(first.y - (lead.y + lead.height)).toBeLessThan(viewport.width < 700 ? 60 : 140);
      await context.close();
    });
  }

  for (const state of ['invites', 'full'] as const) {
    test(`${state}: the notice stays at the top, above the doors`, async ({ browser }) => {
      const { context, page } = await visitor(browser, { state, ua: UA.iphone, touch: 5 });
      await page.goto('/get/');
      await ready(page);
      await expect(page.locator('html')).toHaveClass(/is-full/);
      await expect(page.locator('.gethead .label')).toHaveText('Private beta · free');
      await expect(page.locator('.gethead [data-cap-block]')).toBeVisible();
      await expect(page.locator('#why [data-cap-block]')).toHaveCount(0);
      await expect(page.locator('.gethead [data-cap-text]')).toHaveText(
        state === 'full' ? 'Every spot is taken right now. Join the waitlist.' : /^Open spots are gone\. Invited by a band that’s already inside\? 29 spots are still kept for you\.$/,
      );
      await expect(page.locator('.gethead a[href="#why"]')).toBeVisible();
      await expect(page.locator('#waitlist')).toBeVisible();
      expect(await top(page, '[data-cap-block]')).toBeLessThan(await top(page, '#waitlist'));
      expect(await top(page, '#waitlist')).toBeLessThan(await top(page, '[data-doors]'));
      // An invited iPhone owner still finds TestFlight first among the doors.
      expect(await doorIds(page)).toEqual(['ios', 'web', 'android']);
      await context.close();
    });
  }
});

test.describe('open beta wording follows the capacity', () => {
  test.beforeEach(({}, info) => { test.skip(info.project.name !== 'site-desktop', 'each test opens its own device'); });

  const WORDS = {
    '': { open: 'Open beta', shut: 'Private beta' },
    'it/': { open: 'Beta aperta', shut: 'Beta privata' },
    'es/': { open: 'Beta abierta', shut: 'Beta privada' },
  } as const;

  for (const [lang, w] of Object.entries(WORDS)) {
    test(`/${lang}: open → "${w.open}", no spots count in the hero`, async ({ browser }) => {
      const { context, page } = await visitor(browser, { ua: UA.iphone, touch: 5 });
      await page.goto(`/${lang}`);
      await ready(page);
      await expect(page.locator('[data-hero-kicker]')).toHaveText(`${w.open} · iPhone · Android · Web`);
      await expect(page.locator('.hero [data-cap-line]')).toBeHidden();
      await expect(page.locator('#get .label')).toHaveText(w.open);
      // The limit is still told, further down, with the way to its explanation.
      await expect(page.locator('#get [data-cap-line]')).toBeVisible();
      await expect(page.locator('#get a[href$="/get/#why"]')).toBeVisible();
      await expect(page.locator('.menu__note')).toHaveText(new RegExp(`^${w.open} · `));
      expect(await page.locator('main').innerText()).not.toMatch(/private beta|beta privata|beta privada/i);
      await context.close();
    });

    for (const state of ['invites', 'full'] as const) {
      test(`/${lang}: ${state} → "${w.shut}", the hero says so`, async ({ browser }) => {
        const { context, page } = await visitor(browser, { ua: UA.iphone, touch: 5, state });
        await page.goto(`/${lang}`);
        await ready(page);
        await expect(page.locator('[data-hero-kicker]')).toHaveText(`${w.shut} · iPhone · Android · Web`);
        await expect(page.locator('.hero [data-cap-line]')).toBeVisible();
        await expect(page.locator('.hero [data-cap-text]')).not.toHaveText('');
        await expect(page.locator('#get .label')).toHaveText(w.shut);
        await expect(page.locator('.menu__note')).toHaveText(new RegExp(`^${w.shut} · `));
        expect(await page.evaluate(() => [...((window as unknown as { __bwI18nMisses?: Set<string> }).__bwI18nMisses ?? [])])).toEqual([]);
        await context.close();
      });
    }
  }
});

test.describe('cookie banner on a phone', () => {
  test.beforeEach(({}, info) => { test.skip(info.project.name !== 'site-desktop', 'each test opens its own device'); });

  for (const lang of ['', 'it/', 'es/']) {
    test(`/${lang}: compact at 375px, Reject and Accept side by side, the policy link kept`, async ({ browser }) => {
      const { context, page } = await visitor(browser, { ua: UA.iphone, touch: 5, consent: null });
      await page.goto(`/${lang}`);
      const banner = page.locator('[data-consent-banner]');
      await expect(banner).toHaveClass(/is-in/);
      await page.waitForTimeout(700);
      const box = (await banner.boundingBox())!;
      expect(box.height, 'banner height').toBeLessThanOrEqual(120);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width);
      const a = (await banner.locator('[data-consent="accept"]').boundingBox())!;
      const r = (await banner.locator('[data-consent="reject"]').boundingBox())!;
      expect(Math.round(a.y)).toBe(Math.round(r.y));
      expect(Math.round(a.width)).toBe(Math.round(r.width));
      expect(Math.round(a.height)).toBe(Math.round(r.height));
      expect(a.height).toBeGreaterThanOrEqual(40);
      expect(r.x + r.width).toBeLessThanOrEqual(a.x);
      // It says what is asked, by whom, and where to read more.
      await expect(banner).toContainText('Google Analytics');
      const policy = banner.locator('a');
      await expect(policy).toBeVisible();
      await expect(policy).toHaveAttribute('href', /^https:\/\/app\.bandwith\.fun\/legal\/privacy(-it|-es)?\.html$/);
      // Nothing of it is cut off or pushed out of the card.
      expect(await banner.evaluate((el) => el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      await context.close();
    });
  }

  test('a desktop keeps the full explanation', async ({ browser }) => {
    const { context, page } = await visitor(browser, { viewport: { width: 1440, height: 900 }, consent: null });
    await page.goto('/');
    const banner = page.locator('[data-consent-banner]');
    await expect(banner).toHaveClass(/is-in/);
    await expect(banner).toContainText('We’d like to use Google Analytics to see which pages help musicians. It sets cookies only if you accept. No ads, and we never sell data.');
    await expect(banner.locator('.cns__short')).toBeHidden();
    await context.close();
  });

  test('the phone banner still asks before anything goes to Google, and Accept still turns it on', async ({ browser }) => {
    const { context, page } = await visitor(browser, { ua: UA.iphone, touch: 5, consent: null });
    const google: string[] = [];
    page.on('request', (r) => { if (/googletagmanager\.com|google-analytics\.com/.test(r.url())) google.push(r.url()); });
    await page.goto('/get/');
    const banner = page.locator('[data-consent-banner]');
    await expect(banner).toHaveClass(/is-in/);
    await page.waitForTimeout(800);
    expect(google).toEqual([]);
    await expect(page.locator('html')).toHaveAttribute('data-consent', 'pending');
    await banner.locator('[data-consent="accept"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-consent', 'granted');
    await expect.poll(() => google.filter((u) => u.includes('gtag/js?id=G-GCWSEQRZ2E')).length).toBe(1);
    await expect(banner).toBeHidden();
    await context.close();
  });
});

test.describe('on the suite’s own devices', () => {
  test('the phone (WebKit, iPhone) gets TestFlight first; the desktop gets the web app', async ({ page }, info) => {
    await page.route(/googletagmanager\.com|google-analytics\.com/, (r) => r.fulfill({ status: 204, body: '' }));
    await page.route('**/api/geo', (r) => r.fulfill({ contentType: 'application/json', body: '{"country":null}' }));
    await page.route('**/rest/v1/rpc/bw_capacity_status', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(CAP.open) }));
    await page.goto('/get/');
    await ready(page);
    const phone = info.project.name === 'site-phone';
    expect(await doorIds(page)).toEqual(phone ? ['ios', 'web', 'android'] : ['web', 'android', 'ios']);
    expect(await doorNumbers(page)).toEqual(['Door 01', 'Door 02', 'Door 03']);
    await expect(page.locator('[data-doors] > .gdoor').first().locator('.gdoor__btn')).toBeVisible();
  });
});

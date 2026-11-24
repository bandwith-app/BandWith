import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

/**
 * The path to sign-up after the site review of 2026-11-23, in a real browser:
 * - home hero: the web app is the main button on every device ("Start free
 *   in your browser", with the spot it was clicked in), the phone apps and
 *   the Stage demo come after it, quieter; with the open spots gone the
 *   waitlist takes the button's place;
 * - /get/ on a phone: the web door first, with the words written for a phone;
 * - the counter and "Why a limit?" stay out while more than 50 open spots are left;
 * - Facebook's and Instagram's in-app browsers get a bar at the top with the
 *   way out; no other browser ever sees it;
 * - header, device tabs, consent and language controls take a tap on 44 × 44px;
 * - nothing scrolls sideways from 375 to 1920px.
 * The rules themselves: site/test/conversion.test.ts, inapp.test.ts, device.test.ts, capacity.test.ts.
 */

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };
const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  androidTablet: 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  // iPadOS Safari and a Mac send the same string.
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  fbIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/520.0.0;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/18.5;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5]',
  fbAndroid: 'Mozilla/5.0 (Linux; Android 15; Pixel 9 Build/AP3A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/520.0.0.0;]',
  igIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 390.0.0.28.85 (iPhone15,2; iOS 18_5; en_US; en; scale=3.00; 1179x2556; 742412091)',
  igAndroid: 'Mozilla/5.0 (Linux; Android 15; Pixel 9 Build/AP3A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36 Instagram 390.0.0.43.81 Android (35/15; 420dpi; 1080x2424; Google/google; Pixel 9; tokay; tokay; en_US; 742412091)',
};

/** plenty: what the site had when it was reviewed (239 of 255 left). few: the counter is back. */
type State = 'plenty' | 'edge' | 'few' | 'invites' | 'full';
const CAP: Record<State, object> = {
  plenty: { cap: 300, reserved: 45, taken: 16, public_left: 239, invite_left: 284, state: 'open' },
  edge: { cap: 300, reserved: 45, taken: 204, public_left: 51, invite_left: 96, state: 'open' },
  few: { cap: 300, reserved: 45, taken: 205, public_left: 50, invite_left: 95, state: 'open' },
  invites: { cap: 300, reserved: 45, taken: 271, public_left: 0, invite_left: 29, state: 'invites' },
  full: { cap: 300, reserved: 45, taken: 300, public_left: 0, invite_left: 0, state: 'full' },
};

type Visitor = {
  ua?: string; touch?: number; viewport?: { width: number; height: number }; state?: State;
  consent?: 'denied' | null; lang?: 'en' | 'it' | 'es' | null; noModules?: boolean; motion?: boolean;
};

/** A visitor's browser: its own user agent, screen and touch points; the network answered here. */
async function visitor(browser: Browser, v: Visitor = {}): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    userAgent: v.ua ?? UA.windows,
    viewport: v.viewport ?? PHONE,
    locale: 'en-US',
    reducedMotion: v.motion ? 'no-preference' : 'reduce',
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  await context.addInitScript(([touch, consent, lang]) => {
    Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => touch, configurable: true });
    try {
      if (lang) localStorage.setItem('bw-site-lang', lang);
      if (consent) localStorage.setItem('bw-site-consent', consent);
    } catch { /* storage blocked */ }
  }, [v.touch ?? 0, v.consent === undefined ? 'denied' : v.consent, v.lang === undefined ? 'en' : v.lang] as const);
  const page = await context.newPage();
  await page.route(/googletagmanager\.com|google-analytics\.com/, (r) => r.fulfill({ status: 204, body: '' }));
  await page.route('**/api/geo', (r) => r.fulfill({ contentType: 'application/json', body: '{"country":null}' }));
  await page.route('**/rest/v1/rpc/bw_capacity_status', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(CAP[v.state ?? 'plenty']) }));
  // Without the page's own scripts: what the HTML and its inline scripts do alone.
  if (v.noModules) await page.route(/\/assets\/[^?]+\.js(\?|$)/, (r) => r.abort());
  return { context, page };
}

/** The page's scripts ran and the capacity answer is applied (html[data-cap] is set in the same step as every label). */
const ready = (page: Page) => expect(page.locator('html')).toHaveAttribute('data-cap', /^(open|invites|full)$/);
const box = async (page: Page, sel: string) => (await page.locator(sel).first().boundingBox())!;
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const SIGNUP = (spot: string) => `https://app.bandwith.fun/?start=signup&src=${spot}`;

test.beforeEach(({}, info) => { test.skip(info.project.name !== 'site-desktop', 'each test opens its own device'); });

test.describe('home hero: the web app is the main door', () => {
  const devices: [string, Visitor][] = [
    ['an iPhone', { ua: UA.iphone, touch: 5 }],
    ['an Android phone', { ua: UA.android, touch: 5 }],
    ['an iPad', { ua: UA.mac, touch: 5, viewport: { width: 820, height: 1180 } }],
    ['an Android tablet', { ua: UA.androidTablet, touch: 5, viewport: { width: 820, height: 1180 } }],
    ['a Mac', { ua: UA.mac, viewport: DESKTOP }],
    ['a Windows laptop', { ua: UA.windows, viewport: { width: 1280, height: 800 } }],
  ];
  for (const [name, v] of devices) {
    test(`${name}: "Start free in your browser", then the phone apps, then the demo`, async ({ browser }) => {
      const { context, page } = await visitor(browser, v);
      await page.goto('/');
      await ready(page);
      const hero = page.locator('.hero');
      await expect(hero.locator('h1')).toHaveText(/Run the band\.\s*Play the show\./);
      await expect(hero.locator('.hero__what')).toHaveText('The free app for gigging bands.');
      await expect(hero.locator('.hero__how')).toHaveText('Gigs, rehearsals, setlists, quotes and pay in one place, and a live setlist on every phone at the show.');
      // One lime button, and it is the web sign-up.
      const lime = hero.locator('.hero__cta .btn--lime:visible');
      await expect(lime).toHaveCount(1);
      await expect(lime).toHaveText('Start free in your browser');
      await expect(lime).toHaveAttribute('href', SIGNUP('site-hero'));
      await expect(hero.locator('.hero__fine')).toHaveText('Free during the beta · No card · 2 minutes');
      const apps = hero.locator('.hero__apps');
      await expect(apps).toHaveText('Get the iPhone or Android app');
      await expect(apps).toHaveAttribute('href', '/get/');
      const demo = hero.locator('.hero__try');
      await expect(demo).toHaveText('Try it first, no account');
      await expect(demo).toHaveAttribute('href', '/features/stage/#try');
      // Top to bottom: the button, its small print, the apps, the demo; the weights go down in that order.
      const [b, f, a, d] = [await box(page, '.hero__cta .btn--lime:visible'), await box(page, '.hero__fine'), await box(page, '.hero__apps'), await box(page, '.hero__try')];
      expect(b.y + b.height).toBeLessThanOrEqual(f.y);
      expect(f.y + f.height).toBeLessThanOrEqual(a.y);
      expect(a.y).toBeLessThanOrEqual(d.y);
      expect(b.height).toBeGreaterThan(a.height);
      expect(a.height).toBeGreaterThanOrEqual(44);
      expect(d.height).toBeGreaterThanOrEqual(44);
      // All of it on the first screen.
      expect(d.y + d.height).toBeLessThanOrEqual(page.viewportSize()!.height);
      expect(await noSideScroll(page)).toBe(true);
      await context.close();
    });
  }

  for (const [lang, w] of [
    ['it', { what: 'L’app gratuita per le band che suonano dal vivo.', go: 'Inizia gratis dal browser', fine: 'Gratis durante la beta · Senza carta · 2 minuti', apps: 'Scarica l’app per iPhone o Android', demo: 'Provala prima, senza account' }],
    ['es', { what: 'La app gratis para bandas que tocan en directo.', go: 'Empieza gratis en el navegador', fine: 'Gratis durante la beta · Sin tarjeta · 2 minutos', apps: 'Obtén la app para iPhone o Android', demo: 'Pruébala primero, sin cuenta' }],
  ] as const) {
    test(`/${lang}/ on a phone: the same hero in ${lang}, its links in the page’s language`, async ({ browser }) => {
      const { context, page } = await visitor(browser, { ua: UA.iphone, touch: 5, lang });
      await page.goto(`/${lang}/`);
      await ready(page);
      const hero = page.locator('.hero');
      await expect(hero.locator('.hero__what')).toHaveText(w.what);
      const lime = hero.locator('.hero__cta .btn--lime:visible');
      await expect(lime).toHaveText(w.go);
      await expect(lime).toHaveAttribute('href', SIGNUP('site-hero'));
      await expect(hero.locator('.hero__fine')).toHaveText(w.fine);
      await expect(hero.locator('.hero__apps')).toHaveText(w.apps);
      await expect(hero.locator('.hero__apps')).toHaveAttribute('href', `/${lang}/get/`);
      await expect(hero.locator('.hero__try')).toHaveText(w.demo);
      await expect(hero.locator('.hero__try')).toHaveAttribute('href', `/${lang}/features/stage/#try`);
      // Longer words still fit the phone: nothing cut, nothing wider than the screen.
      for (const sel of ['.hero__cta .btn--lime:visible', '.hero__fine', '.hero__apps', '.hero__try']) {
        const r = await box(page, sel);
        expect(r.x, sel).toBeGreaterThanOrEqual(0);
        expect(r.x + r.width, sel).toBeLessThanOrEqual(PHONE.width);
      }
      expect(await noSideScroll(page)).toBe(true);
      expect(await page.evaluate(() => [...((window as unknown as { __bwI18nMisses?: Set<string> }).__bwI18nMisses ?? [])])).toEqual([]);
      await context.close();
    });
  }

  test('on a phone the button stays above the cookie banner, on the first screen', async ({ browser }) => {
    const { context, page } = await visitor(browser, { ua: UA.iphone, touch: 5, consent: null, motion: true, viewport: { width: 375, height: 812 } });
    await page.goto('/');
    await ready(page);
    const banner = page.locator('[data-consent-banner]');
    await expect(banner).toHaveClass(/is-in/);
    await page.waitForTimeout(1500);
    const b = await box(page, '.hero__cta .btn--lime:visible');
    expect(b.y + b.height).toBeLessThanOrEqual((await banner.boundingBox())!.y);
    await context.close();
  });

  for (const state of ['invites', 'full'] as const) {
    test(`open spots gone (${state}): the waitlist takes the button’s place, in the hero and in the footer`, async ({ browser }) => {
      const { context, page } = await visitor(browser, { ua: UA.iphone, touch: 5, state });
      await page.goto('/');
      await ready(page);
      await expect(page.locator('html')).toHaveClass(/is-full/);
      const lime = page.locator('.hero__cta .btn--lime:visible');
      await expect(lime).toHaveCount(1);
      await expect(lime).toHaveText('Join the waitlist');
      await expect(lime).toHaveAttribute('href', '/get/#waitlist');
      await expect(page.locator('.hero__fine')).toBeHidden();
      await expect(page.locator('.hero [data-cap-line]')).toBeVisible();
      // The apps stay: an invited musician still needs them.
      await expect(page.locator('.hero__apps')).toBeVisible();
      const foot = page.locator('.foot__top .btn--lime:visible');
      await expect(foot).toHaveCount(1);
      await expect(foot).toHaveText('Join the waitlist');
      await context.close();
    });
  }

  test('the footer’s button is the same call to action, from the footer', async ({ browser }) => {
    const { context, page } = await visitor(browser, { viewport: DESKTOP });
    for (const url of ['/', '/get/', '/features/stage/', '/faq/']) {
      await page.goto(url);
      await ready(page);
      const foot = page.locator('.foot__top .btn--lime:visible');
      await expect(foot, url).toHaveCount(1);
      await expect(foot, url).toHaveText('Start free in your browser');
      await expect(foot, url).toHaveAttribute('href', SIGNUP('site-footer'));
    }
    await context.close();
  });

  test('"Try it first" lands on the Stage demo, ready to use', async ({ browser }) => {
    const { context, page } = await visitor(browser, { ua: UA.iphone, touch: 5 });
    await page.goto('/');
    await ready(page);
    await page.locator('.hero__try').click();
    await expect(page).toHaveURL(/\/features\/stage\/#try$/);
    const demo = page.locator('#try [data-stage-demo]');
    await expect(demo).toBeVisible();
    // The demo's section starts on the screen, under the header: no scrolling to find it.
    await expect.poll(async () => (await box(page, '#try')).y).toBeLessThan(PHONE.height / 2);
    expect((await box(page, '#try')).y).toBeGreaterThan(-200);
    await context.close();
  });

  test('"What is BandWith?" comes right after the group chat, before the night', async ({ browser }) => {
    const { context, page } = await visitor(browser, { ua: UA.iphone, touch: 5 });
    await page.goto('/');
    await ready(page);
    const top = async (sel: string) => (await box(page, sel)).y + (await page.evaluate(() => window.scrollY));
    expect(await top('#noise')).toBeLessThan(await top('#what'));
    expect(await top('#what')).toBeLessThan(await top('#night'));
    await page.locator('#what summary', { hasText: 'Is BandWith free?' }).click();
    await expect(page.locator('#what details[open] p')).toContainText('BandWith is free while it’s in beta');
    await context.close();
  });
});

test.describe('Get page on a phone: the web door first', () => {
  const doorIds = (page: Page) => page.locator('[data-doors] > .gdoor').evaluateAll((els) => els.map((e) => e.id));
  const PHONE_LINE = 'Fastest way in. Works on your phone right now, nothing to install. Add the phone app later for Bluetooth and offline Stage mode.';
  const OTHER_LINE = 'Create your account in the browser. Nothing to install. Good on a laptop or a tablet.';

  for (const [name, v, order] of [
    ['iPhone', { ua: UA.iphone, touch: 5 }, ['web', 'ios', 'android']],
    ['Android phone', { ua: UA.android, touch: 5 }, ['web', 'android', 'ios']],
  ] as [string, Visitor, string[]][]) {
    test(`${name}: ${order.join(', ')}, with the words for a phone and the sign-up button on the first screen`, async ({ browser }) => {
      const { context, page } = await visitor(browser, { ...v, consent: null, motion: true, viewport: { width: 375, height: 812 } });
      await page.goto('/get/');
      await ready(page);
      expect(await doorIds(page)).toEqual(order);
      await expect(page.locator('html')).toHaveAttribute('data-phone', '');
      const web = page.locator('#web');
      await expect(web.locator('.gdoor__line:visible')).toHaveText(PHONE_LINE);
      await expect(web.locator('.gdoor__facts li:visible')).toHaveText(['Every feature, live sync and the click', 'The same account when you add the phone app']);
      await expect(web).not.toContainText('Good on a laptop', { useInnerText: true });
      await expect(web).not.toContainText('No Bluetooth', { useInnerText: true });
      const btn = web.locator('[data-door="web"]');
      await expect(btn).toHaveText('Create your account');
      await expect(btn).toHaveAttribute('href', SIGNUP('site-get-web'));
      // The button shows without scrolling, above the cookie banner.
      const banner = page.locator('[data-consent-banner]');
      await expect(banner).toHaveClass(/is-in/);
      await page.waitForTimeout(700);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      const b = (await btn.boundingBox())!;
      expect(b.y + b.height).toBeLessThanOrEqual((await banner.boundingBox())!.y);
      // The trust line follows the first door.
      const trust = await box(page, '[data-trust]');
      const first = await box(page, '#web');
      const second = await box(page, `#${order[1]}`);
      expect(trust.y).toBeGreaterThanOrEqual(first.y + first.height);
      expect(trust.y + trust.height).toBeLessThanOrEqual(second.y);
      await expect(page.locator('[data-trust]')).toHaveText('Beta means: free, updated every week, and your data stays yours: export a copy or delete your account anytime.');
      await context.close();
    });
  }

  test('the phone’s order and words are set by the page itself, before its scripts load', async ({ browser }) => {
    const { context, page } = await visitor(browser, { ua: UA.android, touch: 5, noModules: true });
    await page.goto('/get/', { waitUntil: 'domcontentloaded' });
    expect(await doorIds(page)).toEqual(['web', 'android', 'ios']);
    await expect(page.locator('#web .gdoor__line:visible')).toHaveText(PHONE_LINE);
    await context.close();
  });

  for (const [name, v, order] of [
    ['a Mac', { ua: UA.mac, viewport: DESKTOP }, ['web', 'android', 'ios']],
    ['an iPad', { ua: UA.mac, touch: 5, viewport: { width: 820, height: 1180 } }, ['ios', 'web', 'android']],
    ['an Android tablet', { ua: UA.androidTablet, touch: 5, viewport: { width: 820, height: 1180 } }, ['android', 'web', 'ios']],
  ] as [string, Visitor, string[]][]) {
    test(`${name}: the order it had (${order.join(', ')}), the web door’s own words, the trust line under the doors`, async ({ browser }) => {
      const { context, page } = await visitor(browser, v);
      await page.goto('/get/');
      await ready(page);
      expect(await doorIds(page)).toEqual(order);
      await expect(page.locator('html')).not.toHaveAttribute('data-phone', '');
      await expect(page.locator('#web .gdoor__line:visible')).toHaveText(OTHER_LINE);
      await expect(page.locator('#web .gdoor__facts li:visible')).toHaveText(['Every feature, live sync and the click', 'No Bluetooth or offline Stage mode']);
      const trust = await box(page, '[data-trust]');
      for (const id of order) { const d = await box(page, `#${id}`); expect(trust.y, id).toBeGreaterThanOrEqual(d.y + d.height); }
      expect(await noSideScroll(page)).toBe(true);
      await context.close();
    });
  }

  for (const [lang, line, trust] of [
    ['it', 'Il modo più veloce per entrare. Funziona subito sul tuo telefono, senza installare niente. L’app per telefono la aggiungi dopo, per il Bluetooth e la Modalità palco offline.', 'Beta vuol dire: gratis, aggiornata ogni settimana, e i tuoi dati restano tuoi: puoi esportarne una copia o eliminare l’account quando vuoi.'],
    ['es', 'La forma más rápida de entrar. Funciona ya mismo en tu teléfono, sin instalar nada. Añade la app del teléfono más adelante para el Bluetooth y el Modo escenario sin conexión.', 'Beta significa: gratis, con novedades cada semana, y tus datos siguen siendo tuyos: exporta una copia o elimina tu cuenta cuando quieras.'],
  ] as const) {
    test(`/${lang}/get/ on an iPhone: the web door first, in ${lang}`, async ({ browser }) => {
      const { context, page } = await visitor(browser, { ua: UA.iphone, touch: 5, lang });
      await page.goto(`/${lang}/get/`);
      await ready(page);
      expect(await doorIds(page)).toEqual(['web', 'ios', 'android']);
      await expect(page.locator('#web .gdoor__line:visible')).toHaveText(line);
      await expect(page.locator('[data-trust]')).toHaveText(trust);
      await expect(page.locator('#web [data-door="web"]')).toHaveAttribute('href', SIGNUP('site-get-web'));
      expect(await noSideScroll(page)).toBe(true);
      await context.close();
    });
  }
});

test.describe('the counter shows only when the limit matters', () => {
  for (const state of ['plenty', 'edge'] as const) {
    test(`${state === 'plenty' ? '239' : '51'} open spots left: no counter and no "Why a limit?" anywhere`, async ({ browser }) => {
      const { context, page } = await visitor(browser, { ua: UA.iphone, touch: 5, state });
      await page.goto('/get/');
      await ready(page);
      await expect(page.locator('#why')).toBeHidden();
      await expect(page.locator('[data-cap-block]')).toBeHidden();
      expect(await page.locator('main').innerText()).not.toMatch(/open spots left|kept for band invites|small room|why a limit/i);
      await expect(page.locator('.gethead .label')).toHaveText('Open beta · free');
      await page.goto('/');
      await ready(page);
      await expect(page.locator('#get [data-cap-block]')).toBeHidden();
      await expect(page.locator('.hero [data-cap-line]')).toBeHidden();
      expect(await page.locator('main').innerText()).not.toMatch(/open spots left|kept for band invites|why a limit/i);
      // The doors of the section are still there.
      await expect(page.locator('#get .doors .door')).toHaveCount(3);
      await context.close();
    });
  }

  test('50 open spots left: the counter and "Why a limit?" are back, as they were', async ({ browser }) => {
    const { context, page } = await visitor(browser, { ua: UA.iphone, touch: 5, state: 'few' });
    await page.goto('/get/');
    await ready(page);
    await expect(page.locator('#why')).toBeVisible();
    await expect(page.locator('#why h2')).toHaveText(/A small room\s*sounds better\./);
    await expect(page.locator('#why [data-cap-block]')).toBeVisible();
    await expect(page.locator('#why [data-cap-num="left"]')).toHaveText('50');
    await expect(page.locator('#why [data-cap-text]')).toHaveText('50 of 255 open spots left · 45 kept for band invites');
    // Still an open beta: the doors first, no waitlist.
    await expect(page.locator('#waitlist')).toBeHidden();
    await expect(page.locator('.gethead [data-cap-block]')).toHaveCount(0);
    await page.goto('/');
    await ready(page);
    await expect(page.locator('#get [data-cap-block]')).toBeVisible();
    await expect(page.locator('#get [data-cap-text]')).toHaveText('50 of 255 open spots left · 45 kept for band invites');
    await expect(page.locator('#get a[href="/get/#why"]')).toBeVisible();
    await context.close();
  });

  for (const state of ['invites', 'full'] as const) {
    test(`${state}: the notice at the top and the "Why a limit?" section, as before`, async ({ browser }) => {
      const { context, page } = await visitor(browser, { ua: UA.iphone, touch: 5, state });
      await page.goto('/get/');
      await ready(page);
      await expect(page.locator('.gethead [data-cap-block]')).toBeVisible();
      await expect(page.locator('#why')).toBeVisible();
      await expect(page.locator('#waitlist')).toBeVisible();
      await context.close();
    });
  }
});

test.describe('Facebook’s and Instagram’s in-app browsers', () => {
  // Every wording the bar can take is in the page, hidden: the checks read what a visitor sees
  // (innerText; the action is drawn in capitals, so its letters' case is left out of it).
  const BAR = '[data-inapp-bar]';
  /** Two boxes that share no pixel. */
  const apart = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
    a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;

  test('Facebook on Android: the bar above the header, one link that opens this page in Chrome', async ({ browser }) => {
    const { context, page } = await visitor(browser, { ua: UA.fbAndroid, touch: 5, consent: null, motion: true });
    await page.goto('/get/?utm=x#web');
    await ready(page);
    const bar = page.locator(BAR);
    await expect(bar).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-inapp', 'facebook');
    await expect(bar.locator('.iab__t')).toHaveText('You’re in Facebook’s browser. Open in your browser to sign in or install.', { useInnerText: true });
    const go = bar.locator('.iab__go:visible');
    await expect(go).toHaveCount(1);
    await expect(go).toHaveText('Open in Chrome', { useInnerText: true, ignoreCase: true });
    const origin = new URL(page.url());
    await expect(go).toHaveAttribute('href', `intent://${origin.host}/get/?utm=x#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(`https://${origin.host}/get/?utm=x`)};end`);
    // At the very top, full width; the header sits under it, and it covers no button of the page.
    const b = (await bar.boundingBox())!;
    expect(b.y).toBe(0);
    expect(Math.round(b.width)).toBe(PHONE.width);
    expect(b.height).toBeLessThanOrEqual(96);
    const nav = await box(page, '.nav');
    expect(nav.y).toBeGreaterThanOrEqual(b.y + b.height);
    for (const sel of ['.nav__cta', '.nav__menu', '[data-door="web"]']) expect(apart(b, await box(page, sel)), sel).toBe(true);
    // Its own controls take a tap.
    for (const sel of ['.iab__go:visible', '.iab__x']) {
      const r = (await bar.locator(sel).boundingBox())!;
      expect(r.width, sel).toBeGreaterThanOrEqual(44);
      expect(r.height, sel).toBeGreaterThanOrEqual(44);
    }
    // The cookie banner still asks, at the other end of the screen.
    const banner = page.locator('[data-consent-banner]');
    await expect(banner).toHaveClass(/is-in/);
    await page.waitForTimeout(700);
    expect(apart(b, (await banner.boundingBox())!)).toBe(true);
    expect(await noSideScroll(page)).toBe(true);
    await context.close();
  });

  test('Facebook on iPhone: the words say how, the action copies the link', async ({ browser }) => {
    const { context, page } = await visitor(browser, { ua: UA.fbIphone, touch: 5 });
    await page.goto('/');
    await ready(page);
    const bar = page.locator(BAR);
    await expect(bar).toBeVisible();
    await expect(bar.locator('.iab__t')).toHaveText('You’re in Facebook’s browser. To sign in or install, tap ··· then Open in browser.', { useInnerText: true });
    const go = bar.locator('.iab__go:visible');
    await expect(go).toHaveCount(1);
    await expect(go).toHaveText('Copy link', { useInnerText: true, ignoreCase: true });
    await go.click();
    await expect(go).toHaveText('Link copied', { useInnerText: true, ignoreCase: true });
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(page.url());
    // The hero's button is right there under the header, untouched.
    const b = (await bar.boundingBox())!;
    const nav = await box(page, '.nav');
    expect(nav.y).toBeGreaterThanOrEqual(b.y + b.height);
    await expect(page.locator('.hero__cta .btn--lime:visible')).toBeVisible();
    await context.close();
  });

  for (const [name, ua, action] of [['iPhone', UA.igIphone, 'Copy link'], ['Android', UA.igAndroid, 'Open in Chrome']] as const) {
    test(`Instagram on ${name}: it says Instagram`, async ({ browser }) => {
      const { context, page } = await visitor(browser, { ua, touch: 5 });
      await page.goto('/features/stage/');
      await ready(page);
      await expect(page.locator('html')).toHaveAttribute('data-inapp', 'instagram');
      await expect(page.locator(`${BAR} .iab__t`)).toContainText('You’re in Instagram’s browser.', { useInnerText: true });
      await expect(page.locator(`${BAR} .iab__t`)).not.toContainText('Facebook', { useInnerText: true });
      await expect(page.locator(`${BAR} .iab__go:visible`)).toHaveText(action, { useInnerText: true, ignoreCase: true });
      await context.close();
    });
  }

  for (const [lang, android, iphone, copied] of [
    ['it', ['Sei nel browser di Facebook. Aprilo nel tuo browser per accedere o installare.', 'Apri in Chrome'], ['Sei nel browser di Facebook. Per accedere o installare, tocca ··· e poi Apri nel browser.', 'Copia link'], 'Link copiato'],
    ['es', ['Estás en el navegador de Facebook. Ábrelo en tu navegador para entrar o instalar.', 'Abrir en Chrome'], ['Estás en el navegador de Facebook. Para entrar o instalar, toca ··· y luego Abrir en el navegador.', 'Copiar enlace'], 'Enlace copiado'],
  ] as const) {
    test(`/${lang}/: the bar in ${lang}, on Android and iPhone, slim enough for a phone`, async ({ browser }) => {
      for (const [ua, [words, action]] of [[UA.fbAndroid, android], [UA.fbIphone, iphone]] as const) {
        const { context, page } = await visitor(browser, { ua, touch: 5, lang, viewport: { width: 375, height: 812 } });
        await page.goto(`/${lang}/`);
        await ready(page);
        const bar = page.locator(BAR);
        await expect(bar.locator('.iab__t')).toHaveText(words, { useInnerText: true });
        const go = bar.locator('.iab__go:visible');
        await expect(go).toHaveText(action, { useInnerText: true, ignoreCase: true });
        expect((await bar.boundingBox())!.height).toBeLessThanOrEqual(84);
        if (ua === UA.fbIphone) { await go.click(); await expect(go).toHaveText(copied, { useInnerText: true, ignoreCase: true }); }
        expect(await noSideScroll(page)).toBe(true);
        expect(await page.evaluate(() => [...((window as unknown as { __bwI18nMisses?: Set<string> }).__bwI18nMisses ?? [])])).toEqual([]);
        await context.close();
      }
    });
  }

  test('it is there before the page’s scripts run, and nothing jumps when they do', async ({ browser }) => {
    // Without the modules: the HTML and its inline script alone put the bar up and the header under it.
    let v = await visitor(browser, { ua: UA.fbAndroid, touch: 5, noModules: true });
    await v.page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(v.page.locator(BAR)).toBeVisible();
    const bar = (await v.page.locator(BAR).boundingBox())!;
    expect((await box(v.page, '.nav')).y).toBeGreaterThanOrEqual(bar.height);
    expect((await box(v.page, '.hero h1')).y).toBeGreaterThan(bar.height);
    await v.context.close();
    // With them: the page settles without moving by more than a line of the bar.
    v = await visitor(browser, { ua: UA.fbAndroid, touch: 5 });
    await v.page.addInitScript(() => {
      const w = window as unknown as { __cls: number };
      w.__cls = 0;
      new PerformanceObserver((list) => { for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!e.hadRecentInput) w.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
    });
    await v.page.goto('/');
    await ready(v.page);
    await v.page.waitForTimeout(1200);
    expect(await v.page.evaluate(() => (window as unknown as { __cls: number }).__cls)).toBeLessThan(0.05);
    const h = (await v.page.locator(BAR).boundingBox())!.height;
    expect(await v.page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--iab-h'))).toBe(`${Math.round(h)}px`);
    await v.context.close();
  });

  test('closed, it is gone for the visit: the header goes back up, and the next page has no bar', async ({ browser }) => {
    const { context, page } = await visitor(browser, { ua: UA.fbIphone, touch: 5 });
    await page.goto('/');
    await ready(page);
    const bar = page.locator(BAR);
    await expect(bar).toBeVisible();
    const close = bar.getByRole('button', { name: 'Close' });
    await close.click();
    await expect(bar).toBeHidden();
    await expect(page.locator('html')).not.toHaveAttribute('data-inapp', /./);
    expect((await box(page, '.nav')).y).toBeLessThanOrEqual(12);
    await page.goto('/get/');
    await ready(page);
    await expect(page.locator(BAR)).toBeHidden();
    expect((await box(page, '.nav')).y).toBeLessThanOrEqual(12);
    await page.reload();
    await expect(page.locator(BAR)).toBeHidden();
    await context.close();
  });

  test('the menu sheet opens under the bar, and the language suggestion keeps its place', async ({ browser }) => {
    const { context, page } = await visitor(browser, { ua: UA.fbAndroid, touch: 5, lang: null, consent: null, motion: true });
    await page.goto('/?geo=IT');
    await ready(page);
    const bar = (await page.locator(BAR).boundingBox())!;
    const ask = page.locator('[data-lang-suggest]');
    await expect(ask).toHaveClass(/is-in/);
    await page.waitForTimeout(700);
    expect(apart(bar, (await ask.boundingBox())!)).toBe(true);
    // One question at a time, as before: the cookie banner waits for the language answer.
    await expect(page.locator('[data-consent-banner]')).toHaveCount(0);
    await ask.locator('[data-ls-dismiss]').click();
    await expect(page.locator('[data-consent-banner]')).toHaveClass(/is-in/);
    await page.locator('[data-consent="reject"]').click();
    await page.locator('[data-menu-btn]').click();
    const menu = page.locator('[data-menu]');
    await expect(menu).toBeVisible();
    await page.waitForTimeout(900);
    const m = (await menu.boundingBox())!;
    expect(m.y).toBeGreaterThanOrEqual(bar.height);
    expect(m.y + m.height).toBeLessThanOrEqual(PHONE.height);
    await context.close();
  });

  for (const [name, v] of [
    ['Safari on an iPhone', { ua: UA.iphone, touch: 5 }],
    ['Chrome on Android', { ua: UA.android, touch: 5 }],
    ['a Mac', { ua: UA.mac, viewport: DESKTOP }],
    ['a Windows laptop', { ua: UA.windows, viewport: DESKTOP }],
  ] as [string, Visitor][]) {
    test(`${name} never sees it`, async ({ browser }) => {
      const { context, page } = await visitor(browser, v);
      for (const url of ['/', '/get/', '/it/', '/features/stage/', '/faq/']) {
        await page.goto(url);
        await ready(page);
        await expect(page.locator(BAR), url).toBeHidden();
        await expect(page.locator('html'), url).not.toHaveAttribute('data-inapp', /./);
        expect((await box(page, '.nav')).y, url).toBeLessThanOrEqual(12);
      }
      await context.close();
    });
  }
});

test.describe('controls take a tap on 44 × 44px', () => {
  const size = async (page: Page, sel: string) => {
    const els = page.locator(`${sel}:visible`);
    const n = await els.count();
    expect(n, sel).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      const r = (await els.nth(i).boundingBox())!;
      expect(Math.round(r.width * 10) / 10, `${sel} #${i} width`).toBeGreaterThanOrEqual(44);
      expect(Math.round(r.height * 10) / 10, `${sel} #${i} height`).toBeGreaterThanOrEqual(44);
    }
  };

  for (const lang of ['', 'it/', 'es/']) {
    test(`/${lang} on a phone: header buttons, device tabs, consent buttons, the language switch`, async ({ browser }) => {
      const { context, page } = await visitor(browser, { ua: UA.iphone, touch: 5, consent: null, lang: lang ? (lang.slice(0, 2) as 'it' | 'es') : 'en' });
      await page.goto(`/${lang}`);
      await ready(page);
      await expect(page.locator('[data-consent-banner]')).toHaveClass(/is-in/);
      await size(page, '.nav__cta');
      await size(page, '.nav__menu');
      await size(page, '[data-consent-banner] button');
      await page.locator('[data-consent="reject"]').click();
      await size(page, '.dv__tabs button');
      await size(page, '.foot [data-lang-switch] a');
      // The buttons still sit inside the header's pill.
      const nav = await box(page, '.nav');
      for (const sel of ['.nav__cta', '.nav__menu']) {
        const r = await box(page, sel);
        expect(r.y, sel).toBeGreaterThanOrEqual(nav.y);
        expect(r.y + r.height, sel).toBeLessThanOrEqual(nav.y + nav.height);
        expect(r.x + r.width, sel).toBeLessThanOrEqual(nav.x + nav.width);
      }
      await context.close();
    });
  }

  test('the language switch looks as it did: a 38px pill, the current language on a 30px lime one', async ({ browser }) => {
    const { context, page } = await visitor(browser, { ua: UA.iphone, touch: 5 });
    await page.goto('/');
    await ready(page);
    const sw = page.locator('.foot [data-lang-switch]');
    await sw.scrollIntoViewIfNeeded();
    expect(Math.round((await sw.boundingBox())!.height)).toBe(38);
    const pill = await sw.locator('a[aria-current="page"]').evaluate((a) => {
      const s = getComputedStyle(a, '::before');
      return { h: Math.round(a.getBoundingClientRect().height - parseFloat(s.top) - parseFloat(s.bottom)), bg: s.backgroundColor };
    });
    expect(pill).toEqual({ h: 30, bg: 'rgb(213, 251, 70)' });
    await context.close();
  });

  test('a desktop header: Log in, Sign up, Get the app, and the deck’s links', async ({ browser }) => {
    const { context, page } = await visitor(browser, { viewport: DESKTOP });
    await page.goto('/');
    await ready(page);
    for (const sel of ['.nav__login', '.nav__signup', '.nav__cta']) await size(page, sel);
    // The deck's labels keep their 36px look; what takes the click is 44px tall.
    const deck = await page.locator('.nav__deck .nav__item').first().evaluate((el) => {
      const s = getComputedStyle(el, '::before');
      return { look: Math.round(el.getBoundingClientRect().height), tap: Math.round(el.getBoundingClientRect().height - parseFloat(s.top) - parseFloat(s.bottom)) };
    });
    expect(deck).toEqual({ look: 36, tap: 44 });
    await context.close();
  });
});

test.describe('nothing scrolls sideways', () => {
  const widths: [number, number, string, number][] = [
    [375, 812, UA.iphone, 5], [390, 844, UA.android, 5], [820, 1180, UA.mac, 5], [1280, 800, UA.windows, 0], [1440, 900, UA.mac, 0], [1920, 1080, UA.windows, 0],
  ];
  for (const [width, height, ua, touch] of widths) {
    test(`${width}px: home and Get page, in three languages, with and without the in-app bar`, async ({ browser }) => {
      test.setTimeout(90_000);
      const { context, page } = await visitor(browser, { ua, touch, viewport: { width, height }, state: 'few' });
      for (const url of ['/', '/get/', '/it/', '/it/get/', '/es/', '/es/get/']) {
        await page.goto(url);
        await ready(page);
        expect(await noSideScroll(page), url).toBe(true);
      }
      await context.close();
      if (width > 820) return;
      const inapp = await visitor(browser, { ua: touch && /iPhone|Macintosh/.test(ua) ? UA.fbIphone : UA.fbAndroid, touch, viewport: { width, height } });
      for (const url of ['/', '/it/get/', '/es/']) {
        await inapp.page.goto(url);
        await ready(inapp.page);
        await expect(inapp.page.locator('[data-inapp-bar]')).toBeVisible();
        expect(await noSideScroll(inapp.page), url).toBe(true);
      }
      await inapp.context.close();
    });
  }
});

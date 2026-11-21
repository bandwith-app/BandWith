import { expect, test, type Page } from '@playwright/test';

/**
 * Google Analytics 4 (G-GCWSEQRZ2E) with Consent Mode v2, basic mode: every
 * consent type starts denied and gtag.js itself loads only after Accept, so
 * nothing reaches Google (no cookie, no ping) until the visitor says yes.
 * A small banner (EN/IT/ES) asks, Accept and Reject side by side; the choice
 * is remembered and the footer reopens it. The language popup goes first.
 * Hits to Google never leave the tests (collect is answered here).
 */

const BANNER = '[data-consent-banner]';

/** Requests for gtag.js on this page (answered here with an empty script). */
const gtagLoads = new WeakMap<Page, string[]>();
/** Every request to Google's analytics hosts (gtag.js, collect). */
const googleHits = new WeakMap<Page, string[]>();
const hits = (page: Page) => googleHits.get(page) ?? [];
const loads = (page: Page) => gtagLoads.get(page) ?? [];

async function visit(page: Page, path: string, country: string | null = null) {
  gtagLoads.set(page, []);
  googleHits.set(page, []);
  page.on('request', (r) => { if (/googletagmanager\.com|google-analytics\.com/.test(r.url())) hits(page).push(r.url()); });
  await page.route(/googletagmanager\.com\/gtag\/js/, (r) => {
    loads(page).push(r.request().url());
    return r.fulfill({ contentType: 'text/javascript', body: '' });
  });
  await page.route('**/api/geo', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ country, region: '' }) }));
  await page.route('**/rest/v1/rpc/**', (r) => r.fulfill({ contentType: 'application/json', body: '{"cap":300,"reserved":45,"taken":142,"public_left":113,"invite_left":158,"state":"open"}' }));
  await page.route(/google-analytics\.com\/(g|mp)\/collect/, (r) => r.fulfill({ status: 204, body: '' }));
  await page.goto(path);
}

type Cmd = [string, ...unknown[]];
const dataLayer = (page: Page) =>
  page.evaluate(() => ((window as unknown as { dataLayer?: IArguments[] }).dataLayer ?? []).map((a) => Array.from(a as ArrayLike<unknown>)) as Cmd[]);
const gaCookies = async (page: Page) => (await page.context().cookies()).filter((c) => /^_ga/.test(c.name));

test.describe('analytics consent', () => {
  test('before any choice: consent denied, GA not configured, no GA cookie, the banner asks', async ({ page }) => {
    await visit(page, '/');
    await expect(page.locator(BANNER)).toBeVisible();
    const dl = await dataLayer(page);
    const def = dl.find((c) => c[0] === 'consent' && c[1] === 'default');
    expect(def?.[2]).toMatchObject({ analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
    // Basic mode: GA is configured only once there is a yes.
    expect(dl.find((c) => c[0] === 'config')).toBeUndefined();
    await page.waitForTimeout(1500);
    expect(await gaCookies(page)).toEqual([]);
    // Basic mode: Google's script is not even loaded before a yes.
    expect(loads(page)).toEqual([]);
    await expect(page.locator('script[src*="googletagmanager.com/gtag/js"]')).toHaveCount(0);
  });

  test('Accept: consent update for analytics only, remembered, no banner after', async ({ page }) => {
    await visit(page, '/features/money/');
    const b = page.locator(BANNER);
    await expect(b.locator('[data-consent="accept"]')).toBeVisible();
    await expect(b.locator('[data-consent="reject"]')).toBeVisible();
    expect(loads(page)).toEqual([]);
    await b.locator('[data-consent="accept"]').click();
    await expect(b).toBeHidden();
    const upd = (await dataLayer(page)).filter((c) => c[0] === 'consent' && c[1] === 'update');
    expect(upd.at(-1)?.[2]).toEqual({ analytics_storage: 'granted' });
    // The yes configures GA after granting (so the first page_view counts as consented) and loads it, once.
    const after = await dataLayer(page);
    const grant = after.findIndex((c) => c[0] === 'consent' && c[1] === 'update' && (c[2] as Record<string, string>).analytics_storage === 'granted');
    const cfg = after.findIndex((c) => c[0] === 'config');
    expect(grant).toBeGreaterThan(-1);
    expect(cfg).toBeGreaterThan(grant);
    expect(after[cfg][1]).toBe('G-GCWSEQRZ2E');
    expect(after[cfg][2]).toMatchObject({ allow_google_signals: false, allow_ad_personalization_signals: false });
    await expect.poll(() => loads(page).length).toBe(1);
    expect(loads(page)[0]).toContain('id=G-GCWSEQRZ2E');
    gtagLoads.set(page, []);
    await page.reload();
    // A stored yes loads it from the head, on every page.
    await expect.poll(() => loads(page).length).toBe(1);
    await expect(page.locator('html')).toHaveAttribute('data-consent', 'granted');
    await expect(page.locator(BANNER)).toHaveCount(0);
    // A stored yes is applied before GA starts.
    const dl = await dataLayer(page);
    const i = dl.findIndex((c) => c[0] === 'consent' && c[1] === 'update' && (c[2] as Record<string, string>).analytics_storage === 'granted');
    expect(i).toBeGreaterThan(-1);
    expect(i).toBeLessThan(dl.findIndex((c) => c[0] === 'config'));
    expect(dl.filter((c) => c[0] === 'config')).toHaveLength(1);
  });

  test('Reject: nothing granted, remembered, no GA cookie', async ({ page }) => {
    await visit(page, '/');
    await page.locator(BANNER).locator('[data-consent="reject"]').click();
    await expect(page.locator(BANNER)).toBeHidden();
    await page.goto('/get/');
    await expect(page.locator('html')).toHaveAttribute('data-consent', 'denied');
    await expect(page.locator(BANNER)).toHaveCount(0);
    expect((await dataLayer(page)).some((c) => c[0] === 'consent' && c[1] === 'update' && (c[2] as Record<string, string>).analytics_storage === 'granted')).toBe(false);
    await page.waitForTimeout(1500);
    expect(await gaCookies(page)).toEqual([]);
    expect(loads(page)).toEqual([]);
    // Nothing at all went to Google, on either page.
    expect(hits(page)).toEqual([]);
  });

  test('Accept and Reject weigh the same', async ({ page }) => {
    await visit(page, '/');
    const a = page.locator(`${BANNER} [data-consent="accept"]`);
    const r = page.locator(`${BANNER} [data-consent="reject"]`);
    await expect(a).toBeVisible();
    const style = (l: typeof a) => l.evaluate((el) => {
      const s = getComputedStyle(el);
      return [s.backgroundColor, s.color, s.fontSize, s.fontWeight, s.borderColor, Math.round(el.getBoundingClientRect().height)].join('|');
    });
    expect(await style(a)).toBe(await style(r));
  });

  test('the footer reopens the choice; a withdrawal switches GA off and removes its cookies', async ({ page }) => {
    await visit(page, '/');
    await page.locator(BANNER).locator('[data-consent="accept"]').click();
    await expect(page.locator(BANNER)).toBeHidden();
    // As GA would after a yes (the script is stubbed here).
    await page.context().addCookies([
      { name: '_ga', value: 'GA1.1.1.1', domain: '127.0.0.1', path: '/' },
      { name: '_ga_GCWSEQRZ2E', value: 'GS1.1.1', domain: '127.0.0.1', path: '/' },
    ]);
    await page.locator('footer [data-consent-open]').click();
    await expect(page.locator(BANNER)).toBeVisible();
    await page.locator(BANNER).locator('[data-consent="reject"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-consent', 'denied');
    const upd = (await dataLayer(page)).filter((c) => c[0] === 'consent' && c[1] === 'update');
    expect(upd.at(-1)?.[2]).toEqual({ analytics_storage: 'denied' });
    expect(await page.evaluate(() => (window as unknown as Record<string, unknown>)['ga-disable-G-GCWSEQRZ2E'])).toBe(true);
    expect(await gaCookies(page)).toEqual([]);
    // The next page doesn't load GA, and nothing goes to Google.
    googleHits.set(page, []);
    await page.goto('/features/stage/');
    await expect(page.locator('html')).toHaveAttribute('data-consent', 'denied');
    await page.waitForTimeout(1000);
    expect(hits(page)).toEqual([]);
  });

  test('the language popup comes first, then the banner', async ({ page }) => {
    await visit(page, '/', 'ES');
    await expect(page.locator('[data-lang-suggest]')).toBeVisible();
    await expect(page.locator(BANNER)).toHaveCount(0);
    await page.locator('[data-lang-suggest] [data-ls-dismiss]').click();
    await expect(page.locator(BANNER)).toBeVisible();
  });

  for (const [lang, accept, words] of [['it', 'Accetta', 'Rifiuta'], ['es', 'Aceptar', 'Rechazar']] as const) {
    test(`the banner speaks the page's language (${lang})`, async ({ page }) => {
      await visit(page, `/${lang}/`);
      const b = page.locator(BANNER);
      await expect(b).toHaveAttribute('lang', lang);
      await expect(b.locator('[data-consent="accept"]')).toHaveText(accept);
      await expect(b.locator('[data-consent="reject"]')).toHaveText(words);
      await expect(page.locator('footer [data-consent-open]')).not.toHaveText('Cookie preferences');
      // The privacy policy in the page's language, in the banner and the footer.
      const policy = `https://app.bandwith.fun/legal/privacy-${lang}.html`;
      await expect(b.locator('a')).toHaveAttribute('href', policy);
      await expect(page.locator(`footer a[href="${policy}"]`)).toHaveCount(1);
    });
  }
});

import { expect, test, type Page } from '@playwright/test';

/**
 * Site languages: English (/), Italian (/it/), Spanish (/es/).
 *
 * The visitor's country comes from /api/geo (Vercel's x-vercel-ip-country,
 * read by an edge function). A Spanish-speaking country suggests Spanish,
 * Italy and Italian-speaking places suggest Italian, English-speaking
 * countries suggest English; only when that differs from the page's language.
 * Every other country: no suggestion. The choice (yes or no) is remembered.
 */

const POPUP = '[data-lang-suggest]';

async function visit(page: Page, path: string, country: string | null, region = '') {
  // The analytics question is answered (e2e/site/consent.spec.ts covers it); hits never leave.
  await page.addInitScript(() => { try { localStorage.setItem('bw-site-consent', 'denied'); } catch { /* */ } });
  await page.route(/google-analytics\.com\/(g|mp)\/collect/, (r) => r.fulfill({ status: 204, body: '' }));
  await page.route('**/api/geo', (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ country, region }) }),
  );
  // No real Supabase from the tests: the counter stays open, the waitlist answers place 37.
  await page.route('**/rest/v1/rpc/bw_capacity_status', (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ cap: 300, reserved: 45, taken: 142, public_left: 113, invite_left: 158, state: 'open' }) }),
  );
  await page.route('**/rest/v1/rpc/bw_join_waitlist', (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, position: 37 }) }),
  );
  await page.goto(path);
}

const popup = (page: Page) => page.locator(POPUP);
/** The popup is decided once /api/geo answered: wait for the page to say so. */
const settled = (page: Page) => expect(page.locator('html')).toHaveAttribute('data-lang-checked', /.+/);

test.describe('language suggestion', () => {
  test('Spain on the English page: suggests Spanish, in Spanish', async ({ page }) => {
    await visit(page, '/', 'ES');
    const p = popup(page);
    await expect(p).toBeVisible();
    await expect(p).toHaveAttribute('lang', 'es');
    await expect(p).toContainText('España');
    await expect(p).toContainText('¿Ver el sitio en español?');
    await p.locator('[data-ls-accept]').click();
    await expect(page).toHaveURL(/\/es\/$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await settled(page);
    await expect(popup(page)).toHaveCount(0);
  });

  test('Mexico on a feature page: Spanish keeps the same page', async ({ page }) => {
    await visit(page, '/features/money/', 'MX');
    await expect(popup(page)).toContainText('México');
    await popup(page).locator('[data-ls-accept]').click();
    await expect(page).toHaveURL(/\/es\/features\/money\/$/);
  });

  test('Italy on the English page: suggests Italian; a no is remembered', async ({ page }) => {
    await visit(page, '/', 'IT');
    const p = popup(page);
    await expect(p).toBeVisible();
    await expect(p).toHaveAttribute('lang', 'it');
    await expect(p).toContainText('Italia');
    await expect(p).toContainText('italiano');
    await p.locator('[data-ls-dismiss]').click();
    await expect(popup(page)).toBeHidden();

    await page.reload();
    await settled(page);
    await expect(popup(page)).toHaveCount(0);
    await page.goto('/get/');
    await settled(page);
    await expect(popup(page)).toHaveCount(0);
  });

  test('a yes is remembered too: back on English, no popup', async ({ page }) => {
    await visit(page, '/', 'ES');
    await popup(page).locator('[data-ls-accept]').click();
    await expect(page).toHaveURL(/\/es\/$/);
    await page.goto('/');
    await settled(page);
    await expect(popup(page)).toHaveCount(0);
  });

  for (const [country, region] of [['SM', ''], ['VA', ''], ['CH', 'TI']] as const) {
    test(`${country}${region ? '-' + region : ''} suggests Italian`, async ({ page }) => {
      await visit(page, '/', country, region);
      await expect(popup(page)).toHaveAttribute('lang', 'it');
    });
  }

  test('United States on the English page: no popup', async ({ page }) => {
    await visit(page, '/', 'US');
    await settled(page);
    await expect(popup(page)).toHaveCount(0);
  });

  test('United States on the Italian page: suggests English', async ({ page }) => {
    await visit(page, '/it/features/stage/', 'US');
    const p = popup(page);
    await expect(p).toHaveAttribute('lang', 'en');
    await expect(p).toContainText('United States');
    await expect(p).toContainText('View the site in English?');
    await p.locator('[data-ls-accept]').click();
    await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/features\/stage\/$/);
  });

  test('Italy on the Italian page and Spain on the Spanish page: no popup', async ({ page }) => {
    await visit(page, '/it/', 'IT');
    await settled(page);
    await expect(popup(page)).toHaveCount(0);
    await page.goto('/es/get/');
    await page.unroute('**/api/geo');
    await page.route('**/api/geo', (r) => r.fulfill({ contentType: 'application/json', body: '{"country":"ES","region":""}' }));
    await page.reload();
    await settled(page);
    await expect(popup(page)).toHaveCount(0);
  });

  for (const [country, region] of [['DE', ''], ['FR', ''], ['CH', 'ZH'], [null, '']] as const) {
    test(`${country ?? 'unknown country'}${region ? '-' + region : ''}: English, no popup`, async ({ page }) => {
      await visit(page, '/', country, region);
      await settled(page);
      await expect(popup(page)).toHaveCount(0);
    });
  }

  test('another country on the Spanish page: no popup either', async ({ page }) => {
    await visit(page, '/es/', 'DE');
    await settled(page);
    await expect(popup(page)).toHaveCount(0);
  });
});

test.describe('language switcher and pages', () => {
  test('the switcher opens the same page in another language and remembers it', async ({ page }) => {
    await visit(page, '/features/money/', 'IT');
    await expect(popup(page)).toBeVisible();
    const sw = page.locator('footer [data-lang-switch]');
    await expect(sw.locator('a')).toHaveText(['EN', 'IT', 'ES']);
    await expect(sw.locator('[aria-current="page"]')).toHaveText('EN');
    // On a phone the suggestion card covers the end of the page but for a strip under it: each language
    // takes a tap on 44px, and the lower part of it is in that strip (the middle is behind the card).
    await sw.locator('a[hreflang="es"]').click({ position: { x: 22, y: 38 } });
    await expect(page).toHaveURL(/\/es\/features\/money\/$/);
    await settled(page);
    // Picking a language is a choice: no popup on top of it.
    await expect(popup(page)).toHaveCount(0);
    await page.goto('/');
    await settled(page);
    await expect(popup(page)).toHaveCount(0);
  });

  for (const lang of ['it', 'es'] as const) {
    test(`/${lang}/: lang, title, hreflang, og:locale and translated links`, async ({ page }) => {
      await visit(page, `/${lang}/`, null);
      await expect(page.locator('html')).toHaveAttribute('lang', lang);
      const enTitle = 'BandWith · Run the band. Play the show.';
      await expect(page).not.toHaveTitle(enTitle);
      const alt = (h: string) => page.locator(`head link[rel="alternate"][hreflang="${h}"]`);
      await expect(alt('en')).toHaveAttribute('href', 'https://bandwith.fun/');
      await expect(alt('it')).toHaveAttribute('href', 'https://bandwith.fun/it/');
      await expect(alt('es')).toHaveAttribute('href', 'https://bandwith.fun/es/');
      await expect(alt('x-default')).toHaveAttribute('href', 'https://bandwith.fun/');
      await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute('href', `https://bandwith.fun/${lang}/`);
      await expect(page.locator('head meta[property="og:locale"]')).toHaveAttribute('content', lang === 'it' ? 'it_IT' : 'es_ES');
      const desc = await page.locator('head meta[name="description"]').getAttribute('content');
      expect(desc).not.toContain('runs a working band');
      // Site links stay in the language; the Guide opens in it.
      await expect(page.locator(`a.btn[href="/${lang}/get/"]`).first()).toBeAttached();
      await expect(page.locator('a[href="/get/"]')).toHaveCount(0);
      // The Guide opens on its static page in the same language (never the app shell or a #/a/ fragment).
      const guide = await page.locator('a[href^="https://app.bandwith.fun/academy"]').evaluateAll((els) => els.map((a) => a.getAttribute('href') ?? ''));
      expect(guide.length).toBeGreaterThan(2);
      expect(guide.filter((h) => !new RegExp(`^https://app\\.bandwith\\.fun/academy/${lang}/(a/[a-z0-9-]+/)?$`).test(h))).toEqual([]);
    });

    test(`/${lang}/get/: the waitlist answers in the page's language`, async ({ page }) => {
      await visit(page, `/${lang}/get/?capacity=full`, null);
      const form = page.locator('[data-beta-form="waitlist"]');
      await form.locator('input[name="email"]').fill('someone@example.com');
      await form.locator('button[type="submit"]').click();
      const done = form.locator('[data-form-done]');
      await expect(done).toBeVisible();
      await expect(done).toContainText('#37');
      await expect(done).not.toContainText('in line');
      await expect(done).toContainText(lang === 'it' ? 'in lista' : 'en la lista');
    });
  }

  test('the English page keeps English and lists its translations', async ({ page }) => {
    await visit(page, '/features/stage/', null);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('head link[rel="alternate"][hreflang="it"]')).toHaveAttribute('href', 'https://bandwith.fun/it/features/stage/');
    await expect(page.locator('head link[rel="alternate"][hreflang="es"]')).toHaveAttribute('href', 'https://bandwith.fun/es/features/stage/');
    await expect(page.locator('head meta[property="og:locale"]')).toHaveAttribute('content', 'en_US');
  });
});

test.describe('longer words still fit', () => {
  for (const path of ['/', '/it/', '/es/']) {
    test(`${path}: the hero headline isn't cut, the chips don't overlap, the nav holds its menu`, async ({ page }) => {
      await visit(page, path, null);
      await expect(page.locator('.hero__title')).toBeVisible();
      await page.waitForTimeout(1500); // the headline's lines are cut by SplitText after the fonts load
      const cut = await page.locator('.hero__title .line').evaluateAll((ls) =>
        ls.filter((l) => l.scrollWidth > l.clientWidth + 1).map((l) => l.textContent));
      expect(cut).toEqual([]);
      const overlaps = await page.locator('.hero__picks .pick').evaluateAll((ps) => {
        const out: string[] = [];
        ps.forEach((p, i) => {
          const next = ps[i + 1];
          if (!next) return;
          const range = document.createRange();
          range.selectNodeContents(p);
          if (range.getBoundingClientRect().right > next.getBoundingClientRect().left + 1) out.push(`${p.textContent} | ${next.textContent}`);
        });
        return out;
      });
      expect(overlaps).toEqual([]);
      // The nav keeps its menu button inside the bar.
      const nav = await page.locator('[data-nav]').boundingBox();
      const menu = await page.locator('[data-menu-btn]').boundingBox();
      if (nav && menu && (await page.locator('[data-menu-btn]').isVisible())) expect(menu.x + menu.width).toBeLessThanOrEqual(nav.x + nav.width + 1);
    });
  }
});

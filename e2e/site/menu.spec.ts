import { expect, test, type Page } from '@playwright/test';

/**
 * The menu. Wide screens: Features opens "The index" (every page and its
 * one-liner, the page dimmed behind, as wide as the header). Phones and
 * tablets: the menu button opens a sheet with the account first, the four
 * groups as an accordion and the app pinned at the bottom.
 * Keyboard and focus as designed: a button with aria-expanded, Enter / Space /
 * ↓ open and focus the first link, Esc closes and returns focus, Tab out of
 * either end closes, focus stays inside the sheet, aria-current on the page
 * you are on, reduced motion = a fade only.
 * Markup and content: site/test/menu.test.ts.
 */
const quiet = async (page: Page) => {
  await page.route('**/api/geo', (r) => r.fulfill({ json: { country: null, region: '' } }));
  await page.addInitScript(() => {
    try { localStorage.setItem('bw-site-lang', 'no'); localStorage.setItem('bw-site-consent', 'denied'); } catch { /* private mode */ }
  });
};
const LIME = 'rgb(213, 251, 70)';
const active = (page: Page) => page.evaluate(() => {
  const a = document.activeElement as HTMLElement | null;
  return a ? (a.getAttribute('href') ?? a.dataset.rackBtn ?? a.getAttribute('aria-label') ?? a.textContent ?? '').trim() : '';
});

test.describe('features panel (wide screens)', () => {
  test.beforeEach(async ({ page }, info) => {
    test.skip(info.project.name !== 'site-desktop', 'the panel exists from 1081px');
    await quiet(page);
  });

  test('a click opens the index: eleven pages with their one-liners, the page dimmed, the panel as wide as the header', async ({ page }) => {
    await page.goto('/features/stage/');
    const btn = page.locator('[data-rack-btn]');
    const panel = page.locator('#rack-panel');
    await expect(panel).toBeHidden();
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    await btn.click();
    await expect(panel).toBeVisible();
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('[data-rack-scrim]')).toBeVisible();
    const rows = panel.locator('a.mm__row');
    await expect(rows).toHaveCount(11);
    // Nothing waits for a hover: every name and every line can be read.
    for (let i = 0; i < 11; i++) {
      await expect(rows.nth(i).locator('.mm__name')).toBeVisible();
      await expect(rows.nth(i).locator('.mm__line')).toBeVisible();
    }
    await expect(panel.locator('h2.mm__t')).toHaveText(['Book & get paid', 'Line up the band', 'Play the show', 'Built in']);
    await expect.poll(async () => {
      const [n, p] = await Promise.all([page.locator('header.nav').boundingBox(), panel.boundingBox()]);
      return Math.abs(n!.width - p!.width) + Math.abs(n!.x - p!.x);
    }).toBeLessThanOrEqual(2);
    // The four lists start on one line.
    const tops = await panel.locator('.mm__list').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
    // No picture in it any more.
    await expect(panel.locator('img')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    // A second click closes it.
    await btn.click();
    await expect(panel).toBeHidden();
    await expect(page.locator('[data-rack-scrim]')).toBeHidden();
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
  });

  test('the page you are on is the lime one, and only that one', async ({ page }) => {
    await page.goto('/features/stage/');
    await page.locator('[data-rack-btn]').click();
    const current = page.locator('#rack-panel a[aria-current="page"]');
    await expect(current).toHaveCount(1);
    await expect(current.locator('.mm__name')).toHaveText('Stage mode');
    await expect(current.locator('.mm__name')).toHaveCSS('color', LIME);
    await expect(current.locator('.mm__cell')).toHaveCSS('background-color', LIME);
    await page.goto('/');
    await page.locator('[data-rack-btn]').click();
    await expect(page.locator('#rack-panel a[aria-current="page"]')).toHaveCount(0);
  });

  test('keyboard: Enter opens and focuses the first link, Tab reads column by column, Esc closes and returns focus', async ({ page }) => {
    await page.goto('/features/stage/');
    const btn = page.locator('[data-rack-btn]');
    const panel = page.locator('#rack-panel');
    // On the first page of a visit the bar draws itself in: its controls can take focus once they show.
    await expect(btn).toBeVisible();
    await btn.focus();
    await expect(btn).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(panel).toBeVisible();
    await expect.poll(() => active(page)).toBe('/features/calendar-gigs/');
    const seen = ['/features/calendar-gigs/'];
    for (let i = 0; i < 10; i++) { await page.keyboard.press('Tab'); seen.push(await active(page)); }
    expect(seen).toEqual([
      '/features/calendar-gigs/', '/features/quotes-contracts/', '/features/money/',
      '/features/rehearsals-polls/', '/features/people/', '/features/chat/',
      '/features/songs/', '/features/stage/', '/features/stage-plot-rider/',
      '/features/privacy/', '/features/devices/',
    ]);
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(btn).toBeFocused();
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
  });

  test('keyboard: Space and ↓ open it too; Tab out of either end closes it and goes back to the button', async ({ page }) => {
    await page.goto('/features/stage/');
    const btn = page.locator('[data-rack-btn]');
    const panel = page.locator('#rack-panel');
    // On the first page of a visit the bar draws itself in: its controls can take focus once they show.
    await expect(btn).toBeVisible();
    await btn.focus();
    await expect(btn).toBeFocused();
    await page.keyboard.press('Space');
    await expect(panel).toBeVisible();
    await expect.poll(() => active(page)).toBe('/features/calendar-gigs/');
    // Back out of the first link.
    await page.keyboard.press('Shift+Tab');
    await expect(panel).toBeHidden();
    await expect(btn).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(panel).toBeVisible();
    await expect.poll(() => active(page)).toBe('/features/calendar-gigs/');
    // Forward out of the last one ("All eleven on one page").
    await panel.locator('a.mm__all').focus();
    await page.keyboard.press('Tab');
    await expect(panel).toBeHidden();
    await expect(btn).toBeFocused();
  });

  test('hover opens it after a moment; a click on the dimmed page closes it', async ({ page }) => {
    await page.goto('/features/stage/');
    const panel = page.locator('#rack-panel');
    await page.locator('[data-rack-btn]').hover();
    await expect(panel).toBeVisible();
    await page.mouse.click(700, 760);
    await expect(panel).toBeHidden();
  });

  test('reduced motion: the panel only fades (it never moves)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/features/stage/');
    const panel = page.locator('#rack-panel');
    const moved: string[] = [];
    await page.exposeFunction('bwSeen', (t: string) => { moved.push(t); });
    await page.evaluate(() => {
      const p = document.querySelector<HTMLElement>('#rack-panel')!;
      new MutationObserver(() => (window as unknown as { bwSeen: (t: string) => void }).bwSeen(p.style.transform + '|' + p.style.clipPath)).observe(p, { attributes: true, attributeFilter: ['style'] });
    });
    await page.locator('[data-rack-btn]').click();
    await expect(panel).toBeVisible();
    await expect(panel).toHaveCSS('opacity', '1');
    expect(moved.filter((t) => /translate\(0px, -|translate3d\(0px, -|inset/.test(t))).toEqual([]);
  });

  test('the header: FAQ in the deck, the account and the app as before, one line even when it tightens', async ({ page }) => {
    await page.goto('/features/stage/');
    await expect(page.locator('.nav__deck .nav__item .sr-only')).toHaveText(['Features', 'How it works', 'Guide', 'FAQ']);
    await expect(page.locator('.nav__deck a[href="/faq/"]')).toBeVisible();
    await expect(page.locator('.nav__login')).toBeVisible();
    await expect(page.locator('.nav__cta')).toHaveAttribute('href', '/get/');
    await page.evaluate(() => window.scrollTo(0, 1800));
    await expect(page.locator('header.nav')).toHaveClass(/is-tight/);
    await page.waitForTimeout(1000);
    const heights = await page.locator('.nav__deck .nav__item').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
    expect(Math.max(...heights), 'a deck label wrapped').toBeLessThanOrEqual(40);
    // The panel follows the tightened header.
    await page.locator('[data-rack-btn]').click();
    const [n, p] = await Promise.all([page.locator('header.nav').boundingBox(), page.locator('#rack-panel').boundingBox()]);
    expect(Math.abs(n!.width - p!.width)).toBeLessThanOrEqual(2);
  });

  test('on the FAQ page the deck marks it', async ({ page }) => {
    await page.goto('/faq/');
    await expect(page.locator('.nav__deck a[href="/faq/"]')).toHaveAttribute('aria-current', 'page');
  });
});

test.describe('menu sheet (phones and tablets)', () => {
  test.beforeEach(async ({ page }, info) => {
    test.skip(info.project.name !== 'site-phone', 'the sheet exists up to 1080px');
    await quiet(page);
  });
  const openSheet = async (page: Page) => {
    await page.locator('[data-menu-btn]').click();
    await expect(page.locator('#menu')).toBeVisible();
    await page.waitForTimeout(700);
  };

  test('account first, the four groups on the first screen, the app pinned at the bottom', async ({ page }) => {
    await page.goto('/');
    await openSheet(page);
    const sheet = page.locator('#menu');
    await expect(page.locator('[data-menu-btn]')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('[data-menu-btn]')).toHaveAttribute('aria-label', 'Close menu');
    const vh = page.viewportSize()!.height;
    // Log in and Sign up come before anything else.
    const order = await sheet.locator('a[href]:visible, button:visible').evaluateAll((els) => els.slice(0, 6).map((e) => (e.querySelector('.acc__t') ?? e).textContent!.trim()));
    expect(order).toEqual(['Log in', 'Sign up', 'Book & get paid', 'Line up the band', 'Play the show', 'Built in']);
    // On Home no page is the current one: the four groups are closed and all fit above the pinned button.
    await expect(sheet.locator('[data-acc-btn][aria-expanded="true"]')).toHaveCount(0);
    const cta = sheet.locator('.sheet__cta a');
    await expect(cta).toBeVisible();
    const ctaBox = (await cta.boundingBox())!;
    expect(ctaBox.y + ctaBox.height).toBeLessThanOrEqual(vh);
    expect(ctaBox.y).toBeGreaterThan(vh * 0.75);
    const lastHead = (await sheet.locator('[data-acc-btn]').nth(3).boundingBox())!;
    expect(lastHead.y + lastHead.height).toBeLessThanOrEqual(ctaBox.y);
    // The one lime button of the screen.
    await expect(cta).toHaveCSS('background-color', LIME);
    // It stays where it is when the sheet scrolls.
    await sheet.locator('[data-menu-scroll]').evaluate((el) => el.scrollTo(0, el.scrollHeight));
    expect(Math.abs((await cta.boundingBox())!.y - ctaBox.y)).toBeLessThanOrEqual(1);
    // At the end: three chips, then the language.
    await expect(sheet.locator('.sheet__util a')).toHaveText(['How it works', 'Guide', 'FAQ']);
    const chips = (await sheet.locator('.sheet__util').boundingBox())!;
    const lang = (await sheet.locator('[data-lang-switch]').boundingBox())!;
    expect(lang.y).toBeGreaterThanOrEqual(chips.y + chips.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });

  test('the current page’s group is open and its row is marked; one group open at a time', async ({ page }) => {
    await page.goto('/features/stage/');
    await openSheet(page);
    const sheet = page.locator('#menu');
    const heads = sheet.locator('[data-acc-btn]');
    await expect(heads.nth(2)).toHaveAttribute('aria-expanded', 'true');
    for (const i of [0, 1, 3]) await expect(heads.nth(i)).toHaveAttribute('aria-expanded', 'false');
    const current = sheet.locator('a.acc__row[aria-current="page"]');
    await expect(current).toHaveCount(1);
    await expect(current).toBeVisible();
    await expect(current.locator('b')).toHaveText('Stage mode');
    await expect(current.locator('b')).toHaveCSS('color', LIME);
    // Closed groups keep their rows out of sight and out of the tab order.
    await expect(sheet.locator('a[href="/features/money/"]')).toBeHidden();
    // Another group: it opens, the first one closes.
    await heads.nth(0).click();
    await expect(heads.nth(0)).toHaveAttribute('aria-expanded', 'true');
    await expect(heads.nth(2)).toHaveAttribute('aria-expanded', 'false');
    await expect(sheet.locator('a[href="/features/money/"]')).toBeVisible();
    await expect(current).toBeHidden();
    // The same head again closes it.
    await heads.nth(0).click();
    await expect(sheet.locator('[data-acc-btn][aria-expanded="true"]')).toHaveCount(0);
    // Closing and reopening the sheet starts again from the page you are on.
    await page.locator('[data-menu-btn]').click();
    await expect(sheet).toBeHidden();
    await openSheet(page);
    await expect(heads.nth(2)).toHaveAttribute('aria-expanded', 'true');
  });

  test('every control is at least 44px tall, and a row leads to its page', async ({ page }) => {
    await page.goto('/features/stage/');
    await openSheet(page);
    const sheet = page.locator('#menu');
    const small = await sheet.locator('a[href]:visible, button:visible').evaluateAll((els) => els
      .map((e) => ({ t: e.textContent!.trim().slice(0, 24), h: e.getBoundingClientRect().height, w: e.getBoundingClientRect().width }))
      .filter((x) => x.h < 43.5 || x.w < 43.5).map((x) => `${x.t} ${Math.round(x.w)}×${Math.round(x.h)}`));
    expect(small).toEqual([]);
    expect((await page.locator('[data-menu-btn]').boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await sheet.locator('a[href="/features/songs/"]').click();
    await expect(page).toHaveURL(/\/features\/songs\/$/);
    await expect(page.locator('#menu')).toBeHidden();
  });

  test('focus stays inside the sheet, the page behind is inert, Esc closes and returns focus', async ({ page }) => {
    await page.goto('/features/stage/');
    await openSheet(page);
    const btn = page.locator('[data-menu-btn]');
    expect(await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('main, footer')].every((el) => el.inert))).toBe(true);
    // From the last control, Tab goes to the close button; from it, Shift+Tab goes to the last control.
    await page.locator('#menu .sheet__cta a').focus();
    await page.keyboard.press('Tab');
    await expect(btn).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#menu .sheet__cta a')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#menu')).toBeHidden();
    await expect(btn).toBeFocused();
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('main, footer')].some((el) => el.inert))).toBe(false);
  });

  test('reduced motion: the sheet only fades', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/features/stage/');
    await page.locator('[data-menu-btn]').click();
    const sheet = page.locator('#menu');
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveCSS('opacity', '1');
    expect(await sheet.evaluate((el) => (el as HTMLElement).style.clipPath)).toBe('');
  });

  for (const [lang, show] of [['it', 'Fai lo show'], ['es', 'Sal a tocar']] as const) {
    test(`/${lang}/: the groups are translated and nothing is cut`, async ({ page }) => {
      await page.goto(`/${lang}/features/stage/`);
      await openSheet(page);
      const sheet = page.locator('#menu');
      await expect(sheet.locator('[data-acc-btn][aria-expanded="true"] .acc__t')).toHaveText(show);
      await expect(sheet.locator('a.acc__row[aria-current="page"]')).toHaveAttribute('href', `/${lang}/features/stage/`);
      const cut = await sheet.locator('.acc__t, .acc__row b, .sheet__door, .sheet__util a, .menu__cta').evaluateAll((els) => els
        .filter((e) => (e as HTMLElement).offsetParent !== null && e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent!.trim()));
      expect(cut).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    });
  }
});

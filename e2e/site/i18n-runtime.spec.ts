import { expect, test, type Page } from '@playwright/test';
import { appendFileSync } from 'fs';

/**
 * What the scripts write on /it/ and /es/ (demos, the capacity counter, the
 * home explorer, form replies) is in the page's language too. The page's
 * translator collects every unit its dictionary lacks in
 * window.__bwI18nMisses; after using every control of the page it must be
 * empty. The built HTML itself is checked by site/test/i18n.test.ts.
 */

const PAGES = [
  '', 'get/', 'features/calendar-gigs/', 'features/quotes-contracts/', 'features/money/', 'features/rehearsals-polls/',
  'features/chat/', 'features/songs/', 'features/stage/', 'features/stage-plot-rider/', 'features/people/',
  'features/privacy/', 'features/devices/', 'faq/',
];

async function stubNetwork(page: Page, state: 'open' | 'invites' | 'full') {
  await page.route(/google-analytics\.com\/(g|mp)\/collect/, (r) => r.fulfill({ status: 204, body: '' }));
  await page.route('**/api/geo', (r) => r.fulfill({ contentType: 'application/json', body: '{"country":null}' }));
  const cap = {
    open: { cap: 300, reserved: 45, taken: 142, public_left: 113, invite_left: 158, state: 'open' },
    invites: { cap: 300, reserved: 45, taken: 271, public_left: 0, invite_left: 29, state: 'invites' },
    full: { cap: 300, reserved: 45, taken: 300, public_left: 0, invite_left: 0, state: 'full' },
  }[state];
  await page.route('**/rest/v1/rpc/bw_capacity_status', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(cap) }));
  await page.route('**/rest/v1/rpc/bw_join_waitlist', (r) => r.fulfill({ contentType: 'application/json', body: '{"ok":true,"position":37}' }));
}

async function misses(page: Page) {
  const [list, hits] = await page.evaluate(() => {
    const w = window as unknown as { __bwI18nMisses?: Set<string>; __bwI18nHits?: Set<string> };
    return [[...(w.__bwI18nMisses ?? [])], [...(w.__bwI18nHits ?? [])]];
  });
  // BW_I18N_DUMP=file: what's missing (for translators) and what was used (one JSON line per page).
  if (process.env.BW_I18N_DUMP) appendFileSync(process.env.BW_I18N_DUMP, JSON.stringify({ url: page.url(), list, hits }) + '\n');
  return list;
}

/** Presses every button, tab and radio in `scope` (twice: some appear only after a first press). */
async function useControls(page: Page, scope: string) {
  for (let pass = 0; pass < 2; pass++) {
    const n = await page.locator(`${scope} button, ${scope} [role="tab"], ${scope} [role="radio"]`).count();
    for (let i = 0; i < Math.min(n, 80); i++) {
      const el = page.locator(`${scope} button, ${scope} [role="tab"], ${scope} [role="radio"]`).nth(i);
      if (!(await el.isVisible().catch(() => false)) || (await el.isDisabled().catch(() => true))) continue;
      await el.click({ timeout: 1500, force: true }).catch(() => {});
      await page.waitForTimeout(120);
    }
  }
}

test.describe.configure({ mode: 'parallel' });

for (const lang of ['it', 'es'] as const) {
  for (const p of PAGES) {
    test(`/${lang}/${p}: every script-written text is translated`, async ({ page }, info) => {
      test.skip(info.project.name !== 'site-desktop', 'one browser is enough for text');
      test.setTimeout(120_000);
      await stubNetwork(page, 'open');
      await page.goto(`/${lang}/${p}`);
      await expect(page.locator('html')).toHaveAttribute('data-lang-checked', /.+/);
      // Scroll through, so scroll-driven scenes write their text.
      const h = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0; y < h; y += 500) { await page.mouse.wheel(0, 500); await page.waitForTimeout(60); }
      await useControls(page, '#try');
      await useControls(page, '#rack');
      await useControls(page, '#roles');
      await useControls(page, '[data-flow]');
      await page.waitForTimeout(600);
      expect(await misses(page)).toEqual([]);
    });
  }

  for (const state of ['invites', 'full'] as const) {
    test(`/${lang}/get/ with capacity ${state}: counter and waitlist are translated`, async ({ page }, info) => {
      test.skip(info.project.name !== 'site-desktop', 'one browser is enough for text');
      await stubNetwork(page, state);
      await page.goto(`/${lang}/get/`);
      await expect(page.locator('html')).toHaveAttribute('data-lang-checked', /.+/);
      await page.waitForTimeout(400);
      const form = page.locator('[data-beta-form="waitlist"]');
      if (await form.isVisible()) {
        await form.locator('button[type="submit"]').click();
        await form.locator('input[name="email"]').fill('not-an-email');
        await form.locator('input[name="email"]').blur();
        await form.locator('input[name="email"]').fill('someone@example.com');
        await form.locator('button[type="submit"]').click();
        await expect(form.locator('[data-form-done]')).toBeVisible();
      }
      const onGet = await misses(page);
      await page.goto(`/${lang}/`);
      await page.waitForTimeout(400);
      expect([...onGet, ...(await misses(page))]).toEqual([]);
    });
  }
}

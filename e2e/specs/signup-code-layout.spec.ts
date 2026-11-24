import { test, expect, DB_KEY, DEMO_USER_ID, type App } from '../fixtures';
import { systemBack } from '../support/flows';
import { showKeyboard } from '../support/keyboard';

/**
 * "Check your email" (the 6-digit code after Create account), as the device
 * pass of 23 Nov found it:
 * - closed iPhone Duo, upright: the title and the first line of the text ran
 *   under the clock / camera block;
 * - keyboard up on a short view (a phone in landscape, the closed Duo, the
 *   Duo as a book, an iPad in landscape): Verify ended under the keyboard,
 *   and on a phone the top bar slid under the status bar;
 * - the system Back left for the Welcome screen, while the Back button on
 *   the screen goes back to Create account with the fields kept.
 *
 * (The flow itself: signup-code.spec.ts.)
 */

const EMAIL = 'alex.rivera@example.com';
const NAME = 'Alex Rivera';
const WRONG = 'That code doesn’t match. Check it and try again, or send a new one.';

/** A new person on this device: signed out, no band yet, confirmation on. */
async function asNewPerson(app: App) {
  await app.page.evaluate(
    ({ k, me }) => {
      const d = JSON.parse(localStorage.getItem(k) || '{}');
      d.band_members = (d.band_members || []).filter((m: { user_id: string }) => m.user_id !== me);
      d.demo_deputy_gigs = [];
      d.band_deputies = (d.band_deputies || []).filter((x: { user_id?: string }) => x.user_id !== me);
      localStorage.setItem(k, JSON.stringify(d));
      for (const key of Object.keys(localStorage)) if (key.startsWith('bw:')) localStorage.removeItem(key);
      indexedDB.deleteDatabase('bandwith_offline_db');
      localStorage.removeItem('bw-demo-session');
      localStorage.setItem('bw-demo-confirm-email', '1');
    },
    { k: DB_KEY, me: DEMO_USER_ID },
  );
}

const heading = (app: App, source: string) => app.page.getByRole('heading', { name: new RegExp(app.t(source), 'i') }).first();
const codeField = (app: App) => app.page.getByLabel(app.t('Confirmation code'), { exact: true });
const verify = (app: App) => app.page.getByRole('button', { name: app.t('Verify'), exact: true });
const refusal = (app: App) => app.page.getByRole('alert').filter({ hasText: app.t(WRONG) });

/** Create account → Continue: lands on "Check your email". */
async function signUp(app: App) {
  await asNewPerson(app);
  await app.page.goto('/?start=signup');
  await expect(heading(app, 'Create account')).toBeVisible();
  await app.page.getByPlaceholder(app.t('Your name'), { exact: true }).fill(NAME);
  await app.page.getByPlaceholder('you@email.com', { exact: true }).fill(EMAIL);
  await app.page.getByPlaceholder(app.t('Password'), { exact: true }).fill('correct horse battery');
  await app.page.getByRole('button', { name: app.t('Continue'), exact: true }).click();
  await expect(heading(app, 'Check your email')).toBeVisible();
  await expect(codeField(app)).toBeVisible();
}

/**
 * The clock / camera block of the closed iPhone Duo as its simulator reports
 * it (iOS 27.2, `window.__bwRegions.status`): 84 × 174 pt, further down than
 * the profile's 82 pt, beside the title and the first line of the text.
 */
const DUO_CLOSED_BLOCK = { x: 382, y: 0, w: 84, h: 174, edge: 'right' as const };

test('@smoke the title and the text never run under the clock block', async ({ app, duo }) => {
  await signUp(app);
  if (test.info().project.name === 'duo-closed') {
    await app.page.evaluate((status) => {
      const w = window as unknown as { __bwApplyRegions: (r: unknown) => void; __bwRegions: object };
      w.__bwApplyRegions({ ...w.__bwRegions, status, viewport: { w: window.innerWidth, h: window.innerHeight } });
    }, DUO_CLOSED_BLOCK);
    await app.settle();
  }
  const under = await app.page.evaluate(() => {
    const s = (window as unknown as { __bwRegions?: { status?: { x: number; y: number; w: number; h: number } | null } }).__bwRegions?.status;
    if (!s) return [];
    const hits: string[] = [];
    const lines = (el: Element | null, what: string) => {
      if (!el) return hits.push(`${what}: not found`);
      const range = document.createRange();
      range.selectNodeContents(el);
      for (const r of Array.from(range.getClientRects())) {
        const x = Math.min(r.right, s.x + s.w) - Math.max(r.left, s.x);
        const y = Math.min(r.bottom, s.y + s.h) - Math.max(r.top, s.y);
        if (x > 1 && y > 1) hits.push(`${what}: ${Math.round(x)} pt under the block (line at y ${Math.round(r.top)})`);
      }
    };
    lines(document.querySelector('h1'), 'title');
    lines(document.querySelector('p[role="status"]'), 'text');
    return hits;
  });
  expect(under, duo ? `status block of ${test.info().project.name}` : 'no block here').toEqual([]);
  await app.check('Check your email, clear of the clock block');
});

/** The keyboard of each profile: what it leaves of the view, as on the simulators. */
const KEYBOARD_H: Record<string, number> = {
  'phone-portrait': 336,
  'phone-landscape': 180,
  android: 300,
  'ipad-landscape': 400,
  'ipad-portrait': 350,
  'duo-closed': 269,
  'duo-closed-landscape': 230,
  'duo-book': 221,
  'duo-open': 350,
};

/** Where a control is, and whether it shows there (nothing drawn over its middle). */
const seen = (app: App, control: ReturnType<typeof verify>) =>
  control.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      viewH: window.innerHeight,
      shows: !!at && (at === el || el.contains(at) || at.contains(el)),
      over: at && !(at === el || el.contains(at) || at.contains(el)) ? `${at.tagName}.${String(at.className).slice(0, 60)}` : undefined,
    };
  });

async function expectInSight(app: App, control: ReturnType<typeof verify>, what: string) {
  await expect
    .poll(async () => {
      const s = await seen(app, control);
      return s.top >= 0 && s.bottom <= s.viewH && s.shows ? 'in sight' : `${what}: ${JSON.stringify(s)}`;
    }, { message: `${what} shows whole above the keyboard` })
    .toBe('in sight');
}

test('@smoke keyboard up: the code field, a refused code’s message and Verify show above the keyboard', async ({ app }) => {
  const project = test.info().project.name;
  // Laptop pose: the field rests on the strip above the keys (fold-layers.spec.ts);
  // its buttons are reached with the keyboard down. Not this test's rule.
  test.skip(project === 'duo-laptop', 'the Laptop pose places the field itself');
  await signUp(app);
  // A phone or tablet: the status bar across the top (the Duo has its block instead).
  const statusBar = project.startsWith('duo') ? 0 : 47;
  if (statusBar) {
    await app.page.evaluate((h) => document.documentElement.style.setProperty('--safe-area-inset-top', `${h}px`), statusBar);
  }
  const keyboard = await showKeyboard(app, codeField(app), { height: KEYBOARD_H[project] ?? 300 });

  await expectInSight(app, codeField(app), 'the code field');
  await expectInSight(app, verify(app), 'Verify');

  // A refused code: its message shows too, not behind Verify.
  await codeField(app).fill('000000');
  await expect(refusal(app)).toBeVisible();
  await expectInSight(app, refusal(app), 'the refusal');
  await expectInSight(app, codeField(app), 'the code field');
  await expectInSight(app, verify(app), 'Verify');

  // The other buttons are reached by scrolling; the top bar then leaves the
  // screen, it does not slide under the clock.
  const last = app.page.getByRole('button', { name: app.t('I’ve confirmed it: sign in'), exact: true });
  await last.scrollIntoViewIfNeeded();
  await expectInSight(app, last, '"I’ve confirmed it: sign in"');
  if (statusBar) {
    const underClock = await app.page.evaluate((h) => {
      const found: string[] = [];
      for (const el of Array.from(document.querySelectorAll('.bw-auth-screen button, .bw-auth-screen h1, .bw-auth-screen p'))) {
        const r = el.getBoundingClientRect();
        if (r.height === 0 || r.bottom <= 2 || r.top >= h - 2) continue;
        const y = (Math.max(r.top, 0) + Math.min(r.bottom, h)) / 2;
        const at = document.elementFromPoint(r.left + Math.min(r.width / 2, 20), y);
        if (at && (at === el || el.contains(at))) found.push((el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 40));
      }
      return found;
    }, statusBar);
    expect(underClock, 'drawn under the status bar').toEqual([]);
  }
  await keyboard.hide();
});

test('@smoke the system Back on "Check your email" goes back to Create account, fields kept', async ({ app }) => {
  await signUp(app);
  await systemBack(app);
  await expect(heading(app, 'Create account')).toBeVisible();
  await expect(codeField(app)).toHaveCount(0);
  await expect(app.page.getByPlaceholder(app.t('Your name'), { exact: true })).toHaveValue(NAME);
  await expect(app.page.getByPlaceholder('you@email.com', { exact: true })).toHaveValue(EMAIL);
  await expect(app.page.getByPlaceholder(app.t('Password'), { exact: true })).toHaveValue('correct horse battery');
  await app.check('Create account, back from Check your email');

  // The form again: Continue leads to the code as before.
  await app.page.getByRole('button', { name: app.t('Continue'), exact: true }).click();
  await expect(heading(app, 'Check your email')).toBeVisible();
});

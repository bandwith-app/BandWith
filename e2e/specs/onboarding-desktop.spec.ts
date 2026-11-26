import { test, expect, DB_KEY, DEMO_USER_ID, type App } from '../fixtures';

/**
 * The onboarding in a computer's browser window (a tablet-sized window driven
 * by a mouse: src/app/components/onboarding/onboarding-desktop.css).
 *
 * - The screen fills its page on every step, whatever the window's height:
 *   a short step used to end with its content and the window's own colour
 *   showed below it (most of the lower half on "Check your email").
 * - The brand page's named steps and the header's "STEP 2 OF 6" are one
 *   count, on the band path and on the solo path, and nobody is told to set
 *   up a band before choosing one.
 * - A main button that can't be pressed yet doesn't look like one that can.
 * - "Check your email" reads field → Verify → two quiet ways out.
 *
 * Touch devices keep their own layout (the other specs run on them).
 */

const CODE = '482913';
const EMAIL = 'alex.rivera@example.com';

const WINDOWS = [
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1180 },
] as const;

/** A new person on this device: signed out, no band yet, email confirmation on. */
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
const button = (app: App, source: string) => app.page.getByRole('button', { name: app.t(source), exact: true });
const codeField = (app: App) => app.page.getByLabel(app.t('Confirmation code'), { exact: true });

/** The header's "STEP {step} OF {total}", or null on a screen without one (the finish). */
async function headerCount(app: App): Promise<{ step: number; total: number } | null> {
  const pattern = new RegExp(`^${app.t('Step {step} of {total}', { step: '(\\d+)', total: '(\\d+)' })}$`, 'i');
  const label = app.page.getByText(pattern).filter({ visible: true });
  if ((await label.count()) === 0) return null;
  const [, step, total] = ((await label.first().textContent()) ?? '').trim().match(pattern) ?? [];
  return { step: Number(step), total: Number(total) };
}

/**
 * The brand page beside the screen: its headline and its rows. A row is
 * "3 Name your band", "3–6 Your setup", or a name alone (the finish). The lit
 * row is the one at full strength (done rows and those to come are dimmed).
 * The page is decoration for screen readers (`aria-hidden`: the header says
 * the step), so it has no role to find it by.
 */
async function brandPage(app: App) {
  return app.page.locator('aside').filter({ hasText: 'BandWith' }).first().evaluate((aside) => {
    const rows = [...aside.querySelectorAll('ol > li')].map((li) => {
      const [, from = '', to = '', name = ''] = (li.textContent ?? '').trim().match(/^(?:(\d+)(?:\s*–\s*(\d+))?\s+)?(.*)$/) ?? [];
      return { from: from ? Number(from) : null, to: to ? Number(to) : from ? Number(from) : null, name, lit: getComputedStyle(li).opacity === '1' };
    });
    const list = aside.querySelector('ol');
    const headline = (list?.previousElementSibling as HTMLElement | null)?.innerText.replace(/\s+/g, ' ').trim() ?? '';
    return { headline, rows, box: aside.getBoundingClientRect().toJSON() as { right: number; bottom: number } };
  });
}

/** The header and the brand page say the same step of the same total. */
async function expectOneCount(app: App, where: string, opts: { band: boolean }) {
  const header = await headerCount(app);
  const brand = await brandPage(app);
  const numbered = brand.rows.filter((row) => row.from !== null);
  const lit = brand.rows.filter((row) => row.lit);
  expect(lit, `${where}: one row of the list is lit`).toHaveLength(1);
  // The numbers run 1…total with no gap.
  expect(numbered[0]?.from, `${where}: the list starts at 1`).toBe(1);
  numbered.slice(1).forEach((row, i) => expect(row.from, `${where}: "${row.name}" follows on`).toBe(numbered[i].to! + 1));
  const last = brand.rows[brand.rows.length - 1];
  expect(last.from, `${where}: the finish ("${last.name}") is not a numbered step`).toBeNull();
  if (header) {
    expect(numbered[numbered.length - 1].to, `${where}: the list ends on the header's total`).toBe(header.total);
    expect(lit[0].from, `${where}: the lit row is the header's step`).toBeLessThanOrEqual(header.step);
    expect(lit[0].to, `${where}: the lit row is the header's step`).toBeGreaterThanOrEqual(header.step);
  } else {
    expect(lit[0], `${where}: on the finish, the finish is lit`).toEqual(last);
  }
  const said = `${brand.headline} ${brand.rows.map((row) => row.name).join(' ')}`;
  if (!opts.band) expect(said, `${where}: no band before (or without) choosing one`).not.toMatch(/\bband/i);
}

/** The screen's own surface reaches the bottom of the window, right of the brand page. */
async function expectPageFilled(app: App, where: string) {
  await app.settle();
  const title = app.page.getByRole('heading', { level: 1 }).filter({ visible: true }).first();
  const page = await title.evaluate((el) => {
    // The surface the title is drawn on: the nearest ancestor with a colour of its own.
    let surface: HTMLElement | null = el as HTMLElement;
    while (surface && /^(rgba\(0, 0, 0, 0\)|transparent)$/.test(getComputedStyle(surface).backgroundColor)) surface = surface.parentElement;
    const box = (surface ?? document.body).getBoundingClientRect();
    const at = (x: number, y: number) => !!surface && surface.contains(document.elementFromPoint(x, y));
    const mid = box.left + box.width / 2;
    return {
      isBody: !surface || surface === document.body,
      left: box.left,
      right: box.right,
      top: box.top,
      bottom: box.bottom,
      w: innerWidth,
      h: innerHeight,
      // Just above the window's bottom edge, in the middle and near both sides.
      underneath: [at(mid, innerHeight - 3), at(box.left + 8, innerHeight - 3), at(box.right - 8, innerHeight - 3)],
      overflowX: document.documentElement.scrollWidth - innerWidth,
    };
  });
  const brand = await brandPage(app).catch(() => null);
  expect(page.isBody, `${where}: the screen has a surface of its own`).toBe(false);
  expect(page.top, `${where}: starts at the top of the window`).toBeLessThanOrEqual(0.5);
  expect(page.bottom, `${where}: reaches the bottom of the window (${page.h})`).toBeGreaterThanOrEqual(page.h - 0.5);
  expect(page.right, `${where}: reaches the right edge`).toBeGreaterThanOrEqual(page.w - 0.5);
  if (brand) {
    expect(Math.abs(page.left - brand.box.right), `${where}: starts where the brand page ends`).toBeLessThanOrEqual(1.5);
    expect(brand.box.bottom, `${where}: the brand page is as tall as the window`).toBeGreaterThanOrEqual(page.h - 0.5);
  }
  expect(page.underneath, `${where}: nothing else shows above the window's bottom edge`).toEqual([true, true, true]);
  expect(page.overflowX, `${where}: nothing wider than the window`).toBeLessThanOrEqual(0);
}

/** A step is right when its page is filled, its counts agree and the usual health rules hold. */
async function expectStep(app: App, where: string, opts: { band: boolean }) {
  await expectPageFilled(app, where);
  await expectOneCount(app, where, opts);
  await app.check(where);
}

/** Welcome → Create account → Check your email → the code: "What brings you here?". */
async function toChoice(app: App, each: (where: string) => Promise<void>) {
  await asNewPerson(app);
  await app.page.goto('/?start=signup');
  await expect(heading(app, 'Create account')).toBeVisible();
  await each('Create account');
  await app.page.getByPlaceholder(app.t('Your name'), { exact: true }).fill('Alex Rivera');
  await app.page.getByPlaceholder('you@email.com', { exact: true }).fill(EMAIL);
  await app.page.getByPlaceholder(app.t('Password'), { exact: true }).fill('correct horse battery');
  await button(app, 'Continue').click();
  await expect(heading(app, 'Check your email')).toBeVisible();
  await each('Check your email');
  await codeField(app).fill(CODE);
  await expect(heading(app, 'What brings you here?')).toBeVisible();
  await each('What brings you here?');
}

for (const size of WINDOWS) {
  test.describe(`a ${size.width}×${size.height} window on a computer`, () => {
    // A mouse, no touch: what tells a computer from a tablet of the same size.
    test.use({ viewport: size, screen: size, hasTouch: false, isMobile: false, deviceScaleFactor: 1 });
    test.beforeEach(async ({ app }) => {
      test.skip(test.info().project.name !== 'ipad-landscape', 'a computer-window check: one profile is enough');
      expect(app.page.viewportSize()).toEqual(size);
      expect(await app.page.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches), 'a mouse, not a finger').toBe(true);
    });

    test('band path: every step fills the window and the two step counts agree', async ({ app }) => {
      const undecided = (where: string) => expectStep(app, where, { band: false });
      const band = (where: string) => expectStep(app, where, { band: true });
      await toChoice(app, undecided);

      await app.page.getByRole('radio', { name: new RegExp(app.t('Manage my band'), 'i') }).click();
      await undecided('What brings you here?, band chosen');
      await button(app, 'Continue').click();
      await expect(heading(app, 'Name your band')).toBeVisible();
      await band('Name your band');
      expect((await headerCount(app))?.total, 'the band path has six steps').toBe(6);

      await app.page.getByPlaceholder('The Groovemasters').fill('Night Owls');
      await button(app, 'Continue').click();
      await expect(heading(app, 'Tell us about you')).toBeVisible({ timeout: 15_000 });
      await band('About you');

      await app.page.getByPlaceholder(app.t('Your name'), { exact: true }).fill('Alex Rivera');
      await button(app, 'Guitar').click();
      await button(app, 'Continue').click();
      await expect(heading(app, 'Invite your bandmates')).toBeVisible();
      await band('Invite bandmates');

      await button(app, 'Skip for now').click();
      await expect(heading(app, 'Build your repertoire')).toBeVisible();
      await band('Build your repertoire');

      await button(app, 'Skip for now').click();
      await expect(heading(app, 'Ready to rock.')).toBeVisible();
      await expect(button(app, 'Go to dashboard')).toBeVisible();
      await band('Ready to rock');
    });

    test('solo path: every step fills the window, three steps, and no band', async ({ app }) => {
      const solo = (where: string) => expectStep(app, where, { band: false });
      await toChoice(app, solo);

      await app.page.getByRole('radio', { name: new RegExp(app.t('Solo schedule'), 'i') }).click();
      await button(app, 'Continue').click();
      await expect(heading(app, 'Tell us about you')).toBeVisible();
      await solo('About you (solo)');
      expect(await headerCount(app), 'the solo path has three steps').toEqual({ step: 3, total: 3 });

      await app.page.getByPlaceholder(app.t('Your name'), { exact: true }).fill('Alex Rivera');
      await button(app, 'Guitar').click();
      await button(app, 'Continue').click();
      await expect(heading(app, 'Ready to rock.')).toBeVisible();
      await expect(button(app, 'Go to dashboard')).toBeVisible();
      await solo('Ready to rock (solo)');
    });
  });
}

test.describe('a 1440×900 window on a computer: the controls', () => {
  const size = WINDOWS[0];
  test.use({ viewport: size, screen: size, hasTouch: false, isMobile: false, deviceScaleFactor: 1 });
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'ipad-landscape', 'a computer-window check: one profile is enough');
  });

  /** What a button is painted with. */
  const paint = (app: App, source: string) =>
    button(app, source).evaluate((el) => {
      const s = getComputedStyle(el);
      return { fill: s.backgroundColor, text: s.color, opacity: s.opacity };
    });

  test('a main button that can’t be pressed yet is not a dimmed lime one', async ({ app }) => {
    await toChoice(app, async () => {});
    const continueButton = button(app, 'Continue');
    await expect(continueButton).toBeDisabled();
    const resting = await paint(app, 'Continue');
    // Solid and neutral: not the lime at 40% that turns olive on a dark page.
    expect(resting.opacity).toBe('1');

    await app.page.getByRole('radio', { name: new RegExp(app.t('Solo schedule'), 'i') }).click();
    await expect(continueButton).toBeEnabled();
    const ready = await paint(app, 'Continue');
    expect(ready.opacity).toBe('1');
    expect(resting.fill, 'the fill changes with the state, not only its strength').not.toBe(ready.fill);
    expect(resting.text).not.toBe(ready.text);
    await app.check('What brings you here?, solo chosen');
  });

  test('the chosen path is marked on its card, and only there', async ({ app }) => {
    await toChoice(app, async () => {});
    const solo = app.page.getByRole('radio', { name: new RegExp(app.t('Solo schedule'), 'i') });
    const band = app.page.getByRole('radio', { name: new RegExp(app.t('Manage my band'), 'i') });
    const ring = (card: typeof solo) => card.evaluate((el) => getComputedStyle(el).boxShadow);
    // Both say what a click does; neither is marked.
    await expect(solo.getByText(app.t('Select'), { exact: true })).toBeVisible();
    await expect(band.getByText(app.t('Select'), { exact: true })).toBeVisible();
    expect(await ring(band)).toBe('none');

    await band.click();
    await expect(band).toBeChecked();
    await expect(solo).not.toBeChecked();
    await expect(band.getByText(app.t('Selected'), { exact: true })).toBeVisible();
    await expect(solo.getByText(app.t('Select'), { exact: true })).toBeVisible();
    await expect.poll(() => ring(band), 'a ring around the chosen card').not.toBe('none');
    expect(await ring(solo)).toBe('none');
    // The mark on the card is a filled pill, not a line of text beside a dotted icon.
    const mark = (card: typeof solo, source: string) =>
      card
        .getByText(app.t(source), { exact: true })
        .evaluate((el) => getComputedStyle(el.parentElement as HTMLElement).backgroundColor);
    await expect.poll(() => mark(band, 'Selected')).not.toBe('rgba(0, 0, 0, 0)');
    expect(await mark(solo, 'Select')).toBe('rgba(0, 0, 0, 0)');
    await app.check('What brings you here?, band chosen');
  });

  test('Check your email: the field, then Verify, then two quiet links, on one measure', async ({ app }) => {
    await asNewPerson(app);
    await app.page.goto('/?start=signup');
    await expect(heading(app, 'Create account')).toBeVisible();
    await app.page.getByPlaceholder(app.t('Your name'), { exact: true }).fill('Alex Rivera');
    await app.page.getByPlaceholder('you@email.com', { exact: true }).fill(EMAIL);
    await app.page.getByPlaceholder(app.t('Password'), { exact: true }).fill('correct horse battery');
    await button(app, 'Continue').click();
    await expect(heading(app, 'Check your email')).toBeVisible();
    await app.settle();

    const field = codeField(app);
    const verify = button(app, 'Verify');
    // Resting the minute after the sign-up's email: "Send a new code (60 s)".
    const resend = app.page.getByRole('button', { name: new RegExp(`^${app.t('Send a new code')}`) });
    const usedLink = button(app, 'I’ve confirmed it: sign in');
    const box = async (l: typeof field) => (await l.boundingBox())!;
    const [f, v, r, u] = [await box(field), await box(verify), await box(resend), await box(usedLink)];

    // Top to bottom: field, Verify, the two links (side by side or stacked, never above Verify).
    expect(v.y).toBeGreaterThan(f.y + f.height);
    expect(Math.min(r.y, u.y)).toBeGreaterThanOrEqual(v.y + v.height);
    // One measure: Verify is no wider than a code field needs, and the links stay inside it.
    expect(v.width, 'Verify is not a window-wide bar').toBeLessThanOrEqual(420);
    for (const b of [r, u]) {
      expect(b.x).toBeGreaterThanOrEqual(v.x - 1);
      expect(b.x + b.width).toBeLessThanOrEqual(v.x + v.width + 1);
    }
    // Quiet: smaller and lighter than the main button, and not as tall.
    const type = (l: typeof field) =>
      l.evaluate((el) => {
        const s = getComputedStyle(el);
        return { size: parseFloat(s.fontSize), color: s.color };
      });
    const [main, quiet, other] = [await type(verify), await type(resend), await type(usedLink)];
    expect(quiet.size).toBeLessThan(main.size);
    expect(other.size).toBe(quiet.size);
    expect(r.height).toBeLessThan(v.height);
    // The digits are the largest thing in the form.
    expect((await type(field)).size).toBeGreaterThanOrEqual(24);
    // A refused code keeps the order.
    await field.fill('000000');
    await expect(app.page.getByRole('alert').first()).toBeVisible();
    expect((await box(verify)).y).toBeGreaterThan((await box(field)).y);
    await expectPageFilled(app, 'Check your email, wrong code');
    await app.check('Check your email, wrong code');
  });
});

import { test, expect, type App } from '../fixtures';
import { openEvent, eventDetail, SEED } from '../support/flows';
import { readableText } from '../support/event';

/**
 * Privacy (plan 11-13): a member sees only their own fee and the logistics.
 * Never the gig price, the client, or the other musicians' fees, and nothing
 * to edit. Runs on every device profile (@smoke): the layout differs per
 * orientation and posture, the rule doesn't.
 */

const GIGS = [
  { title: SEED.gigToday, client: 'Aurora Events', price: ['€1,800', '€1.8k', '1,800'] },
  { title: SEED.corporateGig, client: 'Northwind', price: ['€4,500', '€4.5k', '4,500'] },
];
// Seed: Leo €300, everyone else €250 (5 musicians, payouts €1,300).
const OTHERS_FEES = ['€250', '€1,300', '€1.3k'];

/** The text (and accessible names) must not contain any of `words`, now or a moment later. */
async function expectNever(app: App, words: string[], where: string, ms = 1500) {
  const deadline = Date.now() + ms;
  do {
    const text = (await readableText(app)).toLowerCase();
    const seen = words.filter((w) => text.includes(w.toLowerCase()));
    expect(seen, `${where} shows ${seen.join(', ')}`).toEqual([]);
    await app.page.waitForTimeout(250);
  } while (Date.now() < deadline);
}

/**
 * A slow device (the emulator pass ran on a machine at load 300+): reads of
 * the offline cache (IndexedDB) answer only after `ms`, so they land after
 * the fresh answer from the server. From the next page load on.
 */
async function slowOfflineCache(app: App, ms = 2500) {
  await app.page.addInitScript((delay) => {
    const get = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['get']>) {
      const req = get.apply(this, args);
      let handler: ((this: IDBRequest, ev: Event) => unknown) | null = null;
      Object.defineProperty(req, 'onsuccess', {
        configurable: true,
        get: () => handler,
        set: (fn) => {
          handler = fn;
          req.addEventListener('success', (ev) => setTimeout(() => handler?.call(req, ev), delay), { once: true });
        },
      });
      return req;
    };
  }, ms);
}

async function expectNoEditing(app: App) {
  const detail = eventDetail(app);
  for (const label of ['Edit title, date & times', 'Edit venue', 'Edit fee']) {
    await expect(detail.getByRole('button', { name: app.t(label) })).toHaveCount(0);
  }
  for (const label of ['EDIT', 'ADD MUSICIAN', 'DELETE', 'REVERT TO QUOTE']) {
    await expect(detail.getByRole('button', { name: app.t(label), exact: true })).toHaveCount(0);
  }
  await expect(detail.getByRole('button', { name: new RegExp(`^${app.t('EDIT')}:`) })).toHaveCount(0);
}

test.describe('member: band gigs are read-only and private', () => {
  test.use({ role: 'member' });
  test.describe.configure({ retries: 0 });

  for (const gig of GIGS) {
    test(`@smoke ${gig.title}: no edit controls, no client, no price, no colleagues' fees`, async ({ app }) => {
      await openEvent(app, gig.title);
      await expectNoEditing(app);
      await expectNever(app, [gig.client, ...gig.price, ...OTHERS_FEES], `member's ${gig.title}`);
      await app.check(`member ${gig.title}`);
    });
  }

  test('@smoke the rehearsal is read-only', async ({ app }) => {
    await openEvent(app, SEED.rehearsalTomorrow);
    await expectNoEditing(app);
    await expect(eventDetail(app).getByRole('button', { name: new RegExp(`^${app.t('EDIT')}`) })).toHaveCount(0);
    await app.check('member rehearsal');
  });

  test('@smoke Home and Calendar never show a client or a gig price', async ({ app }) => {
    await expectNever(app, [...GIGS.map((g) => g.client), ...GIGS.flatMap((g) => g.price)], 'member Home');
    await app.tab('Calendar');
    await expectNever(app, [...GIGS.map((g) => g.client), ...GIGS.flatMap((g) => g.price)], 'member Calendar');
  });

  test('own fee is shown on the gig', async ({ app }) => {
    await openEvent(app, SEED.gigToday);
    await expect(eventDetail(app).getByText(app.t('YOUR FEE'), { exact: false }).first()).toBeVisible();
    await expect.poll(async () => (await readableText(app)).includes('€300')).toBe(true);
  });
});

test.describe('admin hands the band over: same device, now a member', () => {
  // A leak that shows only now and then must still fail the build.
  test.describe.configure({ retries: 0 });
  // The device testers switched roles on one phone (role.sh): what the app
  // cached while the user was admin must not leak once they are a member.
  test('@smoke the cached client and price are gone after the role changes to member', async ({ app }) => {
    await openEvent(app, SEED.gigToday);
    await expect(eventDetail(app).getByText(/Aurora Events/i).first()).toBeVisible();
    await app.setRole('member', { keepOfflineCache: true });
    await openEvent(app, SEED.gigToday);
    await expectNever(app, ['Aurora Events', '€1,800', ...OTHERS_FEES], "former admin's gig as member", 4000);
  });

  test('@smoke on a slow device too: the cached client never reaches the member', async ({ app }) => {
    await openEvent(app, SEED.gigToday);
    await expect(eventDetail(app).getByText(/Aurora Events/i).first()).toBeVisible();
    await slowOfflineCache(app);
    await app.setRole('member', { keepOfflineCache: true });
    await expectNever(app, ['Aurora Events', '€1,800', ...OTHERS_FEES], 'former admin, now member: Home', 3500);
    await openEvent(app, SEED.gigToday);
    await expectNever(app, ['Aurora Events', '€1,800', ...OTHERS_FEES], "former admin's gig as member (slow cache)", 4000);
  });
});

test.describe('a member is made admin: same device, cache kept', () => {
  test.use({ role: 'member' });
  // The emulator pass (11-16): the member-shaped rows the device cached (no
  // client, no price) hid the client from the new admin until the cache was
  // cleared by hand, and Create contract came up with an empty client.
  test('@smoke the new admin sees the client, and a new contract is filled in', async ({ app }) => {
    await openEvent(app, SEED.gigToday);
    await expectNever(app, ['Aurora Events'], "member's gig", 500);
    await slowOfflineCache(app);
    await app.setRole('admin', { keepOfflineCache: true });
    await openEvent(app, SEED.gigToday);
    await expect(eventDetail(app).getByText(/Aurora Events/i).first()).toBeVisible();
    const row = eventDetail(app).getByRole('button', { name: new RegExp(app.t('No contract yet')) });
    await row.scrollIntoViewIfNeeded();
    await row.click();
    await app.settle();
    await expect(app.page.getByRole('heading', { name: app.t('Create contract'), exact: true })).toBeVisible();
    const values = () => app.page.locator('input').evaluateAll((xs) => xs.map((x) => (x as HTMLInputElement).value));
    await expect.poll(values).toContain(SEED.clients[0]);
    await app.check('new admin: new contract for the gig');
  });
});

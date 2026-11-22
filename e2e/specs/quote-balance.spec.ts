import { test, expect, type App } from '../fixtures';
import { openEvent, eventDetail, SEED, checkWholeScreen, sheetTitled } from '../support/flows';

/**
 * The final balance (saldo) of an accepted quote (migration 168).
 *
 * Seed: "Client A — Wedding" is the gig of the accepted quote Q-2026-0014
 * (total €3,904 with VAT); the gig records a €960 deposit as received, and
 * its fee is €3,200. The band has bank details and a Stripe payment link.
 * So the balance is €2,944, with a warning that the gig fee differs.
 */

const QUOTE_ID = '10000386-0000-4000-8000-000000000902';

// BwSheet dialogs are found by their title, as in the rest of the suite.
const balanceSheet = (app: App) => sheetTitled(app, app.t('Final balance'));

async function openBalance(app: App) {
  await openEvent(app, SEED.wedding);
  await eventDetail(app).getByRole('button', { name: app.t('FINAL BALANCE') }).filter({ visible: true }).first().click();
  await expect(balanceSheet(app)).toBeVisible();
  await app.settle();
}

const link = async (app: App) => (await app.readDb()).quote_links.find((l) => l.quote_id === QUOTE_ID)!;
const gig = async (app: App) => (await app.readDb()).events.find((e) => e.title === SEED.wedding)!;

test.describe('Final balance as admin', () => {
  test('the balance sheet fits every screen and says what is still due @smoke', async ({ app }) => {
    await openBalance(app);
    const sheet = balanceSheet(app);
    await expect(sheet.getByText(app.t('Balance due')).first()).toBeVisible();
    await expect(sheet.getByText('2,944').first()).toBeVisible();
    // The gig fee (€3,200) is not the accepted total (€3,904): said, with a way to use it.
    await expect(sheet.getByRole('button', { name: app.t('Use the gig fee') })).toBeVisible();
    await checkWholeScreen(app, 'balance sheet');
  });

  test('sending by email publishes the balance on the client page and records it', async ({ app }) => {
    await openBalance(app);
    const sheet = balanceSheet(app);
    await sheet.getByRole('button', { name: app.t('7 days after') }).click();
    await sheet.getByRole('button', { name: app.t('Send by email') }).click();
    await expect(app.page.getByText(app.t('Balance request sent to {email}', { email: 'client.a@example.com' }))).toBeVisible();

    const l = await link(app);
    const b = l.balance as { amount: number; currency: string; bank: { value: string }[]; stripeUrl: string; reference: string };
    expect(b.amount).toBe(2944);
    expect(b.currency).toBe('EUR');
    expect(b.bank.map((r) => r.value)).toContain('IT60X0542811101000000123456');
    expect(b.stripeUrl).toMatch(/^https:\/\/buy\.stripe\.com\//);
    // The client's language (Italian, as the quote): the bank reference too.
    expect(b.reference).toBe('Q-2026-0014 · Saldo');
    expect(l.balance_sent_at).toBeTruthy();
    const db = await app.readDb();
    expect(db.quote_activity.some((a) => a.quote_id === QUOTE_ID && a.kind === 'balance_requested' && a.channel === 'email')).toBe(true);

    // Again with nothing changed: a reminder, not a new request.
    await expect(sheet.getByRole('button', { name: app.t('Send a reminder') })).toBeVisible();
  });

  test('the gig fee instead of the quote total, and other payments, change the amount', async ({ app }) => {
    await openBalance(app);
    const sheet = balanceSheet(app);
    await sheet.getByRole('button', { name: app.t('Use the gig fee') }).click();
    await expect(sheet.getByText('2,240').first()).toBeVisible();
    await sheet.getByLabel(app.t('Other payments received')).fill('240');
    await expect(sheet.getByText('2,000').first()).toBeVisible();
  });

  test('"Mark as paid" marks the gig paid, and Undo brings it back', async ({ app }) => {
    await openBalance(app);
    const sheet = balanceSheet(app);
    await sheet.getByRole('button', { name: app.t('Mark as paid') }).click();
    await expect(sheet.getByText(app.t('Balance received')).first()).toBeVisible();
    expect((await gig(app)).payment_status).toBe('paid');
    await sheet.getByRole('button', { name: app.t('Undo') }).click();
    await expect(sheet.getByRole('button', { name: app.t('Mark as paid') })).toBeVisible();
    expect((await gig(app)).payment_status).toBe('partial');
  });

  test('a deposit not recorded yet: asked for the whole total, until it is marked received', async ({ app }) => {
    await app.editDb((db) => {
      const e = db.events.find((x) => x.title === SEED.wedding)!;
      e.deposit_paid = false;
      e.payment_status = 'pending';
    });
    await openBalance(app);
    const sheet = balanceSheet(app);
    await expect(sheet.getByText('3,904').first()).toBeVisible();
    await sheet.getByRole('button', { name: app.t('Mark deposit received') }).click();

    // Its own sheet: the amount and how it arrived (168 deposit tweaks).
    const deposit = sheetTitled(app, app.t('Deposit received'));
    await expect(deposit.getByLabel(app.t('Amount received'))).toHaveValue('960');
    await deposit.getByRole('button', { name: app.t('Cash') }).click();
    await checkWholeScreen(app, 'deposit received sheet');
    await deposit.getByRole('button', { name: app.t('Mark deposit received') }).click();

    await expect(sheet.getByText('2,944').first()).toBeVisible();
    const e = await gig(app);
    expect(e.deposit_paid).toBe(true);
    expect(e.payment_status).toBe('partial');
    const db = await app.readDb();
    expect(db.quote_activity.some((a) => a.quote_id === QUOTE_ID && a.kind === 'deposit_received' && a.body === 'cash')).toBe(true);
  });

  test('no bank details or Stripe link: only cash, with a way to set them up', async ({ app }) => {
    await app.editDb((db) => {
      const b = db.bands[0];
      b.pricing_settings = {};
    });
    await openBalance(app);
    const sheet = balanceSheet(app);
    await expect(sheet.getByText(app.t('No bank details or Stripe link yet. The client can only pay in cash.'))).toBeVisible();
    await expect(sheet.getByRole('button', { name: app.t('Set up payments') })).toBeVisible();
  });

  test('a cancelled gig has no balance to ask', async ({ app }) => {
    await app.editDb((db) => {
      db.events.find((x) => x.title === SEED.wedding)!.status = 'cancelled';
    });
    await openEvent(app, SEED.wedding);
    await expect(eventDetail(app).getByRole('button', { name: app.t('FINAL BALANCE') })).toHaveCount(0);
  });
});

test.describe('Final balance as member', () => {
  test.use({ role: 'member' });
  test('a member never sees the balance @smoke', async ({ app }) => {
    await openEvent(app, SEED.wedding);
    await expect(eventDetail(app).getByRole('button', { name: app.t('FINAL BALANCE') })).toHaveCount(0);
    await expect(eventDetail(app).getByText(app.t('Balance due'))).toHaveCount(0);
  });
});

test.describe('The client page with a balance', () => {
  test.use({ autoOpen: false });

  test('shows what is due, how to pay and the same document @smoke', async ({ app }) => {
    await app.page.goto('/quote.html?t=demo&state=balance');
    const main = app.page.locator('main');
    await expect(main.getByRole('heading', { name: 'Balance due' })).toBeVisible();
    // Grouped by four to read it out; Copy gives the plain value.
    await expect(main.getByText('IT60 X054 2811 1010 0000 0123 456')).toBeVisible();
    await expect(main.getByRole('button', { name: 'Copy IBAN' })).toBeVisible();
    const pay = main.getByRole('link', { name: /Pay .* by card/ });
    await expect(pay).toHaveAttribute('href', /^https:\/\/buy\.stripe\.com\//);
    await expect(pay).toHaveAttribute('rel', /noopener/);
    // The quote itself is still there, with what was received.
    await expect(main.getByText('Deposit received')).toBeVisible();
    await expect(main.getByText('MAIN BAND')).toBeVisible();
    // No Accept / Decline on a balance.
    await expect(main.getByRole('button', { name: 'Accept the quote' })).toHaveCount(0);
    await app.check('client balance page');
  });

  test('once paid, it says thank you and stops asking @smoke', async ({ app }) => {
    await app.page.goto('/quote.html?t=demo&state=balance_paid');
    const main = app.page.locator('main');
    await expect(main.getByRole('heading', { name: 'Paid in full. Thank you!' })).toBeVisible();
    await expect(main.getByRole('link', { name: /by card/ })).toHaveCount(0);
    await app.check('client balance page, paid');
  });

  test('in the client\'s language', async ({ app }) => {
    await app.page.goto('/quote.html?t=demo&state=balance&l=it');
    await expect(app.page.locator('main').getByRole('heading', { name: 'Saldo da pagare' })).toBeVisible();
  });
});

test.describe('The client page and the deposit (168)', () => {
  test.use({ autoOpen: false });

  test('before accepting: the deposit is named, how to pay it is not shown yet', async ({ app }) => {
    await app.page.goto('/quote.html?t=demo');
    const main = app.page.locator('main');
    await expect(main.getByTestId('accept-deposit')).toContainText('€1,720.20');
    await expect(main.getByTestId('deposit-pay')).toHaveCount(0);
    await expect(main.getByText('IT60 X054 2811 1010 0000 0123 456')).toHaveCount(0);
  });

  test('once accepted: how to pay the deposit, with Copy and the band\'s card link @smoke', async ({ app }) => {
    await app.page.goto('/quote.html?t=demo&state=accepted');
    const pay = app.page.locator('main').getByTestId('deposit-pay');
    await expect(pay.getByRole('heading', { name: 'Deposit to pay' })).toBeVisible();
    await expect(pay.getByText('IT60 X054 2811 1010 0000 0123 456')).toBeVisible();
    await expect(pay.getByRole('button', { name: 'Copy IBAN' })).toBeVisible();
    await expect(pay.getByText('Q-2026-0013 · Deposit')).toBeVisible();
    const card = pay.getByRole('link', { name: /Pay .* by card/ });
    await expect(card).toHaveAttribute('href', /^https:\/\/buy\.stripe\.com\//);
    await expect(card).toHaveAttribute('rel', /noopener/);
    await app.check('client deposit page');
  });

  test('the band recorded the deposit: thank you, nothing more to pay', async ({ app }) => {
    await app.page.goto('/quote.html?t=demo&state=deposit_paid&l=it');
    const main = app.page.locator('main');
    await expect(main.getByRole('heading', { name: 'Acconto ricevuto. Grazie!' })).toBeVisible();
    // 183: the amount the band recorded (1,500 on a 1,720.20 deposit), not the one asked.
    await expect(main.getByTestId('deposit-paid')).toContainText(/1\.?500\s?€/);
    await expect(main.getByTestId('deposit-paid')).not.toContainText('1720');
    await expect(main.getByTestId('deposit-pay')).toHaveCount(0);
  });
});

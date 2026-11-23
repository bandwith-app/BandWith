import { expect, type Locator } from '@playwright/test';
import { DB_KEY, DEMO_USER_ID, type App } from '../fixtures';

/**
 * Shared steps. Keep them about what the user does ("open the gig from the
 * calendar"), not about how the DOM is built.
 */

/** Demo seed titles (src/lib/demo/seed.ts). Today is Monday 16 Nov 2026. */
export const SEED = {
  gigToday: 'Rooftop Session', // gig today 21:00, client Aurora Events, fee 1800
  rehearsalTomorrow: 'Weekly rehearsal', // rehearsal tomorrow, Blackbox Studios
  wedding: 'Client A — Wedding', // gig in 5 days, rider + stage plot, client Client A
  rehearsalNext: 'New songs rehearsal',
  tentativeGig: 'Jazz Club Night', // still a quote; Leo's RSVP pending
  corporateGig: 'Tech Summit Afterparty', // client Northwind Conferences
  personal: 'Vocal lesson', // personal gig (no band)
  quoteDraft: '40th birthday party', // quote draft, Client B
  poll: 'Extra rehearsal next week',
  members: ['Marta C.', 'Jonah R.', 'Lena P.', 'Sam O.'],
  me: 'Leo M.',
  clients: ['Aurora Events', 'Client A', 'Northwind Conferences', 'Client B'],
} as const;

/** The open event detail layer (gig, rehearsal, personal gig, quote). */
export const eventDetail = (app: App): Locator => app.page.locator('.bw-event-detail').last();

/** Calendar tab → the event's card in the agenda → its detail. */
export async function openEvent(app: App, title: string) {
  await app.tab('Calendar');
  // The Calendar must be up before the card is looked for. On a slow machine
  // Home is still mounted after the tab press, and in Duo Laptop pose its Band
  // desk has an "Open <gig>" button that matches the title. The check below
  // passed on that button, Home then went away, and the click waited on the
  // Calendar's own card, which lies under the Planner there (CI 11-23).
  await expect(app.page.getByRole('button', { name: app.t('Search events'), exact: true }).filter({ visible: true }).first()).toBeVisible();
  const card = app.page.getByRole('button', { name: new RegExp(escapeRe(title), 'i') }).first();
  // Duo Laptop pose shows the Planner (month grid + one day's agenda): an
  // event on another day is not on screen there, so find it like a user,
  // with Search.
  const reachable = await canBeTapped(card, 2500);
  if (!reachable) {
    await app.page.getByRole('button', { name: app.t('Search events'), exact: true }).filter({ visible: true }).first().click();
    await app.page.getByPlaceholder(app.t('Search title, venue, city, client…')).filter({ visible: true }).first().fill(title);
    await app.settle();
    const results = app.page.getByRole('dialog', { name: app.t('Search events') }).last();
    await results.getByRole('button', { name: new RegExp(escapeRe(title), 'i') }).first().click();
    await expectEventOpen(app, title);
    return;
  }
  await openEventHere(app, title);
}

/**
 * Could a tap land on `target` within `timeout`? On screen (scrolled into
 * view), enabled, and the topmost element at its centre: what a trial click
 * checks, without ever pressing. A trial click (Playwright 1.65.1) can press
 * for real when its timeout cuts it short, which opened the event under the
 * helper and sent it to Search (member-readonly, duo-open and phone-portrait).
 */
async function canBeTapped(target: Locator, timeout: number): Promise<boolean> {
  const until = Date.now() + timeout;
  // The same element must be tappable on two looks in a row: one look can
  // land on a screen that is on its way out (see openEvent).
  let seen = '';
  for (;;) {
    const sig = await target
      .evaluate((el) => {
        if (!(el instanceof HTMLElement) || !el.isConnected) return '';
        if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return '';
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return '';
        const style = getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none' || style.pointerEvents === 'none') return '';
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return '';
        const top = document.elementFromPoint(x, y);
        if (!top || !(top === el || el.contains(top))) return '';
        return `${el.getAttribute('aria-label') ?? ''}|${el.getAttribute('aria-labelledby') ?? ''}|${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`;
      }, undefined, { timeout: Math.max(1, until - Date.now()) })
      .catch(() => '');
    if (sig && sig === seen) return true;
    seen = sig;
    if (Date.now() >= until) return false;
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function expectEventOpen(app: App, title: string) {
  const detail = eventDetail(app);
  await expect(detail).toBeVisible();
  await expect(detail.getByText(title, { exact: false }).first()).toBeVisible();
  await app.settle();
}

/** Opens an event whose card is already on screen. */
export async function openEventHere(app: App, title: string) {
  await app.page.getByRole('button', { name: new RegExp(escapeRe(title), 'i') }).first().click();
  await expectEventOpen(app, title);
}

/** The in-app Back of the top layer. */
export async function back(app: App) {
  await app.page.getByRole('button', { name: app.t('Back'), exact: true }).last().click();
  await app.settle();
}

/** A sheet/dialog layer by its title text. */
export const sheetTitled = (app: App, title: string): Locator =>
  app.page.getByRole('dialog').filter({ hasText: title }).last();

export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Money as the app prints it in English (€1,800). */
export const eur = (n: number) => `€${n.toLocaleString('en-US')}`;

/**
 * System Back as the user gives it: Android Back / Escape on a keyboard.
 * Escape typed inside a field belongs to the field (src/lib/backStack.ts),
 * so the focus leaves the field first, as it does when Back is pressed.
 */
export async function systemBack(app: App) {
  await app.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await app.page.keyboard.press('Escape');
}

/** Tablet layout (src/lib/deviceRegions.ts sets data-bw-wide on <html>). */
export const isWide = (app: App) => app.page.evaluate(() => document.documentElement.hasAttribute('data-bw-wide'));

/** Create (+) → one of its entries ("New gig", "New rehearsal", "Propose rehearsal"…). */
export async function openCreate(app: App, item: string) {
  await app.tab('Create');
  const menu = app.page.getByRole('dialog').last();
  await menu.getByRole('button', { name: new RegExp(`^${escapeRe(app.t(item))}`, 'i') }).first().click();
  await app.settle();
}

/**
 * Page health over the whole screen, not just its first viewport: scrolls
 * the main scroller (the tallest one) a viewport at a time and checks each.
 */
export async function checkWholeScreen(app: App, where: string, maxSteps = 8) {
  for (let step = 0; step < maxSteps; step++) {
    await app.check(`${where} (scroll ${step})`);
    const moved = await app.page.evaluate(() => {
      let best: Element | null = null;
      let area = 0;
      document.querySelectorAll('*').forEach((e) => {
        const s = getComputedStyle(e);
        if (!/(auto|scroll)/.test(s.overflowY) || e.scrollHeight <= e.clientHeight + 4) return;
        const r = e.getBoundingClientRect();
        const a = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
        if (a > area) {
          area = a;
          best = e;
        }
      });
      const el = (best ?? document.scrollingElement) as Element | null;
      if (!el) return false;
      const before = el.scrollTop;
      el.scrollTop = before + el.clientHeight * 0.8;
      return el.scrollTop > before + 1;
    });
    if (!moved) return;
  }
}

/**
 * The account leaves its band (the demo user stays signed in): with deputy
 * gigs it lands on "Deputy gigs", without them on onboarding. Like a fresh
 * install, the offline cache of the band session is cleared.
 */
export async function leaveBand(app: App, keepDeputyGigs: boolean) {
  await app.page.evaluate(
    ({ k, me, keep }) => {
      const d = JSON.parse(localStorage.getItem(k) || '{}');
      d.band_members = (d.band_members || []).filter((m: { user_id: string }) => m.user_id !== me);
      if (!keep) {
        d.demo_deputy_gigs = [];
        d.band_deputies = (d.band_deputies || []).filter((x: { user_id?: string }) => x.user_id !== me);
      }
      localStorage.setItem(k, JSON.stringify(d));
      for (const key of Object.keys(localStorage)) if (key.startsWith('bw:')) localStorage.removeItem(key);
      indexedDB.deleteDatabase('bandwith_offline_db');
    },
    { k: DB_KEY, me: DEMO_USER_ID, keep: keepDeputyGigs },
  );
  await app.page.reload();
}

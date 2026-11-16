import { expect, type Locator } from '@playwright/test';
import type { App } from '../fixtures';

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
  const card = app.page.getByRole('button', { name: new RegExp(escapeRe(title), 'i') }).first();
  // Duo Laptop pose shows the Planner (month grid + one day's agenda): an
  // event on another day is not on screen there, so find it like a user,
  // with Search.
  const reachable = await card.click({ trial: true, timeout: 2500 }).then(() => true, () => false);
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

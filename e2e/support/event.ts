import { expect, type Locator } from '@playwright/test';
import type { App } from '../fixtures';
import { eventDetail, escapeRe } from './flows';

/**
 * Event overview helpers: the per-card EDIT actions of #178 and the sheets
 * behind them (src/app/components/event/edit/OverviewEditSheets.tsx).
 */

/** Seed ids (src/lib/demo/seed.ts: id(600 + n)). */
export const EVENT_IDS = {
  rooftop: '10000258-0000-4000-8000-000000000600',
  weeklyRehearsal: '10000259-0000-4000-8000-000000000601',
  wedding: '1000025a-0000-4000-8000-000000000602',
} as const;

/** A section's text action ("EDIT: LINEUP · 5/5"). */
export function sectionAction(app: App, action: string, section: string): Locator {
  return eventDetail(app).getByRole('button', {
    name: new RegExp(`^${escapeRe(app.t(action))}: ${escapeRe(app.t(section))}`),
  });
}

/** The EDIT next to a section title of the overview. */
export const sectionEdit = (app: App, section: string) => sectionAction(app, 'EDIT', section);

/** An overview edit sheet by its title (e.g. "Venue & location"). */
export function editSheet(app: App, title: string): Locator {
  return app.page.getByRole('dialog').filter({ has: app.page.getByText(app.t(title), { exact: true }) }).last();
}

/** Opens an overview editor and returns its sheet. */
export async function openEditor(app: App, trigger: Locator, title: string): Promise<Locator> {
  await trigger.click();
  const sheet = editSheet(app, title);
  await expect(sheet).toBeVisible();
  await app.settle();
  return sheet;
}

/** Save in a sheet's footer; the sheet closes once it is saved. */
export async function saveSheet(app: App, sheet: Locator) {
  const save = sheet.getByRole('button', { name: app.t('Save'), exact: true });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(sheet).toBeHidden();
  await app.settle();
}

/** The lineup list on the overview (the button that opens its details). */
export const lineupList = (app: App) =>
  eventDetail(app).getByRole('button', { name: app.t('Open lineup details') });

/**
 * Everything a user could read on screen: the visible text plus accessible
 * names (amounts drawn as dots only exist as aria-labels).
 */
export async function readableText(app: App): Promise<string> {
  return app.page.evaluate(() => {
    const labels = [...document.querySelectorAll('[aria-label],[title]')]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        const s = getComputedStyle(e);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
      })
      .map((e) => `${e.getAttribute('aria-label') || ''} ${e.getAttribute('title') || ''}`);
    return `${document.body.innerText}\n${labels.join('\n')}`.replace(/\s+/g, ' ');
  });
}

/** Opens the gig's setlist editor: inline on phones, its own tab on tablets. */
export async function showGigSetlist(app: App) {
  // Tablets show the gig workspace as tabs (labels drawn in capitals).
  const tab = eventDetail(app).getByRole('tab', { name: new RegExp(`^${escapeRe(app.t('Setlist'))}$`, 'i') });
  await expect(eventDetail(app).getByRole('tablist').or(eventDetail(app).getByRole('button', { name: app.t('Templates'), exact: true })).first()).toBeVisible();
  if (await tab.count()) await tab.click();
  await expect(eventDetail(app).getByRole('button', { name: app.t('Templates'), exact: true })).toBeVisible();
  await app.settle();
}

import { test, expect, type App } from '../fixtures';
import type { Locator } from '@playwright/test';
import { openEvent, eventDetail, SEED } from '../support/flows';
import { editSheet, openEditor, sectionEdit } from '../support/event';

/**
 * Leaving an overview editor (#178) with changes that aren't saved must ask
 * first, whichever way the user leaves: Cancel, ✕ or Escape (system Back).
 * Keep editing goes back to the sheet with the change still there. With no
 * change the sheet just closes.
 *
 * Known open bug on main (fix on another branch): the sheets drop the edits
 * without asking, so the "asks" tests fail until that fix lands.
 */

interface Editor {
  name: string;
  event: string;
  open: (app: App) => Locator;
  title: string;
  /** Makes one change; returns a check that the change is still there. */
  change: (app: App, sheet: Locator) => Promise<() => Promise<void>>;
}

const EDITORS: Editor[] = [
  {
    name: 'title, date & times',
    event: SEED.gigToday,
    open: (app) => eventDetail(app).getByRole('button', { name: app.t('Edit title, date & times'), exact: true }).first(),
    title: 'Title, date & times',
    change: async (app, sheet) => {
      const field = sheet.getByLabel(app.t('Event title'));
      await field.fill('Rooftop Session XL');
      return () => expect(field).toHaveValue('Rooftop Session XL');
    },
  },
  {
    name: 'venue',
    event: SEED.gigToday,
    open: (app) => eventDetail(app).getByRole('button', { name: app.t('Edit venue') }),
    title: 'Venue & location',
    change: async (app, sheet) => {
      const field = sheet.getByLabel(app.t('Address'));
      await field.fill('Via Roma 1');
      return () => expect(field).toHaveValue('Via Roma 1');
    },
  },
  {
    name: 'lineup',
    event: SEED.gigToday,
    open: (app) => sectionEdit(app, 'LINEUP'),
    title: 'Lineup',
    change: async (app, sheet) => {
      const box = sheet.getByRole('checkbox', { name: SEED.members[0], exact: true });
      await box.click();
      return () => expect(box).toHaveAttribute('aria-checked', 'false');
    },
  },
  {
    name: 'fee',
    event: SEED.gigToday,
    open: (app) => eventDetail(app).getByRole('button', { name: app.t('Edit fee') }),
    title: 'Edit fee',
    change: async (app, sheet) => {
      const field = sheet.getByLabel(app.t('Extra band fee / services'));
      await field.fill('700');
      return () => expect(field).toHaveValue('700');
    },
  },
  {
    name: 'client & notes',
    event: SEED.gigToday,
    open: (app) => sectionEdit(app, 'CLIENT & NOTES'),
    title: 'Client & notes',
    change: async (app, sheet) => {
      const field = sheet.getByLabel(app.t('Notes for the band'));
      await field.fill('Lift to the roof is behind the bar.');
      return () => expect(field).toHaveValue('Lift to the roof is behind the bar.');
    },
  },
  {
    name: 'studio cost',
    event: SEED.rehearsalTomorrow,
    open: (app) => sectionEdit(app, 'STUDIO COST'),
    title: 'Studio cost',
    change: async (app, sheet) => {
      const paid = sheet.getByRole('radio', { name: app.t('Paid') }).or(sheet.getByRole('button', { name: app.t('Paid'), exact: true })).first();
      await paid.click();
      const field = sheet.getByRole('spinbutton');
      await field.fill('120');
      return () => expect(field).toHaveValue('120');
    },
  },
];

const WAYS: { name: string; leave: (app: App, sheet: Locator) => Promise<void> }[] = [
  { name: 'Cancel', leave: (app, sheet) => sheet.getByRole('button', { name: app.t('Cancel'), exact: true }).click() },
  { name: '✕', leave: (app, sheet) => sheet.getByRole('button', { name: app.t('Close'), exact: true }).first().click() },
  { name: 'Escape', leave: (app) => app.page.keyboard.press('Escape') },
];

/** The "unsaved changes" question: it offers to discard. */
const discardChoice = (app: App) => app.page.getByRole('button', { name: app.t('Discard'), exact: true });

for (const ed of EDITORS) {
  test.describe(`${ed.name} editor`, () => {
    test.beforeEach(async ({ app }) => {
      await openEvent(app, ed.event);
    });

    test('with a change, Cancel, ✕ and Escape each ask before discarding', async ({ app }) => {
      const sheet = await openEditor(app, ed.open(app), ed.title);
      const stillChanged = await ed.change(app, sheet);
      for (const way of WAYS) {
        await test.step(way.name, async () => {
          await way.leave(app, sheet);
          await expect(discardChoice(app), `${way.name} with unsaved changes asks first`).toBeVisible();
          await app.check(`${ed.name}: unsaved changes question`);
          await app.page.getByRole('button', { name: app.t('Keep editing'), exact: true }).first().click();
          await expect(discardChoice(app)).toBeHidden();
          await expect(editSheet(app, ed.title)).toBeVisible();
          await stillChanged();
        });
      }
      // Discard really drops the change and closes the editor.
      await WAYS[0].leave(app, sheet);
      await discardChoice(app).click();
      await expect(editSheet(app, ed.title)).toBeHidden();
    });

    test('with no change, Escape just closes', async ({ app }) => {
      await openEditor(app, ed.open(app), ed.title);
      await app.page.keyboard.press('Escape');
      await expect(editSheet(app, ed.title)).toBeHidden();
      await expect(discardChoice(app)).toHaveCount(0);
    });
  });
}

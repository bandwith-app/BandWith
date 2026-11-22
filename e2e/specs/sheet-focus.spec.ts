import { test, expect, type App } from '../fixtures';
import { isWide, openCreate } from '../support/flows';
import type { Locator } from '@playwright/test';

/**
 * Keyboard focus in modal layers (src/lib/focusTrap.ts): while a sheet or
 * the iPad composer is open, Tab and Shift+Tab cycle inside it and never
 * reach the controls behind the scrim.
 */

// Inside the layer, or on the Duo rail's actions (its Close and Back move there).
const focusInside = (layer: Locator) =>
  layer.evaluate((el) => el.contains(document.activeElement) || !!document.activeElement?.closest('[data-bw-trap-include]'));

async function cycle(app: App, layer: Locator, key: 'Tab' | 'Shift+Tab', presses: number) {
  for (let i = 0; i < presses; i++) {
    await app.page.keyboard.press(key);
    expect(await focusInside(layer), `${key} #${i + 1} stays in the layer`).toBe(true);
  }
}

const tabStops = (layer: Locator) =>
  layer.evaluate(
    (el) =>
      el.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])')
        .length,
  );

test('@smoke Tab and Shift+Tab stay inside the Create sheet', async ({ app }) => {
  await app.tab('Create');
  const sheet = app.page.getByRole('dialog').last();
  await expect(sheet).toBeVisible();
  await expect.poll(() => focusInside(sheet), 'focus moves into the sheet').toBe(true);
  const stops = await tabStops(sheet);
  // From the start of the sheet backwards (the audit's path), then forwards past the end.
  await cycle(app, sheet, 'Shift+Tab', stops + 2);
  await cycle(app, sheet, 'Tab', stops + 2);
  await app.page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
});

test('@smoke a card arriving under the Create sheet (a band invite) leaves focus in the sheet', async ({ app }) => {
  await app.tab('Create');
  const sheet = app.page.getByRole('dialog').last();
  await expect(sheet).toBeVisible();
  await expect.poll(() => focusInside(sheet)).toBe(true);
  // Like PendingInvitesPrompt, but modal: only the page can tell it is under the
  // sheet (z-65, inside the sheet's area: on the Duo the other pane has no scrim).
  const box = (await sheet.boundingBox())!;
  const before = await app.page.evaluate((r) => {
    const was = document.activeElement?.outerHTML;
    const card = document.createElement('div');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-label', 'Band invite');
    card.style.cssText = `position:fixed;left:${r.x + 16}px;top:${r.y + 16}px;width:${Math.max(r.width - 32, 40)}px;height:120px;z-index:65;background:#fff`;
    card.innerHTML = '<button type="button">Join</button><button type="button">Not now</button>';
    // First in the page, so the sheet stays the last dialog for the locator.
    document.body.prepend(card);
    return was;
  }, box);
  await app.page.waitForTimeout(150);
  expect(await app.page.evaluate(() => document.activeElement?.outerHTML), 'focus did not move').toBe(before);
  await cycle(app, sheet, 'Tab', (await tabStops(sheet)) + 2);
  await app.page.evaluate(() => document.querySelector('[aria-label="Band invite"]')?.remove());
});

test('@smoke Tab stays inside the iPad composer', async ({ app }) => {
  test.skip(!(await isWide(app)), 'the composer is the tablet layout');
  await openCreate(app, 'New gig');
  const composer = app.page.locator('[data-bw-composer]').last();
  await expect(composer).toBeVisible();
  await expect.poll(() => focusInside(composer), 'focus moves into the composer').toBe(true);
  // A few laps past both ends.
  const stops = Math.min(await tabStops(composer), 60);
  await cycle(app, composer, 'Shift+Tab', 4);
  await cycle(app, composer, 'Tab', stops + 2);
});

test('@smoke iPad composer: Rider & stage → Edit list from the keyboard opens an editor focus can reach', async ({ app }) => {
  test.skip(!(await isWide(app)), 'the composer is the tablet layout');
  await openCreate(app, 'New gig');
  const composer = app.page.locator('[data-bw-composer]').last();
  await expect(composer).toBeVisible();
  // Keyboard only: focus the button, press Enter.
  const riderButton = composer.getByRole('button', { name: new RegExp(`^${app.t('Rider & stage')}`) }).first();
  await riderButton.focus();
  await app.page.keyboard.press('Enter');
  const sheet = app.page.getByRole('dialog').filter({ hasText: app.t('Rider & stage') }).last();
  await expect(sheet).toBeVisible();
  await expect.poll(() => focusInside(sheet)).toBe(true);
  const editList = sheet.getByRole('button', { name: app.t('EDIT LIST') }).first();
  await editList.focus();
  await app.page.keyboard.press('Enter');
  const editor = app.page.getByRole('dialog', { name: app.t('Edit input list') });
  await expect(editor).toBeVisible();
  await expect.poll(() => focusInside(editor), 'focus moves into the editor').toBe(true);
  await cycle(app, editor, 'Tab', (await tabStops(editor)) + 2);
  await cycle(app, editor, 'Shift+Tab', 4);
});

test('@smoke Create band from the band switcher takes the focus (Duo: beside the docked switcher)', async ({ app }) => {
  await app.page.getByRole('button', { name: new RegExp(app.t('Switch band')) }).first().click();
  const switcher = app.page.getByRole('dialog', { name: app.t('Your bands') });
  await expect(switcher).toBeVisible();
  const add = switcher.getByRole('button', { name: app.t('Create band') });
  await add.focus();
  await app.page.keyboard.press('Enter');
  const create = app.page.getByRole('dialog', { name: app.t('Create') }).last();
  await expect(create).toBeVisible();
  await expect.poll(() => focusInside(create), 'focus moves into Create band').toBe(true);
  // Close is a stop of the cycle: in its header (phone, iPad), or on the Duo
  // in the rail's actions, the last stops (Shift+Tab from the start wraps
  // there; WebKit's own Tab skips buttons, the trap's wrap does not).
  const rail = app.page.locator('[data-bw-trap-include]');
  if (await rail.isVisible()) {
    await create.evaluate((el) => (el as HTMLElement).focus());
    await app.page.keyboard.press('Shift+Tab');
    expect(await app.page.evaluate(() => !!document.activeElement?.closest('[data-bw-trap-include]')), 'Shift+Tab wraps to the rail').toBe(true);
    await expect(rail.getByRole('button', { name: app.t('Close'), exact: true })).toBeVisible();
  } else {
    await expect(create.getByRole('button', { name: app.t('Close'), exact: true })).toBeVisible();
  }
  await cycle(app, create, 'Tab', Math.min(await tabStops(create), 40) + 2);
  await cycle(app, create, 'Shift+Tab', 4);
});

test('@smoke inbox: one dialog over both pages, Tab moves between the list and the detail', async ({ app }) => {
  await app.page.getByRole('button', { name: new RegExp(`^${app.t('Notifications')}, \\d`) }).first().click();
  const inbox = app.page.getByRole('dialog', { name: app.t('Notifications'), exact: true });
  await expect(inbox).toBeVisible();
  test.skip(!(await app.page.locator('html[data-bw-two-pane]').count()), 'one page: the inbox is a single dialog');
  const detail = inbox.getByRole('region');
  // Two pages: the open notification is a region inside the inbox, not a dialog of its own.
  await expect(detail.first()).toBeVisible();
  await expect(app.page.getByRole('dialog', { name: app.t('Notifications'), exact: true })).toHaveCount(1);
  await expect.poll(() => focusInside(inbox), 'focus moves into the inbox').toBe(true);
  // Shift+Tab from the start wraps to the last stop and Tab comes back: the cycle spans both pages.
  await inbox.evaluate((el) => (el as HTMLElement).focus());
  await cycle(app, inbox, 'Shift+Tab', 3);
  await cycle(app, inbox, 'Tab', 6);
});

test('@smoke inbox on one page: Tab and Shift+Tab stay in it', async ({ app }) => {
  await app.page.getByRole('button', { name: new RegExp(`^${app.t('Notifications')}, \\d`) }).first().click();
  const inbox = app.page.getByRole('dialog', { name: app.t('Notifications'), exact: true });
  await expect(inbox).toBeVisible();
  test.skip(!!(await app.page.locator('html[data-bw-two-pane]').count()), 'two pages: covered by the test above');
  await expect.poll(() => focusInside(inbox), 'focus moves into the inbox').toBe(true);
  const stops = Math.min(await tabStops(inbox), 30);
  await cycle(app, inbox, 'Shift+Tab', stops + 2);
  await cycle(app, inbox, 'Tab', stops + 2);
});

test('@smoke folding the Duo from book to closed: focus moves into the one-page inbox, never to the bell', async ({ app }) => {
  const duo = await app.page.evaluate(() => typeof (window as unknown as { __bwApplyRegions?: unknown }).__bwApplyRegions === 'function');
  test.skip(!duo || !(await app.page.locator('html[data-bw-two-pane]').count()), 'needs the Duo open on two pages');
  await app.page.getByRole('button', { name: new RegExp(`^${app.t('Notifications')}, \\d`) }).first().click();
  const inbox = app.page.getByRole('dialog', { name: app.t('Notifications'), exact: true });
  await expect(inbox).toBeVisible();
  await expect.poll(() => focusInside(inbox), 'focus moves into the inbox').toBe(true);
  // Every element that takes focus from here on, outside the inbox.
  await app.page.evaluate(() => {
    const w = window as unknown as { __bwOutside: string[] };
    w.__bwOutside = [];
    document.addEventListener('focusin', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[role="dialog"][aria-label]') || t.closest('[data-bw-trap-include]') || t.matches('[data-bw-focus-guard]')) return;
      w.__bwOutside.push(t.getAttribute('aria-label') || t.textContent?.trim().slice(0, 40) || t.tagName);
    });
  });
  // The Duo closes to one screen (the regions the simulator reports closed, portrait).
  await app.page.setViewportSize({ width: 466, height: 678 });
  await app.page.evaluate(() =>
    (window as unknown as { __bwApplyRegions: (r: unknown) => void }).__bwApplyRegions({
      status: { x: 382, y: 0, w: 84, h: 82, edge: 'right' },
      division: null,
      hinge: { status: 'closed', angle: 0 },
      viewport: { w: 466, h: 678 },
    }),
  );
  await expect(app.page.locator('html[data-bw-two-pane]')).toHaveCount(0);
  const one = app.page.locator('[role="dialog"][aria-modal="true"].bw-pane-detail');
  await expect(one).toBeVisible();
  await expect.poll(() => focusInside(one), 'focus moves into the one-page inbox').toBe(true);
  expect(await app.page.evaluate(() => (window as unknown as { __bwOutside: string[] }).__bwOutside)).toEqual([]);
  await cycle(app, one, 'Tab', 4);
});

import { test, expect, type App } from '../fixtures';
import { isWide, openCreate } from '../support/flows';
import { openHubPage } from '../support/hub';
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

test('@smoke folding the Duo with Edit kit open: focus stays in the editor, above the kit page', async ({ app }) => {
  const duo = await app.page.evaluate(() => typeof (window as unknown as { __bwApplyRegions?: unknown }).__bwApplyRegions === 'function');
  test.skip(!duo || !(await app.page.locator('html[data-bw-two-pane]').count()), 'needs the Duo open on two pages');
  await openHubPage(app, 'Gear & inventory');
  await app.page.getByRole('tab', { name: new RegExp(`^${app.t('Kits')}`) }).click();
  // Two pages: the first kit opens beside the list.
  const kitPage = app.page.locator('[role="region"].bw-pane-detail');
  await expect(kitPage).toBeVisible();
  const kitName = (await kitPage.getAttribute('aria-label'))!;
  await kitPage.getByRole('button', { name: app.t('Edit'), exact: true }).click();
  const editor = app.page.getByRole('dialog', { name: app.t('Edit kit') });
  await expect(editor).toBeVisible();
  await expect.poll(() => focusInside(editor), 'focus moves into the editor').toBe(true);
  // The Duo closes to one screen: the kit page turns into a modal dialog with its trap.
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
  await expect(app.page.getByRole('dialog', { name: kitName, exact: true })).toHaveCount(1);
  await app.page.waitForTimeout(300);
  expect(await focusInside(editor), 'focus stays in the editor').toBe(true);
  await cycle(app, editor, 'Tab', 6);
  await cycle(app, editor, 'Shift+Tab', 6);
});


test("@smoke Duo: Tab and Shift+Tab cross between a layer's last control and the rail's actions", async ({ app }) => {
  await app.page.getByRole('button', { name: new RegExp(app.t('Switch band')) }).first().click();
  const switcher = app.page.getByRole('dialog', { name: app.t('Your bands') });
  await expect(switcher).toBeVisible();
  await switcher.getByRole('button', { name: app.t('Create band') }).focus();
  await app.page.keyboard.press('Enter');
  const create = app.page.getByRole('dialog', { name: app.t('Create') }).last();
  await expect(create).toBeVisible();
  const rail = app.page.locator('[data-bw-trap-include]');
  test.skip(!(await rail.isVisible()), "no rail actions: the layer's Close is in its header");
  await expect.poll(() => focusInside(create)).toBe(true);
  const ends = await create.evaluate((el) => {
    const sel = 'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])';
    const own = Array.from(el.querySelectorAll<HTMLElement>(sel)).filter((c) => c.getClientRects().length > 0);
    const railStops = Array.from(document.querySelectorAll<HTMLElement>(`[data-bw-trap-include] :is(${sel})`)).filter((c) => c.getClientRects().length > 0);
    own[own.length - 1].setAttribute('data-e2e-last', '');
    railStops[0].setAttribute('data-e2e-rail-first', '');
    return { own: own.length, rail: railStops.length };
  });
  expect(ends.rail).toBeGreaterThan(0);
  // From the rail's first action, Shift+Tab goes back to the layer's last control.
  await app.page.locator('[data-e2e-rail-first]').focus();
  await app.page.keyboard.press('Shift+Tab');
  expect(await app.page.evaluate(() => document.activeElement?.hasAttribute('data-e2e-last')), 'Shift+Tab: back to the last control').toBe(true);
  // And Tab from there goes on to the rail's first action.
  await app.page.keyboard.press('Tab');
  expect(await app.page.evaluate(() => document.activeElement?.hasAttribute('data-e2e-rail-first')), 'Tab: on to the rail').toBe(true);
});

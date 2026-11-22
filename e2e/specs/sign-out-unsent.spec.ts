import { test, expect, DB_KEY } from '../fixtures';
import { DEMO_USER_ID } from '../fixtures';
import { escapeRe } from '../support/flows';
import { openHub, openHubPage } from '../support/hub';

/**
 * Signing out with changes made on this phone that haven't reached the band
 * yet (a note written with no signal): asked first, "Send now" or "Sign out
 * anyway". The sheet fits every screen (phone, Duo postures, iPad); closed,
 * the person is still signed in. Made-up note (New York).
 */
test('@smoke signing out with an unsent change asks first, and closing keeps me signed in', async ({ app, context }) => {
  await openHub(app);
  await app.page.evaluate((id) => {
    localStorage.setItem(
      `bw:live_outbox:${id}`,
      JSON.stringify([{ kind: 'note', id: 'e2e-note-1', songId: 'e2e-song', anchor: { type: 'song' }, body: 'Watch the drummer before the bridge', isNew: true }]),
    );
  }, DEMO_USER_ID);
  // No signal: nothing can be sent behind the sheet.
  await context.setOffline(true);
  const signOutRow = app.page
    // "Sign out", or "Sign out (email)" when the hub shows the email.
    .getByRole('button', {
      name: new RegExp(`^(${escapeRe(app.t('Sign out'))}$|${escapeRe(app.t('Sign out ({email})', { email: '§' }).split('§')[0])})`),
    })
    .filter({ visible: true })
    .first();
  await signOutRow.scrollIntoViewIfNeeded();
  await signOutRow.click();
  const sheet = app.page.getByRole('dialog', { name: app.t('You have 1 unsent change') });
  await expect(sheet).toBeVisible();
  await app.settle();
  const viewport = app.page.viewportSize()!;
  for (const name of ['Send now', 'Sign out anyway']) {
    const button = sheet.getByRole('button', { name: app.t(name), exact: true });
    await expect(button).toBeVisible();
    const box = (await button.boundingBox())!;
    expect(box.x, name).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, name).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.y + box.height, name).toBeLessThanOrEqual(viewport.height + 1);
  }
  await app.check('unsent changes before sign-out');

  // Send now with no signal: says so, still waiting.
  await sheet.getByRole('button', { name: app.t('Send now'), exact: true }).click();
  await expect(sheet.getByText(app.t('No connection. Try again when you are online.'))).toBeVisible();

  // Closed: still signed in, the change still waits.
  await app.page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await context.setOffline(false);
  await expect(signOutRow).toBeVisible();
  // Not sent behind the sheet's back: the demo note doesn't exist (song e2e-song), so clean up.
  await app.page.evaluate((id) => localStorage.removeItem(`bw:live_outbox:${id}`), DEMO_USER_ID);
});

/**
 * Changes the band refused (the note was gone, the setlist changed
 * meanwhile) are kept on the phone and shown in Settings › Offline & live:
 * copy what you need, then remove them. Never lost unseen.
 */
test('@smoke refused changes show in Offline & live, with Copy and Remove', async ({ app }) => {
  await app.page.evaluate((id) => {
    localStorage.setItem(
      `bw:live_refused:${id}`,
      JSON.stringify([
        { kind: 'note', id: 'e2e-n1', songId: 'e2e-song', anchor: { type: 'song' }, body: 'Watch the drummer before the bridge' },
        { kind: 'suggestion', id: 'e2e-g1', row: { band_id: 'b', song_id: 'e2e-song', kind: 'note', proposed: { note: 'Slower intro on Empire State' } } },
      ]),
    );
  }, DEMO_USER_ID);
  await openHubPage(app, 'Settings & account');
  const section = app.page.getByRole('button', { name: new RegExp(`^${escapeRe(app.t('Offline & live'))}`) }).filter({ visible: true }).first();
  await section.scrollIntoViewIfNeeded();
  await section.click();
  await app.settle();

  const list = app.page.getByRole('region', { name: app.t('Changes not sent'), exact: true }).filter({ visible: true }).first();
  await list.scrollIntoViewIfNeeded();
  await expect(list.getByText('Watch the drummer before the bridge')).toBeVisible();
  await expect(list.getByText('Slower intro on Empire State')).toBeVisible();
  const viewport = app.page.viewportSize()!;
  const copy = list.getByRole('button', { name: app.t('Copy change: {change}', { change: 'Watch the drummer before the bridge' }), exact: true });
  const remove = list.getByRole('button', { name: app.t('Remove change: {change}', { change: 'Watch the drummer before the bridge' }), exact: true });
  for (const b of [copy, remove]) {
    const box = (await b.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  }
  await app.check('refused changes in Offline & live');

  // Copied, or (clipboard blocked here) said so: never silent.
  await copy.click();
  await expect(
    list.getByText(app.t('Copied'), { exact: true }).or(list.getByText(app.t('Couldn’t copy this change. Select the text and copy it yourself.'))).first(),
  ).toBeVisible();
  await remove.click();
  await expect(list.getByText('Watch the drummer before the bridge')).toHaveCount(0);
  // Undo puts it back where it was.
  await list.getByRole('button', { name: app.t('Undo'), exact: true }).click();
  await expect(list.getByText('Watch the drummer before the bridge')).toBeVisible();
  await remove.click();
  await list.getByRole('button', { name: app.t('Remove change: {change}', { change: 'Slower intro on Empire State' }), exact: true }).click();
  await expect(list.getByRole('listitem')).toHaveCount(0);
  await expect(list.getByText(app.t('Change removed.'), { exact: true })).toBeVisible();
});

/**
 * Round 6 (Claude r5 M6): nothing waiting, only changes the band refused:
 * sign-out still asks. They stay on this phone for the account ("Sign out"),
 * or "Erase them and sign out". The sheet fits every screen.
 */
test('@smoke refused changes only: sign-out asks, and "Erase them and sign out" erases them', async ({ app }) => {
  await openHub(app);
  await app.page.evaluate((id) => {
    localStorage.setItem(
      `bw:live_refused:${id}`,
      JSON.stringify([{ kind: 'note', id: 'e2e-n9', songId: 'e2e-song', anchor: { type: 'song' }, body: 'Watch the drummer before the bridge' }]),
    );
  }, DEMO_USER_ID);
  const signOutRow = app.page
    .getByRole('button', {
      name: new RegExp(`^(${escapeRe(app.t('Sign out'))}$|${escapeRe(app.t('Sign out ({email})', { email: '§' }).split('§')[0])})`),
    })
    .filter({ visible: true })
    .first();
  await signOutRow.scrollIntoViewIfNeeded();
  await signOutRow.click();
  const sheet = app.page.getByRole('dialog', { name: app.t('Some changes were refused') });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText(app.t('1 change not sent stays on this phone for your account.'))).toBeVisible();
  await app.settle();
  const viewport = app.page.viewportSize()!;
  for (const name of ['Sign out', 'Erase them and sign out']) {
    const button = sheet.getByRole('button', { name: app.t(name), exact: true });
    await expect(button).toBeVisible();
    const box = (await button.boundingBox())!;
    expect(box.x, name).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, name).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.y + box.height, name).toBeLessThanOrEqual(viewport.height + 1);
  }
  await app.check('refused changes only before sign-out');
  await sheet.getByRole('button', { name: app.t('Erase them and sign out'), exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect.poll(() => app.page.evaluate((id) => localStorage.getItem(`bw:live_refused:${id}`), DEMO_USER_ID)).toBeNull();
});

/**
 * Round 5 (Codex MINOR): "Update BandWith" (z 1000) has its own Sign out;
 * the unsent-changes sheet opens above it and takes taps (touch included).
 */
test('@smoke the unsent-changes sheet opens above "Update BandWith" and takes taps', async ({ app, context }) => {
  const db = await app.readDb();
  (db as Record<string, unknown>).app_versions = [{ platform: 'web', min_version: '999912312359' }];
  await app.page.evaluate(({ k, v }) => {
    localStorage.setItem(k, v);
    sessionStorage.setItem('bw-min-reloaded:999912312359', '1');
  }, { k: DB_KEY, v: JSON.stringify(db) });
  await app.page.reload();
  const update = app.page.getByTestId('update-required');
  await expect(update).toBeVisible({ timeout: 20_000 });
  // This screen shows as soon as the version answer is in, while the app
  // under it is still loading its own chunk and CSS. Cut off mid-load, the
  // app fails to start and the error screen replaces everything, this screen
  // included (CI, 11-22). So wait for the app first: Home is there once the
  // chunk is in (#root is inert and hidden from assistive tech under this
  // screen, hence includeHidden).
  await expect(app.page.getByRole('button', { name: app.t('Home'), exact: true, includeHidden: true }).first()).toBeAttached({ timeout: 30_000 });
  await app.settle();
  // No signal, then a change made on this phone: nothing is sent behind the sheet.
  await context.setOffline(true);
  await app.page.evaluate((id) => {
    localStorage.setItem(
      `bw:live_outbox:${id}`,
      JSON.stringify([{ kind: 'note', id: 'e2e-note-2', songId: 'e2e-song', anchor: { type: 'song' }, body: 'Watch the drummer before the bridge', isNew: true }]),
    );
  }, DEMO_USER_ID);
  const touch = !!test.info().project.use.hasTouch;
  const press = async (l: import('@playwright/test').Locator) => (touch ? l.tap() : l.click());
  await press(update.getByRole('button', { name: app.t('Sign out') }));
  const sheet = app.page.getByRole('dialog', { name: app.t('You have 1 unsent change') });
  await expect(sheet).toBeVisible();
  await app.settle();
  // On top: the point under each button belongs to the sheet, not the update screen.
  // Asked until it is: the sheet slides in, and while a button is still below
  // the screen its point belongs to nothing (CI, 11-22: settle() can return
  // before the slide ends on a loaded machine). Under the update screen it
  // would never be true.
  for (const name of ['Send now', 'Sign out anyway']) {
    const button = sheet.getByRole('button', { name: app.t(name), exact: true });
    await expect
      .poll(
        async () => {
          const box = await button.boundingBox();
          if (!box) return false;
          return app.page.evaluate(
            ({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[role="dialog"]')?.textContent?.includes('unsent'),
            { x: box.x + box.width / 2, y: box.y + box.height / 2 },
          );
        },
        { message: name },
      )
      .toBe(true);
  }
  await press(sheet.getByRole('button', { name: app.t('Send now'), exact: true }));
  await expect(sheet.getByText(app.t('No connection. Try again when you are online.'))).toBeVisible();
  await app.check('unsent changes above Update BandWith');
  await context.setOffline(false);
  await app.page.evaluate((id) => localStorage.removeItem(`bw:live_outbox:${id}`), DEMO_USER_ID);
});


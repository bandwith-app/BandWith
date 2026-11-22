import { test, expect } from '../fixtures';
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

  const list = app.page.getByRole('region', { name: app.t('Not sent'), exact: true }).filter({ visible: true }).first();
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
  await list.getByRole('button', { name: app.t('Remove change: {change}', { change: 'Slower intro on Empire State' }), exact: true }).click();
  await expect(app.page.getByRole('region', { name: app.t('Not sent'), exact: true })).toHaveCount(0);
});


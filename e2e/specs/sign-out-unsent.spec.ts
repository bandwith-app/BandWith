import { test, expect } from '../fixtures';
import { DEMO_USER_ID } from '../fixtures';
import { escapeRe } from '../support/flows';
import { openHub } from '../support/hub';

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

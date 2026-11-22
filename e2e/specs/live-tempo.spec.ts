import { test, expect, type App } from '../fixtures';
import { openHub } from '../support/hub';
import { escapeRe } from '../support/flows';

/**
 * Live mode: Follow the tempo and the count-in (plan live-offline-and-tempo
 * §4, §6). The song form's live fields (migration 171), the count-in on
 * every phone, every meter, and the playhead.
 */


/** Repertoire → a song's menu → Edit → step 2 (Details). */
async function editSongDetails(app: App, title: string) {
  // The hub's Repertoire row ("Repertoire: 17 songs…"), not Home's quick action behind it.
  await openHub(app);
  await app.page.getByRole('button', { name: new RegExp(`^${escapeRe(app.t('Repertoire'))}:`) }).first().click();
  await app.settle();
  await app.page.getByText(title, { exact: true }).first().click();
  await app.page.getByRole('menuitem', { name: app.t('Edit'), exact: true }).click();
  await app.settle();
  await app.button('Next', { exact: true }).click();
  await app.settle();
}

test.describe('Song form: live mode fields', () => {
  test('@smoke time signature, 2 bars of count-in, a pickup and the backing track are saved with the song', async ({ app }) => {
    await editSongDetails(app, 'Harbor Lights');
    // The chart is in 4/4: that is the pick until another one is chosen.
    const ts = (time: string) => app.page.getByRole('button', { name: app.t('Time signature {time}', { time }), exact: true });
    await expect(ts('4/4')).toHaveAttribute('aria-pressed', 'true');
    await expect(app.page.getByText(app.t('From the chord chart.'))).toBeVisible();
    await ts('6/8').click();
    await app.page.getByRole('button', { name: app.t('2 bars'), exact: true }).click();
    await app.button('One beat more', { exact: true }).click();
    await expect(app.page.getByText(app.t('Starts {n} beats early', { n: 1 }))).toBeVisible();
    await app.page.getByRole('switch', { name: app.t('Played with a backing track') }).click();
    await app.check('song form, live mode fields');

    await app.button('Save now', { exact: true }).click();
    await expect.poll(async () => (await app.readDb()).songs.find((s) => s.title === 'Harbor Lights')).toMatchObject({
      time_signature: '6/8',
      count_in_bars: 2,
      pickup_beats: 1,
      backing_track: true,
    });
  });
});

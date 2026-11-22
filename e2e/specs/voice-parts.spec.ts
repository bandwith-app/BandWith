import { test, expect, type App } from '../fixtures';
import { openEvent } from '../support/flows';
import { isLaptop, liveDialog, openLive, openWithFocusSongs, WEEKLY } from '../support/live';

/**
 * Voice parts (plan "live offline & tempo" §5): lines marked in the lyrics
 * for the second voice, backing vocals, everyone or spoken words are drawn
 * each in its own style, with a small legend; "Highlight my part" keeps the
 * singer's own part bright and dims the others. Made-up lyrics.
 */
const LYRICS = [
  '# Chorus',
  '[C]Paper boats on the [G]river',
  '{bv}(ooh, [Am]yeah){/bv}',
  '{v2}Hudson lights are calling{/v2}',
  '{all}All the way home{/all}',
  '{sp}Count it, Brooklyn{/sp}',
].join('\n');

/** Where the song is drawn: Live mode, or the floor wedge's Display in Laptop pose. */
const songArea = (app: App) =>
  isLaptop() ? app.page.getByRole('region', { name: app.t('Now playing') }) : liveDialog(app, WEEKLY);

test.describe('voice parts in Live mode', () => {
  test.use({ autoOpen: false });

  test('@smoke each part has its own look, a legend, and my part stays bright', async ({ app }) => {
    await openWithFocusSongs(app);
    await app.editDb((db, { me }) => {
      const rows = db as unknown as Record<string, Record<string, unknown>[]>;
      rows.songs.find((s) => s.title === 'Paper Boats')!.lyrics = LYRICS;
      // Leo sings the backing vocals.
      for (const m of rows.band_members.filter((m) => m.user_id === me)) m.instrument = 'Guitar / Backing vocals';
    });
    await app.page.evaluate(() => localStorage.setItem('bw-song-view', 'chords'));
    await openEvent(app, WEEKLY);
    await openLive(app);
    if (isLaptop()) {
      await app.page.getByRole('region', { name: app.t('Song controls') }).getByRole('button', { name: app.t('Lyrics'), exact: true }).click();
    } else {
      await liveDialog(app, WEEKLY).getByRole('tablist', { name: app.t('Setlist') }).getByRole('tab').nth(1).click();
    }
    await app.settle();

    const area = songArea(app);
    await expect(area).toContainText('Paper boats on the');
    // The markers never show.
    await expect(area).not.toContainText(/\{\/?(bv|v2|all|sp)\}/);
    const legend = area.getByRole('group', { name: app.t('Voice parts') });
    await expect(legend).toBeVisible();
    for (const [key, ctx] of [['Lead', 'voice'], ['2nd voice'], ['Backing', 'voice'], ['All', 'voice'], ['Spoken']] as const)
      await expect(legend).toContainText(app.t(key, ctx ? { context: ctx } : undefined));

    // Shape, not only colour.
    const line = (v: string) => area.locator(`p[data-voice="${v}"]`).filter({ visible: true }).first();
    await expect(line('bv')).toContainText('ooh');
    expect(await line('bv').evaluate((el) => [getComputedStyle(el).fontStyle, parseFloat(getComputedStyle(el).borderLeftWidth) > 0])).toEqual(['italic', true]);
    expect(await line('v2').evaluate((el) => getComputedStyle(el).textDecorationLine)).toContain('underline');
    expect(Number(await line('all').evaluate((el) => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(700);
    expect(await line('sp').evaluate((el) => getComputedStyle(el).fontVariantCaps)).toBe('all-small-caps');

    // My part (backing, from my instrument) bright; lead, 2nd and spoken dimmed; "all" is everyone's.
    const toggle = legend.getByRole('button', { name: app.t('Highlight my part') });
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(line('bv')).not.toHaveAttribute('data-voice-dim', 'true');
    await expect(line('all')).not.toHaveAttribute('data-voice-dim', 'true');
    await expect(line('v2')).toHaveAttribute('data-voice-dim', 'true');
    await expect(line('sp')).toHaveAttribute('data-voice-dim', 'true');
    await app.check('live mode, voice parts');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(area.locator('[data-voice-dim="true"]')).toHaveCount(0);
  });

  test('@smoke an admin sets who sings what; my part follows the assignment', async ({ app }) => {
    await openWithFocusSongs(app);
    await app.editDb((db, { me }) => {
      const rows = db as unknown as Record<string, Record<string, unknown>[]>;
      rows.songs.find((s) => s.title === 'Paper Boats')!.lyrics = LYRICS;
      for (const m of rows.band_members.filter((m) => m.user_id === me)) m.instrument = 'Lead vocals';
    });
    await app.page.evaluate(() => localStorage.setItem('bw-song-view', 'chords'));
    await openEvent(app, WEEKLY);
    await openLive(app);
    if (isLaptop()) {
      await app.page.getByRole('region', { name: app.t('Song controls') }).getByRole('button', { name: app.t('Lyrics'), exact: true }).click();
    } else {
      await liveDialog(app, WEEKLY).getByRole('tablist', { name: app.t('Setlist') }).getByRole('tab').nth(1).click();
    }
    await app.settle();
    const area = songArea(app);
    const line = (v: string) => area.locator(`p[data-voice="${v}"]`).filter({ visible: true }).first();
    // Lead vocals by instrument: the backing line dims.
    await expect(line('bv')).toHaveAttribute('data-voice-dim', 'true');

    await area.getByRole('group', { name: app.t('Voice parts') }).getByRole('button', { name: app.t('Who sings what') }).click();
    const sheet = app.page.getByRole('dialog', { name: app.t('Who sings what') });
    await expect(sheet).toBeVisible();
    await app.check('who sings what');
    await sheet.getByRole('region', { name: app.t('Backing', { context: 'voice' }) }).getByRole('button', { name: 'Leo M.' }).click();
    await sheet.getByRole('button', { name: app.t('Save'), exact: true }).click();
    await expect(sheet).toHaveCount(0);

    // Assigned to the backing now: it is bright, the lead line dims, the legend names him.
    await expect(line('bv')).not.toHaveAttribute('data-voice-dim', 'true');
    await expect(area.locator('p[data-voice-dim="true"]').filter({ hasText: 'Paper boats' }).first()).toBeVisible();
    await expect(area.getByRole('group', { name: app.t('Voice parts') })).toContainText('Leo M.');
    const db = await app.readDb();
    const song = (db as unknown as Record<string, Record<string, unknown>[]>).songs.find((s) => s.title === 'Paper Boats')!;
    expect(Object.keys((song.vocal_parts as Record<string, string[]>) ?? {})).toEqual(['bv']);
  });
});

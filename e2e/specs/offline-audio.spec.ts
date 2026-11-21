import { test, expect } from '../fixtures';
import { openEvent, eventDetail, SEED } from '../support/flows';
import { openWith } from '../support/rehearsal';

/**
 * Audio on this device (src/app/components/event/OfflineAudioCard.tsx): on
 * an upcoming gig's setlist, the admin (whoever can be the stage manager)
 * downloads the songs' audio ahead of time, so Stage mode plays it at a venue
 * with no internet. The card fits every screen and shows how many files are
 * on the device.
 */

/** A short silent WAV (a real audio file for the download check). */
function silentWav(seconds = 1): Buffer {
  const rate = 8000;
  const data = rate * seconds * 2;
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + data, 4);
  b.write('WAVE', 8);
  b.write('fmt ', 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(data, 40);
  return b;
}

test.describe('Audio on this device (pre-download for the stage manager)', () => {
  test.use({ autoOpen: false });

  test('@smoke the admin downloads the gig’s audio from its setlist; the card fits the screen', async ({ app }) => {
    const title = SEED.gigToday;
    await app.page.context().route('**/offline-e2e/**', (route) =>
      route.fulfill({ status: 200, contentType: 'audio/wav', body: silentWav(), headers: { 'access-control-allow-origin': '*' } }),
    );
    await openWith(app, (db) => {
      db.songs.forEach((s, i) => {
        s.audio_url = `https://media.example/offline-e2e/${i}.wav`;
      });
    });
    await openEvent(app, title);
    const detail = eventDetail(app);
    // iPads: the setlist has its own tab.
    if (test.info().project.name.startsWith('ipad')) {
      await detail.getByRole('tablist', { name: app.t('Gig workspace') }).getByRole('tab', { name: app.t('SETLIST'), exact: true }).click();
    }

    const card = detail.getByRole('group', { name: app.t('Audio for the stage manager') });
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeVisible();
    await expect(card).toContainText(/\b0\/(\d+)(?!\d)/);
    const total = Number((await card.textContent())!.match(/\b0\/(\d+)(?!\d)/)![1]);
    expect(total).toBeGreaterThan(0);

    // Fits the screen: nothing sticks out sideways.
    const box = (await card.boundingBox())!;
    const vp = app.page.viewportSize()!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 1);

    const download = card.getByRole('button', { name: app.t('Download audio') });
    await expect(download).toBeInViewport({ ratio: 1 });
    await download.click();
    await expect(card).toContainText(app.t('Audio on this device {ready}/{total}', { ready: total, total }), { timeout: 20_000 });
    await expect(card).toContainText(app.t('Ready: the stage manager plays it without internet.'));
    await expect(card.getByRole('button', { name: app.t('Download audio') })).toHaveCount(0);
  });
});

test.describe('Audio on this device as a member', () => {
  test.use({ role: 'member', autoOpen: false });

  test('a member sees no download card: only whoever can be the stage manager downloads', async ({ app }) => {
    const title = SEED.gigToday;
    await openWith(app, (db) => {
      db.songs.forEach((s, i) => {
        s.audio_url = `https://media.example/offline-e2e/${i}.wav`;
      });
    });
    await openEvent(app, title);
    const detail = eventDetail(app);
    await expect(detail).toBeVisible();
    if (test.info().project.name.startsWith('ipad')) {
      await detail.getByRole('tablist', { name: app.t('Gig workspace') }).getByRole('tab', { name: app.t('SETLIST'), exact: true }).click();
    }
    await expect(detail.getByText(app.t('SETLIST')).first()).toBeAttached();
    await expect(detail.getByRole('group', { name: app.t('Audio for the stage manager') })).toHaveCount(0);
  });
});

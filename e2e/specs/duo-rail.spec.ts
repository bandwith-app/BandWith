import { test, expect, type App } from '../fixtures';
import type { DuoProfile } from '../support/devices';
import { openEvent, SEED } from '../support/flows';
import { openChatTab } from '../support/hub';

/**
 * The iPhone Duo rail: every button in it can be tapped, in every posture.
 *
 * Seen on the EV Duo simulator (1.0.6 gate): closed, turned so the camera is
 * top-left (landscape-primary, the block reported as a "top" band), the Chat
 * tab's rail held 8 buttons. The group was 532 pt tall in a 466 pt column,
 * "Open profile" sat at 471–511, under the bottom edge, and the rail could
 * not be scrolled (pointer-events: none).
 */

/** The closed Duo turned with the camera block in the top-left corner. */
const DUO_CLOSED_LANDSCAPE_PRIMARY: DuoProfile = {
  posture: 'closed',
  regions: {
    status: { x: 0, y: 0, w: 84, h: 82, edge: 'top' },
    division: null,
    hinge: { status: 'closed', angle: 0 },
  },
};

/** Every rail button lies inside the screen, clear of the camera block, on top at its centre. */
async function expectRailReachable(app: App, where: string) {
  await app.settle();
  const report = await app.page.evaluate(() => {
    const rail = document.querySelector('.bw-duo-rail');
    if (!rail) return null;
    const cam = (window as unknown as { __bwRegions?: { status?: { x: number; y: number; w: number; h: number } | null } }).__bwRegions?.status;
    const bad: string[] = [];
    const buttons = Array.from(rail.querySelectorAll('button')).filter((b) => {
      const r = b.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(b).visibility !== 'hidden';
    });
    for (const b of buttons) {
      const r = b.getBoundingClientRect();
      const name = b.getAttribute('aria-label') || b.textContent || '?';
      const at = `${Math.round(r.top)}–${Math.round(r.bottom)}`;
      if (r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) {
        bad.push(`${name} off screen (${at} of ${innerHeight})`);
        continue;
      }
      // The camera block is a small corner block only when it is not a full column.
      if (cam && cam.h < innerHeight * 0.6 && r.left < cam.x + cam.w && r.right > cam.x && r.top < cam.y + cam.h && r.bottom > cam.y) {
        bad.push(`${name} under the camera block (${at})`);
        continue;
      }
      const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!t || !(t === b || b.contains(t))) bad.push(`${name} covered (${at})`);
    }
    return { count: buttons.length, bad };
  });
  if (!report) return; // no rail on this device
  expect(report.count, `${where}: rail buttons`).toBeGreaterThan(0);
  expect(report.bad, `${where}: rail buttons out of reach`).toEqual([]);
}

async function everyTab(app: App, label: string) {
  await app.tab('Home');
  await expectRailReachable(app, `${label}: Home`);
  await app.tab('Calendar');
  await expectRailReachable(app, `${label}: Calendar`);
  await openChatTab(app);
  await expectRailReachable(app, `${label}: Chat`);
  // A gig: Back and the gig's own actions join the rail.
  await openEvent(app, SEED.gigToday);
  await expectRailReachable(app, `${label}: a gig`);
}

test.describe('Duo rail: every button within reach', () => {
  test('@smoke every rail button can be tapped on Home, Calendar, Chat and a gig', async ({ app, profileId }) => {
    test.skip(!profileId.startsWith('duo-'), 'the rail is the iPhone Duo’s');
    await everyTab(app, profileId);
  });

  test.describe('closed, camera top-left (landscape-primary)', () => {
    test.use({ duo: DUO_CLOSED_LANDSCAPE_PRIMARY });

    test('@smoke every rail button can be tapped, Chat included', async ({ app, profileId }) => {
      // The 678×466 profile, turned the other way.
      test.skip(profileId !== 'duo-closed-landscape', 'closed landscape only');
      await expect(app.page.locator('html')).toHaveAttribute('data-bw-rail-edge', 'left');
      await everyTab(app, 'landscape-primary');
    });
  });
});

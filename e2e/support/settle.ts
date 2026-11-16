import type { Page } from '@playwright/test';

/**
 * Waits until the screen stops moving: layers slide in with spring
 * animations, and measuring mid-flight would report a sheet "off screen".
 * Polls the position of every on-screen control until two reads in a row
 * match (or `timeout` passes). Not a fixed sleep: it returns as soon as the
 * page is still.
 */
export async function settle(page: Page, timeout = 4000) {
  const read = () =>
    page.evaluate(() => {
      const out: number[] = [];
      const els = document.querySelectorAll('button,[role=button],[role=dialog],a[href],input,h1,h2');
      for (let i = 0; i < els.length && out.length < 1200; i++) {
        const r = els[i].getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        out.push(Math.round(r.left), Math.round(r.top), Math.round(r.width));
      }
      const running = document
        .getAnimations()
        .filter((a) => a.playState === 'running' && (a.effect?.getComputedTiming().endTime ?? 0) !== Infinity).length;
      return `${running}|${out.join(',')}`;
    });
  const end = Date.now() + timeout;
  let last = await read().catch(() => '');
  while (Date.now() < end) {
    await page.waitForTimeout(120);
    const next = await read().catch(() => '');
    if (next === last && next.startsWith('0|')) return;
    last = next;
  }
}

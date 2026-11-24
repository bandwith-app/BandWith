import type { BrowserContext } from '@playwright/test';

/**
 * A slow machine, on request, for chasing timing races locally (with
 * `--repeat-each`). Off unless a variable is set; never set in CI.
 *
 * `E2E_SLOW_CPU=5` gives every page of the test about a fifth of the CPU:
 * - Chromium: the DevTools CPU throttle (`Emulation.setCPUThrottlingRate`).
 * - WebKit (no such switch): the page's main thread is kept busy in bursts,
 *   `burst` ms working for every `burst / (rate - 1)` ms left to the app.
 *   `E2E_SLOW_CPU=5:200` sets the burst (default 40 ms).
 *
 * `E2E_SLOW_FPS=2` lets the page draw only that many frames a second
 * (requestAnimationFrame callbacks wait for the next allowed frame), as a CI
 * runner does when it paints WebKit in software: scripts still answer at
 * once, but anything that moves does so in a few big steps.
 */
export async function slowMachine(context: BrowserContext, browserName: string) {
  const [rate, burst = 40] = (process.env.E2E_SLOW_CPU ?? '').split(':').map(Number);
  const fps = Number(process.env.E2E_SLOW_FPS ?? 0);
  if (fps > 0) {
    await context.addInitScript((gap) => {
      if (window.top !== window) return;
      const raf = window.requestAnimationFrame.bind(window);
      const caf = window.cancelAnimationFrame.bind(window);
      let queue = new Map<number, FrameRequestCallback>();
      let id = 0;
      let last = 0;
      let armed = 0;
      const frame = (ts: number) => {
        armed = 0;
        if (performance.now() - last < gap) {
          armed = raf(frame);
          return;
        }
        last = performance.now();
        const run = queue;
        queue = new Map();
        for (const cb of run.values()) cb(ts);
      };
      window.requestAnimationFrame = (cb) => {
        queue.set(++id, cb);
        if (!armed) armed = raf(frame);
        return id;
      };
      window.cancelAnimationFrame = (n) => {
        queue.delete(n);
        if (!queue.size && armed) {
          caf(armed);
          armed = 0;
        }
      };
    }, 1000 / fps);
  }
  if (!rate || rate <= 1) return;
  if (browserName === 'chromium') {
    const throttle = async (page: Parameters<BrowserContext['newCDPSession']>[0]) => {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    };
    for (const page of context.pages()) await throttle(page);
    context.on('page', (page) => void throttle(page).catch(() => undefined));
    return;
  }
  await context.addInitScript(
    ({ burst, idle }) => {
      if (window.top !== window) return;
      const ch = new MessageChannel();
      ch.port1.onmessage = () => {
        const end = performance.now() + burst;
        while (performance.now() < end);
        setTimeout(() => ch.port2.postMessage(0), idle);
      };
      ch.port2.postMessage(0);
    },
    { burst, idle: burst / (rate - 1) },
  );
}

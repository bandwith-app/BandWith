/**
 * The stylesheet side of the keyboard on iOS (found by the emulator check on
 * an iPhone 17 Pro Max: a gig's title sheet went 388 → 422 → 205, the chat's
 * message box 862 → 896 → 549, instead of one move).
 *
 * - --safe-bottom (the home indicator's 34 px) is zeroed with the keyboard up
 *   on Android only. On iOS env(safe-area-inset-bottom) drops to 0 by itself
 *   when the web view ends above the home indicator; zeroing it from
 *   keyboardWillShow, half a second before the web view shrinks, dropped every
 *   bottom sheet and bottom bar by 34 px first.
 * - In the iOS app, bottom sheets and full-screen layers are pinned to the
 *   bottom of 100vh: right after the web view shrinks WKWebView keeps fixed
 *   layers on the old bottom for a few frames while vh and env() are new.
 *
 * Browsers and jsdom don't lay out native WebView states, so this checks the
 * rules as written (like RehearsalPollModal.keyboard.test.tsx does).
 */
import { describe, expect, it } from 'vitest';

const FS = 'node:fs';
const readCss = async (name: string): Promise<string> => {
  const { readFileSync } = (await import(/* @vite-ignore */ FS)) as { readFileSync: (p: string, enc: 'utf8') => string };
  const cwd = (globalThis as unknown as { process: { cwd: () => string } }).process.cwd();
  return readFileSync(`${cwd}/src/styles/${name}`, 'utf8');
};
/** Rules (selector → body) of a stylesheet, comments dropped. */
const rules = (css: string) =>
  [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));

describe('keyboard up: the home-indicator inset', () => {
  it('is zeroed on Android only, never from the keyboard flag alone (iOS)', async () => {
    const zeroing = rules(await readCss('theme.css')).filter((r) => /data-keyboard="open"/.test(r.selector) && /--safe-bottom:\s*0/.test(r.body));
    expect(zeroing.length).toBeGreaterThan(0);
    for (const r of zeroing) {
      for (const part of r.selector.split(',')) expect(part).toMatch(/\[data-platform="android"\]/);
    }
  });
});

describe('iOS app: fixed layers pinned to the bottom of 100vh', () => {
  it('bottom sheets and full-screen layers', async () => {
    const pin = rules(await readCss('index.css')).find((r) => /bottom:\s*max\(0px,\s*calc\(100% - 100vh\)\)/.test(r.body));
    expect(pin, 'a rule pinning fixed layers to 100vh').toBeTruthy();
    expect(pin!.selector).toMatch(/is-native:not\(\.is-android\)/);
    expect(pin!.selector).toMatch(/\.bw-sheet\.fixed\.bottom-0/);
    expect(pin!.selector).toMatch(/\.bw-pane-detail\.fixed\.inset-0/);
  });
});

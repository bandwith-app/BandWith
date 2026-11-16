import { devices, type PlaywrightTestOptions, type PlaywrightWorkerOptions } from '@playwright/test';

/**
 * Device profiles the suite runs on. Each one is a Playwright project.
 *
 * Duo postures: the iPhone Duo's posture never comes from the browser. The
 * native shell (ios/App/App/BandWithBridgeViewController.swift) installs
 * `window.__bwApplyRegions` before the app's scripts and calls it with the
 * display regions iOS reports (system column, fold, hinge). The suite
 * installs the very same receiver (see `duoInitScript`) and feeds it the
 * regions the Duo simulator reports in each posture, so src/lib/deviceRegions.ts
 * and src/lib/posture.ts run exactly as they do on the device. No app code is
 * changed for this.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DuoRegions {
  status: (Rect & { edge?: 'left' | 'right' | 'top' | 'bottom' }) | null;
  division: Rect | null;
  hinge: { status: 'closed' | 'partial' | 'open' | 'unknown'; angle?: number | null } | null;
}

export interface DuoProfile {
  posture: 'closed' | 'book' | 'tabletop' | 'open-flat';
  regions: DuoRegions;
  /** Horizontal fold band (Laptop pose): no control may sit in it. */
  foldBand?: { top: number; bottom: number };
}

/** Options every spec can read through the `profile` fixture. */
export interface ProfileOptions {
  /** Short id used in reports and docs. */
  profileId: string;
  duo: DuoProfile | null;
}

const iphone = devices['iPhone 14'];
const ipad = devices['iPad Pro 11'];
const pixel = devices['Pixel 7'];

type Use = PlaywrightTestOptions & PlaywrightWorkerOptions & ProfileOptions;

const phone = (w: number, h: number): Partial<Use> => ({
  ...iphone,
  viewport: { width: w, height: h },
  screen: { width: w, height: h },
  defaultBrowserType: 'webkit',
});

// The closed Duo (cover display): 466×678 with the clock/camera block in
// the top-right corner; turned, the block sits bottom-right.
const DUO_CLOSED_P: DuoRegions = {
  status: { x: 382, y: 0, w: 84, h: 82, edge: 'right' },
  division: null,
  hinge: { status: 'closed', angle: 0 },
};
const DUO_CLOSED_L: DuoRegions = {
  status: { x: 594, y: 384, w: 84, h: 82, edge: 'bottom' },
  division: null,
  hinge: { status: 'closed', angle: 0 },
};
// Open, half folded, held sideways ("book"): a full-height system column on
// the right and a vertical fold in the middle.
const DUO_BOOK: DuoRegions = {
  status: { x: 881, y: 0, w: 70, h: 669, edge: 'right' },
  division: { x: 455, y: 0, w: 40, h: 669 },
  hinge: { status: 'partial', angle: 110 },
};
// Laptop pose: half folded, the fold runs across at y 455–495; the clock is
// a 144×82 block in the top-right corner of the upright half.
const DUO_LAPTOP: DuoRegions = {
  status: { x: 525, y: 0, w: 144, h: 82, edge: 'right' },
  division: { x: 0, y: 455, w: 669, h: 40 },
  hinge: { status: 'partial', angle: 100 },
};
// Open flat, upright: one tall pane, the clock block top-right.
const DUO_OPEN: DuoRegions = {
  status: { x: 585, y: 0, w: 84, h: 82, edge: 'right' },
  division: null,
  hinge: { status: 'open', angle: 180 },
};

const duo = (w: number, h: number, profile: DuoProfile): Partial<Use> => ({
  ...iphone,
  viewport: { width: w, height: h },
  screen: { width: w, height: h },
  defaultBrowserType: 'webkit',
  duo: profile,
});

export interface DeviceProject {
  name: string;
  /** Runs every flow (true) or only the @smoke layout + privacy checks. */
  full: boolean;
  use: Partial<Use>;
}

export const DEVICE_PROJECTS: DeviceProject[] = [
  { name: 'phone-portrait', full: true, use: { ...phone(390, 844), profileId: 'phone-portrait' } },
  { name: 'phone-landscape', full: false, use: { ...phone(844, 390), profileId: 'phone-landscape' } },
  {
    name: 'android',
    full: false,
    use: {
      ...pixel,
      viewport: { width: 412, height: 915 },
      screen: { width: 412, height: 915 },
      defaultBrowserType: 'chromium',
      profileId: 'android',
    },
  },
  {
    name: 'ipad-landscape',
    full: true,
    use: { ...ipad, viewport: { width: 1210, height: 834 }, screen: { width: 1210, height: 834 }, defaultBrowserType: 'webkit', profileId: 'ipad-landscape' },
  },
  {
    name: 'ipad-portrait',
    full: false,
    use: { ...ipad, viewport: { width: 834, height: 1210 }, screen: { width: 834, height: 1210 }, defaultBrowserType: 'webkit', profileId: 'ipad-portrait' },
  },
  { name: 'duo-closed', full: false, use: { ...duo(466, 678, { posture: 'closed', regions: DUO_CLOSED_P }), profileId: 'duo-closed' } },
  { name: 'duo-closed-landscape', full: false, use: { ...duo(678, 466, { posture: 'closed', regions: DUO_CLOSED_L }), profileId: 'duo-closed-landscape' } },
  { name: 'duo-book', full: false, use: { ...duo(951, 669, { posture: 'book', regions: DUO_BOOK }), profileId: 'duo-book' } },
  {
    name: 'duo-laptop',
    full: false,
    use: {
      ...duo(669, 951, { posture: 'tabletop', regions: DUO_LAPTOP, foldBand: { top: 455, bottom: 495 } }),
      profileId: 'duo-laptop',
    },
  },
  { name: 'duo-open', full: false, use: { ...duo(669, 951, { posture: 'open-flat', regions: DUO_OPEN }), profileId: 'duo-open' } },
];

/**
 * The native shell's bootstrap script (BandWithBridgeViewController.swift),
 * then the regions the shell would send once the DOM is ready.
 */
export function duoInitScript(arg: { regions: DuoRegions }) {
  // Init scripts run before <html> exists: reach it lazily.
  const root = () => document.documentElement;
  function apply(r: DuoRegions & { viewport: { w: number; h: number } }) {
    (window as unknown as { __bwRegions: unknown }).__bwRegions = r;
    const el = root();
    if (!el) return;
    const vw = (r.viewport && r.viewport.w) || window.innerWidth;
    const s = r.status;
    const edge = s ? s.edge || 'right' : null;
    el.style.setProperty('--bw-status-clear-x', s && edge === 'right' ? Math.max(0, vw - s.x) + 'px' : '0px');
    el.style.setProperty('--bw-status-clear-left', s && edge === 'left' ? Math.max(0, s.x + s.w) + 'px' : '0px');
    el.style.setProperty('--bw-status-clear-y', s && edge !== 'bottom' ? s.y + s.h + 'px' : '0px');
    el.toggleAttribute('data-bw-status-column', !!s);
    if (edge) el.setAttribute('data-bw-status-edge', edge);
    else el.removeAttribute('data-bw-status-edge');
    el.toggleAttribute('data-bw-fold', !!r.division);
    window.dispatchEvent(new CustomEvent('bwregions', { detail: r }));
  }
  const regions = () => ({ ...arg.regions, viewport: { w: window.innerWidth, h: window.innerHeight } });
  (window as unknown as { __bwApplyRegions: unknown }).__bwApplyRegions = apply;
  // Known from the first line of app code on, like on the device; the CSS
  // side follows as soon as the DOM exists (the shell answers its "ready"
  // message the same way).
  (window as unknown as { __bwRegions: unknown }).__bwRegions = regions();
  document.addEventListener('DOMContentLoaded', () => apply(regions()));
}

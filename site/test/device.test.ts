/**
 * The Get page puts the visitor's own door first (core/device.ts): TestFlight
 * on iPhone and iPad, the APK on Android, the web app anywhere else. The
 * decision is a pure function; the page runs it inline, right after the
 * doors, so the order is right before the first paint.
 */
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'fs';
import path from 'path';
import { deviceOf, doorOrder } from '../src/core/device';
import { doorOrderScript } from '../src/content/render';
import { englishPage } from '../tools/pages';

const SITE = path.resolve(__dirname, '..');

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  iphoneFacebook: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/520.0.0;FBDV/iPhone15,2]',
  ipadOld: 'Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1',
  // iPadOS Safari and a Mac send the same string: only the touch points tell them apart.
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  android: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  androidTablet: 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  linux: 'Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0',
};

describe('which device is this', () => {
  it('iPhone and iPad, in Safari or inside another app', () => {
    expect(deviceOf(UA.iphone, 5)).toBe('ios');
    expect(deviceOf(UA.iphoneFacebook, 5)).toBe('ios');
    expect(deviceOf(UA.ipadOld, 5)).toBe('ios');
  });

  it('an iPad that says it is a Mac: touch points give it away', () => {
    expect(deviceOf(UA.mac, 5)).toBe('ios');
    expect(deviceOf(UA.mac, 2)).toBe('ios');
  });

  it('a real Mac (no touch screen) is not an iPad', () => {
    expect(deviceOf(UA.mac, 0)).toBe('web');
    expect(deviceOf(UA.mac, 1)).toBe('web');
  });

  it('Android phones and tablets', () => {
    expect(deviceOf(UA.android, 5)).toBe('android');
    expect(deviceOf(UA.androidTablet, 5)).toBe('android');
  });

  it('anything else gets the web app, touch screen or not', () => {
    expect(deviceOf(UA.windows, 0)).toBe('web');
    expect(deviceOf(UA.windows, 10)).toBe('web');
    expect(deviceOf(UA.linux, 0)).toBe('web');
    expect(deviceOf('', 0)).toBe('web');
  });
});

describe('the order of the doors', () => {
  it('the visitor’s own door first, the web app before the other phone', () => {
    expect(doorOrder('ios')).toEqual(['ios', 'web', 'android']);
    expect(doorOrder('android')).toEqual(['android', 'web', 'ios']);
    expect(doorOrder('web')).toEqual(['web', 'android', 'ios']);
  });

  it('always the same three doors', () => {
    for (const d of ['ios', 'android', 'web'] as const) expect([...doorOrder(d)].sort()).toEqual(['android', 'ios', 'web']);
  });
});

describe('the Get page orders its doors before the first paint', () => {
  const source = readFileSync(path.join(SITE, 'get/index.html'), 'utf8');

  /** The built Get page as a browser with this user agent would run it (inline scripts only). */
  function open(userAgent: string, maxTouchPoints: number) {
    const dom = new JSDOM(englishPage('get/index.html'), {
      runScripts: 'dangerously',
      url: 'https://bandwith.fun/get/',
      beforeParse(window) {
        Object.defineProperty(window.navigator, 'userAgent', { value: userAgent, configurable: true });
        Object.defineProperty(window.navigator, 'maxTouchPoints', { value: maxTouchPoints, configurable: true });
        // The head's own boot script asks for it; jsdom has none.
        Object.assign(window, { matchMedia: () => ({ matches: false }) });
      },
    });
    const doc = dom.window.document;
    const doors = [...doc.querySelectorAll('[data-doors] > .gdoor')];
    return {
      device: doc.documentElement.getAttribute('data-device'),
      ids: doors.map((d) => d.id),
      numbers: doors.map((d) => d.querySelector('[data-door-no]')?.textContent),
    };
  }

  it('runs inline, right after the doors (not in the page module)', () => {
    expect(source).toMatch(/<\/article>\s*<\/div>\s*<!--@door-order-->/);
    expect(doorOrderScript()).toMatch(/^<script>[\s\S]+<\/script>$/);
    expect(doorOrderScript()).not.toMatch(/type="module"|src=/);
  });

  it('iPhone: TestFlight first', () => {
    const p = open(UA.iphone, 5);
    expect(p.device).toBe('ios');
    expect(p.ids).toEqual(['ios', 'web', 'android']);
  });

  it('iPad that says it is a Mac: TestFlight first', () => {
    expect(open(UA.mac, 5).ids).toEqual(['ios', 'web', 'android']);
  });

  it('Android: the APK first', () => {
    const p = open(UA.android, 5);
    expect(p.device).toBe('android');
    expect(p.ids).toEqual(['android', 'web', 'ios']);
  });

  it('a laptop: the web app first, as written', () => {
    const p = open(UA.mac, 0);
    expect(p.device).toBe('web');
    expect(p.ids).toEqual(['web', 'android', 'ios']);
  });

  it('Door 01, 02, 03 follow the order on screen, on every device', () => {
    for (const [ua, touch] of [[UA.iphone, 5], [UA.android, 5], [UA.mac, 0], [UA.mac, 5]] as const) {
      expect(open(ua, touch).numbers).toEqual(['Door 01', 'Door 02', 'Door 03']);
    }
  });
});

/**
 * The Get page orders its doors for the device (core/device.ts). A phone: the
 * web app first (it opens right there, nothing to install), then the phone's
 * own app (TestFlight on iPhone, the APK on Android), then the other. A
 * tablet or a computer: its own door first (TestFlight on iPad, the APK on an
 * Android tablet, the web app anywhere else). The decision is a pure
 * function; the page runs it inline, right after the doors, so the order is
 * right before the first paint.
 */
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'fs';
import path from 'path';
import { deviceOf, doorOrder, isPhone } from '../src/core/device';
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

describe('is it a phone', () => {
  it('an iPhone, in Safari or inside another app', () => {
    expect(isPhone(UA.iphone)).toBe(true);
    expect(isPhone(UA.iphoneFacebook)).toBe(true);
  });

  it('an Android phone says Mobile; an Android tablet doesn’t', () => {
    expect(isPhone(UA.android)).toBe(true);
    expect(isPhone(UA.androidTablet)).toBe(false);
  });

  it('an iPad is not a phone, whatever it calls itself', () => {
    expect(isPhone(UA.ipadOld)).toBe(false);
    expect(isPhone(UA.mac)).toBe(false);
  });

  it('a computer is not a phone', () => {
    expect(isPhone(UA.windows)).toBe(false);
    expect(isPhone(UA.linux)).toBe(false);
    expect(isPhone('')).toBe(false);
  });
});

describe('the order of the doors', () => {
  it('a phone: the web app first, then its own app, then the other', () => {
    expect(doorOrder('ios', true)).toEqual(['web', 'ios', 'android']);
    expect(doorOrder('android', true)).toEqual(['web', 'android', 'ios']);
  });

  it('a tablet or a computer: its own door first, the web app before the other phone', () => {
    expect(doorOrder('ios')).toEqual(['ios', 'web', 'android']);
    expect(doorOrder('ios', false)).toEqual(['ios', 'web', 'android']);
    expect(doorOrder('android', false)).toEqual(['android', 'web', 'ios']);
    expect(doorOrder('web')).toEqual(['web', 'android', 'ios']);
    expect(doorOrder('web', false)).toEqual(['web', 'android', 'ios']);
  });

  it('always the same three doors', () => {
    for (const d of ['ios', 'android', 'web'] as const) {
      for (const phone of [true, false]) expect([...doorOrder(d, phone)].sort()).toEqual(['android', 'ios', 'web']);
    }
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
    /** What a visitor reads in a part of the page: nothing that is hidden. */
    const shown = (sel: string) => [...doc.querySelectorAll<HTMLElement>(sel)].filter((el) => !el.closest('[hidden]')).map((el) => el.textContent!.replace(/\s+/g, ' ').trim());
    return {
      device: doc.documentElement.getAttribute('data-device'),
      phone: doc.documentElement.hasAttribute('data-phone'),
      ids: doors.map((d) => d.id),
      numbers: doors.map((d) => d.querySelector('[data-door-no]')?.textContent),
      webLine: shown('#web .gdoor__line'),
      webFacts: shown('#web .gdoor__facts li'),
      /** Every child of the doors' grid, in order: the three doors and the trust line. */
      grid: [...doc.querySelectorAll('[data-doors] > *')].map((el) => (el.hasAttribute('data-trust') ? 'trust' : el.id)),
    };
  }

  it('runs inline, right after the doors (not in the page module)', () => {
    expect(source).toMatch(/<\/article>\s*<\/div>\s*<!--@door-order-->/);
    expect(doorOrderScript()).toMatch(/^<script>[\s\S]+<\/script>$/);
    expect(doorOrderScript()).not.toMatch(/type="module"|src=/);
  });

  it('iPhone: the web app first, then TestFlight', () => {
    const p = open(UA.iphone, 5);
    expect(p.device).toBe('ios');
    expect(p.phone).toBe(true);
    expect(p.ids).toEqual(['web', 'ios', 'android']);
  });

  it('iPhone inside Facebook: the same', () => {
    expect(open(UA.iphoneFacebook, 5).ids).toEqual(['web', 'ios', 'android']);
  });

  it('Android phone: the web app first, then the APK', () => {
    const p = open(UA.android, 5);
    expect(p.device).toBe('android');
    expect(p.phone).toBe(true);
    expect(p.ids).toEqual(['web', 'android', 'ios']);
  });

  it('iPad (it says it is a Mac): TestFlight first, as before', () => {
    const p = open(UA.mac, 5);
    expect(p.phone).toBe(false);
    expect(p.ids).toEqual(['ios', 'web', 'android']);
    expect(open(UA.ipadOld, 5).ids).toEqual(['ios', 'web', 'android']);
  });

  it('Android tablet: the APK first, as before', () => {
    const p = open(UA.androidTablet, 5);
    expect(p.phone).toBe(false);
    expect(p.ids).toEqual(['android', 'web', 'ios']);
  });

  it('a laptop: the web app first, as written', () => {
    const p = open(UA.mac, 0);
    expect(p.device).toBe('web');
    expect(p.phone).toBe(false);
    expect(p.ids).toEqual(['web', 'android', 'ios']);
  });

  it('Door 01, 02, 03 follow the order on screen, on every device', () => {
    for (const [ua, touch] of [[UA.iphone, 5], [UA.android, 5], [UA.androidTablet, 5], [UA.mac, 0], [UA.mac, 5]] as const) {
      expect(open(ua, touch).numbers).toEqual(['Door 01', 'Door 02', 'Door 03']);
    }
  });

  const PHONE_LINE = 'Fastest way in. Works on your phone right now, nothing to install. Add the phone app later for Bluetooth and offline Stage mode.';
  const OTHER_LINE = 'Create your account in the browser. Nothing to install. Good on a laptop or a tablet.';

  it('on a phone the web door says it is the fastest way in, and drops the minus about Bluetooth', () => {
    for (const ua of [UA.iphone, UA.android, UA.iphoneFacebook]) {
      const p = open(ua, 5);
      expect(p.webLine).toEqual([PHONE_LINE]);
      expect(p.webFacts).toEqual(['Every feature, live sync and the click', 'The same account when you add the phone app']);
    }
  });

  it('on a tablet or a computer the web door keeps its words', () => {
    for (const [ua, touch] of [[UA.mac, 0], [UA.mac, 5], [UA.androidTablet, 5], [UA.windows, 10]] as const) {
      const p = open(ua, touch);
      expect(p.webLine).toEqual([OTHER_LINE]);
      expect(p.webFacts).toEqual(['Every feature, live sync and the click', 'No Bluetooth or offline Stage mode']);
    }
  });

  it('without scripts the page reads as on a computer (the phone words are written hidden)', () => {
    expect(source).toMatch(/<p class="gdoor__line" data-door-for="other">Create your account in the browser\./);
    expect(source).toMatch(/<p class="gdoor__line" data-door-for="phone" hidden>Fastest way in\./);
    expect(source).toMatch(/<li data-door-for="phone" hidden>/);
  });

  it('the trust line: after the first door on a phone, under the three doors anywhere else', () => {
    expect(open(UA.iphone, 5).grid).toEqual(['web', 'trust', 'ios', 'android']);
    expect(open(UA.android, 5).grid).toEqual(['web', 'trust', 'android', 'ios']);
    expect(open(UA.mac, 0).grid).toEqual(['web', 'android', 'ios', 'trust']);
    expect(open(UA.mac, 5).grid).toEqual(['ios', 'web', 'android', 'trust']);
  });
});

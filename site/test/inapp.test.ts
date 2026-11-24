/**
 * Facebook's and Instagram's in-app browsers (core/inApp.ts): told apart from
 * real browsers by the user agent, and offered a way out in a bar at the top
 * of every page. The bar is written hidden; an inline script right after it
 * shows it before the first paint, only there.
 * In a browser (layout, the consent banner, closing it): e2e/site/conversion.spec.ts.
 */
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { PAGES, englishPage } from '../tools/pages';
import { finalizePage } from '../tools/i18n';
import { INAPP_CLOSED_KEY, chromeIntentUrl, inAppBrowser } from '../src/core/inApp';
import { inAppBar } from '../src/content/render';

const UA = {
  safari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  chromeIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  // A plain Android WebView (another app's): "wv" alone is not Facebook.
  webview: 'Mozilla/5.0 (Linux; Android 15; Pixel 9 Build/AP3A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  fbIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/520.0.0;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/18.5;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5]',
  fbAndroid: 'Mozilla/5.0 (Linux; Android 15; Pixel 9 Build/AP3A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/520.0.0.0;]',
  // Older Android builds: FBAN/FB4A with no FB_IAB token.
  fbAndroidOld: 'Mozilla/5.0 (Linux; Android 12; SM-G991B Build/SP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 [FBAN/FB4A;FBAV/440.0.0.0;]',
  messengerIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerForiOS;FBAV/480.0.0;FBDV/iPhone15,2]',
  messengerAndroid: 'Mozilla/5.0 (Linux; Android 15; Pixel 9 Build/AP3A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36 [FB_IAB/Orca-Android;FBAV/480.0.0.0;]',
  igIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 390.0.0.28.85 (iPhone15,2; iOS 18_5; en_US; en; scale=3.00; 1179x2556; 742412091)',
  igAndroid: 'Mozilla/5.0 (Linux; Android 15; Pixel 9 Build/AP3A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36 Instagram 390.0.0.43.81 Android (35/15; 420dpi; 1080x2424; Google/google; Pixel 9; tokay; tokay; en_US; 742412091)',
  // Instagram builds that carry Facebook's tokens too: still Instagram.
  igWithFb: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 390.0.0.28.85 [FBAN/InstagramForiOS;FBAV/390.0]',
};

describe('which in-app browser is this', () => {
  it('Facebook: FBAN, FBAV or FB_IAB, on iPhone and Android, Messenger included', () => {
    for (const k of ['fbIphone', 'fbAndroid', 'fbAndroidOld', 'messengerIphone', 'messengerAndroid'] as const) expect(inAppBrowser(UA[k]), k).toBe('facebook');
    expect(inAppBrowser('x FBAN/FBIOS')).toBe('facebook');
    expect(inAppBrowser('x FBAV/1.0')).toBe('facebook');
    expect(inAppBrowser('x [FB_IAB/FB4A]')).toBe('facebook');
  });

  it('Instagram, also when its user agent carries Facebook’s tokens', () => {
    for (const k of ['igIphone', 'igAndroid', 'igWithFb'] as const) expect(inAppBrowser(UA[k]), k).toBe('instagram');
  });

  it('a real browser is not one: Safari, Chrome, another app’s web view, a computer', () => {
    for (const k of ['safari', 'chromeIos', 'chromeAndroid', 'webview', 'mac', 'windows'] as const) expect(inAppBrowser(UA[k]), k).toBeNull();
    expect(inAppBrowser('')).toBeNull();
  });
});

describe('the Android link that opens the same address in Chrome', () => {
  it('an intent for Chrome, with the plain https address as the fallback', () => {
    expect(chromeIntentUrl('https://bandwith.fun/')).toBe(
      'intent://bandwith.fun/#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=https%3A%2F%2Fbandwith.fun%2F;end',
    );
  });

  it('keeps the path and the query; the #fragment can’t ride in an intent link', () => {
    expect(chromeIntentUrl('https://bandwith.fun/it/get/?capacity=open#web')).toBe(
      'intent://bandwith.fun/it/get/?capacity=open#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=https%3A%2F%2Fbandwith.fun%2Fit%2Fget%2F%3Fcapacity%3Dopen;end',
    );
  });

  it('anything that is not a web address comes back untouched', () => {
    for (const href of ['about:blank', 'mailto:someone@example.com', '']) expect(chromeIntentUrl(href)).toBe(href);
  });
});

describe('the bar on the built pages', () => {
  /** A page as a browser with this user agent runs it (inline scripts only). */
  function open(rel: string, userAgent: string, o: { touch?: number; closed?: boolean; lang?: 'en' | 'it' | 'es'; url?: string } = {}) {
    const lang = o.lang ?? 'en';
    const dom = new JSDOM(finalizePage(englishPage(rel), rel, lang), {
      runScripts: 'dangerously',
      url: o.url ?? `https://bandwith.fun/${lang === 'en' ? '' : `${lang}/`}${rel.replace(/index\.html$/, '')}`,
      beforeParse(window) {
        Object.defineProperty(window.navigator, 'userAgent', { value: userAgent, configurable: true });
        Object.defineProperty(window.navigator, 'maxTouchPoints', { value: o.touch ?? 5, configurable: true });
        Object.assign(window, { matchMedia: () => ({ matches: false }) });
        if (o.closed) window.sessionStorage.setItem(INAPP_CLOSED_KEY, '1');
      },
    });
    const doc = dom.window.document;
    const bar = doc.querySelector<HTMLElement>('[data-inapp-bar]')!;
    const shown = (sel: string) => [...bar.querySelectorAll<HTMLElement>(sel)].filter((el) => !el.closest('[hidden]'));
    return {
      doc, bar,
      visible: !bar.hidden,
      inapp: doc.documentElement.getAttribute('data-inapp'),
      words: shown('.iab__t > *').map((el) => el.textContent),
      actions: shown('.iab__go'),
    };
  }

  it('is on every page, written hidden, first thing after the skip link and before the header', () => {
    for (const rel of Object.values(PAGES).concat('404.html')) {
      const html = englishPage(rel);
      expect(html.match(/data-inapp-bar/g), rel).toHaveLength(2); // the bar, and the script that finds it
      expect(html, rel).toMatch(/<a class="skip" href="#main">Skip to content<\/a>\s*<!--[^>]*-->\s*<aside class="iab" data-inapp-bar aria-label="Open in your browser" hidden>/);
      expect(html.indexOf('data-inapp-bar'), rel).toBeLessThan(html.indexOf('<header class="nav"'));
    }
    expect(inAppBar()).toMatch(/^<aside [\s\S]+<\/aside><script>[\s\S]+<\/script>$/);
    expect(inAppBar()).not.toMatch(/type="module"|src=/);
  });

  it('a real browser never sees it', () => {
    for (const k of ['safari', 'chromeIos', 'chromeAndroid', 'webview', 'mac', 'windows'] as const) {
      const p = open('index.html', UA[k], { touch: k === 'mac' || k === 'windows' ? 0 : 5 });
      expect(p.visible, k).toBe(false);
      expect(p.inapp, k).toBeNull();
    }
  });

  it('Facebook on Android: one link that opens this address in Chrome', () => {
    const p = open('get/index.html', UA.fbAndroid);
    expect(p.visible).toBe(true);
    expect(p.inapp).toBe('facebook');
    expect(p.words).toEqual(['You’re in Facebook’s browser.', 'Open in your browser to sign in or install.']);
    expect(p.actions).toHaveLength(1);
    expect(p.actions[0].tagName).toBe('A');
    expect(p.actions[0].textContent).toBe('Open in Chrome');
    expect(p.actions[0].getAttribute('href')).toBe(chromeIntentUrl('https://bandwith.fun/get/'));
    expect(p.actions[0].getAttribute('href')).toMatch(/^intent:\/\/bandwith\.fun\/get\/#Intent;scheme=https;package=com\.android\.chrome;/);
  });

  it('Facebook on iPhone: the words say how, the one action copies the link', () => {
    const p = open('index.html', UA.fbIphone);
    expect(p.visible).toBe(true);
    expect(p.inapp).toBe('facebook');
    expect(p.words).toEqual(['You’re in Facebook’s browser.', 'To sign in or install, tap ··· then Open in browser.']);
    expect(p.actions).toHaveLength(1);
    expect(p.actions[0].tagName).toBe('BUTTON');
    expect(p.actions[0].hasAttribute('data-iab-copy')).toBe(true);
    expect([...p.actions[0].children].filter((c) => !(c as HTMLElement).hidden).map((c) => c.textContent)).toEqual(['Copy link']);
  });

  it('Instagram says Instagram, on both', () => {
    expect(open('index.html', UA.igIphone).words[0]).toBe('You’re in Instagram’s browser.');
    const a = open('index.html', UA.igAndroid);
    expect(a.inapp).toBe('instagram');
    expect(a.words).toEqual(['You’re in Instagram’s browser.', 'Open in your browser to sign in or install.']);
    expect(a.actions[0].textContent).toBe('Open in Chrome');
  });

  it('closed once, it stays away for the visit', () => {
    const p = open('index.html', UA.fbAndroid, { closed: true });
    expect(p.visible).toBe(false);
    expect(p.inapp).toBeNull();
  });

  it('can always be closed, and its controls have names', () => {
    const p = open('index.html', UA.fbIphone);
    const close = p.bar.querySelector('[data-iab-close]')!;
    expect(close.tagName).toBe('BUTTON');
    expect(close.getAttribute('aria-label')).toBe('Close');
    expect(p.bar.getAttribute('aria-label')).toBe('Open in your browser');
  });

  it('in Italian and Spanish', () => {
    const it_ = open('get/index.html', UA.fbAndroid, { lang: 'it' });
    expect(it_.words).toEqual(['Sei nel browser di Facebook.', 'Aprilo nel tuo browser per accedere o installare.']);
    expect(it_.actions[0].textContent).toBe('Apri in Chrome');
    expect(it_.actions[0].getAttribute('href')).toBe(chromeIntentUrl('https://bandwith.fun/it/get/'));
    const es = open('index.html', UA.igIphone, { lang: 'es' });
    expect(es.words).toEqual(['Estás en el navegador de Instagram.', 'Para entrar o instalar, toca ··· y luego Abrir en el navegador.']);
    expect(es.actions[0].textContent).toContain('Copiar enlace');
    expect(es.bar.getAttribute('aria-label')).toBe('Abrir en tu navegador');
  });
});

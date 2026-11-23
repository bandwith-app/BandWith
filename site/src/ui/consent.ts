/**
 * Analytics consent: Google Analytics 4 (G-GCWSEQRZ2E) with Consent Mode v2,
 * basic mode. partials/head.html sets every consent type to denied and loads
 * gtag.js only on a stored yes (window.bwLoadGa); this banner asks the rest.
 * Before a yes nothing is sent to Google: no script, no cookie, no ping.
 *
 * - Accept and Reject are the same size and style, side by side.
 * - On a phone the card is compact (two lines and the buttons, about 115px):
 *   it says the same in fewer words, so it never covers what the page is
 *   for. Wider screens get the full sentence. Both are in the card; CSS
 *   (styles/lang.css) shows one.
 * - The choice is kept in localStorage (bw-site-consent = granted | denied)
 *   and <html data-consent>; the footer's "Cookie preferences" reopens it.
 * - Accept grants analytics_storage only: ad_storage, ad_user_data and
 *   ad_personalization stay denied, Google signals and ad personalisation are
 *   off. Reject after a yes switches GA off on the spot (ga-disable flag), removes
 *   the _ga cookies, and later pages don't load gtag.js.
 * - It waits for the language suggestion (ui/langSuggest.ts): one at a time.
 *
 * Its words come from the page's dictionary (i18n/dict/live.ts).
 */
import { storageGet, storageSet } from '../core/storage';
import { LANG, t } from '../i18n/runtime';
import { localizeHref } from '../i18n/langs';

export const CONSENT_KEY = 'bw-site-consent';
type Choice = 'granted' | 'denied';
const PRIVACY_URL = localizeHref('https://app.bandwith.fun/legal/privacy.html', LANG);

declare global {
  interface Window { gtag?: (...args: unknown[]) => void; dataLayer?: unknown[]; bwLoadGa?: () => void }
}

const gtag = (...args: unknown[]) => {
  if (window.gtag) window.gtag(...args);
  else (window.dataLayer ??= []).push(args);
};

const stored = (): Choice | null => {
  const v = storageGet(CONSENT_KEY);
  return v === 'granted' || v === 'denied' ? v : null;
};

/** Removes Google Analytics cookies on this host and its parent domains. */
function clearGaCookies() {
  const names = document.cookie.split(';').map((c) => c.split('=')[0].trim()).filter((n) => /^_ga/.test(n));
  const parts = location.hostname.split('.');
  const domains = ['', ...parts.map((_, i) => '.' + parts.slice(i).join('.')).filter((d) => d.split('.').length > 2)];
  for (const n of names) for (const d of domains) {
    document.cookie = `${n}=; Max-Age=0; path=/${d ? `; domain=${d}` : ''}`;
  }
}

/** GA's own off switch: with it set, gtag.js (if already loaded) sends nothing at all. */
const GA_OFF = 'ga-disable-G-GCWSEQRZ2E';

export function setConsent(c: Choice) {
  (window as unknown as Record<string, boolean>)[GA_OFF] = c !== 'granted';
  storageSet(CONSENT_KEY, c);
  document.documentElement.setAttribute('data-consent', c);
  gtag('consent', 'update', { analytics_storage: c });
  if (c === 'granted') window.bwLoadGa?.();
  else clearGaCookies();
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let open: HTMLElement | null = null;

export function showConsent() {
  if (open) return;
  const card = document.createElement('aside');
  card.className = 'cns';
  card.lang = LANG;
  card.setAttribute('data-consent-banner', '');
  card.setAttribute('data-i18n-skip', '');
  card.setAttribute('role', 'region');
  card.setAttribute('aria-label', t('Cookie consent'));
  card.innerHTML =
    `<p class="cns__t">${esc(t('Can we count visits?'))}</p>` +
    `<p class="cns__p">` +
      `<span class="cns__long">${esc(t('We’d like to use Google Analytics to see which pages help musicians. It sets cookies only if you accept. No ads, and we never sell data.'))}</span>` +
      `<span class="cns__short">${esc(t('Google Analytics cookies, only if you accept.'))}</span> ` +
      `<a href="${PRIVACY_URL}">${esc(t('Privacy policy'))}</a></p>` +
    `<div class="cns__act">` +
      `<button type="button" class="btn btn--sm cns__b" data-consent="reject">${esc(t('Reject'))}</button>` +
      `<button type="button" class="btn btn--sm cns__b" data-consent="accept">${esc(t('Accept'))}</button>` +
    `</div>`;
  const done = (c: Choice) => {
    setConsent(c);
    card.classList.remove('is-in');
    open = null;
    window.setTimeout(() => card.remove(), 400);
  };
  card.querySelector('[data-consent="accept"]')!.addEventListener('click', () => done('granted'));
  card.querySelector('[data-consent="reject"]')!.addEventListener('click', () => done('denied'));
  document.body.appendChild(card);
  open = card;
  requestAnimationFrame(() => requestAnimationFrame(() => card.classList.add('is-in')));
}

/** After the language suggestion: ask once; the footer link asks again. */
export function initConsent(after: Promise<unknown>) {
  document.addEventListener('click', (e) => {
    if ((e.target as HTMLElement | null)?.closest('[data-consent-open]')) {
      e.preventDefault();
      showConsent();
      open?.querySelector<HTMLElement>(`[data-consent="${stored() === 'granted' ? 'accept' : 'reject'}"]`)?.focus();
    }
  });
  if (stored()) return;
  void after.then(() => { if (!stored()) showConsent(); });
}

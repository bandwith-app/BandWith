/**
 * Language suggestion: a small card that asks, in the visitor's language,
 * whether to see the site in it ("🇪🇸 España · ¿Ver el sitio en español?").
 *
 * The country comes from /api/geo (site/api/geo.js: Vercel's own
 * x-vercel-ip-country header, no third-party lookup). The rules are in
 * i18n/suggest.ts. A yes, a no and the EN · IT · ES switcher are all
 * remembered (localStorage), and the card never comes back.
 * `?geo=MX` (or `?geo=CH-TI`) previews it from anywhere.
 *
 * <html data-lang-checked> says it was decided: shown · none · chosen.
 */
import { storageGet, storageSet } from '../core/storage';
import { LANG } from '../i18n/runtime';
import { isLang, pathIn, type Lang } from '../i18n/langs';
import { POPUP, flagEmoji, placeName, suggestion, type Choice, type Geo } from '../i18n/suggest';

export const CHOICE_KEY = 'bw-site-lang';

const readChoice = (): Choice => {
  const v = storageGet(CHOICE_KEY);
  return v === 'no' || isLang(v) ? v : null;
};
const remember = (c: Lang | 'no') => storageSet(CHOICE_KEY, c);

async function geo(): Promise<{ geo: Geo; preview: boolean }> {
  const q = new URLSearchParams(location.search).get('geo');
  if (q && /^[A-Za-z]{2}(-[A-Za-z0-9]{1,3})?$/.test(q)) {
    const [country, region] = q.toUpperCase().split('-');
    return { geo: { country, region: region ?? '' }, preview: true };
  }
  const ctl = new AbortController();
  const timer = window.setTimeout(() => ctl.abort(), 3000);
  try {
    const res = await fetch('/api/geo', { cache: 'no-store', signal: ctl.signal });
    if (!res.ok) return { geo: { country: null }, preview: false };
    const d = (await res.json()) as Geo;
    return { geo: { country: d.country ?? null, region: d.region ?? '' }, preview: false };
  } catch {
    return { geo: { country: null }, preview: false };
  } finally {
    window.clearTimeout(timer);
  }
}

/** Whether this device draws flag emoji (Windows shows two letters instead). */
function drawsFlags(): boolean {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    const x = c.getContext('2d', { willReadFrequently: true });
    if (!x) return false;
    x.font = '14px sans-serif';
    x.textBaseline = 'top';
    x.fillText(flagEmoji('IT'), 0, 0);
    const d = x.getImageData(0, 0, 16, 16).data;
    for (let i = 0; i < d.length; i += 4) {
      const [r, g, b, a] = [d[i], d[i + 1], d[i + 2], d[i + 3]];
      if (a > 0 && (Math.abs(r - g) > 30 || Math.abs(g - b) > 30)) return true;
    }
  } catch { /* no canvas */ }
  return false;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Shows the card; resolves once it is closed with a no (a yes leaves the page). */
function show(want: Lang, where: Geo): Promise<void> {
  let closed: () => void = () => {};
  const gone = new Promise<void>((r) => { closed = r; });
  const w = POPUP[want];
  const code = (where.country ?? '').toUpperCase();
  const target = pathIn(location.pathname, want) + location.hash;
  const flag = drawsFlags()
    ? `<span class="lsg__flag" aria-hidden="true">${flagEmoji(code)}</span>`
    : `<span class="lsg__code mono" aria-hidden="true">${esc(code)}</span>`;
  const card = document.createElement('aside');
  card.className = 'lsg';
  card.lang = want;
  card.dir = 'ltr';
  card.setAttribute('data-lang-suggest', '');
  card.setAttribute('data-i18n-skip', '');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'false');
  card.setAttribute('aria-label', w.label);
  card.setAttribute('aria-describedby', 'lsg-q');
  card.innerHTML =
    `<p class="lsg__where" data-ls-country>${flag}<span>${esc(placeName(where, want))}</span></p>` +
    `<p class="lsg__q" id="lsg-q">${esc(w.q)}</p>` +
    `<div class="lsg__act">` +
      `<a class="btn btn--lime btn--sm" href="${esc(target)}" hreflang="${want}" data-ls-accept>${esc(w.yes)}</a>` +
      `<button type="button" class="btn btn--ghost btn--sm" data-ls-dismiss>${esc(w.stay[LANG])}</button>` +
    `</div>` +
    `<button type="button" class="lsg__x" aria-label="${esc(w.close)}" data-ls-close><svg class="ico" aria-hidden="true"><use href="#i-x"/></svg></button>`;

  const close = () => {
    remember('no');
    card.classList.remove('is-in');
    document.removeEventListener('keydown', onKey);
    window.setTimeout(() => { card.remove(); closed(); }, 400);
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  card.querySelector('[data-ls-accept]')!.addEventListener('click', (e) => {
    e.preventDefault();
    remember(want);
    location.assign(target);
  });
  card.querySelector('[data-ls-dismiss]')!.addEventListener('click', close);
  card.querySelector('[data-ls-close]')!.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.appendChild(card);
  requestAnimationFrame(() => requestAnimationFrame(() => card.classList.add('is-in')));
  return gone;
}

/** Resolves when the language question is over (nothing to ask, or a no): the cookie banner waits for it. */
export async function initLangSuggest(): Promise<void> {
  const root = document.documentElement;
  // The switcher is a choice too.
  document.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement | null)?.closest<HTMLAnchorElement>('[data-lang-switch] a[hreflang]');
    const l = a?.getAttribute('hreflang');
    if (isLang(l)) remember(l);
  });

  const { geo: where, preview } = await geo();
  const choice = preview ? null : readChoice();
  const want = suggestion(where, LANG, choice);
  root.dataset.langChecked = want ? 'shown' : choice ? 'chosen' : 'none';
  if (want) await show(want, where);
}

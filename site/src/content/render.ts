/**
 * Build-time HTML for the pieces every page repeats (menus, footer, rack),
 * generated from CHANNELS so a new page only needs `live: true`.
 * Used by site/vite.config.ts as <!--@name--> placeholders.
 */
import { CHANNELS, MENU, channelUrl, channelsOf, pad2, type Channel } from './features';
import { MADE_BY, academyArticle, shot, type MadeBy } from './site';
import { rolesCard } from './rolesCard';
import { picksHtml } from '../ui/heroScreen';
import { pageHead, pageMain } from './pageRender';
import { homeAnswers, faqPage } from './answersRender';
import { deviceOf, doorOrder, isPhone } from '../core/device';
import { INAPP_CLOSED_KEY, chromeIntentUrl, inAppBrowser } from '../core/inApp';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const meter = (n = 10) => `<span class="strip__meter" aria-hidden="true">${'<i></i>'.repeat(n)}</span>`;
const accentVar = (c: Channel) => `var(--${c.accent === 'rehearsal' ? 'rehearsal-ink' : c.accent})`;

const arrow = (id: string, cls = 'ico') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;

/**
 * Features panel (nav, ≥1081px), "The index": four columns, every page with
 * its one-liner in view, nothing behind a hover. Three numbered verbs in the
 * order of a band's week, then "Built in". Rows are subgrid rows, so the
 * lists start on one line whatever the language does to the titles. The
 * current page is marked by ui/nav.ts (aria-current, the lime cell).
 */
export function featurePanel() {
  return MENU.map((g, i) =>
    `<section class="mm__g${g.no.length > 2 ? ' mm__g--built' : ''}" aria-labelledby="mm-g${i + 1}">` +
      `<p class="mono mm__n"><span>${esc(g.no)}</span><i></i></p>` +
      `<h2 class="mm__t" id="mm-g${i + 1}">${esc(g.name)}</h2>` +
      `<p class="mm__p">${esc(g.promise)}</p>` +
      `<ul class="mm__list">${channelsOf(g).map((c) =>
        c.live
          ? `<li><a class="mm__row" href="${channelUrl(c)}" data-mm-row><i class="mm__cell"></i><span class="mm__w"><span class="mm__name">${esc(c.name)}</span><span class="mm__line">${esc(c.line)}</span></span>${arrow('arrow-right')}</a></li>`
          : `<li><span class="mm__row is-soon"><i class="mm__cell"></i><span class="mm__w"><span class="mm__name">${esc(c.name)}</span><span class="mm__line">${esc(c.line)} <span class="soon">Page coming soon</span></span></span></span></li>`,
      ).join('')}</ul>` +
    `</section>`,
  ).join('');
}

/**
 * Home channel explorer: the eleven strips are tabs. The selected one pushes
 * its fader up and shows its screen, three things it does and its Guide
 * article; ui/rack.ts drives the selection and the auto-play.
 */
export function rackHome() {
  const first = CHANNELS[0];
  const tabs = CHANNELS.map((c, i) =>
    `<button type="button" class="strip rx__tab" role="tab" id="rx-tab-${c.ch}" aria-selected="${i === 0}" aria-controls="rx-panel" tabindex="${i === 0 ? 0 : -1}" data-rx-tab="${i}" style="--c: ${accentVar(c)}">` +
    `<span class="strip__ch">CH ${pad2(c.ch)}</span>${meter(8)}` +
    `<span class="strip__track" aria-hidden="true"><span class="strip__cap"></span></span>` +
    `<span class="strip__name">${esc(c.short)}</span></button>`,
  ).join('');
  return (
    `<div class="rx__panel" id="rx-panel" role="tabpanel" aria-labelledby="rx-tab-${first.ch}" style="--c: ${accentVar(first)}">` +
      `<div class="crop rx__crop" data-rx-crop data-crop="${first.crop.join(' ')}"><img class="crop__img" src="${shot(first.shot)}" alt="" width="780" height="1688" loading="lazy" decoding="async" /></div>` +
      `<div class="rx__copy" data-rx-copy>` +
        `<p class="rx__ch mono" data-rx-ch>CH ${pad2(first.ch)} · ${first.group}</p>` +
        `<h3 class="rx__name" data-rx-name>${esc(first.name)}</h3>` +
        `<p class="rx__line" data-rx-line>${esc(first.line)}</p>` +
        `<ul class="rx__pts" data-rx-pts>${first.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` +
        `<p class="rx__links"><a class="rx__guide" data-rx-guide href="${academyArticle(first.guide)}">Read it in the Guide <svg class="ico" aria-hidden="true"><use href="#i-arrow-up-right"/></svg></a>` +
        `<a class="btn btn--lime btn--sm rx__page" data-rx-page href="${first.live ? channelUrl(first) : '#'}"${first.live ? '' : ' hidden'}>Open the page <svg class="ico btn__arrow" aria-hidden="true"><use href="#i-arrow-right"/></svg></a></p>` +
      `</div>` +
    `</div>` +
    `<div class="rx__strips" role="tablist" aria-label="The eleven channels">${tabs}</div>`
  );
}

/**
 * Menu sheet (≤1080px): the same four groups as an accordion, one open at a
 * time. Each head is a button (aria-expanded, aria-controls); a closed group's
 * rows are `hidden`, so they are out of the tab order. ui/nav.ts opens the
 * current page's group and marks its row.
 */
export function menuRows() {
  return MENU.map((g, i) =>
    `<section class="acc__g" data-acc-group>` +
      `<h2 class="acc__h"><button type="button" class="acc__head" aria-expanded="false" aria-controls="acc-p${i + 1}" id="acc-b${i + 1}" data-acc-btn>` +
        `<b>${g.no.length > 2 ? '+' : esc(g.no)}</b><span class="acc__t">${esc(g.name)}</span>` +
        `<span class="acc__pm" aria-hidden="true">${arrow('plus', 'ico acc__plus')}${arrow('minus', 'ico acc__minus')}</span>` +
        `<span class="acc__p">${esc(g.promise)}</span>` +
      `</button></h2>` +
      `<ul class="acc__list" id="acc-p${i + 1}" aria-labelledby="acc-b${i + 1}" data-acc-panel hidden>${channelsOf(g).map((c) =>
        c.live
          ? `<li><a class="acc__row" href="${channelUrl(c)}" data-mm-row><span class="acc__w"><b>${esc(c.name)}</b><em>${esc(c.line)}</em></span>${arrow('chevron-right')}</a></li>`
          : `<li><span class="acc__row is-soon"><span class="acc__w"><b>${esc(c.name)}</b><em>${esc(c.line)}</em></span></span></li>`,
      ).join('')}</ul>` +
    `</section>`,
  ).join('');
}

export function footFeatures() {
  return CHANNELS.map((c) =>
    c.live ? `<li><a href="${channelUrl(c)}">${esc(c.name)}</a></li>` : `<li><span class="is-soon">${esc(c.name)}</span></li>`,
  ).join('');
}


/**
 * Get page, inline right after the doors: the doors in the order for this
 * device, before the first paint. The functions of core/device.ts run here
 * as written (their source is pasted in). A phone gets the web app first and
 * the words written for it ([data-door-for="phone"]; a tablet or a computer
 * keeps "other"). Then "Door 01, 02, 03" are handed out again in the new
 * order: the labels swap as the page reads them, so this works the same on
 * /it/ and /es/. The trust line goes after the first door on a phone, under
 * the three doors anywhere else. <html data-device> and <html data-phone> say
 * what was decided.
 */
export function doorOrderScript() {
  return '<script>(function(){try{' +
    `var u=navigator.userAgent,d=(${deviceOf})(u,navigator.maxTouchPoints||0),p=(${isPhone})(u),h=document.documentElement;` +
    "h.setAttribute('data-device',d);if(p)h.setAttribute('data-phone','');" +
    "var g=document.querySelector('[data-doors]');if(!g)return;" +
    "[].forEach.call(g.querySelectorAll('[data-door-for]'),function(n){n.hidden=(n.getAttribute('data-door-for')==='phone')!==p});" +
    "var no=[].map.call(g.querySelectorAll('[data-door-no]'),function(n){return n.textContent});" +
    `(${doorOrder})(d,p).forEach(function(id,i){` +
      'var a=document.getElementById(id);if(!a||a.parentNode!==g)return;g.appendChild(a);' +
      "var n=a.querySelector('[data-door-no]');if(n&&no[i]!=null)n.textContent=no[i];" +
    '});' +
    "var t=g.querySelector('[data-trust]'),s=g.querySelectorAll('.gdoor')[1];" +
    'if(t){if(p&&s)g.insertBefore(t,s);else g.appendChild(t)}' +
    '}catch(e){}})();</script>';
}

/**
 * "Made by": one line next to the trust line (Get page), from content/site.ts.
 * Nothing at all while it is off or a slot is empty.
 */
export function madeBy(m: MadeBy = MADE_BY) {
  const name = m.name.trim();
  const role = m.role.trim();
  const contact = m.contact.trim();
  if (!m.on || !name || !role || !contact) return '';
  const href = /^https?:\/\//.test(contact) ? contact : `mailto:${contact}`;
  return `<p class="gtrust__by">Made by <b>${esc(name)}</b>, ${esc(role)}. Write to me: <a href="${esc(href)}">${esc(contact.replace(/^https?:\/\//, ''))}</a></p>`;
}

/**
 * Every page, first thing in the body: the bar for Facebook's and
 * Instagram's in-app browsers. It is written `hidden`, with every wording it
 * can take (so the build translates them); the inline script after it, with
 * the functions of core/inApp.ts and core/device.ts pasted in, shows it
 * before the first paint, only in those browsers and only until it is closed
 * (sessionStorage). On Android the action is a link that opens the same
 * address in Chrome; anywhere else nothing can force the real browser, so
 * the words say how and the action copies the link (ui/inAppBar.ts).
 * <html data-inapp> says which app; --iab-h is the bar's height, for the
 * fixed header under it.
 */
export function inAppBar() {
  return (
    `<aside class="iab" data-inapp-bar aria-label="Open in your browser" hidden>` +
      `<p class="iab__t">` +
        `<b data-iab-app="facebook">You’re in Facebook’s browser.</b>` +
        `<b data-iab-app="instagram" hidden>You’re in Instagram’s browser.</b> ` +
        `<span data-iab-os="android">Open in your browser to sign in or install.</span>` +
        `<span data-iab-os="other" hidden>To sign in or install, tap ··· then Open in browser.</span>` +
      `</p>` +
      `<a class="iab__go" data-iab-os="android" data-iab-chrome href="#main">Open in Chrome</a>` +
      `<button type="button" class="iab__go" data-iab-os="other" data-iab-copy aria-live="polite" hidden>` +
        `<span data-iab-copy-label>Copy link</span><span data-iab-copied hidden>Link copied</span>` +
      `</button>` +
      `<button type="button" class="iab__x" aria-label="Close" data-iab-close><svg class="ico" aria-hidden="true"><use href="#i-x"/></svg></button>` +
    `</aside>` +
    '<script>(function(){try{' +
      `var u=navigator.userAgent,a=(${inAppBrowser})(u);if(!a)return;` +
      `try{if(sessionStorage.getItem('${INAPP_CLOSED_KEY}'))return}catch(e){}` +
      "var b=document.querySelector('[data-inapp-bar]');if(!b)return;" +
      `var o=(${deviceOf})(u,navigator.maxTouchPoints||0)==='android'?'android':'other',h=document.documentElement;` +
      "[].forEach.call(b.querySelectorAll('[data-iab-app]'),function(n){n.hidden=n.getAttribute('data-iab-app')!==a});" +
      "[].forEach.call(b.querySelectorAll('[data-iab-os]'),function(n){n.hidden=n.getAttribute('data-iab-os')!==o});" +
      `var c=b.querySelector('[data-iab-chrome]');if(c)c.setAttribute('href',(${chromeIntentUrl})(location.href));` +
      "b.hidden=false;h.setAttribute('data-inapp',a);h.style.setProperty('--iab-h',b.offsetHeight+'px');" +
    '}catch(e){}})();</script>'
  );
}

export const GENERATED: Record<string, (arg?: string) => string> = {
  page: (slug) => pageMain(slug ?? ''),
  'page-head': (slug) => pageHead(slug ?? ''),
  'roles-card': rolesCard,
  'feature-panel': featurePanel,
  'rack-home': rackHome,
  'hero-picks': picksHtml,
  'menu-rows': menuRows,
  'foot-features': footFeatures,
  'home-answers': homeAnswers,
  'faq-page': faqPage,
  'door-order': doorOrderScript,
  'made-by': () => madeBy(),
  'inapp-bar': inAppBar,
};

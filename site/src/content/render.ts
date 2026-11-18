/**
 * Build-time HTML for the pieces every page repeats (menus, footer, rack),
 * generated from CHANNELS so a new page only needs `live: true`.
 * Used by site/vite.config.ts as <!--@name--> placeholders.
 */
import { CHANNELS, GROUPS, channelUrl, pad2, type Channel } from './features';
import { academyArticle, shot } from './site';
import { rolesCard } from './rolesCard';
import { picksHtml } from '../ui/heroScreen';
import { pageHead, pageMain } from './pageRender';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const meter = (n = 10) => `<span class="strip__meter" aria-hidden="true">${'<i></i>'.repeat(n)}</span>`;
const accentVar = (c: Channel) => `var(--${c.accent === 'rehearsal' ? 'rehearsal-ink' : c.accent})`;
const grouped = () => GROUPS.map((g) => ({ g, list: CHANNELS.filter((c) => c.group === g) }));

/**
 * Features panel (nav, ≥1081px): four calm groups of text rows and one
 * preview card (a zoomed piece of the channel's screen) that follows the
 * row under the pointer or the focus.
 */
export function featurePanel() {
  const groups = grouped().map(({ g, list }) =>
    `<div class="fp__group"><p class="fp__g">${g}</p><ul class="fp__list">` +
    list.map((c) => {
      const tag = c.live ? 'a' : 'span';
      const attrs = c.live ? ` href="${channelUrl(c)}"` : ' tabindex="0" aria-disabled="true"';
      return (
        `<li><${tag} class="fp__row${c.live ? '' : ' is-soon'}"${attrs} data-fp data-ch="CH ${pad2(c.ch)}" data-shot="${shot(c.shot)}" data-crop="${c.crop.join(' ')}" data-name="${esc(c.name)}" data-line="${esc(c.line)}" style="--c: ${accentVar(c)}">` +
        `<b>${pad2(c.ch)}</b><span class="fp__name">${esc(c.name)}</span></${tag}></li>`
      );
    }).join('') +
    `</ul></div>`,
  ).join('');
  return `<div class="fp__groups">${groups}</div>`;
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

/** Menu sheet (≤1080px): the same four groups, one row per channel. */
export function menuRows() {
  return grouped().map(({ g, list }) =>
    `<p class="label menu__label">${g}</p>` +
    list.map((c) => {
      const tag = c.live ? 'a' : 'div';
      const href = c.live ? ` href="${channelUrl(c)}"` : ' aria-disabled="true"';
      return (
        `<${tag} class="menu__row${c.live ? '' : ' is-soon'}"${href} style="--c: ${accentVar(c)}">` +
        `<b>${pad2(c.ch)}</b><span class="menu__m"><span class="menu__w">${esc(c.name)}</span></span>` +
        (c.live ? `<em>${esc(c.line)}</em>` : '') +
        `</${tag}>`
      );
    }).join(''),
  ).join('');
}

export function footFeatures() {
  return CHANNELS.map((c) =>
    c.live ? `<li><a href="${channelUrl(c)}">${esc(c.name)}</a></li>` : `<li><span class="is-soon">${esc(c.name)}</span></li>`,
  ).join('');
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
};

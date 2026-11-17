/**
 * Build-time HTML for the pieces every page repeats (menus, footer, rack),
 * generated from CHANNELS so a new page only needs `live: true`.
 * Used by site/vite.config.ts as <!--@name--> placeholders.
 */
import { CHANNELS, GROUPS, channelUrl, pad2, type Channel } from './features';
import { shot } from './site';
import { GIG, ROLES, SECTIONS, WHO, countFor, FIELDS } from './roles';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const meter = (n = 10) => `<span class="strip__meter" aria-hidden="true">${'<i></i>'.repeat(n)}</span>`;
const accentVar = (c: Channel) => `var(--${c.accent === 'rehearsal' ? 'rehearsal-ink' : c.accent})`;
const grouped = () => GROUPS.map((g) => ({ g, list: CHANNELS.filter((c) => c.group === g) }));

/** One channel strip (nav panel and home rack). */
function strip(c: Channel, big: boolean) {
  const tag = c.live ? 'a' : 'div';
  const href = c.live ? ` href="${channelUrl(c)}"` : ' aria-disabled="true"';
  return (
    `<${tag} class="strip${c.live ? '' : ' is-soon'}"${href} data-strip data-accent="${c.accent}" data-shot="${shot(c.shot)}" data-name="${esc(c.name)}" data-line="${esc(c.line)}" style="--c: ${accentVar(c)}">` +
    `<span class="strip__ch">CH ${pad2(c.ch)}</span>` +
    `${meter(big ? 14 : 10)}` +
    `<span class="strip__track" aria-hidden="true"><span class="strip__cap"></span></span>` +
    `<span class="strip__name">${esc(big ? c.name : c.short)}</span>` +
    (c.live ? '<span class="strip__live">Live</span>' : '') +
    `</${tag}>`
  );
}

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

export function rackHome() {
  return CHANNELS.map((c) => strip(c, true)).join('');
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

/**
 * "Same gig, three views" (home): the gig card as the admin sees it, plus the
 * role switch. ui/roles.ts swaps it to the member and deputy views.
 */
export function rolesCard() {
  let i = 0;
  const seg = ROLES.map((r) =>
    `<button type="button" role="radio" aria-checked="${r === 'admin'}" data-rv-role="${r}">${WHO[r].name}</button>`,
  ).join('');
  const sections = SECTIONS.map((sec) =>
    `<section class="rv__sec"><h3 class="rv__st">${esc(sec.title)}</h3><dl class="rv__dl">` +
    sec.fields.map((f) =>
      `<div class="rr" data-f="${f.id}" data-state="on" style="--i:${i++}"><dt>${esc(f.label)}</dt>` +
      `<dd><span class="rr__v">${esc(f.value.admin ?? '')}</span><span class="rr__x" aria-hidden="true"></span><span class="sr-only rr__sr"></span></dd></div>`,
    ).join('') +
    `</dl></section>`,
  ).join('');
  return (
    `<div class="rv__side">` +
      `<p class="label rv__ask" id="rv-ask">See the same gig as</p>` +
      `<div class="rv__seg" role="radiogroup" aria-labelledby="rv-ask" data-rv-seg><span class="rv__pill" aria-hidden="true"></span>${seg}</div>` +
      `<div class="rv__who" data-rv-who><p class="rv__person" data-rv-person>${esc(WHO.admin.person)}</p><p class="rv__line" data-rv-line>${esc(WHO.admin.line)}</p></div>` +
      `<p class="rv__count" aria-live="polite"><b data-rv-count>${countFor('admin')}</b><span>of ${FIELDS.length} details<br />reach this phone</span></p>` +
      `<button type="button" class="btn btn--ink rv__yes" data-rv-yes hidden>Say yes as Ivo <svg class="ico btn__arrow" aria-hidden="true"><use href="#i-check"/></svg></button>` +
    `</div>` +
    `<article class="rv__card" data-rv-card aria-label="The gig as the selected role sees it">` +
      `<header class="rv__head"><p class="rv__kick mono">${esc(GIG.kicker)}</p><span class="rv__badge mono" data-rv-badge>Admin view</span>` +
      `<p class="rv__title">${esc(GIG.title)}</p><p class="rv__when mono">${esc(GIG.when)}</p></header>` +
      sections +
    `</article>`
  );
}

export const GENERATED: Record<string, () => string> = {
  'roles-card': rolesCard,
  'feature-panel': featurePanel,
  'rack-home': rackHome,
  'menu-rows': menuRows,
  'foot-features': footFeatures,
};

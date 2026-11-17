/**
 * Build-time HTML for the pieces every page repeats (menus, footer, rack),
 * generated from CHANNELS so a new page only needs `live: true`.
 * Used by site/vite.config.ts as <!--@name--> placeholders.
 */
import { CHANNELS, channelUrl, pad2, type Channel } from './features';
import { shot } from './site';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const meter = (n = 10) => `<span class="strip__meter" aria-hidden="true">${'<i></i>'.repeat(n)}</span>`;
const soon = '<span class="soon">Soon</span>';

/** One channel strip (nav panel and home rack). */
function strip(c: Channel, big: boolean) {
  const tag = c.live ? 'a' : 'div';
  const href = c.live ? ` href="${channelUrl(c)}"` : ' aria-disabled="true"';
  return (
    `<${tag} class="strip${c.live ? '' : ' is-soon'}"${href} data-strip data-accent="${c.accent}" data-shot="${shot(c.shot)}" data-name="${esc(c.name)}" data-line="${esc(c.line)}" style="--c: var(--${c.accent === 'rehearsal' ? 'rehearsal-ink' : c.accent})">` +
    `<span class="strip__ch">CH ${pad2(c.ch)}</span>` +
    `${meter(big ? 14 : 10)}` +
    `<span class="strip__track" aria-hidden="true"><span class="strip__cap"></span></span>` +
    `<span class="strip__name">${esc(big ? c.name : c.short)}</span>` +
    (big ? `<span class="strip__line">${esc(c.line)}</span>` : '') +
    (c.live ? '' : soon) +
    `</${tag}>`
  );
}

export function rackPanel() {
  return CHANNELS.map((c) => strip(c, false)).join('');
}

export function rackHome() {
  return CHANNELS.map((c) => strip(c, true)).join('');
}

export function menuRows() {
  return CHANNELS.map((c) => {
    const tag = c.live ? 'a' : 'div';
    const href = c.live ? ` href="${channelUrl(c)}"` : ' aria-disabled="true"';
    return (
      `<${tag} class="menu__row${c.live ? '' : ' is-soon'}"${href} style="--c: var(--${c.accent === 'rehearsal' ? 'rehearsal-ink' : c.accent})">` +
      `<b>${pad2(c.ch)}</b><span class="menu__m"><span class="menu__w">${esc(c.name)}</span></span>` +
      `<em>${c.live ? esc(c.line) : 'Page coming soon'}</em></${tag}>`
    );
  }).join('');
}

export function footFeatures() {
  return CHANNELS.map((c) =>
    c.live ? `<li><a href="${channelUrl(c)}">${esc(c.name)}</a></li>` : `<li><span class="is-soon">${esc(c.name)}</span></li>`,
  ).join('');
}

export const GENERATED: Record<string, () => string> = {
  'rack-panel': rackPanel,
  'rack-home': rackHome,
  'menu-rows': menuRows,
  'foot-features': footFeatures,
};

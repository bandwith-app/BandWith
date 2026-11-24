/**
 * Channel page renderer: a ChannelPage (content/pages/<slug>.ts) becomes the
 * page's <head> extras and <main>. Used at build time by the partials plugin:
 *   <!--@page-head:quotes-contracts-->  and  <!--@page:quotes-contracts-->
 * Section order and tone: hero, how it works (dark), try it (bone, if the
 * page has a demo), who sees what (dark), the small things + learn it (one
 * bone sheet), next channel (dark). Devices are shown once, on the home page.
 */
import { CHANNELS, bySlug, channelUrl, pad2, type Channel } from './features';
import { academyArticle, shot } from './site';
import { DEMOS } from './demos/index';
import { PAGES } from './pages';
import type { Cell, ChannelPage, Heading, Icon } from './pages/types';
import { pageAnswers } from './answersRender';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ico = (id: Icon, cls = 'ico') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;

function line(text: string, em?: string) {
  const t = esc(text);
  if (!em || !text.includes(em)) return t;
  return t.replace(esc(em), `<em>${esc(em)}</em>`);
}
const h1 = (h: Heading) => h.lines.map((l, i) => `<span class="line"><span>${line(l, i === 1 ? h.em : undefined)}</span></span>`).join('');
const h2 = (h: Heading) => `${line(h.lines[0])}<br />${line(h.lines[1], h.em)}`;

function cell(c: Cell) {
  if (c === true) return '<span class="yes">Yes</span>';
  if (c === false) return '<span class="no">No</span>';
  if (typeof c === 'string') return `<span class="yes">${esc(c)}</span>`;
  return `<span class="dash">${esc(c.dash)}</span>`;
}

export function getPage(slug: string): { page: ChannelPage; ch: Channel } {
  const page = PAGES[slug];
  const ch = bySlug(slug);
  if (!page || !ch) throw new Error(`No channel page "${slug}"`);
  return { page, ch };
}

export function pageHead(slug: string) {
  const { page } = getPage(slug);
  return (
    `<title>${esc(page.title)} · BandWith</title>` +
    `<meta name="description" content="${esc(page.description)}" />` +
    `<meta property="og:title" content="${esc(page.ogTitle)}" />` +
    `<meta property="og:description" content="${esc(page.description)}" />` +
    `<link rel="preload" as="image" href="${shot(page.hero.shot)}" fetchpriority="high" />`
  );
}

/**
 * The hero is built on the mark's own grid (brand/bandwith-mark.svg): three
 * columns of rounded squares, the middle one an empty cell over a tall cell.
 * The tall cell has a phone's shape, so the page's own screen lives there;
 * the page's chips sit in four cells, the first of them the lime one; the
 * empty cell stays empty. The cells repeat the chip list for the eye only.
 */
const MARK_CELLS = ['3 / 1', '1 / 2', '3 / 2', '1 / 3']; // column / row of chips 1–4; (1,1) and (3,3) stay plain
function heroMark(page: ChannelPage) {
  const chips = page.hero.chips.slice(0, 4);
  const cell = (at: string, inner = '', lime = false) => `<div class="mk__c${lime ? ' mk__c--lime' : ''}" style="grid-area: ${at.split(' / ').reverse().join(' / ')}">${inner}</div>`;
  const chip = (i: number) => (chips[i] ? `${ico(chips[i].icon)}<span>${esc(chips[i].label)}</span>` : '');
  return (
    `<div class="mk fhero__mark" data-fh-phone>` +
      `<div class="mk__cells" aria-hidden="true">` +
        cell('1 / 1') + cell(MARK_CELLS[0], chip(0), true) + cell(MARK_CELLS[1], chip(1)) + cell(MARK_CELLS[2], chip(2)) + cell(MARK_CELLS[3], chip(3)) + cell('3 / 3') +
      `</div>` +
      // The whole screen, set in from the cell's round corners so nothing of it is cut.
      `<div class="mk__tall"><div class="crop mk__screen" data-crop="0 1"><img class="crop__img" src="${shot(page.hero.shot)}" alt="${esc(page.hero.alt)}" width="780" height="1688" fetchpriority="high" decoding="async" /></div></div>` +
    `</div>`
  );
}

/** The mark alone, as a sign: `spot` is what sits in one of its cells (an arrow), `at` says which. */
function markSign(cls: string, spot: string, at: 'empty' | 'last', href?: string) {
  // By the next channel the mark is also a way there (the name beside it is the link people read).
  const [open, close] = href ? [`a href="${href}" tabindex="-1"`, 'a'] : ['div', 'div'];
  const cells = ['1 / 1', '1 / 3', '2 / 1', '2 / 3', '3 / 1'].map((a) => `<i style="grid-area: ${a}"></i>`).join('');
  return (
    `<${open} class="mk mk--sign ${cls}" aria-hidden="true">${cells}<i class="mk__tall" style="grid-area: 2 / 2 / 4 / 3"></i>` +
    (at === 'last' ? `<i class="mk__spot mk__spot--lime" style="grid-area: 3 / 3">${spot}</i>` : `<i style="grid-area: 3 / 3"></i><i class="mk__spot" style="grid-area: 1 / 2">${spot}</i>`) +
    `</${close}>`
  );
}

function hero(page: ChannelPage, ch: Channel) {
  const id = `${page.slug}-h`;
  const tag = `CH ${pad2(ch.ch)} · ${esc(ch.name)}`;
  return (
    `<section class="fhero" aria-labelledby="${id}">` +
      `<div class="wrap fhero__grid">` +
        `<div class="fhero__copy">` +
          `<p class="label fhero__ch" data-fh><span class="led"></span>${tag}</p>` +
          `<h1 class="h1 fhero__title" id="${id}">${h1(page.hero.heading)}</h1>` +
          `<p class="lead fhero__lead" data-fh>${esc(page.hero.lead)}</p>` +
          `<ul class="chips fhero__chips" data-fh>${page.hero.chips.map((c) => `<li>${ico(c.icon)}${esc(c.label)}</li>`).join('')}</ul>` +
          `<div class="fhero__cta" data-fh>` +
            `<a class="btn btn--lime" href="${page.demo ? '#try-it' : '#how'}" data-magnetic>${page.demo ? 'Try it here' : 'See how it works'} <svg class="ico btn__arrow btn__arrow--down" aria-hidden="true"><use href="#i-arrow-right"/></svg></a>` +
            `<a class="btn btn--ghost" href="/get/">Get the beta ${ico('arrow-up-right', 'ico btn__arrow')}</a>` +
          `</div>` +
        `</div>` +
        heroMark(page) +
      `</div>` +
    `</section>`
  );
}

function flow(page: ChannelPage) {
  const [first] = page.flow.steps;
  const steps = page.flow.steps.map((s, i) =>
    `<li class="flow__step${i ? '' : ' is-on'}" data-flow-step data-shot="${shot(s.shot)}" data-region="${s.region.join(' ')}" data-badge="${esc(s.badge)}"${page.slug === 'stage' && /click/i.test(s.badge) ? ' data-glow' : ''}>` +
    `<p class="flow__n mono">${pad2(i + 1)}</p><h3 class="h3">${esc(s.title)}</h3><p>${esc(s.body)}</p></li>`,
  ).join('');
  return (
    `<section class="sec flow" id="how" data-flow aria-labelledby="how-h"><div class="wrap">` +
      `<div class="head"><p class="label">How it works</p><h2 class="h2" id="how-h" data-split>${h2(page.flow.heading)}</h2></div>` +
      `<div class="flow__grid"><ol class="flow__steps">${steps}</ol>` +
        `<div class="flow__phone" aria-hidden="true"><div class="flow__sticky">` +
          `<div class="crop flow__crop" data-flow-device><img class="crop__img" src="${shot(first.shot)}" alt="" width="780" height="1688" loading="lazy" decoding="async" /></div>` +
          `<p class="flow__badge mono" data-flow-badge><span></span>${esc(first.badge)}</p>` +
        `</div></div>` +
      `</div>` +
    `</div></section>`
  );
}

/**
 * "Try it": a lime band says what you are about to do (the mark points at
 * it from its empty cell), then the demo itself on paper.
 */
function demo(page: ChannelPage) {
  const d = page.demo;
  const body = d ? DEMOS[d.kind]?.() : '';
  if (!d || !body) return '';
  return (
    `<section class="band" id="try-it" aria-labelledby="try-h" data-light><div class="wrap band__grid">` +
      `<div><p class="label">Try it</p><h2 class="h2 band__h" id="try-h" data-split>${h2(d.heading)}</h2><p class="band__lead">${esc(d.lead)}</p></div>` +
      markSign('band__mark', ico('arrow-right'), 'empty') +
    `</div></section>` +
    `<section class="sec sec--bone try" id="try" aria-labelledby="try-h" data-light><div class="wrap">${body}</div></section>`
  );
}

function roles(page: ChannelPage, bone: boolean) {
  const r = page.roles;
  const rows = r.rows.map((x) => `<tr><th scope="row">${esc(x.what)}</th><td>${cell(x.admin)}</td><td>${cell(x.member)}</td><td>${cell(x.deputy)}</td></tr>`).join('');
  return (
    `<section class="sec${bone ? ' sec--bone' : ''} roles" id="roles" aria-labelledby="roles-h"${bone ? ' data-light' : ''}><div class="wrap">` +
      `<div class="head"><p class="label">Who sees what</p><h2 class="h2" id="roles-h" data-split>${h2(r.heading)}</h2><p class="lead">${esc(r.lead)}</p></div>` +
      `<div class="rtable" role="region" aria-labelledby="roles-h" tabindex="0"><table>` +
        `<thead><tr><th scope="col"><span class="sr-only">What</span></th><th scope="col"><span class="tag tag--lime">Admin</span></th><th scope="col"><span class="tag">Member</span></th><th scope="col"><span class="tag">Deputy</span></th></tr></thead>` +
        `<tbody>${rows}</tbody>` +
      `</table></div>` +
    `</div></section>`
  );
}

function details(page: ChannelPage, bone: boolean) {
  const items = page.details.items.map((x) =>
    `<li class="bento__c${x.wide ? ' bento__c--wide' : ''}" data-reveal-item>${ico(x.icon)}<b>${esc(x.title)}</b><p>${esc(x.body)}</p></li>`,
  ).join('');
  return (
    `<section class="sec${bone ? ' sec--bone' : ''} details" aria-labelledby="det-h"${bone ? ' data-light' : ''}><div class="wrap">` +
      `<div class="head"><p class="label">The small things</p><h2 class="h2" id="det-h" data-split>${h2(page.details.heading)}</h2></div>` +
      `<ul class="bento" data-reveal-group>${items}</ul>` +
    `</div></section>`
  );
}

const WORDS = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
function learn(page: ChannelPage, bone: boolean) {
  const n = page.learn.length;
  const items = page.learn.map((l) =>
    `<li data-reveal-item><a href="${academyArticle(l.id)}"><b>${esc(l.title)}</b><span>${esc(l.line)}</span>${ico('arrow-up-right')}</a></li>`,
  ).join('');
  return (
    `<section class="sec${bone ? ' sec--bone' : ''} learn" aria-labelledby="learn-h"${bone ? ' data-light' : ''}><div class="wrap">` +
      `<div class="head"><p class="label">Learn it</p><h2 class="h2" id="learn-h" data-split>The Guide,<br />step by step.</h2>` +
      `<p class="lead">${WORDS[n] ?? n} short ${n === 1 ? 'article' : 'articles'} in the BandWith Academy, in six languages.</p></div>` +
      `<ul class="learn__list" data-reveal-group>${items}</ul>` +
    `</div></section>`
  );
}

function next(ch: Channel, bone: boolean) {
  const n = CHANNELS[(CHANNELS.indexOf(ch) + 1) % CHANNELS.length];
  const name = `<b>CH ${pad2(n.ch)}</b> ${esc(n.name)}`;
  return (
    `<section class="sec${bone ? ' sec--bone' : ''} nextch" aria-label="Next channel"${bone ? ' data-light' : ''}><div class="wrap nextch__grid"><div class="nextch__inner">` +
      `<p class="label">Next channel</p>` +
      (n.live
        ? `<a class="nextch__name nextch__link" href="${channelUrl(n)}">${name}</a><p class="nextch__line">${esc(n.line)}</p>`
        : `<p class="nextch__name">${name}</p><p class="nextch__line">${esc(n.line)} <span class="soon">Page coming soon</span></p>`) +
      `<div class="nextch__cta">` +
        `<a class="btn btn--ghost" href="/#rack">All eleven channels ${ico('arrow-right', 'ico btn__arrow')}</a>` +
        `<a class="btn btn--lime" href="/get/" data-magnetic>Get the beta ${ico('arrow-up-right', 'ico btn__arrow')}</a>` +
      `</div>` +
    `</div>${markSign('nextch__mark', ico('arrow-right'), 'last', n.live ? channelUrl(n) : undefined)}</div></section>`
  );
}

export function pageMain(slug: string) {
  const { page, ch } = getPage(slug);
  // Each section keeps the tone its styles are made for (as on Stage).
  return [
    hero(page, ch), flow(page), demo(page), roles(page, false),
    details(page, true), learn(page, true), pageAnswers(slug), next(ch, false),
  ].join('');
}

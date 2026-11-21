/**
 * Guide content → static HTML, with the same markup and class names as the
 * interactive guide (academy/src/blocks.tsx, inline.tsx), so its stylesheet
 * applies. Plain strings, no React, no browser globals: it runs at build time.
 */
import type { Block, Device, Role, ShotDevice } from '../content/types';
import { SHOT_FILES } from '../content/shotFiles';
import type { Lang } from '../src/langs';
import { translate } from '../src/uiText';
import { MUSIC_SYMBOLS, type MusicSymbolId } from '@/lib/musicSymbols';

export const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** What a page needs to resolve [[article-id]] links and labels in its language. */
export interface Ctx {
  lang: Lang;
  /** Article id → its title in this language. */
  titles: Map<string, string>;
  /** The URL path of an article in this language. */
  articlePath: (id: string) => string;
  /** Pixel size of a screenshot file (shots/<id>@<device>.webp), when known. */
  shotSize?: (file: string) => { w: number; h: number } | null;
}

export const t = (ctx: { lang: Lang }, s: string, vars?: Record<string, string | number>) => translate(ctx.lang, s, vars);

// The same tokens as academy/src/inline.tsx.
const TOKEN = /(\*\*(?:\\\*|[^*])+\*\*|\[\[[^\]]+\]\]|`[^`]+`)/g;
const unescape = (s: string) => s.replace(/\\\*/g, '*');

const placeholders = (text: string) =>
  esc(text).replace(/\{([a-zA-Z]+)\}/g, (_, p: string) => `<span class="ph">${p}</span>`);

/** **label**, [[id|text]] and `code` → HTML. */
export function inline(text: string, ctx: Ctx): string {
  return text
    .split(TOKEN)
    .map((part) => {
      if (!part) return '';
      if (part.startsWith('**') && part.endsWith('**')) return `<strong class="ui">${placeholders(unescape(part.slice(2, -2)))}</strong>`;
      if (part.startsWith('[[') && part.endsWith(']]')) {
        const [rawId, label] = part.slice(2, -2).split('|');
        const id = rawId.trim();
        const title = ctx.titles.get(id);
        if (!title) return esc(label ?? id);
        return `<a class="xref" href="${ctx.articlePath(id)}">${esc(label ?? title)}</a>`;
      }
      if (part.startsWith('`') && part.endsWith('`')) return `<code>${esc(part.slice(1, -1))}</code>`;
      return placeholders(part);
    })
    .join('');
}

/** Plain text of an inline string (descriptions, JSON-LD, llms.txt). */
export const plain = (text: string, titles: Map<string, string>) =>
  text
    .replace(/\*\*((?:\\\*|[^*])+)\*\*/g, (_, l: string) => unescape(l))
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, (_, id: string) => titles.get(id.trim()) ?? id)
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\{([a-zA-Z]+)\}/g, '$1');

/** Cut at a word boundary, for meta descriptions. */
export function clip(s: string, max = 160): string {
  const one = s.replace(/\s+/g, ' ').trim();
  if (one.length <= max) return one;
  const cut = one.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 60 ? cut.lastIndexOf(' ') : cut.length).replace(/[,;:.\s]+$/, '')}…`;
}

const ROLE_EN: Record<Role, string> = { admin: 'Admin', member: 'Member', deputy: 'Deputy' };
export const roleLabel = (ctx: { lang: Lang }, r: Role) => t(ctx, ROLE_EN[r]);
export const chip = (ctx: { lang: Lang }, r: Role, on = true) =>
  `<span class="chip chip--${r}${on ? '' : ' chip--off'}">${esc(roleLabel(ctx, r))}</span>`;

// English labels; the interactive guide's academy/src/devices.tsx and viewer.ts use the same keys.
const DEVICE_SHORT: Record<Device, string> = {
  phone: 'Phone',
  phoneLand: 'Landscape',
  tablet: 'iPad',
  duoClosed: 'Duo closed',
  duoBook: 'Duo Book',
  duoLaptop: 'Duo Laptop',
  duoLand: 'Duo open',
  android: 'Android',
  web: 'Web',
};
const SHOT_DEVICE_LABEL: Record<ShotDevice, string> = {
  phone: 'iPhone & Android phone',
  tablet: 'iPad & tablets',
  web: 'Web browser',
  duoClosed: 'Dual-screen, closed',
  duoBook: 'Dual-screen, Book',
  duoLaptop: 'Dual-screen, Laptop',
};

/** The capture a static page shows: a desktop reader and a crawler see the web one first. */
const SHOT_ORDER: ShotDevice[] = ['web', 'tablet', 'phone', 'duoBook', 'duoClosed', 'duoLaptop'];
export function shotDevice(id: string, pinned?: ShotDevice): ShotDevice | null {
  const have = SHOT_FILES[id] ?? [];
  if (pinned) return have.includes(pinned) ? pinned : null;
  return SHOT_ORDER.find((d) => have.includes(d)) ?? null;
}
export const shotFile = (id: string, dev: ShotDevice) => `shots/${id}@${dev}.webp`;

function shot(b: Extract<Block, { type: 'shot' }>, ctx: Ctx): string {
  const dev = shotDevice(b.id, b.device);
  const caption = inline(b.caption, ctx);
  if (!dev) return '';
  const file = shotFile(b.id, dev);
  const size = ctx.shotSize?.(file);
  const dims = size ? ` width="${size.w}" height="${size.h}"` : '';
  const bar =
    dev === 'web'
      ? '<div class="shot__bar" aria-hidden="true"><i></i><i></i><i></i><span>app.bandwith.fun</span></div>'
      : '';
  const hinge = dev === 'duoBook' || dev === 'duoLaptop' ? '<span class="shot__hinge" aria-hidden="true"></span>' : '';
  return (
    `<figure class="shot shot--${dev}"><div class="shot__frame shot__frame--${dev}">${bar}` +
    `<div class="shot__screen"><img src="/academy/${file}" alt="${esc(plain(b.caption, ctx.titles))}" loading="lazy" decoding="async"${dims}></div>${hinge}</div>` +
    `<figcaption><span class="dev shot__dev">${esc(t(ctx, SHOT_DEVICE_LABEL[dev]))}</span><span>${caption}</span></figcaption></figure>`
  );
}

/** Steps are numbered across the article, so HowTo steps can point at #step-n. */
export function blocks(list: Block[], ctx: Ctx): string {
  let step = 0;
  return list
    .map((b) => {
      switch (b.type) {
        case 'p':
          return `<p>${inline(b.text, ctx)}</p>`;
        case 'steps':
          return (
            `<section class="steps">${b.title ? `<h3 class="steps__title">${inline(b.title, ctx)}</h3>` : ''}<ol>` +
            b.items
              .map((it, i) => `<li id="step-${++step}"><span class="steps__n">${String(i + 1).padStart(2, '0')}</span><span>${inline(it, ctx)}</span></li>`)
              .join('') +
            '</ol></section>'
          );
        case 'list':
          return (
            `<section class="list">${b.title ? `<h3 class="list__title">${inline(b.title, ctx)}</h3>` : ''}<ul>` +
            b.items.map((it) => `<li>${inline(it, ctx)}</li>`).join('') +
            '</ul></section>'
          );
        case 'note': {
          const label = b.tone === 'privacy' ? 'Privacy' : b.tone === 'warning' ? 'Careful' : 'Tip';
          return `<aside class="note note--${b.tone}"><span class="note__label">${esc(t(ctx, label))}</span><p>${inline(b.text, ctx)}</p></aside>`;
        }
        case 'roles':
          return (
            `<section class="rolesBlock"><h3 class="mini">${esc(t(ctx, 'By role'))}</h3>` +
            b.rows.map((r) => `<div class="rolesBlock__row">${chip(ctx, r.role)}<p>${inline(r.text, ctx)}</p></div>`).join('') +
            '</section>'
          );
        case 'devices':
          return (
            `<section class="devBlock"><h3 class="mini">${esc(t(ctx, 'On your device'))}</h3>` +
            b.rows
              .map(
                (r) =>
                  `<div class="devBlock__row"><div class="devBlock__devs">${r.devices
                    .map((d) => `<span class="dev">${esc(t(ctx, DEVICE_SHORT[d]))}</span>`)
                    .join('')}</div><p>${inline(r.text, ctx)}</p></div>`,
              )
              .join('') +
            '</section>'
          );
        case 'shot':
          return shot(b, ctx);
        case 'symbols':
          return (
            `<section class="symbols">${b.title ? `<h3>${inline(b.title, ctx)}</h3>` : ''}<dl class="symbols__list">` +
            b.rows
              .map((r) => {
                const def = MUSIC_SYMBOLS[r.symbol as MusicSymbolId];
                const mark = def?.text ?? r.name ?? (r.n != null ? String(r.n) : '•');
                return `<div class="symbols__row"><dt>${esc(mark)}</dt><dd>${inline(r.text, ctx)}</dd></div>`;
              })
              .join('') +
            '</dl></section>'
          );
        case 'table':
          return (
            '<div class="tableWrap"><table><thead><tr>' +
            b.head.map((h) => `<th>${inline(h, ctx)}</th>`).join('') +
            '</tr></thead><tbody>' +
            b.rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c, ctx)}</td>`).join('')}</tr>`).join('') +
            '</tbody></table></div>'
          );
      }
    })
    .join('\n');
}

/** Guide content → Markdown-ish plain text, for llms-full.txt. */
export function blocksText(list: Block[], titles: Map<string, string>, shotUrl: (id: string, dev: ShotDevice) => string): string {
  const p = (s: string) => plain(s, titles);
  return list
    .map((b) => {
      switch (b.type) {
        case 'p':
          return p(b.text);
        case 'steps':
          return `${b.title ? `${p(b.title)}\n` : ''}${b.items.map((it, i) => `${i + 1}. ${p(it)}`).join('\n')}`;
        case 'list':
          return `${b.title ? `${p(b.title)}\n` : ''}${b.items.map((it) => `- ${p(it)}`).join('\n')}`;
        case 'note':
          return `> ${b.tone === 'privacy' ? 'Privacy' : b.tone === 'warning' ? 'Careful' : 'Tip'}: ${p(b.text)}`;
        case 'roles':
          return b.rows.map((r) => `- ${ROLE_EN[r.role]}: ${p(r.text)}`).join('\n');
        case 'devices':
          return b.rows.map((r) => `- ${r.devices.map((d) => DEVICE_SHORT[d]).join(', ')}: ${p(r.text)}`).join('\n');
        case 'shot': {
          const dev = shotDevice(b.id, b.device);
          return dev ? `![${p(b.caption)}](${shotUrl(b.id, dev)})` : '';
        }
        case 'symbols':
          return `${b.title ? `${p(b.title)}\n` : ''}${b.rows
            .map((r) => `- ${MUSIC_SYMBOLS[r.symbol as MusicSymbolId]?.name ?? r.symbol}: ${p(r.text)}`)
            .join('\n')}`;
        case 'table':
          return [
            `| ${b.head.map(p).join(' | ')} |`,
            `| ${b.head.map(() => '---').join(' | ')} |`,
            ...b.rows.map((r) => `| ${r.map(p).join(' | ')} |`),
          ].join('\n');
      }
    })
    .filter(Boolean)
    .join('\n\n');
}

/**
 * The page's language in the browser. The built HTML is already translated
 * (site/tools/i18n.ts); this keeps what the scripts write afterwards (demos,
 * the capacity counter, form replies, links) in the same language: on an
 * Italian or Spanish page a MutationObserver translates every unit the
 * scripts add or change, and keeps site links under /it/ or /es/.
 *
 * English pages load no dictionary and install nothing.
 * Units the dictionary lacks are collected in window.__bwI18nMisses
 * (the e2e suite reads it).
 */
import { isLang, localizeHref, type Lang } from './langs';
import { makeTranslator, translateTree, wordy, TEXT_ATTRS, type Translator } from './translate';
import { SAME } from './same';

const htmlLang = document.documentElement.lang;
export const LANG: Lang = isLang(htmlLang) ? htmlLang : 'en';

let tr: Translator | null = null;
if (LANG === 'it') tr = makeTranslator('it', (await import('./dict/it')).it, SAME);
else if (LANG === 'es') tr = makeTranslator('es', (await import('./dict/es')).es, SAME);

/** A text in the page's language (English when the dictionary has none). */
export const t = (s: string): string => tr?.text(s) ?? s;

/** A link as it should read on this page (/get/ → /it/get/ on an Italian page). */
export const localHref = (href: string) => localizeHref(href, LANG);

function localizeLinks(root: Node) {
  if (LANG === 'en') return;
  const els: Element[] = [];
  if (root.nodeType === 1) els.push(root as Element);
  if ('querySelectorAll' in root) els.push(...Array.from((root as Element).querySelectorAll('a[href]')));
  for (const a of els) {
    if (a.tagName !== 'A' || a.closest('[data-i18n-skip], [data-lang-switch]')) continue;
    const h = a.getAttribute('href');
    if (h == null) continue;
    const out = localizeHref(h, LANG);
    if (out !== h) a.setAttribute('href', out);
  }
}

/** The element whose text is one unit with `node` (a <b> inside a sentence is part of it). */
function unitRoot(node: Node): Node {
  let n: Node = node.nodeType === 1 ? node : node.parentNode ?? node;
  while (n.nodeType === 1 && n.parentNode && n.parentNode.nodeType === 1 && wordy(n as Element)) n = n.parentNode;
  return n;
}

/**
 * Translated in the HTML, then cut into pieces for motion: [data-split]
 * headings (SplitText lines), [data-roll] nav labels (letters).
 */
const MOTION = '[data-split], [data-roll]';

if (tr) {
  const t0 = tr;
  Object.assign(window, { __bwI18nMisses: t0.misses, __bwI18nHits: t0.hits });
  const observer = new MutationObserver((list) => {
    observer.disconnect();
    const roots = new Set<Node>();
    for (const m of list) {
      if (m.type === 'attributes') roots.add(m.target);
      else roots.add(unitRoot(m.target));
    }
    for (const r of roots) {
      if (!r.isConnected) continue;
      const el = r.nodeType === 1 ? (r as Element) : r.parentElement;
      if (el?.closest(`[data-i18n-skip], ${MOTION}`)) continue;
      translateTree(r, t0, MOTION);
      localizeLinks(r);
    }
    observer.takeRecords();
    watch();
  });
  const watch = () => observer.observe(document.documentElement, {
    subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...TEXT_ATTRS, 'href'],
  });
  watch();
}

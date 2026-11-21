/**
 * The site's translator. The English pages are the source; IT and ES are
 * dictionaries from the English text to the translation (dict/it.ts,
 * dict/es.ts). The same code runs on the built HTML (site/tools/i18n.ts, with
 * jsdom) and in the browser (i18n/runtime.ts, for what the demos write).
 *
 * Units: the text of an element is cut into units at block elements, icons
 * and empty decorations. A unit with inline markup ("Play the <em>show.</em>")
 * is translated whole, as HTML, so a sentence is never split into pieces.
 * Whitespace inside a key is collapsed to one space.
 *
 * Keys may hold placeholders, so numbers can change at runtime:
 *   {n}   a whole number, kept         "{n} of 5 voted"
 *   {num} a number, re-formatted       "{num} BPM"
 *   {eur} an amount in euros, re-formatted for the language ("€1,900" → "1.900 €")
 *   {x}   any text, translated on its own if it is a key ("Ask {x}")
 * A bare amount ("€2,400") needs no key.
 */
import type { Lang } from './langs';
import { INTL_LOCALE } from './langs';

export type Dict = Record<string, string>;

/** Strings that read the same in every language: names, products, symbols. */
export type Translator = {
  lang: Lang;
  /** A text (plain, not HTML) in the language, or null when the dictionary has none. */
  text: (s: string) => string | null;
  /** An HTML unit with inline markup, or null. */
  html: (s: string) => string | null;
  /** Whether a text needs no translation (no letters, a name, already translated). */
  skip: (s: string) => boolean;
  /** Whether a text is the same in every language (no letters, a name, a code): never part of a sentence key. */
  fixed: (s: string) => boolean;
  /** Units the dictionary didn't have (build: the report; browser: window.__bwI18nMisses). */
  misses: Set<string>;
  /** Dictionary keys used so far (finds keys no page needs any more). */
  hits: Set<string>;
};

const INLINE = new Set(['EM', 'STRONG', 'B', 'I', 'BR', 'A', 'SPAN', 'SMALL', 'CODE', 'KBD', 'SUP', 'SUB', 'U', 'MARK', 'ABBR', 'TIME', 'Q', 'S', 'DEL', 'INS', 'WBR']);
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'svg', 'SVG', 'CANVAS', 'CODE']);
/** Attributes people read or hear. */
export const TEXT_ATTRS = ['alt', 'aria-label', 'title', 'placeholder', 'aria-description', 'aria-roledescription'];
/** <meta> whose content is copy. */
const META_COPY = /^(description|og:title|og:description|twitter:title|twitter:description|og:image:alt)$/;

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
/** The words of an HTML unit: tags dropped, the common entities read. */
const plainOf = (h: string) =>
  h.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const HAS_LETTER = /\p{L}/u;

const ESC_RE = /[.*+?^${}()|[\]\\]/g;
type Pattern = { key: string; re: RegExp; slots: string[]; out: string };

function compilePatterns(dict: Dict): Pattern[] {
  const out: Pattern[] = [];
  for (const [k, v] of Object.entries(dict)) {
    if (!/\{(n|num|eur|x)\}/.test(k)) continue;
    const slots: string[] = [];
    const src = k.split(/(\{(?:n|num|eur|x)\})/).map((part) => {
      const m = /^\{(n|num|eur|x)\}$/.exec(part);
      if (!m) return part.replace(ESC_RE, '\\$&');
      slots.push(m[1]);
      if (m[1] === 'n') return '(\\d+)';
      if (m[1] === 'num') return '(\\d[\\d,]*(?:\\.\\d+)?)';
      if (m[1] === 'eur') return '€(\\d[\\d,]*(?:\\.\\d+)?)';
      return '(.+?)';
    }).join('');
    out.push({ key: k, re: new RegExp(`^${src}$`, 'u'), slots, out: v });
  }
  // The most specific (longest literal text) first.
  return out.sort((a, b) => b.re.source.length - a.re.source.length);
}

export function makeTranslator(lang: Lang, dict: Dict, same: Iterable<string> = []): Translator {
  const locale = INTL_LOCALE[lang];
  // Italian writes 1.900 €; Spanish groups from five digits (1900 €, 12.500 €), as its style guides say.
  const grouping = (lang === 'it' ? 'always' : 'auto') as unknown as boolean;
  const eurFmt = new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0, useGrouping: grouping });
  const numFmt = new Intl.NumberFormat(locale, { maximumFractionDigits: 2, useGrouping: grouping });
  const parseNum = (s: string) => Number(s.replace(/,/g, ''));
  const eur = (s: string) => eurFmt.format(parseNum(s)).replace(/ /g, ' ');
  const plain = new Map<string, string>();
  const htmlMap = new Map<string, string>();
  for (const [k, v] of Object.entries(dict)) {
    if (/\{(n|num|eur|x)\}/.test(k)) continue;
    (k.includes('<') ? htmlMap : plain).set(norm(k), v);
  }
  const patterns = compilePatterns(dict);
  // Text already in the language (dictionary values and everything produced so far), as HTML and as plain text:
  // a re-rendered piece of a translated page is not a miss.
  const values = new Set<string>();
  const known = (v: string) => { values.add(norm(v)); values.add(norm(plainOf(v))); return v; };
  Object.values(dict).forEach(known);
  const sameSet = new Set([...same].map(norm));
  const misses = new Set<string>();
  const hits = new Set<string>();

  const viaPattern = (s: string): string | null => {
    for (const p of patterns) {
      const m = p.re.exec(s);
      if (!m) continue;
      hits.add(p.key);
      let i = 0;
      return p.out.replace(/\{(n|num|eur|x)\}/g, (_, slot: string) => {
        const val = m[1 + p.slots.indexOf(slot, i)] ?? '';
        i = p.slots.indexOf(slot, i) + 1;
        if (slot === 'eur') return eur(val);
        if (slot === 'num') return numFmt.format(parseNum(val));
        if (slot === 'x') return text(val) ?? val;
        return val;
      });
    }
    return null;
  };

  function text(s0: string): string | null {
    const s = norm(s0);
    if (plain.has(s)) { hits.add(s); return plain.get(s)!; }
    const bare = /^€(\d[\d,]*(?:\.\d+)?)$/.exec(s);
    if (bare) return known(eur(bare[1]));
    const p = viaPattern(s);
    return p == null ? null : known(p);
  }
  const html = (s0: string): string | null => {
    const s = norm(s0);
    if (htmlMap.has(s)) { hits.add(s); return htmlMap.get(s)!; }
    const p = viaPattern(s);
    return p == null ? null : known(p);
  };
  const fixed = (s0: string) => {
    const s = norm(s0);
    if (/^€\d[\d,]*(?:\.\d+)?$/.test(s)) return false; // a bare amount: re-formatted
    return !HAS_LETTER.test(s) || sameSet.has(s) || SAME_RE.test(s);
  };
  const skip = (s0: string) => fixed(s0) || values.has(norm(s0));
  return { lang, text, html, skip, fixed, misses, hits };
}

/** Never translated: channel numbers, times, keys, units, codes. */
const SAME_RE = /^(CH \d+|CH \d+ · CH \d+|[A-G][b#♭♯]?(m|maj|min|dim|aug|sus)?\d*(\/[A-G][b#♭♯]?)?|\d+(:\d+)?\s?(am|pm|h|min|s|BPM|bpm|x|×)?|[A-Z]{1,3}|v\d+(\.\d+)*|\d+\/\d+)$/u;

// ─────────────────────────── DOM walk ───────────────────────────

const isEl = (n: Node): n is Element => n.nodeType === 1;
const isText = (n: Node): n is Text => n.nodeType === 3;

/** An inline element that is only words: it can be part of a sentence unit. */
export function wordy(el: Element): boolean {
  if (!INLINE.has(el.tagName.toUpperCase())) return false;
  if (el.tagName.toUpperCase() === 'BR' || el.tagName.toUpperCase() === 'WBR') return true;
  if (!HAS_LETTER.test(el.textContent ?? '') && !/\d/.test(el.textContent ?? '')) return false;
  for (const c of Array.from(el.childNodes)) {
    if (isEl(c) && !wordy(c)) return false;
  }
  return true;
}

const serialize = (nodes: Node[]) =>
  nodes.map((n) => (isText(n) ? escapeText(n.data) : (n as Element).outerHTML)).join('');
const escapeText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;');

function translateAttrs(el: Element, t: Translator) {
  for (const a of TEXT_ATTRS) {
    const v = el.getAttribute(a);
    if (v == null || !v.trim() || t.skip(v)) continue;
    const out = t.text(v);
    if (out != null) el.setAttribute(a, out);
    else t.misses.add(norm(v));
  }
  if (el.tagName.toUpperCase() === 'META') {
    const name = el.getAttribute('name') ?? el.getAttribute('property') ?? '';
    const v = el.getAttribute('content');
    if (META_COPY.test(name) && v && !t.skip(v)) {
      const out = t.text(v);
      if (out != null) el.setAttribute('content', out);
      else t.misses.add(norm(v));
    }
  }
  if (el.tagName.toUpperCase() === 'INPUT' && /^(submit|button)$/i.test(el.getAttribute('type') ?? '')) {
    const v = el.getAttribute('value');
    if (v && !t.skip(v)) {
      const out = t.text(v);
      if (out != null) el.setAttribute('value', out);
      else t.misses.add(norm(v));
    }
  }
}

function replaceRun(run: Node[], out: string, asHtml: boolean, doc: Document) {
  const first = run[0];
  const last = run[run.length - 1];
  const parent = first.parentNode!;
  const lead = isText(first) ? /^\s*/.exec(first.data)![0] : '';
  const trail = isText(last) ? /\s*$/.exec(last.data)![0] : '';
  const frag = doc.createDocumentFragment();
  if (lead) frag.appendChild(doc.createTextNode(lead));
  if (asHtml) {
    const tpl = doc.createElement('template');
    tpl.innerHTML = out;
    frag.appendChild(tpl.content);
  } else {
    frag.appendChild(doc.createTextNode(out));
  }
  if (trail) frag.appendChild(doc.createTextNode(trail));
  parent.insertBefore(frag, first);
  for (const n of run) parent.removeChild(n);
}

function translateRun(run: Node[], t: Translator, doc: Document) {
  const textOnly = run.every(isText);
  const raw = textOnly ? run.map((n) => (n as Text).data).join('') : serialize(run);
  const plainText = run.map((n) => n.textContent ?? '').join('');
  if (!norm(plainText) || t.skip(plainText)) return;
  if (textOnly) {
    const out = t.text(raw);
    if (out == null) { t.misses.add(norm(raw)); return; }
    if (out === norm(raw)) return;
    if (run.length === 1) {
      const n = run[0] as Text;
      const lead = /^\s*/.exec(n.data)![0];
      const trail = /\s*$/.exec(n.data)![0];
      n.data = lead + out + trail;
    } else replaceRun(run, out, false, doc);
    return;
  }
  const out = t.html(raw);
  if (out == null) {
    // No key for the sentence: reported, left in English.
    t.misses.add(norm(raw));
    return;
  }
  replaceRun(run, out, true, doc);
}

/**
 * Translates every unit inside `root` (an element, a fragment or a document).
 * `skip`: a selector of elements to leave alone (in the browser: pieces cut for motion).
 */
export function translateTree(root: Node, t: Translator, skip?: string) {
  const doc = (root.nodeType === 9 ? root : root.ownerDocument) as Document;
  const visit = (node: Node) => {
    if (isEl(node)) {
      if (SKIP_TAGS.has(node.tagName) || node.hasAttribute('data-i18n-skip') || (skip && node.matches(skip))) return;
      translateAttrs(node, t);
    }
    if (isEl(node) && node.tagName.toUpperCase() === 'TITLE') {
      const v = node.textContent ?? '';
      if (v.trim() && !t.skip(v)) {
        const out = t.text(v);
        if (out != null) node.textContent = out; else t.misses.add(norm(v));
      }
      return;
    }
    const kids = Array.from(node.childNodes);
    let run: Node[] = [];
    let hasText = false;
    const flush = () => {
      // A unit already in the language (a re-rendered piece of a translated page): leave it whole.
      if (hasText && t.skip(run.map((n) => n.textContent ?? '').join(''))) { run = []; hasText = false; return; }
      // Names and numbers at the edges ("CH 04", "01") are not part of the sentence.
      const edge = (n: Node | undefined) => !!n && isEl(n) && t.fixed(n.textContent ?? '');
      const head: Node[] = [];
      const tail: Node[] = [];
      while (run.length && (edge(run[0]) || (isText(run[0]) && !run[0].data.trim() && edge(run[1])))) head.push(run.shift()!);
      while (run.length && (edge(run[run.length - 1]) || (isText(run[run.length - 1]) && !(run[run.length - 1] as Text).data.trim() && edge(run[run.length - 2])))) tail.unshift(run.pop()!);
      hasText = run.some((n) => isText(n) && !!n.data.trim());
      [...head, ...tail].forEach((n) => isEl(n) && visit(n));
      if (run.length) {
        if (hasText) translateRun(run, t, doc);
        else run.forEach((n) => isEl(n) && visit(n));
      }
      run = [];
      hasText = false;
    };
    for (const k of kids) {
      if (isText(k)) { run.push(k); if (k.data.trim()) hasText = true; continue; }
      if (isEl(k) && wordy(k)) { run.push(k); continue; }
      flush();
      if (isEl(k)) visit(k);
    }
    flush();
  };
  if (root.nodeType === 9) visit((root as Document).documentElement);
  else visit(root);
}

/**
 * What the crawler reads from the page, in one `page.evaluate` each time.
 *
 * Everything in here runs in the browser: the functions are serialised by
 * Playwright, so they may not use anything from the module scope.
 *
 * A *state* is identified by what the user is looking at, never by pixels:
 * the page path, the active tab (or the screen's heading outside the tab
 * app), the stack of open layers (dialogs, sheets, panes, each by its kind
 * and accessible name or first heading) and the selected tab inside the top
 * layer.
 */

export interface LayerInfo {
  kind: 'dialog' | 'sheet' | 'detail' | 'hub' | 'layer';
  name: string;
}

export interface ControlInfo {
  /** Index in this read; the element carries data-crawl-id="<nonce>-<cid>". */
  cid: number;
  /** Stable across reloads: role|name|layer name|occurrence. */
  key: string;
  role: string;
  name: string;
  tag: string;
  href: string | null;
  target: string | null;
  download: boolean;
  inputType: string | null;
  /** Index into `layers` (-1: the base screen under every layer). */
  layer: number;
  /** Text field, select…: recorded, never clicked. */
  field: boolean;
  /** Inside the tab bar / rail. */
  inNav: boolean;
  /** Same markup as its siblings (list rows, day cells): sampled. */
  group: string;
  checked: string | null;
}

export interface PageRead {
  url: string;
  path: string;
  tab: string | null;
  screen: string | null;
  layers: LayerInfo[];
  selectedTabs: string[];
  sig: string;
  title: string;
  /** Short visible text of the top layer (or the screen): what the role reads. */
  text: string;
  /** Everything readable (visible text + accessible names), for privacy and coverage. */
  fullText: string;
  /** Hash of the controls, their states and the field values. */
  fp: string;
  /** Hash of the visible text. */
  textHash: string;
  /** Scroll offsets of the scrollers. */
  scroll: string;
  /** The top layer (or screen) shows nothing: no text, no control. */
  empty: boolean;
  /** The signed-in app (tab bar mounted): the browser's Back runs its back chain. */
  inApp: boolean;
  controls: ControlInfo[];
}

export interface ReadOptions {
  nonce: string;
  /** Collect the controls (slower: scrolls each one into view to test it is on top). */
  collect: boolean;
}

export function readPageInBrowser(opts: ReadOptions): PageRead {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const norm = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ').trim();
  const hash = (s: string) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  };
  const cls = (e: Element | null) => (e ? (e.getAttribute('class') || '').slice(0, 80) : '');
  const visible = (e: Element) => {
    const r = e.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cv = (e as unknown as { checkVisibility?: (o: object) => boolean }).checkVisibility;
    if (typeof cv === 'function') return cv.call(e, { opacityProperty: true, visibilityProperty: true });
    const s = getComputedStyle(e);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
  };
  const onScreenShare = (e: Element) => {
    const r = e.getBoundingClientRect();
    const w = Math.max(0, Math.min(r.right, W) - Math.max(r.left, 0));
    const h = Math.max(0, Math.min(r.bottom, H) - Math.max(r.top, 0));
    return r.width * r.height > 0 ? (w * h) / (r.width * r.height) : 0;
  };
  /** Text in reading order with spaces between blocks, original letter case. */
  const textOf = (e: Element) => {
    const parts: string[] = [];
    const walker = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walker.nextNode())) {
      const p = n.parentElement;
      if (!p || p.closest('[aria-hidden="true"],script,style,noscript')) continue;
      const v = norm(n.nodeValue);
      if (v) parts.push(v);
    }
    return norm(parts.join(' '));
  };
  const byIds = (ids: string | null) =>
    ids
      ? norm(
          ids
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent || '')
            .join(' '),
        )
      : '';
  const headingIn = (root: Element) => {
    const hs = root.querySelectorAll('h1,h2,h3,[role=heading]');
    for (let i = 0; i < hs.length; i++) {
      // First heading in reading order, scrolled into view or not: the name
      // of a layer must not change when its content scrolls.
      if (visible(hs[i])) {
        const t = textOf(hs[i]);
        if (t) return t;
      }
    }
    return '';
  };

  // ---------------------------------------------------------------- layers
  const STRONG = '[role=dialog],[role=alertdialog],[aria-modal=true],.bw-pane-detail,.bw-pane-hub,.bw-sheet,.bw-pane-float,.bw-pane-dialog';
  const BASE = /(^|\s)(bw-nav-bar|bw-pane-main|bw-pane-placeholder|bw-pane-backdrop|bw-rail)(\s|$)/;
  const hasContent = (e: Element) =>
    !!e.querySelector('button,a[href],input,textarea,select,[role=button],h1,h2,h3,[role=heading]') || norm((e as HTMLElement).innerText).length > 0;
  const cands: Element[] = [];
  const consider = (e: Element, strong: boolean) => {
    if (cands.includes(e) || BASE.test(e.getAttribute('class') || '')) return;
    if (!visible(e) || onScreenShare(e) < 0.3) return;
    const s = getComputedStyle(e);
    if (s.pointerEvents === 'none') return;
    if (!strong) {
      if (s.position !== 'fixed') return;
      const z = Number(s.zIndex);
      if (!(z >= 10)) return;
      const r = e.getBoundingClientRect();
      if (r.width * r.height < W * H * 0.25) return;
    }
    if (!hasContent(e)) return;
    cands.push(e);
  };
  document.querySelectorAll(STRONG).forEach((e) => consider(e, true));
  document.querySelectorAll('body *').forEach((e) => {
    if (e.closest('svg') && e.tagName.toLowerCase() !== 'svg') return;
    consider(e, false);
  });
  const isStrong = (e: Element) => e.matches(STRONG);
  // Nested candidates: a dialog inside a pane is a layer on the pane; a plain
  // fixed box inside a layer (a sticky footer) is part of it; a plain wrapper
  // around a dialog (the backdrop) is not a layer of its own.
  const drop = new Set<Element>();
  for (const a of cands)
    for (const b of cands) {
      if (a === b || !a.contains(b)) continue;
      if (isStrong(b) && !isStrong(a)) drop.add(a);
      else if (!isStrong(b)) drop.add(b);
    }
  const zOf = (e: Element) => {
    let best = 0;
    for (let p: Element | null = e; p && p !== document.body; p = p.parentElement) {
      const z = Number(getComputedStyle(p).zIndex);
      if (z > best) best = z;
    }
    return best;
  };
  const all = [...document.querySelectorAll('body *')];
  const layersEl = cands
    .filter((e) => !drop.has(e))
    .map((e) => ({ e, z: zOf(e), i: all.indexOf(e) }))
    .sort((a, b) => a.z - b.z || a.i - b.i)
    .map((x) => x.e);
  const kindOf = (e: Element): LayerInfo['kind'] => {
    const c = e.getAttribute('class') || '';
    if (/(^|\s)bw-pane-detail(\s|$)/.test(c)) return 'detail';
    if (/(^|\s)bw-pane-hub(\s|$)/.test(c)) return 'hub';
    if (/(^|\s)bw-sheet(\s|$)/.test(c)) return 'sheet';
    if (e.matches('[role=dialog],[role=alertdialog],[aria-modal=true],.bw-pane-float,.bw-pane-dialog')) return 'dialog';
    return 'layer';
  };
  const nameOf = (e: Element) =>
    (norm(e.getAttribute('aria-label')) || byIds(e.getAttribute('aria-labelledby')) || headingIn(e) || norm((e as HTMLElement).innerText).slice(0, 40)).slice(0, 60);
  const layers: LayerInfo[] = layersEl.map((e) => ({ kind: kindOf(e), name: nameOf(e) }));
  document.querySelectorAll('[data-crawl-layer]').forEach((e) => e.removeAttribute('data-crawl-layer'));
  layersEl.forEach((e, i) => e.setAttribute('data-crawl-layer', i === layersEl.length - 1 ? 'top' : String(i)));
  const top: Element | null = layersEl.length ? layersEl[layersEl.length - 1] : null;

  // ---------------------------------------------------------------- where
  const cur = [...document.querySelectorAll('[aria-current=page]')].find((e) => visible(e));
  const tab = cur ? norm(cur.getAttribute('aria-label')) || textOf(cur) : null;
  let screen: string | null = null;
  if (!tab) {
    const hs = [...document.querySelectorAll('h1,h2,[role=heading]')].filter(
      (h) => visible(h) && !layersEl.some((l) => l.contains(h)),
    );
    screen = hs.length ? textOf(hs[0]).slice(0, 60) : null;
  }
  const scope = top ?? document.body;
  const selectedTabs = [...scope.querySelectorAll('[role=tab][aria-selected=true]')]
    .filter((e) => visible(e))
    .map((e) => norm(e.getAttribute('aria-label')) || textOf(e))
    .slice(0, 3);
  const path = location.pathname.replace(/\/index\.html$/, '/') + (location.pathname.endsWith('.html') ? location.search : '');
  // Under a layer, the tab bar is often gone: the screen is the layers
  // (the same gig detail whether it was opened from Home or the Calendar).
  const base = tab ? `tab:${tab.replace(/,.*$/, '')}` : layers.length ? '' : `screen:${screen ?? '?'}`;
  const sig = [
    path,
    base,
    layers.map((l) => `${l.kind}:${l.name}`).join(' > '),
    selectedTabs.length ? `sel:${selectedTabs.join(',')}` : '',
  ].join(' | ');
  const title = layers.length ? layers[layers.length - 1].name : tab || screen || document.title;

  // ---------------------------------------------------------------- text
  const navBar = document.querySelector('.bw-nav-bar');
  let text = '';
  if (top) text = norm((top as HTMLElement).innerText);
  else {
    const main = document.querySelector('.bw-pane-main') || document.body;
    const clone = norm((main as HTMLElement).innerText);
    const nav = navBar ? norm((navBar as HTMLElement).innerText) : '';
    text = nav && clone.endsWith(nav) ? clone.slice(0, -nav.length).trim() : clone;
  }
  const labels = [...document.querySelectorAll('[aria-label],[title]')]
    .filter((e) => visible(e))
    .map((e) => `${e.getAttribute('aria-label') || ''} ${e.getAttribute('title') || ''}`);
  const fullText = norm(`${document.body.innerText}\n${labels.join('\n')}`).slice(0, 30000);

  // ---------------------------------------------------------------- controls
  const SEL =
    'button,a[href],[role=button],[role=link],[role=tab],[role=menuitem],[role=menuitemradio],[role=option],[role=switch],[role=checkbox],[role=radio],input,select,textarea,summary,[contenteditable=true]';
  const roleOf = (e: Element) => {
    const r = e.getAttribute('role');
    if (r) return r;
    const t = e.tagName.toLowerCase();
    if (t === 'a') return 'link';
    if (t === 'select') return 'combobox';
    if (t === 'textarea') return 'textbox';
    if (t === 'input') {
      const ty = (e as HTMLInputElement).type;
      if (ty === 'checkbox') return 'checkbox';
      if (ty === 'radio') return 'radio';
      if (ty === 'button' || ty === 'submit' || ty === 'reset') return 'button';
      if (ty === 'range') return 'slider';
      return 'textbox';
    }
    return 'button';
  };
  const accName = (e: Element) => {
    const al = norm(e.getAttribute('aria-label'));
    if (al) return al;
    const lb = byIds(e.getAttribute('aria-labelledby'));
    if (lb) return lb;
    if (e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement || e instanceof HTMLSelectElement) {
      const lab = e.id ? document.querySelector(`label[for="${CSS.escape(e.id)}"]`) : null;
      return norm(lab?.textContent || e.closest('label')?.textContent || e.getAttribute('placeholder') || e.getAttribute('title') || e.name || '');
    }
    const t = textOf(e);
    if (t) return t;
    const ti = norm(e.getAttribute('title'));
    if (ti) return ti;
    const img = e.querySelector('img[alt]');
    return img ? norm(img.getAttribute('alt')) : '';
  };
  const controls: ControlInfo[] = [];
  const fpParts: string[] = [];
  {
    document.querySelectorAll('[data-crawl-id]').forEach((e) => e.removeAttribute('data-crawl-id'));
    // Remember every scroller's offset: testing "on top" scrolls things into view.
    const scrollers: [Element, number, number][] = [];
    document.querySelectorAll('*').forEach((e) => {
      if (e.scrollTop || e.scrollLeft) scrollers.push([e, e.scrollTop, e.scrollLeft]);
    });
    const winY = window.scrollY;
    const winX = window.scrollX;
    const seen = new Map<string, number>();
    const els = [...document.querySelectorAll(SEL)];
    for (const e of els) {
      if (controls.length >= 400) break;
      if (!visible(e)) continue;
      // A control inside another control is the same action.
      if (e.parentElement?.closest(SEL) && !e.matches('input,select,textarea')) continue;
      const he = e as HTMLElement & { disabled?: boolean };
      if (he.disabled || e.getAttribute('aria-disabled') === 'true') continue;
      if (e instanceof HTMLInputElement && e.type === 'hidden') continue;
      const isOnTop = () => {
        const r = e.getBoundingClientRect();
        const cy = Math.min(Math.max(r.top + r.height / 2, 0), H - 1);
        const pts = [r.left + r.width / 2, r.left + Math.min(6, r.width / 2), r.right - Math.min(6, r.width / 2)];
        return pts.some((x) => {
          if (x < 0 || x >= W || cy < 0 || cy >= H) return false;
          const t = document.elementFromPoint(x, cy);
          return !!t && (t === e || e.contains(t) || (e instanceof HTMLInputElement && t.tagName === 'LABEL' && (t as HTMLLabelElement).control === e));
        });
      };
      // On top where it is, or once scrolled to the middle of its scroller
      // (a sticky bar may cover it at the edge).
      let onTop = isOnTop();
      if (!onTop && opts.collect) {
        e.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' as ScrollBehavior });
        onTop = isOnTop();
      }
      if (!onTop) continue;
      const role = roleOf(e);
      const name = accName(e).slice(0, 80);
      // Deepest layer that holds it.
      let layer = -1;
      for (let i = layersEl.length - 1; i >= 0; i--)
        if (layersEl[i].contains(e)) {
          layer = i;
          break;
        }
      const layerName = layer >= 0 ? layers[layer].name : tab || screen || '';
      const base = `${role}|${name}|${layerName}`;
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      const field =
        e.matches('textarea,select,[contenteditable=true]') ||
        (e instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range'].includes(e.type));
      const checked =
        e.getAttribute('aria-checked') ??
        e.getAttribute('aria-pressed') ??
        e.getAttribute('aria-selected') ??
        e.getAttribute('aria-expanded') ??
        (e instanceof HTMLInputElement && (e.type === 'checkbox' || e.type === 'radio') ? String(e.checked) : null);
      const cid = controls.length;
      e.setAttribute('data-crawl-id', `${opts.nonce}-${cid}`);
      controls.push({
        cid,
        key: `${base}|${n}`,
        role,
        name,
        tag: e.tagName.toLowerCase(),
        href: e.getAttribute('href'),
        target: e.getAttribute('target'),
        download: e.hasAttribute('download'),
        inputType: e instanceof HTMLInputElement ? e.type : null,
        layer,
        field,
        inNav: !!e.closest('.bw-nav-bar,nav,[role=navigation],[role=tablist].bw-rail'),
        group: `${role}|${e.tagName}|${cls(e)}|${cls(e.parentElement)}`,
        checked,
      });
      const value = e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement || e instanceof HTMLSelectElement ? e.value : '';
      fpParts.push(`${base}|${checked ?? ''}|${value}`);
    }
    for (const [e, t, l] of scrollers) {
      e.scrollTop = t;
      e.scrollLeft = l;
    }
    document.querySelectorAll('*').forEach((e) => {
      if ((e.scrollTop || e.scrollLeft) && !scrollers.some(([s]) => s === e)) {
        e.scrollTop = 0;
        e.scrollLeft = 0;
      }
    });
    window.scrollTo(winX, winY);
  }
  const scroll = [...document.querySelectorAll('*')]
    .filter((e) => e.scrollTop || e.scrollLeft)
    .map((e) => `${Math.round(e.scrollTop)}/${Math.round(e.scrollLeft)}`)
    .join(',');
  const topControls = controls.filter((c) => c.layer === layersEl.length - 1).length;
  const empty = norm(text).length < 2 && topControls === 0;
  return {
    url: location.href,
    path,
    tab,
    screen,
    layers,
    selectedTabs,
    sig,
    title,
    text: text.slice(0, 300),
    fullText,
    fp: hash(`${sig}#${fpParts.join(';')}`),
    textHash: hash(text),
    scroll: `${Math.round(window.scrollY)}:${scroll}`,
    empty,
    inApp: !!document.querySelector('.bw-pane-main, .bw-nav-bar, .bw-duo-rail'),
    controls,
  };
}

/**
 * Installed before the app's scripts: records toasts (they vanish), and
 * swallows the outward actions a click may trigger (opening a URL, the share
 * sheet, printing) so nothing ever leaves the app; the crawler reads what
 * was attempted from `window.__crawl`.
 */
export function crawlInitScript() {
  const w = window as unknown as {
    __crawl: { toasts: string[]; outward: string[]; invalid: number };
    open: typeof window.open;
  };
  w.__crawl = { toasts: [], outward: [], invalid: 0 };
  // A submit with empty required fields: the browser's own validation bubble.
  document.addEventListener(
    'invalid',
    () => {
      w.__crawl.invalid++;
    },
    true,
  );
  w.open = ((url?: string | URL) => {
    w.__crawl.outward.push(`open ${String(url ?? '')}`);
    return null;
  }) as typeof window.open;
  try {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (d: { url?: string; title?: string }) => {
        w.__crawl.outward.push(`share ${d?.url ?? d?.title ?? ''}`);
      },
    });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
  } catch {
    /* read-only in this engine */
  }
  window.print = () => {
    w.__crawl.outward.push('print');
  };
  const watch = () => {
    new MutationObserver((list) => {
      for (const m of list)
        m.addedNodes.forEach((n) => {
          if (!(n instanceof Element)) return;
          const toast = n.matches('[data-sonner-toast]') ? n : n.querySelector('[data-sonner-toast]');
          if (toast) w.__crawl.toasts.push((toast.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160));
        });
    }).observe(document.documentElement, { childList: true, subtree: true });
  };
  if (document.documentElement) watch();
  else document.addEventListener('DOMContentLoaded', watch);
}

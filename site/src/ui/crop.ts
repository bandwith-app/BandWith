/**
 * Screen crops: show the part of an app screen that matters, zoomed, instead
 * of a whole phone. A crop is a box of any shape holding one capture; a
 * region (y0..y1 of the capture's height, optional x0..x1 of its width) is
 * fitted into the box: the whole region stays visible, the rest of the box
 * shows the screen around it, and the capture never leaves a gap. Moving to
 * another region pans and zooms with one transform (CSS transitions it).
 *
 *   <div class="crop" data-crop="0.12 0.46"><img class="crop__img" src=…></div>
 */

export type Region = { y0: number; y1: number; x0?: number; x1?: number };

const AR_DEFAULT = 1688 / 780; // phone captures: height / width

export function parseRegion(s: string | undefined): Region {
  const [y0 = 0, y1 = 1, x0, x1] = (s ?? '').trim().split(/\s+/).filter(Boolean).map(Number);
  return { y0, y1, x0, x1 };
}

/** Pure geometry, exported for tests: scale and offset (px) of the capture inside a w×h box. */
export function fit(w: number, h: number, ar: number, r: Region) {
  const x0 = r.x0 ?? 0;
  const x1 = r.x1 ?? 1;
  const zW = 1 / (x1 - x0);                 // region width = box width
  const zH = h / ((r.y1 - r.y0) * ar * w);  // region height = box height
  const z = Math.max(1, Math.min(zW, zH));  // whole region visible, never narrower than the box
  const iw = w * z;
  const ih = iw * ar;
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const tx = clamp(w / 2 - ((x0 + x1) / 2) * iw, w - iw, 0);
  // A region taller than the box (wide boxes on phones) is read from its top.
  const fits = (r.y1 - r.y0) * ih <= h + 0.5;
  const want = fits ? h / 2 - ((r.y0 + r.y1) / 2) * ih : -r.y0 * ih;
  const ty = ih <= h ? (h - ih) / 2 : clamp(want, h - ih, 0);
  return { z, tx, ty };
}

function apply(box: HTMLElement, r: Region) {
  const w = box.clientWidth;
  const h = box.clientHeight;
  if (!w || !h) return;
  const ar = Number(box.dataset.ar ?? AR_DEFAULT);
  const { z, tx, ty } = fit(w, h, ar, r);
  box.style.setProperty('--crop-t', `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, 0) scale(${z.toFixed(4)})`);
}

const watched = new WeakMap<HTMLElement, Region>();
let ro: ResizeObserver | null = null;
const observer = () => (ro ??= new ResizeObserver((entries) => entries.forEach((e) => {
  const box = e.target as HTMLElement;
  const r = watched.get(box);
  if (!r) return;
  box.classList.add('is-sizing');          // no transition while the layout moves
  apply(box, r);
  requestAnimationFrame(() => box.classList.remove('is-sizing'));
})));

/** Keep a crop fitted to its region as the layout changes. */
export function fitCrop(box: HTMLElement, r: Region = parseRegion(box.dataset.crop)) {
  watched.set(box, r);
  box.classList.add('is-sizing');
  apply(box, r);
  requestAnimationFrame(() => box.classList.remove('is-sizing'));
  observer().observe(box);
}

/**
 * Move a crop to a new region. With a new capture the old one fades out,
 * the new one is placed at its region and fades in (no pan across screens).
 */
export function focusCrop(box: HTMLElement, r: Region, src?: string, alt?: string) {
  watched.set(box, r);
  const img = box.querySelector<HTMLImageElement>('.crop__img');
  if (!src || !img || img.getAttribute('src') === src) { apply(box, r); return; }
  box.classList.add('is-swapping');
  window.setTimeout(() => {
    const show = () => {
      box.classList.add('is-sizing');
      apply(box, r);
      requestAnimationFrame(() => requestAnimationFrame(() => box.classList.remove('is-sizing', 'is-swapping')));
    };
    const pre = new Image();
    pre.src = src;
    const swap = () => { img.src = src; if (alt !== undefined) img.alt = alt; show(); };
    if (pre.complete) swap(); else { pre.onload = swap; pre.onerror = swap; }
  }, 240);
}

export function initCrops(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('[data-crop]').forEach((box) => fitCrop(box));
}

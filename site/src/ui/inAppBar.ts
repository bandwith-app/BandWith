/**
 * The bar for Facebook's and Instagram's in-app browsers, once the page's
 * scripts run. The bar itself, and whether it shows, is decided inline before
 * the first paint (content/render.ts, inAppBar); this keeps the fixed header
 * right under it (--iab-h follows the bar's height), closes it for the visit
 * and, where the real browser can't be opened from a link (iPhone), copies
 * the page's address so the visitor can paste it there.
 */
import { storageSet } from '../core/storage';
import { INAPP_CLOSED_KEY } from '../core/inApp';

/** Copies text with the Clipboard API, or the older way where a web view refuses it. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch { /* no Clipboard API here, or not allowed: the selection way */ }
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.cssText = 'position:fixed;left:0;top:0;opacity:0;font-size:16px';
  document.body.appendChild(field);
  field.select();
  field.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  field.remove();
  return ok;
}

/** `onResize`: the bar changed height or went away (the page under it moved). */
export function initInAppBar(onResize: () => void = () => {}) {
  const bar = document.querySelector<HTMLElement>('[data-inapp-bar]');
  if (!bar || bar.hidden) return;
  const root = document.documentElement;

  let last = -1;
  const size = () => {
    const h = bar.hidden ? 0 : Math.round(bar.getBoundingClientRect().height);
    if (h === last) return;
    last = h;
    if (h) root.style.setProperty('--iab-h', `${h}px`);
    else root.style.removeProperty('--iab-h');
    onResize();
  };
  size();
  const watch = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(size);
  watch?.observe(bar);

  bar.querySelector('[data-iab-close]')?.addEventListener('click', () => {
    storageSet(INAPP_CLOSED_KEY, '1', 'session');
    watch?.disconnect();
    bar.hidden = true;
    root.removeAttribute('data-inapp');
    size();
  });

  const copy = bar.querySelector<HTMLButtonElement>('[data-iab-copy]');
  const label = copy?.querySelector<HTMLElement>('[data-iab-copy-label]');
  const copied = copy?.querySelector<HTMLElement>('[data-iab-copied]');
  let back = 0;
  copy?.addEventListener('click', async () => {
    if (!(await copyText(location.href)) || !label || !copied) return;
    label.hidden = true;
    copied.hidden = false;
    window.clearTimeout(back);
    back = window.setTimeout(() => { copied.hidden = true; label.hidden = false; }, 4000);
  });
}

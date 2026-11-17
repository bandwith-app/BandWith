// core/boot first: its base CSS must come before the page's own styles.
import { boot, finish } from '../core/boot';
import '../styles/get.css';
import { initForms } from '../ui/forms';

/**
 * Get page. When every spot is taken (html.is-full, set by capacity.ts) the
 * doors close and the waitlist comes first; forms post nothing in that state.
 */
const ctx = boot();
initForms();
finish(ctx);

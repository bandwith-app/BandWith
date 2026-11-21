// core/boot first: its base CSS must come before the page's own styles.
import { boot, finish } from '../core/boot';
import '../styles/answers.css';

/** /faq/: every question on the site, by channel (content/answers.ts). Static: only the shared boot. */
const ctx = boot();
finish(ctx);

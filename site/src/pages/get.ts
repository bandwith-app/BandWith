// core/boot first: its base CSS must come before the page's own styles.
import { boot, finish } from '../core/boot';
import '../styles/get.css';
import { initForms } from '../ui/forms';

/**
 * Get page. The doors are plain links (web app, APK, TestFlight). When the
 * open spots are gone (html.is-full, set by capacity.ts) the waitlist comes
 * first; with spots still kept for band invites (html.is-invites) the doors
 * stay open for invited people.
 */
const ctx = boot();
initForms();
finish(ctx);

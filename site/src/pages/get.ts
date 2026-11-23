// core/boot first: its base CSS must come before the page's own styles.
import { boot, finish } from '../core/boot';
import '../styles/get.css';
import '../styles/answers.css';
import { initForms } from '../ui/forms';
import { getCapacity } from '../core/capacity';

/**
 * Get page. The doors are plain links (web app, APK, TestFlight) and come
 * right under the headline, the visitor's own first (the inline script after
 * them, content/render.ts). The counter sits with "Why a limit?".
 *
 * When the open spots are gone (html.is-full, set by capacity.ts) the action
 * is another one, so the notice goes back to the top: the counter moves up
 * under the headline and the waitlist comes before the doors; with spots
 * still kept for band invites (html.is-invites) the doors stay open for
 * invited people.
 */
const ctx = boot();
initForms();
// Before finish(): its own capacity step then measures the page as it will stay.
void getCapacity().then((c) => {
  if (!c || c.state === 'open') return;
  const block = document.querySelector('[data-cap-block]');
  const top = document.querySelector('[data-cap-top]');
  if (block && top) top.append(block);
});
finish(ctx);

/**
 * Privacy demo: the home page's "Same gig, three views" card (ui/roles.ts,
 * styles/roles.css, rules in content/roles.ts), here as the page's Try it.
 */
import { rolesCard } from '../rolesCard';

export const markup = () =>
  `<div class="rv" data-roles data-role="admin">${rolesCard()}</div>` +
  `<p class="rv__note"><svg class="ico" aria-hidden="true"><use href="#i-eye-off"/></svg><span>Hidden here means never sent. The server leaves these details out, so a member’s phone never receives the band fee, the client or anyone else’s fee.</span></p>`;

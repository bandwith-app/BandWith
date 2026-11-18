/**
 * Fees & payouts demo markup (script: ui/demos/money.ts, styles: styles/demos/money.css).
 * Client A — Wedding is over: Leo's Fee & payouts sheet, then Sara's phone.
 * Numbers match the home page's "Same gig" card: band fee €2,400, five fees
 * €1,900 to pay out, Sara €400, the deputy €180 (Academy: payouts-due,
 * fee-and-payouts-on-a-gig, what-members-see-of-money).
 */
const ico = (id: string) => `<svg class="ico" aria-hidden="true"><use href="#i-${id}"/></svg>`;

export const markup = () =>
  `<div class="md" data-money-demo>` +
  `<div class="md__bar">` +
  `<div class="md__roles" role="radiogroup" aria-label="Whose phone">` +
  `<button type="button" role="radio" aria-checked="true" tabindex="0" data-md-role="admin"><b>Leo’s phone</b><em>Admin</em></button>` +
  `<button type="button" role="radio" aria-checked="false" tabindex="-1" data-md-role="member"><b>Sara’s phone</b><em>Member</em></button>` +
  `</div>` +
  `<button type="button" class="md__reset" data-md-reset>${ico('refresh')}Start over</button></div>` +
  `<div class="md__floor">` +
  `<div class="md__side">` +
  `<p class="md__kick mono"><span class="md__dot"></span>Show over · Sat 21 Nov 2026</p>` +
  `<p class="md__gig">Client A — Wedding</p>` +
  `<p class="md__venue mono">Villa Necchi · Milan</p>` +
  `<div class="md__sees" data-md-sees></div>` +
  `</div>` +
  `<div class="md__phone"><div class="mdp" data-md-phone></div></div>` +
  `</div>` +
  `<ol class="md__log mono" data-md-log aria-live="polite" aria-label="What happened"></ol>` +
  `<noscript><p class="md__nojs">The demo needs JavaScript. Here is Home as an admin sees it, with payouts due:</p><img src="/shots/basics-home-admin@phone.webp" alt="Home for an admin with Payouts due" width="390" height="844" /></noscript>` +
  `</div>`;

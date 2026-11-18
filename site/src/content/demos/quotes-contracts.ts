/**
 * Quotes & contracts demo markup: "Be the client" (script: ui/demos/quotes-contracts.ts,
 * styles: styles/demos/quotes-contracts.css). Left, the client's personal quote page
 * (labels from src/quote/strings.ts, the real /quote.html); right, Leo's phone with
 * Client confirmation (Academy: client-quote-page, client-confirmation, quote-to-gig).
 * Amounts: subtotal €2,400 is the band fee the gig gets; VAT 22% on top; deposit 25% of the total.
 */
const ico = (id: string) => `<svg class="ico" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const arrow = `<span class="qc__arr" aria-hidden="true">→</span>`;

const hero =
  `<section class="qc qc--lime">` +
  `<p class="qc__k">Velvet Static · Quote Q-2026-0014</p>` +
  `<h3 class="qc__h1">Client A — Wedding</h3>` +
  `<p class="qc__p" data-qd-hello>Hi Client A, Velvet Static sent you this quote. Have a look, then accept it, decline it or ask a question.</p>` +
  `<dl class="qc__dl">` +
  `<dt>Date</dt><dd>Saturday 21 November 2026</dd>` +
  `<dt>Time</dt><dd>20:30–00:30</dd>` +
  `<dt>Venue</dt><dd>Villa Necchi</dd>` +
  `<dt>City</dt><dd>Milan</dd>` +
  `<dt>Guests</dt><dd>140</dd>` +
  `<dt>Line-up</dt><dd>5 musicians</dd>` +
  `</dl></section>`;

const items =
  `<section class="qc"><h3 class="qc__h2">What’s in the quote</h3>` +
  `<ul class="qc__items">` +
  `<li><span><b>MAIN BAND</b><em>5pc band · two sets</em></span><strong>€2,100.00</strong></li>` +
  `<li><span><b>MUSICAL PRODUCTION</b><em>Sound and lights</em></span><strong>€300.00</strong></li>` +
  `</ul><div class="qc__tot">` +
  `<p><span>Subtotal</span><span>€2,400.00</span></p>` +
  `<p><span>VAT 22%</span><span>€528.00</span></p>` +
  `<p class="qc__grand"><span>Total</span><span>€2,928.00</span></p>` +
  `<p><span>Deposit 25%</span><span>€732.00</span></p>` +
  `<p><span>Valid until</span><span>31 Oct 2026</span></p>` +
  `</div></section>`;

const answer =
  `<section class="qc" data-qd-answer><h3 class="qc__h2">Does it work for you?</h3>` +
  `<label class="qc__k qc__lab" for="qd-name">Your full name</label>` +
  `<input class="qc__in" id="qd-name" type="text" autocomplete="off" maxlength="80" placeholder="e.g. Anna Rossi" data-qd-name />` +
  `<p class="qc__err" id="qd-name-err" data-qd-err="name" hidden>Type your full name to accept.</p>` +
  `<div class="qc__check"><input type="checkbox" id="qd-check" data-qd-check /><label for="qd-check">I accept this quote (Q-2026-0014, version 1).</label></div>` +
  `<p class="qc__err" id="qd-check-err" data-qd-err="check" hidden>Tick the box to confirm.</p>` +
  `<button type="button" class="qc__btn" data-qd-act="accept">Accept the quote${arrow}</button>` +
  `<p class="qc__mute">Your name, the date and the time are saved as your acceptance of this quote. It is not a legal signature: if a contract is needed, Velvet Static will send it to you to sign separately.</p>` +
  `<details class="qc__dec" data-qd-decline><summary>Decline the quote</summary>` +
  `<label class="qc__k qc__lab" for="qd-reason">Reason (optional)</label>` +
  `<textarea class="qc__in" id="qd-reason" rows="2" maxlength="200" placeholder="e.g. we chose another date" data-qd-reason></textarea>` +
  `<button type="button" class="qc__btn qc__btn--light" data-qd-act="decline">Decline${arrow}</button>` +
  `</details></section>`;

const chat =
  `<section class="qc" data-qd-chat><h3 class="qc__h2">Questions or changes?</h3>` +
  `<p class="qc__mute">Write to Velvet Static. Their answer appears on this page: keep the link to come back.</p>` +
  `<div class="qc__thread" data-qd-thread></div>` +
  `<label class="qc__k qc__lab" for="qd-msg">Your message</label>` +
  `<textarea class="qc__in" id="qd-msg" rows="3" maxlength="300" placeholder="e.g. Could you play one more set?" data-qd-msg>Could you play one more set after dinner?</textarea>` +
  `<p class="qc__err" data-qd-err="msg" hidden>Write a message first.</p>` +
  `<button type="button" class="qc__btn qc__btn--lime" data-qd-act="send">Send message${arrow}</button></section>`;

export const markup = () =>
  `<div class="qd" data-qd-demo>` +
  `<div class="qd__bar"><p class="qd__hint mono">${ico('lock')}You are Client A · no account, no app</p>` +
  `<button type="button" class="qd__reset" data-qd-reset>${ico('refresh')}Start over</button></div>` +
  `<div class="qd__floor">` +
  `<div class="qd__client"><p class="qd__who"><span class="tag">Client</span>The personal link</p>` +
  `<div class="qdb"><div class="qdb__chrome" aria-hidden="true"><i></i><i></i><i></i><span>${ico('lock')}Velvet Static · Quote Q-2026-0014</span></div>` +
  `<div class="qdb__page" tabindex="0" role="region" aria-label="Client A’s quote page" data-qd-page>` +
  `<div data-qd-status></div><div class="qc__cols"><div class="qc__col">${hero}${items}</div><div class="qc__col">${answer}${chat}</div></div><p class="qc__foot">BandWith</p></div></div>` +
  `<p class="qd__echo" data-qd-echo aria-hidden="true"></p></div>` +
  `<div class="qd__leo"><p class="qd__who"><span class="tag tag--ink">Admin</span>Leo M. · the quote in the app</p>` +
  `<div class="qdp" data-qd-phone></div></div>` +
  `</div>` +
  `<ol class="qd__log mono" data-qd-log aria-live="polite" aria-label="What happened"></ol>` +
  `<noscript><p class="qd__nojs">The demo needs JavaScript. Here is Client confirmation as Leo sees it in the app:</p><img src="/shots/quote-client-confirmation@phone.webp" alt="Client confirmation on a quote" width="390" height="844" /></noscript>` +
  `</div>`;

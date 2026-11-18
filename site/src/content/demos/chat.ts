/** chat demo markup (script: ui/demos/chat.ts, styles: styles/demos/chat.css). */
const ico = (id: string) => `<svg class="ico" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const tick = (k: string, name: string, line: string) =>
  `<li data-cd-mark="${k}"><span class="cd__mk cd__mk--${k}">${k === 'sending' ? ico('clock') : k === 'sent' ? ico('check') : `${ico('check')}${ico('check')}`}</span><span><b>${name}</b>${line}</span></li>`;

export const markup = () =>
  `<div class="cd" data-cd-demo>` +
    `<div class="cd__bar">` +
      `<div class="cd__tabs" role="tablist" aria-label="Chats">` +
        `<button type="button" role="tab" id="cd-tab-event" aria-controls="cd-phone" aria-selected="true" data-cd-tab="event">${ico('calendar')}Event chat</button>` +
        `<button type="button" role="tab" id="cd-tab-direct" aria-controls="cd-phone" aria-selected="false" tabindex="-1" data-cd-tab="direct">${ico('message-circle')}Direct</button>` +
      `</div>` +
      `<button type="button" class="cd__reset" data-cd-reset>${ico('refresh')}Start over</button>` +
    `</div>` +
    `<div class="cd__floor">` +
      `<figure class="cd__m">` +
        `<div class="cdp" id="cd-phone" role="tabpanel" aria-labelledby="cd-tab-event" data-cd-phone>` +
          `<div class="cdp__head" data-cd-head></div>` +
          `<div class="cdp__thread" data-cd-thread></div>` +
          `<div class="cdp__compose" data-cd-compose>` +
            `<div class="cdp__reply" data-cd-reply></div>` +
            `<div class="cdp__mentions" data-cd-mentions role="listbox" aria-label="Mention someone"></div>` +
            `<div class="cdp__row">` +
              `<input type="text" class="cdp__in" data-cd-input aria-label="Message" placeholder="Write a message…" autocomplete="off" enterkeyhint="send" />` +
              `<button type="button" class="cdp__send" data-cd-send aria-label="Send message" disabled>${ico('arrow-up-right')}</button>` +
            `</div>` +
            `<p class="cdp__lock" data-cd-lock hidden>${ico('lock')}<span>Direct messaging is only available with band admins.</span></p>` +
          `</div>` +
        `</div>` +
        `<figcaption><b>Sara</b> Vocals · member</figcaption>` +
      `</figure>` +
      `<div class="cd__side">` +
        `<ol class="cd__try" data-cd-try aria-label="Things to try">` +
          `<li data-cd-step="send"><i>${ico('check')}</i>Send a message and watch the ticks</li>` +
          `<li data-cd-step="reply"><i>${ico('check')}</i>Reply to Leo’s message</li>` +
          `<li data-cd-step="mention"><i>${ico('check')}</i>Type @ to mention Nico</li>` +
          `<li data-cd-step="direct"><i>${ico('check')}</i>Open Direct and try to message Nico</li>` +
        `</ol>` +
        `<div class="cd__ticks">` +
          `<p class="cd__lab">Ticks on your last message</p>` +
          `<ul class="cd__marks">` +
            tick('sending', 'Sending', 'Your message is on its way.') +
            tick('sent', 'Sent', 'Saved on the server.') +
            tick('delivered', 'Delivered', 'It reached the other people’s phones.') +
            tick('read', 'Read', 'They opened the chat after your message.') +
          `</ul>` +
          `<p class="cd__rule">In band and event chats the ticks change only when everyone has received or read the message.</p>` +
          `<p class="cd__lab">In this chat</p>` +
          `<ul class="cd__people" data-cd-people></ul>` +
        `</div>` +
      `</div>` +
    `</div>` +
    `<ol class="cd__log mono" data-cd-log aria-live="polite" aria-label="What happened"></ol>` +
    `<noscript><p class="cd__nojs">The demo needs JavaScript. Here is an event chat as it looks in the app:</p><img src="/shots/shot-event-chat@phone.webp" alt="An event chat on a phone" width="390" height="844" /></noscript>` +
  `</div>`;

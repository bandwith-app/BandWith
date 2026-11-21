/**
 * Build-time HTML for the Q&A blocks (content/answers.ts):
 *   <!--@home-answers-->  "What is BandWith?" + the home FAQ
 *   <!--@faq-page-->      the /faq/ page: every question, by channel
 *   and the "Questions" section at the end of each channel page (pageRender.ts).
 * Answers are plain <details>: open or closed, the text is in the HTML for
 * crawlers, and tools/seo.ts turns exactly these into FAQPage JSON-LD.
 */
import { ANSWERS, DEFINITION, HOME_ANSWERS, type QA } from './answers';
import { CHANNELS, channelUrl, pad2 } from './features';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const arrow = '<svg class="ico btn__arrow" aria-hidden="true"><use href="#i-arrow-right"/></svg>';

export const qaList = (list: QA[]) =>
  `<div class="faq__list">${list.map(({ q, a }) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div>`;

/** Home: the definition on the left, the questions on the right. */
export function homeAnswers() {
  return (
    `<section class="sec faq answers" id="what" aria-labelledby="what-h"><div class="wrap faq__grid">` +
      `<div class="answers__def">` +
        `<p class="label">In short</p>` +
        `<h2 class="h2" id="what-h" data-split>What is<br />BandWith?</h2>` +
        `<p class="lead answers__lead" data-definition>${esc(DEFINITION)}</p>` +
        `<a class="btn btn--ghost btn--sm" href="/faq/">All questions ${arrow}</a>` +
      `</div>` +
      qaList(HOME_ANSWERS) +
    `</div></section>`
  );
}

/** A channel page's questions (bone, like the sheet above it). */
export function pageAnswers(slug: string) {
  const list = ANSWERS[slug];
  if (!list?.length) return '';
  return (
    `<section class="sec sec--bone faq answers" id="questions" aria-labelledby="qa-h" data-light><div class="wrap faq__grid">` +
      `<div>` +
        `<p class="label">Questions</p>` +
        `<h2 class="h2" id="qa-h" data-split>Asked<br />and answered.</h2>` +
        `<a class="answers__all" href="/faq/">All questions ${arrow}</a>` +
      `</div>` +
      qaList(list) +
    `</div></section>`
  );
}

/** /faq/: the home questions, then one group per channel, each with a link to its page. */
export function faqPage() {
  const group = (id: string, tag: string, title: string, list: QA[], link?: { href: string; text: string }) =>
    `<section class="faqp__group" id="${id}" aria-labelledby="${id}-h">` +
      `<div><p class="label">${tag}</p><h2 class="h2 faqp__h" id="${id}-h">${esc(title)}</h2>` +
      (link ? `<a class="answers__all" href="${link.href}">${esc(link.text)} ${arrow}</a>` : '') +
      `</div>` +
      qaList(list) +
    `</section>`;
  const groups = [
    group('about', 'BandWith', 'About BandWith', HOME_ANSWERS),
    ...CHANNELS.filter((c) => ANSWERS[c.slug]?.length).map((c) =>
      group(c.slug, `CH ${pad2(c.ch)}`, c.name, ANSWERS[c.slug], { href: channelUrl(c), text: 'Open the page' })),
  ].join('');
  return (
    `<section class="faqp__head" aria-labelledby="faq-h"><div class="wrap">` +
      `<p class="label"><span class="led"></span>Questions &amp; answers</p>` +
      `<h1 class="h1 faqp__title" id="faq-h" data-split>Asked and answered.</h1>` +
      `<p class="lead faqp__lead" data-definition>${esc(DEFINITION)}</p>` +
      `<p class="faqp__more">Joining the beta? <a href="/get/#faq-h">Before you sign up</a>.</p>` +
    `</div></section>` +
    `<div class="sec faq faqp"><div class="wrap faqp__groups">${groups}</div></div>`
  );
}

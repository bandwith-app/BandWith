/**
 * The site's pages (English source files, relative to site/) and the shared
 * HTML they include. Used by site/vite.config.ts and site/test/i18n.test.ts.
 */
import { readFileSync } from 'fs';
import path from 'path';
import { GENERATED } from '../src/content/render';

export const SITE_ROOT = path.resolve(__dirname, '..');

export const PAGES: Record<string, string> = {
  home: 'index.html',
  calendarGigs: 'features/calendar-gigs/index.html',
  quotesContracts: 'features/quotes-contracts/index.html',
  money: 'features/money/index.html',
  rehearsalsPolls: 'features/rehearsals-polls/index.html',
  chat: 'features/chat/index.html',
  songs: 'features/songs/index.html',
  stage: 'features/stage/index.html',
  stagePlotRider: 'features/stage-plot-rider/index.html',
  people: 'features/people/index.html',
  privacy: 'features/privacy/index.html',
  devices: 'features/devices/index.html',
  get: 'get/index.html',
  faq: 'faq/index.html',
};

const read = (name: string) => readFileSync(path.resolve(SITE_ROOT, 'partials', `${name}.html`), 'utf8');

/**
 * <!--#name--> = a file in site/partials; <!--@name--> = generated from the channel list;
 * <!--@page:slug--> / <!--@page-head:slug--> = a channel page from content/pages/<slug>.ts.
 * (<!--@lang-switch--> is left for tools/i18n.ts, which knows the page.)
 */
const once = (html: string) =>
  html
    .replace(/<!--#([a-z-]+)-->/g, (_, name: string) => read(name))
    .replace(/<!--@([a-z-]+)(?::([a-z-]+))?-->/g, (m, name: string, arg?: string) => GENERATED[name]?.(arg) ?? m);
export const fillPartials = (html: string) => once(once(html));

/** A page's English HTML with its partials filled. */
export const englishPage = (rel: string) => fillPartials(readFileSync(path.resolve(SITE_ROOT, rel), 'utf8'));

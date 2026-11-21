/**
 * Spanish: English site text → Spanish. es.json holds the page text (keys = the
 * English exactly as the page shows it, whitespace collapsed; see
 * i18n/translate.ts for units and placeholders); live.ts the counter and the
 * waitlist. site/test/i18n.test.ts fails on any English left on a page, and
 * e2e/site/i18n-runtime.spec.ts on any the scripts write.
 */
import type { Dict } from '../translate';
import strings from './es.json';
import { LIVE } from './live';

export const es: Dict = { ...(strings as Dict), ...LIVE.es };

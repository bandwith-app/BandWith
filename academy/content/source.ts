import type { AreaModule } from './types';
import basics from './basics';
import gigs from './gigs';
import business from './business';
import together from './together';
import music from './music';
import people from './people';

/** The English areas, in the order they appear on the home page. Plain data (the static pages load it at build time). */
export const SOURCE: AreaModule[] = [basics, gigs, business, together, music, people];

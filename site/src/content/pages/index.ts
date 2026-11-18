/** Every channel page's content, by slug (see types.ts). */
import type { ChannelPage } from './types';
import { page as calendar } from './calendar-gigs';
import { page as quotes } from './quotes-contracts';
import { page as money } from './money';
import { page as rehearsals } from './rehearsals-polls';
import { page as chat } from './chat';
import { page as songs } from './songs';
import { page as stage } from './stage';
import { page as rider } from './stage-plot-rider';
import { page as people } from './people';
import { page as privacy } from './privacy';
import { page as devices } from './devices';

export const PAGES: Record<string, ChannelPage> = Object.fromEntries(
  [calendar, quotes, money, rehearsals, chat, songs, stage, rider, people, privacy, devices].map((p) => [p.slug, p]),
);

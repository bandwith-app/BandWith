/**
 * "Try it" demos: the markup each channel page's demo needs, one file per
 * demo kind in this folder (its script is in ui/demos/<kind>.ts, started by
 * the page's entry in pages/<slug>.ts; its styles in styles/demos/<kind>.css).
 * A demo whose markup is empty leaves its page without a Try it section.
 */
import { markup as stage } from './stage';
import { markup as calendarGigs } from './calendar-gigs';
import { markup as quotesContracts } from './quotes-contracts';
import { markup as money } from './money';
import { markup as rehearsalsPolls } from './rehearsals-polls';
import { markup as chat } from './chat';
import { markup as songs } from './songs';
import { markup as stagePlotRider } from './stage-plot-rider';
import { markup as people } from './people';
import { markup as privacy } from './privacy';
import { markup as devices } from './devices';

export const DEMOS: Record<string, () => string> = {
  stage,
  'calendar-gigs': calendarGigs,
  'quotes-contracts': quotesContracts,
  'money': money,
  'rehearsals-polls': rehearsalsPolls,
  'chat': chat,
  'songs': songs,
  'stage-plot-rider': stagePlotRider,
  'people': people,
  'privacy': privacy,
  'devices': devices,
};

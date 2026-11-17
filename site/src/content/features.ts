/**
 * The site's eleven channels: one page per main function of the app.
 * `live: false` = the page isn't built yet (the rack and menus show "Soon").
 * `shot` = an Academy capture id (academy/public/shots/<shot>@<device>.webp).
 * `academy` = article ids linked from the page (checked by features.test.ts).
 */
export type Accent = 'gig' | 'rehearsal' | 'quote' | 'personal';

export type Channel = {
  ch: number;
  slug: string;
  name: string;
  short: string;
  line: string;
  accent: Accent;
  shot: string;
  live: boolean;
  academy: string[];
};

export const CHANNELS: Channel[] = [
  { ch: 1, slug: 'calendar-gigs', name: 'Calendar & gigs', short: 'Calendar', line: 'Every date, every call time.', accent: 'gig', shot: 'calendar-month', live: false, academy: [] },
  { ch: 2, slug: 'quotes-contracts', name: 'Quotes & contracts', short: 'Quotes', line: 'Quotes the client confirms with a tap.', accent: 'quote', shot: 'quote-client-confirmation', live: false, academy: [] },
  { ch: 3, slug: 'money', name: 'Fees & payouts', short: 'Money', line: 'Everyone knows what they’re owed.', accent: 'gig', shot: 'analytics', live: false, academy: [] },
  { ch: 4, slug: 'rehearsals-polls', name: 'Rehearsals & polls', short: 'Rehearsals', line: 'Find the date in one round.', accent: 'rehearsal', shot: 'shot-poll-card', live: false, academy: [] },
  { ch: 5, slug: 'chat', name: 'Band chat', short: 'Chat', line: 'Talk next to the plans.', accent: 'personal', shot: 'shot-event-chat', live: false, academy: [] },
  { ch: 6, slug: 'songs', name: 'Songs & setlists', short: 'Songs', line: 'Charts, keys and setlists, ready to play.', accent: 'gig', shot: 'music-setlist-editor', live: false, academy: [] },
  { ch: 7, slug: 'stage', name: 'Stage mode', short: 'Stage', line: 'One song on every phone.', accent: 'gig', shot: 'music-stage', live: true, academy: ['stage-mode', 'lead-stage-mode', 'follow-in-stage-mode', 'stage-click', 'stage-bluetooth-sync', 'stage-mode-on-devices'] },
  { ch: 8, slug: 'stage-plot-rider', name: 'Stage plot & rider', short: 'Rider', line: 'The venue knows before you arrive.', accent: 'quote', shot: 'gig-workspace-admin', live: false, academy: [] },
  { ch: 9, slug: 'people', name: 'Members, deputies & gear', short: 'People', line: 'Who plays, who covers, who brings what.', accent: 'personal', shot: 'people-find-deputy', live: false, academy: [] },
  { ch: 10, slug: 'privacy', name: 'Privacy by role', short: 'Privacy', line: 'Everyone sees their part. Only theirs.', accent: 'gig', shot: 'gig-workspace-member', live: false, academy: [] },
  { ch: 11, slug: 'devices', name: 'Every device', short: 'Devices', line: 'Phone, iPad, Surface Duo and the web.', accent: 'rehearsal', shot: 'calendar-month', live: false, academy: [] },
];

export const pad2 = (n: number) => String(n).padStart(2, '0');
export const channelUrl = (c: Channel) => `/features/${c.slug}/`;
export const bySlug = (slug: string) => CHANNELS.find((c) => c.slug === slug);

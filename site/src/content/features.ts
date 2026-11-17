/**
 * The site's eleven channels: one page per main function of the app.
 * `live: false` = the page isn't built yet (the rack and menus show "Soon").
 * `shot` = an Academy capture id (academy/public/shots/<shot>@<device>.webp),
 * `crop` = the part of its phone capture that previews the channel.
 * `academy` = article ids linked from the page (checked by features.test.ts).
 */
export type Accent = 'gig' | 'rehearsal' | 'quote' | 'personal';
export type Group = 'Business' | 'Band' | 'Show' | 'Everywhere';

/** Menu order: the groups, then each group's channels in CH order. */
export const GROUPS: Group[] = ['Business', 'Band', 'Show', 'Everywhere'];

export type Channel = {
  ch: number;
  slug: string;
  name: string;
  short: string;
  line: string;
  accent: Accent;
  shot: string;
  /** The part of the capture that tells the story: [top, bottom] as fractions of its height. */
  crop: [number, number];
  group: Group;
  live: boolean;
  academy: string[];
};

export const CHANNELS: Channel[] = [
  { ch: 1, slug: 'calendar-gigs', name: 'Calendar & gigs', short: 'Calendar', line: 'Every date, every call time.', accent: 'gig', shot: 'calendar-month', crop: [0.04, 0.5], group: 'Business', live: false, academy: [] },
  { ch: 2, slug: 'quotes-contracts', name: 'Quotes & contracts', short: 'Quotes', line: 'Quotes the client confirms with a tap.', accent: 'quote', shot: 'quote-client-confirmation', crop: [0, 0.31], group: 'Business', live: false, academy: [] },
  { ch: 3, slug: 'money', name: 'Fees & payouts', short: 'Money', line: 'Everyone knows what they’re owed.', accent: 'gig', shot: 'analytics', crop: [0.04, 0.5], group: 'Business', live: false, academy: [] },
  { ch: 4, slug: 'rehearsals-polls', name: 'Rehearsals & polls', short: 'Rehearsals', line: 'Find the date in one round.', accent: 'rehearsal', shot: 'shot-poll-card', crop: [0.13, 0.44], group: 'Band', live: false, academy: [] },
  { ch: 5, slug: 'chat', name: 'Band chat', short: 'Chat', line: 'Talk next to the plans.', accent: 'personal', shot: 'shot-event-chat', crop: [0.1, 0.6], group: 'Band', live: false, academy: [] },
  { ch: 6, slug: 'songs', name: 'Songs & setlists', short: 'Songs', line: 'Charts, keys and setlists, ready to play.', accent: 'gig', shot: 'music-setlist-editor', crop: [0.27, 0.8], group: 'Show', live: false, academy: [] },
  { ch: 7, slug: 'stage', name: 'Stage mode', short: 'Stage', line: 'One song on every phone.', accent: 'gig', shot: 'music-stage', crop: [0, 0.52], group: 'Show', live: true, academy: ['stage-mode', 'lead-stage-mode', 'follow-in-stage-mode', 'stage-click', 'stage-bluetooth-sync', 'stage-mode-on-devices'] },
  { ch: 8, slug: 'stage-plot-rider', name: 'Stage plot & rider', short: 'Rider', line: 'The venue knows before you arrive.', accent: 'quote', shot: 'gig-workspace-admin', crop: [0.47, 0.96], group: 'Show', live: false, academy: [] },
  { ch: 9, slug: 'people', name: 'Members, deputies & gear', short: 'People', line: 'Who plays, who covers, who brings what.', accent: 'personal', shot: 'people-find-deputy', crop: [0.29, 0.76], group: 'Band', live: false, academy: [] },
  { ch: 10, slug: 'privacy', name: 'Privacy by role', short: 'Privacy', line: 'Everyone sees their part. Only theirs.', accent: 'gig', shot: 'gig-workspace-member', crop: [0.36, 0.84], group: 'Band', live: false, academy: [] },
  { ch: 11, slug: 'devices', name: 'Every device', short: 'Devices', line: 'Phone, iPad, Surface Duo and the web.', accent: 'rehearsal', shot: 'calendar-month', crop: [0, 0.46], group: 'Everywhere', live: false, academy: [] },
];

export const pad2 = (n: number) => String(n).padStart(2, '0');
export const channelUrl = (c: Channel) => `/features/${c.slug}/`;
export const bySlug = (slug: string) => CHANNELS.find((c) => c.slug === slug);

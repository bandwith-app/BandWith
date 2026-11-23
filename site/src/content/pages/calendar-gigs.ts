import type { ChannelPage } from './types';

export const page: ChannelPage = {
  slug: 'calendar-gigs',
  title: 'Calendar & gigs',
  description: 'One month grid for the band’s gigs, rehearsals and quotes. Book a gig in three steps: every musician gets the date, the call times and their own fee.',
  ogTitle: 'Calendar & gigs · Every date, every call time.',
  hero: {
    heading: { lines: ['Every date.', 'Every call time.'], em: 'time.' },
    lead: 'Gigs, rehearsals and quotes share one calendar. Book a gig in three steps and the lineup gets the date, the venue, the call times and their own fee. Then the gig’s page keeps track of what’s still to do.',
    chips: [
      { icon: 'calendar', label: 'Month grid' },
      { icon: 'users', label: 'Lineup & fees' },
      { icon: 'clock', label: 'Call times' },
      { icon: 'wifi-off', label: 'Saves offline' },
    ],
    shot: 'gig-workspace-admin',
    region: [0, 0.46],
    alt: 'A gig on a phone: Client A — Wedding at Villa Necchi, Sat 21 Nov 2026, the forecast, and load in 15:00, soundcheck 16:30, show 20:30',
  },
  flow: {
    heading: { lines: ['From a free day', 'to a full lineup.'] },
    steps: [
      { title: 'See the month', body: 'Gigs, rehearsals, quotes and personal dates share one grid, each day in its event’s colour. Filter by type with ALL, GIGS, REHEARSALS, QUOTES and DRAFTS, or by band if you play in more than one. Tap a free day to start a gig on it.', shot: 'calendar-month', region: [0.585, 0.885], badge: '9 events' },
      { title: 'Pick who plays', body: 'Step 1 of the wizard: the event type, then Solo, Duo, Trio or Full band. Each musician’s fee is filled in from the roster; change any of them. Money not agreed yet? Turn on Fee to be discussed (TBD).', shot: 'gig-wizard-step1', region: [0.46, 0.89], badge: 'Step 1 of 3' },
      { title: 'Set the date and venue', body: 'Step 2: search the venue and pick the date. The picker tints each day by how many members are free. Add load-in and soundcheck, and they show on the gig as call times.', shot: 'gig-workspace-admin', region: [0.21, 0.46], badge: 'Call times set' },
      { title: 'Create it, then run it', body: 'Tap Create gig. Each musician gets an invitation with their own fee only. On the gig’s page, SHOW READINESS lists what’s settled and marks the rest To do.', shot: 'gig-workspace-admin', region: [0.47, 0.97], badge: '5 of 6 ready' },
    ],
  },
  demo: {
    kind: 'calendar-gigs',
    heading: { lines: ['Three steps.', 'One gig.'] },
    lead: 'You’re Leo. Pick the lineup, pick a day the band is free, create the gig. Then see what reaches each musician’s phone: their own fee, nobody else’s.',
  },
  roles: {
    heading: { lines: ['Admins book.', 'Everyone sees their part.'] },
    lead: 'Admins create and change gigs. Members see the gigs they’re on, with their own fee. Deputies never see the band calendar: they get the request, the times and the fee offered.',
    rows: [
      { what: 'Sees the band calendar', admin: 'Every event', member: 'Gigs they’re on', deputy: false },
      { what: 'Creates, edits and deletes gigs', admin: true, member: false, deputy: false },
      { what: 'Sees quotes and gig drafts', admin: 'Drafts: only their own', member: false, deputy: false },
      { what: 'Sees date, call times and venue', admin: true, member: true, deputy: 'Of their request' },
      { what: 'Sees fees', admin: 'Everyone’s', member: 'Own only', deputy: 'Fee offered' },
      { what: 'Accepts or declines the gig', admin: 'When invited', member: true, deputy: true },
      { what: 'Sees show readiness', admin: 'Every check', member: 'No contract or deposit', deputy: false },
      { what: 'Syncs events to their own calendar', admin: 'Every band event', member: 'Their own events', deputy: 'Their gigs, by feed' },
    ],
  },
  details: {
    heading: { lines: ['Small things', 'that save a call.'] },
    items: [
      { icon: 'users', title: 'Who’s free, never why', body: 'When you pick a date, the picker counts the members with nothing else on that day, in any of their calendars. Counts only: a personal gig shows as busy, never its title, venue or fee.', wide: true },
      { icon: 'clock', title: 'Shows past midnight', body: '21:00 to 02:00 is one gig. It stays upcoming until the show really ends.' },
      { icon: 'file-text', title: 'Drafts only you see', body: 'Close the wizard and save a draft. It follows you to your other devices. Nobody is told until you create the gig.' },
      { icon: 'bell', title: 'One notice per change', body: 'A new date, time, call time or venue sends the lineup one Gig updated. A changed fee reaches only that musician.' },
      { icon: 'map-pin', title: 'Venue and forecast', body: 'Search the venue by name, clubs and studios included, and its street and city fill in. For a gig in the next seven days, the wizard shows the forecast and the sunset time.' },
      { icon: 'calendar', title: 'In your own calendar', body: 'Settings & account, then Calendar sync: a private link for Apple Calendar, Google Calendar or Outlook. The gigs and rehearsals you’re on follow by themselves, with the times, the venue and your role, never fees or clients. Add to calendar on an event saves just that one.', wide: true },
    ],
  },
  learn: [
    { id: 'calendar-overview', title: 'The calendar', line: 'Filters, the month grid, the legend and the cards.' },
    { id: 'create-a-gig', title: 'Create a gig', line: 'The three-step wizard, from lineup to Create gig.' },
    { id: 'free-slots-and-conflicts', title: 'Who’s free', line: 'Availability counts and schedule conflicts.' },
    { id: 'gig-workspace', title: 'The gig workspace', line: 'Everything on a gig’s page, top to bottom.' },
    { id: 'show-readiness', title: 'Show readiness', line: 'What’s settled for a gig, and what’s still to do.' },
    { id: 'calendar-sync', title: 'Calendar sync', line: 'Your events in Apple, Google or Outlook.' },
  ],
};

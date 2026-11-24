import type { ChannelPage } from './types';

export const page: ChannelPage = {
  slug: 'people',
  title: 'Members, deputies & gear',
  description: 'Invite the band by name, email, link or code. When someone can’t play, ask a deputy: they answer in one tap, no account. And keep track of the gear.',
  ogTitle: 'Members, deputies & gear · Who plays. Who covers.',
  hero: {
    heading: { lines: ['Who plays.', 'Who covers.'], em: 'covers.' },
    lead: 'Invite the band, set each person’s role and default fee, and keep a list of deputies for the nights someone can’t make it. Then track the gear, and who has it.',
    chips: [
      { icon: 'users', label: 'Invite by link or code' },
      { icon: 'bell', label: 'Ask in the app' },
      { icon: 'message-circle', label: 'WhatsApp, SMS, Email' },
      { icon: 'sliders', label: 'Gear & kits' },
    ],
    shot: 'people-find-deputy',
    region: [0.29, 0.76],
    alt: 'Find a deputy on a phone: replacing Lena P. on keys, with the deputies Ivo M. and Luca T. and an Ask in the app button',
  },
  flow: {
    heading: { lines: ['From the invite', 'to the van.'] },
    steps: [
      { title: 'Invite the band', body: 'On Band members, tap Invite member and type a name or an email. People on BandWith show up under Found in BandWith; anyone else gets an email, a link and a code. Pick Member or Admin. Nobody joins without saying yes.', shot: 'people-invite', region: [0.53, 1], badge: 'Valid 7 days' },
      { title: 'Someone can’t play', body: 'When a member declines a gig, open the lineup and tap Find a deputy. Deputies on the same instrument come first. Tap Ask in the app, or send WhatsApp, SMS or Email with the details and a reply link.', shot: 'people-find-deputy', region: [0.49, 0.85], badge: 'Asked' },
      { title: 'The deputy answers', body: 'In one tap, on a web page with no account, or in Deputy gigs if they’re on BandWith: Yes, Not sure yet or No, I can’t. You get a notification. The street address reaches them only after a yes.', shot: 'people-deputy-gigs', region: [0.4, 0.79], badge: 'No account needed' },
      { title: 'Pack the gear', body: 'Add the band’s gear, or your own with Add my gear. Each item has a status, Available, In use, Maintenance or Lost, and a line for who has it. Bundle items into kits, then pick a kit on the gig.', shot: 'people-gear', region: [0.57, 1], badge: '16 items · 2 kits' },
    ],
  },
  demo: {
    kind: 'people',
    heading: { lines: ['Lena can’t.', 'Ivo can.'] },
    lead: 'Lena P. declined the wedding. Find a deputy, ask Ivo M. in the app, then answer on his phone. Watch the answer reach Leo, and the address reach Ivo.',
  },
  roles: {
    heading: { lines: ['Admins manage.', 'Everyone plays.'] },
    lead: 'Admins run the band list, the deputies and the kits. Members see the whole band and add their own gear. Deputies see only the requests sent to them.',
    rows: [
      { what: 'Sees everyone in the band, with email and phone', admin: true, member: true, deputy: false },
      { what: 'Invites, removes, makes admin', admin: true, member: false, deputy: false },
      { what: 'Default fee in this band', admin: 'Sets everyone’s', member: 'Sees their own', deputy: false },
      { what: 'The deputies list and requests', admin: true, member: false, deputy: 'Their own requests' },
      { what: 'Sees the gear, its status and the kits', admin: true, member: true, deputy: false },
      { what: 'Adds and changes gear', admin: 'Any item', member: 'Only their own', deputy: false },
      { what: 'Creates kits, picks one for a gig', admin: true, member: false, deputy: false },
    ],
  },
  details: {
    heading: { lines: ['Made for', 'last-minute calls.'] },
    lead: 'Three things to know first. The other four are sorted by band and by deputy.',
    featured: [
      {
        title: 'The right deputy first',
        tag: 'Replacing a member',
        body: 'The sheet lists the band’s deputies, the same instrument first, with their usual fee. Ask in the app, or by message.',
        ui: { shot: 'people-find-deputy', region: [0.5, 0.86], alt: 'Find a deputy for Lena P. on keys: Ivo M., keys, first, then Luca T., bass, usual fee €180, with Ask in the app' },
      },
      {
        title: 'The gig changed?',
        tag: 'After a deputy’s yes',
        body: 'Move the date, times or venue and the request is flagged. Send update shows them what changed and asks Still OK.',
        ui: { shot: 'people-deputy-gigs', region: [0.66, 1], alt: 'Deputy gigs: Yes, Not sure yet and No, I can’t, then a gig answered yes and marked Something changed' },
      },
      {
        title: 'Invites that wait, then expire',
        tag: 'Valid for 7 days',
        body: 'One reminder when 2 days are left. Under Invited, admins see the open ones, with Send again, Copy link or Cancel invite.',
        ui: { shot: 'people-invite', region: [0.64, 1], alt: 'Invite member: a search for the person, then the role, Member or Admin' },
      },
    ],
    groups: [
      {
        label: 'In the band',
        items: [
          { title: 'A default fee per person', line: 'Set it on their page under In the band. New gigs and quotes fill it in; you can still change it.' },
          { title: 'Who covers what', line: 'The deputies list groups the band by instrument and tells you which ones still have no deputy.' },
        ],
      },
      {
        label: 'For deputies',
        items: [
          { title: 'A calendar that keeps up', line: 'After a yes, a deputy can tap Subscribe to my gigs. Their calendar follows every change.' },
          { title: 'The link is the key', line: 'Anyone with a reply link can answer. Unlink account replaces every link sent to that deputy.' },
        ],
      },
    ],
  },
  learn: [
    { id: 'invite-members', title: 'Invite someone', line: 'By name, email, link or code, as member or admin.' },
    { id: 'member-roles', title: 'Admin and member', line: 'What each role can do, and the one-admin rule.' },
    { id: 'deputies', title: 'Deputies', line: 'The band’s stand-ins, and what they can see.' },
    { id: 'ask-a-deputy', title: 'Ask a deputy', line: 'From the gig’s lineup, in the app or by message.' },
    { id: 'deputy-reply-page', title: 'The reply page', line: 'How a deputy answers without an account.' },
    { id: 'gear-inventory', title: 'Gear & inventory', line: 'Items, status, owners and kits.' },
  ],
};

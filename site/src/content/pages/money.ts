import type { ChannelPage } from './types';

export const page: ChannelPage = {
  slug: 'money',
  title: 'Fees & payouts',
  description: 'Every musician has a fee on every gig, or Fee TBD until it’s set. After the show, Home lists who is still owed. Members see only their own fee.',
  ogTitle: 'Fees & payouts · Everyone knows what they’re owed.',
  hero: {
    heading: { lines: ['Everyone knows', 'what they’re owed.'], em: 'owed.' },
    lead: 'Set each musician’s fee on the gig. After the show, Home lists who the band still owes, and you tick them off as paid. Members see their own fee and whether it was paid. Nothing else.',
    chips: [
      { icon: 'wallet', label: 'A fee per musician' },
      { icon: 'clock', label: 'Payouts after the show' },
      { icon: 'check', label: 'Mark all as paid' },
      { icon: 'eye-off', label: 'Only your own fee' },
    ],
    shot: 'basics-home-admin',
    region: [0.52, 0.88],
    alt: 'Home for an admin: Action center with Payouts (1), Summer Fest Opening, payouts due €1,300 to five musicians, paid after the show',
  },
  flow: {
    heading: { lines: ['From the fee', 'to paid.'] },
    steps: [
      { title: 'Set each fee', body: 'In the gig wizard every musician gets a fee, from their own default or the band’s rates. Type any amount, or tick Fee to be discussed (TBD): the date is confirmed now, the money later.', shot: 'gig-wizard-step1', region: [0.46, 0.89], badge: 'Roster · 5 of 5' },
      { title: 'Pay after the show', body: 'Once the gig is over, Action center on Home shows the payouts due. Review payouts opens Fee & payouts: tap the switch next to each musician, or MARK ALL AS PAID.', shot: 'basics-home-admin', region: [0.64, 0.88], badge: '5 musicians due' },
      { title: 'Keep the ledger', body: 'REVENUE on Home adds up this year’s gig fees. Tap it for Money flow, the band ledger: record income and expenses, and see Net profit for the year.', shot: 'basics-home-admin', region: [0.14, 0.5], badge: 'Admins only' },
      { title: 'See the year', body: 'View Analytics, at the bottom of Home, opens Data insights: total revenue, the change on the previous period, the months, revenue by event type and each member’s year.', shot: 'analytics', region: [0.07, 0.49], badge: 'Data insights' },
    ],
  },
  demo: {
    kind: 'money',
    heading: { lines: ['Play the gig.', 'Pay the band.'] },
    lead: 'Client A — Wedding is over. Tick off Leo, Sara, Nico, Tom and Ivo M., the deputy on keys, one by one or all at once. Then switch to Sara’s phone and see what she sees.',
  },
  roles: {
    heading: { lines: ['Admins see it all.', 'You see yours.'] },
    lead: 'Members and deputies see their own fee and whether it was paid. Never the band fee, other people’s fees, the client or the band’s finances. The database enforces it, not only the app.',
    rows: [
      { what: 'Sets and changes fees', admin: true, member: false, deputy: false },
      { what: 'Sees a fee on the gig', admin: 'Everyone’s', member: 'Their own', deputy: 'Fee offered' },
      { what: 'Sees the band fee, band fund and deposit', admin: true, member: false, deputy: false },
      { what: 'Sees payouts due after the show', admin: 'Everyone owed', member: 'Their own', deputy: 'Their own' },
      { what: 'Marks musicians paid', admin: true, member: false, deputy: false },
      { what: 'Sees revenue and the band ledger', admin: true, member: false, deputy: false },
      { what: 'Opens Analytics', admin: true, member: false, deputy: false },
    ],
  },
  details: {
    heading: { lines: ['The fine print', 'on money.'] },
    lead: 'Three things to know first. The other four are sorted by gig and by year.',
    featured: [
      {
        title: 'Two kinds of revenue',
        tag: 'On Home',
        body: 'REVENUE on Home adds up this year’s gig fees; Money flow adds up the income you record.',
        ui: { shot: 'basics-home-admin', region: [0.15, 0.5], alt: 'Home for an admin: 4 confirmed gigs, 2 upcoming rehearsals, 1 active quote and €13.2K of revenue' },
      },
      {
        title: 'Members see their own',
        tag: 'A member’s Home',
        body: 'Your payouts shows what you’re owed, with View payout. Never the band fee, never anyone else’s.',
        ui: { shot: 'quote-hold-card', region: [0.5, 0.82], alt: 'A member’s Home, Your payouts: Summer Fest Opening, You’re owed $300, not paid yet, with View payout' },
      },
      {
        title: 'The band fund',
        tag: 'Musicians plus band',
        body: 'The band fee is the musicians’ fees plus any extra band fee. What isn’t paid out stays with the band.',
        ui: { shot: 'gig-wizard-step1', region: [0.566, 0.886], alt: 'The gig wizard’s roster: Leo M., Marta C., Jonah R. and Lena P., each with a fee' },
      },
    ],
    groups: [
      {
        label: 'Gig by gig',
        items: [
          { title: 'Fee to be discussed', line: 'Confirm the date now and the money later: the gig shows To be discussed until you set it.' },
          { title: 'A fee change reaches one person', line: 'Change a musician’s fee and only that musician is notified.' },
        ],
      },
      {
        label: 'Across the year',
        items: [
          { title: 'Member stats', line: 'Each musician’s year: gigs played and coming up, rehearsals, earnings and what’s not paid yet.' },
          { title: 'Your currency', line: 'EUR, USD, GBP or CHF, with your country’s VAT rate. Each quote keeps the currency it was made in.' },
        ],
      },
    ],
  },
  learn: [
    { id: 'fee-and-payouts-on-a-gig', title: 'Fee and payouts on a gig', line: 'The band fee, each musician’s fee, and who’s paid.' },
    { id: 'payouts-due', title: 'Payouts due', line: 'Who the band still owes, and marking them paid.' },
    { id: 'gig-lineup-and-fees', title: 'Lineup and fees', line: 'Fees in the gig wizard, Fee TBD and the band fee.' },
    { id: 'money-on-home', title: 'Money on Home', line: 'Revenue, your pay and the Money flow ledger.' },
    { id: 'analytics', title: 'Analytics', line: 'The band’s year in numbers.' },
    { id: 'what-members-see-of-money', title: 'What members see', line: 'Their own fee and whether it was paid.' },
  ],
};

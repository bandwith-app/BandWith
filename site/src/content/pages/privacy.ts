import type { ChannelPage } from './types';

export const page: ChannelPage = {
  slug: 'privacy',
  title: 'Privacy by role',
  description: 'Admins see the whole deal. Members see their own fee and the logistics. Deputies see only their request, and the street address after a yes. The server enforces it.',
  ogTitle: 'Privacy by role · Everyone sees their part.',
  hero: {
    heading: { lines: ['Everyone sees', 'their part.'], em: 'part.' },
    lead: 'Admins run the deal. Members get what they need to play, and their own fee. Deputies get only their request. The rules live on the server, so a phone never receives what its owner shouldn’t see.',
    chips: [
      { icon: 'shield', label: 'Enforced by the server' },
      { icon: 'wallet', label: 'Your own fee' },
      { icon: 'map-pin', label: 'Address after a yes' },
      { icon: 'download', label: 'Export your data' },
    ],
    shot: 'gig-workspace-member',
    region: [0.36, 0.84],
    alt: 'A member’s view of Client A — Wedding on a phone: call times and Show readiness 3/4, with no contract or deposit line',
  },
  flow: {
    heading: { lines: ['Three views,', 'and your own.'] },
    steps: [
      { title: 'Admins run the deal', body: 'The admin sees the whole gig: the client, the band fee, the deposit, the contract and every musician’s fee. Show readiness counts the contract and the deposit too.', shot: 'gig-workspace-admin', region: [0.47, 0.97], badge: 'Readiness 5/6' },
      { title: 'Members get their part', body: 'A member sees the times, the venue and address, the lineup and its answers, the setlist and rider to read, and their own fee. Never the client, the band fee or anyone else’s fee.', shot: 'gig-workspace-member', region: [0.47, 0.84], badge: 'Readiness 3/4' },
      { title: 'Deputies get the request', body: 'A deputy sees only what they’re asked: date, times, venue, city, role and the fee offered. The street address arrives after they say yes. Nothing else of the band.', shot: 'people-deputy-gigs', region: [0.12, 0.47], badge: 'Fee offered' },
      { title: 'Your data, your account', body: 'In Privacy & account, export a JSON copy of your data, read the Terms and Privacy Policy, or delete your account. Your personal gigs stay yours: bands only see that you’re busy.', shot: 'basics-settings-privacy', region: [0.08, 0.5], badge: 'JSON copy' },
    ],
  },
  demo: {
    kind: 'privacy',
    heading: { lines: ['Pick a role.', 'See their phone.'] },
    lead: 'This is Client A — Wedding as each phone receives it. Switch between Leo, Sara and Ivo: rows the role never gets go dark, and Ivo’s address waits for his yes.',
  },
  roles: {
    heading: { lines: ['Row by row.', 'Role by role.'] },
    lead: 'Members and deputies see only their own fee and the logistics. They never see other people’s fees, the client, quote totals or the band’s finances.',
    rows: [
      { what: 'Date, call times and venue', admin: true, member: true, deputy: true },
      { what: 'Street address', admin: true, member: true, deputy: 'After a yes' },
      { what: 'Fees', admin: 'Everyone’s', member: 'Their own', deputy: 'Fee offered' },
      { what: 'Client, band fee, deposit, quote and contract', admin: true, member: false, deputy: false },
      { what: 'Lineup and answers', admin: true, member: 'Without fees', deputy: false },
      { what: 'Setlist and rider', admin: 'Edit', member: 'Read-only', deputy: false },
      { what: 'Direct messages', admin: 'Anyone in the band', member: 'Admins only', deputy: false },
    ],
  },
  details: {
    heading: { lines: ['Not hidden.', 'Never sent.'], em: 'sent.' },
    items: [
      { icon: 'shield', title: 'Enforced by the server', body: 'Money, quote prices, contracts and other people’s fees are protected by the database, not only hidden in the app. A member’s phone never receives them.', wide: true },
      { icon: 'refresh', title: 'New role, fresh copy', body: 'When a role changes, the phone drops what it kept of the band and loads it again. A former admin no longer keeps the client and prices on the phone.' },
      { icon: 'message-circle', title: 'Who can message whom', body: 'Admins write to anyone in the band. Members write directly only to admins, and talk to each other in the band or gig chat. Deputies are in no chat.' },
      { icon: 'eye-off', title: 'Statistics only with a yes', body: 'In the iPhone and Android apps, Anonymous usage statistics stays off until you say yes. It counts which screens are used, never your songs, gigs or messages, and nothing for ads.' },
      { icon: 'lock', title: 'App lock', body: 'Face ID, fingerprint or the device passcode when BandWith starts again after being closed. On by default on iPhone, iPad and Android.' },
      { icon: 'download', title: 'Export, or delete', body: 'Export my data saves a JSON copy of your profile, bands, personal gigs and gig answers. Delete account removes your profile, personal gigs and direct messages for good; your band and gig chat messages stay, shown as from a Former member. The only admin of a band makes someone else admin first.', wide: true },
    ],
  },
  learn: [
    { id: 'who-sees-what', title: 'Who sees what', line: 'Every kind of band data, role by role.' },
    { id: 'what-members-see-on-a-gig', title: 'On a gig', line: 'The privacy rules of a gig, field by field.' },
    { id: 'what-members-see-of-money', title: 'Money', line: 'Your own fee, and nothing else of the band’s money.' },
    { id: 'deputies-on-a-gig', title: 'What a deputy sees', line: 'The request, the fee offered, the address after a yes.' },
    { id: 'who-can-message-whom', title: 'Who can message whom', line: 'The chat rules for each role.' },
    { id: 'privacy-and-account-settings', title: 'Privacy & account', line: 'App lock, export your data, delete your account.' },
  ],
};

import type { ChannelPage } from './types';

export const page: ChannelPage = {
  slug: 'privacy',
  title: 'Privacy by role',
  description: 'Admins see the whole deal. Members see their own fee and the logistics. Deputies see only their request, and the address after a yes. The server enforces it.',
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
    lead: 'Three things to know first. The other six are sorted by role, by phone and by report.',
    featured: [
      {
        title: 'A hold, not the quote',
        tag: 'What a member sees',
        body: 'While a gig is still a quote, members see only Possible gig – keep the date free, with the day, time and place.',
        ui: { shot: 'quote-hold-card', region: [0.12, 0.48], alt: 'A member’s Home: Possible gig – keep the date free, Mon Dec 7, 22:00–01:00 at The Blue Room, New York, with I’m free and I can’t' },
      },
      {
        title: 'Offline copies stay yours',
        tag: 'On this device only',
        body: 'Setlists kept for no signal hold lyrics, chords and your own notes, never fees or contracts. Removed the day after the gig.',
        ui: { shot: 'settings-offline-live', region: [0, 0.36], alt: 'Settings, Offline & live: lyrics, chords and your own notes on this device, no fees, no contracts, with Automatic download on' },
      },
      {
        title: 'Export, or delete',
        tag: 'Your account',
        body: 'Export my data saves a JSON copy of your profile, bands, personal gigs and gig answers. Delete account removes your profile for good.',
        ui: { shot: 'basics-settings-privacy', region: [0.225, 0.59], alt: 'Privacy & account: Export my data as a JSON copy, the terms, the privacy policy, and Delete account' },
      },
    ],
    groups: [
      {
        label: 'Between roles',
        items: [
          { title: 'Enforced by the server', line: 'Money, quote prices and contracts are protected by the database. A member’s phone never receives them.' },
          { title: 'Who can message whom', line: 'Admins write to anyone. Members write directly only to admins. Deputies are in no chat.' },
        ],
      },
      {
        label: 'On your phone',
        items: [
          { title: 'New role, fresh copy', line: 'When a role changes, the phone drops what it kept of the band and loads it again.' },
          { title: 'App lock', line: 'Face ID, fingerprint or the passcode when BandWith starts again. On by default on iPhone, iPad and Android.' },
        ],
      },
      {
        label: 'What the app reports',
        items: [
          { title: 'Error reports you can switch off', line: 'On by default: the error, no name, email or account id, deleted after 14 days. Off with Send crash reports.' },
          { title: 'Statistics only with a yes', line: 'Anonymous usage statistics stays off until you say yes. Crash details go to Firebase Crashlytics only with that yes.' },
        ],
      },
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

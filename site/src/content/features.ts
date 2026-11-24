/**
 * The site's eleven channels: one page per main function of the app.
 * `shot` = an Academy capture id (academy/public/shots/<shot>@<device>.webp),
 * `crop` = the part of its phone capture that previews the channel.
 * `academy` = article ids linked from the page (checked by features.test.ts).
 */
export type Accent = 'gig' | 'rehearsal' | 'quote' | 'personal';
/**
 * The menu's groups: three verbs in the order of a band's week, then what is
 * true on every page. A group has a promise (one line) and its pages in the
 * order the menu shows them (not CH order).
 */
export type Group = 'Book & get paid' | 'Line up the band' | 'Play the show' | 'Built in';
export type MenuGroup = {
  name: Group;
  /** "01"–"03" for the three verbs; the last group has a word instead. */
  no: string;
  promise: string;
  slugs: string[];
};
export const MENU: MenuGroup[] = [
  { name: 'Book & get paid', no: '01', promise: 'From the first quote to the last payout.', slugs: ['calendar-gigs', 'quotes-contracts', 'money'] },
  { name: 'Line up the band', no: '02', promise: 'One date, the right players, one conversation.', slugs: ['rehearsals-polls', 'people', 'chat'] },
  { name: 'Play the show', no: '03', promise: 'The same song on every phone, signal or not.', slugs: ['songs', 'stage', 'stage-plot-rider'] },
  { name: 'Built in', no: 'Always', promise: 'True on every page above.', slugs: ['privacy', 'devices'] },
];
export const GROUPS: Group[] = MENU.map((g) => g.name);

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
  /** Three things it does, for the home channel explorer (Academy-checked wording). */
  points: [string, string, string];
  /** The Academy article the explorer links to. */
  guide: string;
  live: boolean;
  academy: string[];
};

export const CHANNELS: Channel[] = [
  { ch: 1, slug: 'calendar-gigs', name: 'Calendar & gigs', short: 'Calendar', line: 'Every date, every call time.', accent: 'gig', shot: 'calendar-month', crop: [0.04, 0.5], group: 'Book & get paid', points: ['A month grid of gigs, rehearsals and quotes, filtered by band.', 'A three-step gig wizard: lineup and fees, date and venue, review.', 'One page per gig: call times, venue, forecast and show readiness.'], guide: 'gig-workspace', live: true, academy: ['calendar-overview', 'create-a-gig', 'free-slots-and-conflicts', 'gig-workspace', 'show-readiness', 'gig-notifications'] },
  { ch: 2, slug: 'quotes-contracts', name: 'Quotes & contracts', short: 'Quotes', line: 'Quotes the client confirms with a tap.', accent: 'quote', shot: 'quote-client-confirmation', crop: [0, 0.31], group: 'Book & get paid', points: ['A priced quote in three steps, with your logo and terms.', 'The client accepts, declines or asks on a personal page, no account needed.', 'An accepted quote becomes the gig; contracts are sent and marked signed.'], guide: 'client-quote-page', live: true, academy: ['create-a-quote', 'share-a-quote', 'client-quote-page', 'client-confirmation', 'quote-to-gig', 'create-a-contract'] },
  { ch: 3, slug: 'money', name: 'Fees & payouts', short: 'Money', line: 'Everyone knows what they’re owed.', accent: 'gig', shot: 'analytics', crop: [0.04, 0.5], group: 'Book & get paid', points: ['Each musician’s fee on every gig, or Fee TBD until it’s set.', 'Payouts due after the show, ticked off as paid.', 'Revenue, analytics and member stats for the admins.'], guide: 'payouts-due', live: true, academy: ['fee-and-payouts-on-a-gig', 'payouts-due', 'gig-lineup-and-fees', 'money-on-home', 'analytics', 'what-members-see-of-money'] },
  { ch: 4, slug: 'rehearsals-polls', name: 'Rehearsals & polls', short: 'Rehearsals', line: 'Find the date in one round.', accent: 'rehearsal', shot: 'shot-poll-card', crop: [0.13, 0.44], group: 'Line up the band', points: ['An availability poll with a few dates and a vote-by time.', 'Lock in the winning date and the rehearsal is created.', 'Songs to work on and prep tasks on every rehearsal.'], guide: 'create-a-rehearsal-poll', live: true, academy: ['create-a-rehearsal-poll', 'vote-in-a-rehearsal-poll', 'lock-in-a-poll-date', 'create-a-rehearsal', 'propose-a-rehearsal', 'the-rehearsal-page'] },
  { ch: 5, slug: 'chat', name: 'Band chat', short: 'Chat', line: 'Talk next to the plans.', accent: 'personal', shot: 'shot-event-chat', crop: [0.1, 0.6], group: 'Line up the band', points: ['A band chat, a chat for each gig or rehearsal, and direct messages.', 'The event’s times pinned on top of its chat.', 'Replies, mentions and read receipts.'], guide: 'event-and-rehearsal-chats', live: true, academy: ['the-chat-inbox', 'event-and-rehearsal-chats', 'send-and-reply-to-messages', 'who-can-message-whom', 'message-receipts-and-online-status', 'rehearsal-and-chat-notifications'] },
  { ch: 6, slug: 'songs', name: 'Songs & setlists', short: 'Songs', line: 'Charts, keys and setlists, ready to play.', accent: 'gig', shot: 'music-setlist-editor', crop: [0.27, 0.8], group: 'Play the show', points: ['The band’s songs with keys, lyrics, chords and who sings what.', 'Setlists built from the library and changed right on the gig.', 'Charts from iReal Pro, transposed on your screen, with your own notes.'], guide: 'build-a-setlist', live: true, academy: ['read-a-song', 'transpose-and-tempo', 'import-from-ireal-pro', 'my-notes-and-files', 'build-a-setlist', 'edit-a-gig-setlist', 'voice-parts', 'mark-voice-parts', 'who-sings-what'] },
  { ch: 7, slug: 'stage', name: 'Stage mode', short: 'Stage', line: 'One song on every phone.', accent: 'gig', shot: 'music-stage', crop: [0, 0.52], group: 'Play the show', points: ['The leader moves to the next song and every phone follows.', 'A count-in on every phone, then a visual click on the beat.', 'Setlists on the phone and Bluetooth sync when the venue has no signal.'], guide: 'stage-mode', live: true, academy: ['stage-mode', 'lead-stage-mode', 'follow-in-stage-mode', 'stage-click', 'count-in', 'follow-the-tempo', 'stage-bluetooth-sync', 'stage-mode-on-devices', 'live-mode-offline', 'offline-and-live-settings', 'offline-members-ready', 'changes-without-signal'] },
  { ch: 8, slug: 'stage-plot-rider', name: 'Stage plot & rider', short: 'Rider', line: 'The venue knows before you arrive.', accent: 'quote', shot: 'gig-workspace-admin', crop: [0.47, 0.96], group: 'Play the show', points: ['The stage plot, drawn with a finger.', 'The input list and who brings what.', 'Rider versions shared with the venue as a link.'], guide: 'rider-and-stage', live: true, academy: ['rider-and-stage', 'contract-riders', 'show-readiness', 'contracts-and-docs', 'create-a-gig-on-ipad', 'gig-workspace'] },
  { ch: 9, slug: 'people', name: 'Members, deputies & gear', short: 'People', line: 'Who plays, who covers, who brings what.', accent: 'personal', shot: 'people-find-deputy', crop: [0.29, 0.76], group: 'Line up the band', points: ['Invite members by name, email, link or code.', 'Ask a deputy who plays the part, in the app or by message.', 'Gear with status and owner, packed into kits for each kind of gig.'], guide: 'find-a-deputy', live: true, academy: ['invite-members', 'member-roles', 'deputies', 'ask-a-deputy', 'deputy-reply-page', 'gear-inventory'] },
  { ch: 10, slug: 'privacy', name: 'Privacy by role', short: 'Privacy', line: 'Everyone sees their part. Only theirs.', accent: 'gig', shot: 'gig-workspace-member', crop: [0.36, 0.84], group: 'Built in', points: ['Admins run the deal: client, quote, contract and every fee.', 'Members see their own fee and the logistics.', 'Deputies see only the request, and the address after a yes.'], guide: 'what-members-see-on-a-gig', live: true, academy: ['who-sees-what', 'what-members-see-on-a-gig', 'what-members-see-of-money', 'deputies-on-a-gig', 'who-can-message-whom', 'privacy-and-account-settings'] },
  { ch: 11, slug: 'devices', name: 'Every device', short: 'Devices', line: 'Phone, iPad, Surface Duo and the web.', accent: 'rehearsal', shot: 'calendar-month', crop: [0, 0.46], group: 'Built in', points: ['iPhone and Android apps, and the web in any browser.', 'Two panes side by side on iPad.', 'Dual-screen phones in every posture.'], guide: 'calendar-on-tablet-and-duo', live: true, academy: ['device-differences', 'ipad-layout', 'duo-laptop-pose', 'using-the-web-app', 'android-app', 'offline-mode', 'offline-and-live-settings', 'changes-without-signal'] },
];

export const pad2 = (n: number) => String(n).padStart(2, '0');
export const channelUrl = (c: Channel) => `/features/${c.slug}/`;
export const bySlug = (slug: string) => CHANNELS.find((c) => c.slug === slug);
/** A group's channels, in the menu's order. */
export const channelsOf = (g: MenuGroup) => g.slugs.map((slug) => bySlug(slug)!);

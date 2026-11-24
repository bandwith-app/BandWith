import type { ChannelPage } from './types';

export const page: ChannelPage = {
  slug: 'chat',
  title: 'Band chat',
  description: 'One chat for the band, one for each gig or rehearsal with its times pinned on top, and direct messages with the admins. Replies, mentions and read receipts.',
  ogTitle: 'Band chat · Talk next to the plans.',
  hero: {
    heading: { lines: ['Talk next to', 'the plans.'], em: 'plans.' },
    lead: 'A band chat, a chat for each gig or rehearsal, and direct messages with the admins. Every event chat keeps the day, the load-in time and the place on top, one tap from the gig.',
    chips: [
      { icon: 'users', label: 'Band chat' },
      { icon: 'calendar', label: 'Event chats' },
      { icon: 'message-circle', label: 'Direct messages' },
      { icon: 'check', label: 'Read receipts' },
    ],
    shot: 'shot-event-chat',
    region: [0, 0.31],
    alt: 'The event chat of Rooftop Session on a phone: Today, load-in 17:00, Terrazza Aurora, and a message read by everyone',
  },
  flow: {
    heading: { lines: ['Four ways', 'to say it.'] },
    steps: [
      { title: 'One inbox', body: 'Tap Chat in the bottom bar. Band, event and direct chats share one list, unread first, with ALL, DIRECT, BANDS and EVENTS. Search finds chats, people and words in messages.', shot: 'shot-chat-inbox', region: [0.1, 0.5], badge: '2 unread' },
      { title: 'A chat for each gig', body: 'Open a gig or rehearsal and tap EVENT CHAT or REHEARSAL CHAT. The lineup and the admins are in it. The strip on top shows the day, the load-in or start time and the place: tap it to open the event.', shot: 'shot-event-chat', region: [0, 0.3], badge: 'Load-in 17:00' },
      { title: 'Reply, mention, read', body: 'Swipe a message to the right to reply to it. Type @ and a name to mention someone. Two coloured ticks mean everyone in the chat has read it.', shot: 'shot-event-chat', region: [0.14, 0.4], badge: 'Read' },
      { title: 'Straight to an admin', body: 'Tap + for a new chat: DIRECT, BAND or EVENT. Admins can message anyone in their bands, members message the admins. Two members talk in the band or event chat.', shot: 'shot-chat-inbox', region: [0, 0.28], badge: 'New chat' },
    ],
  },
  demo: {
    kind: 'chat',
    heading: { lines: ['Say it once.', 'Where it belongs.'], em: 'belongs.' },
    lead: 'You’re Sara, in the chat of Saturday’s wedding at Villa Necchi. Send a message and watch the ticks, reply to Leo, mention Nico. Then try to message Nico directly.',
  },
  roles: {
    heading: { lines: ['Everyone talks.', 'Admins reach all.'] },
    lead: 'Members talk in the band chat, in the events they play and with the admins. Deputies aren’t band members: the band reaches them through deputy requests in the app.',
    rows: [
      { what: 'Writes in the band chat', admin: true, member: true, deputy: false },
      { what: 'Opens a gig or rehearsal chat', admin: 'Any event of the band', member: 'After answering going', deputy: false },
      { what: 'Sends direct messages', admin: 'To anyone in their bands', member: 'To admins only', deputy: false },
      { what: 'Replies to a message, mentions someone', admin: true, member: true, deputy: false },
      { what: 'Gets a push for each new message', admin: true, member: true, deputy: false },
      { what: 'Sees who is online', admin: true, member: true, deputy: false },
    ],
  },
  details: {
    heading: { lines: ['Fewer threads.', 'Clear rules.'] },
    lead: 'Three things to know first. The other four are sorted by who is told and who has read.',
    featured: [
      {
        title: 'Times, never the fee',
        tag: 'On every event chat',
        body: 'The strip on top shows times, place and status. Never the fee or the client.',
        ui: { shot: 'shot-event-chat', region: [0, 0.32], alt: 'The Rooftop Session chat: a strip with today’s load-in at 17:00 at Terrazza Aurora, and a message about the setlist' },
      },
      {
        title: 'One chat per band, one per event',
        tag: 'No duplicates',
        body: 'If the chat already exists, BandWith opens it. People added to the lineup later join with the next message.',
        ui: { shot: 'shot-chat-inbox', region: [0.27, 0.55], alt: 'The chat inbox: the Velvet Static band chat, the Rooftop Session chat and a direct chat with Marta C.' },
      },
      {
        title: 'Find a chat, a person, a word',
        tag: 'From the inbox',
        body: 'Type two letters in Search chats and the results come grouped as Chats, People and Messages.',
        ui: { shot: 'shot-chat-inbox', region: [0, 0.27], alt: 'The chat inbox: the filters All, Direct, Bands and Events above the search field' },
      },
    ],
    groups: [
      {
        label: 'Getting through',
        items: [
          { title: 'A push for every message', line: 'Everyone else in the chat is told. No push for a chat you have open on screen.' },
          { title: 'Nothing typed is lost', line: 'With no connection a message waits in the chat, marked Waiting for connection, and sends itself later.' },
        ],
      },
      {
        label: 'Who has read',
        items: [
          { title: 'Ticks that mean everyone', line: 'In group chats the ticks change only when everyone has received or read the message.' },
          { title: 'A direct chat stays between two', line: 'BandWith never reuses it for someone else, so nobody else can read that history.' },
        ],
      },
    ],
  },
  learn: [
    { id: 'the-chat-inbox', title: 'The chat inbox', line: 'Every chat in one list, with filters and search.' },
    { id: 'event-and-rehearsal-chats', title: 'Event chats', line: 'A chat per gig or rehearsal, times on top.' },
    { id: 'send-and-reply-to-messages', title: 'Send, reply, mention', line: 'Answer one message, call someone in.' },
    { id: 'who-can-message-whom', title: 'Who can message whom', line: 'The rules for admins, members and deputies.' },
    { id: 'message-receipts-and-online-status', title: 'Ticks and online status', line: 'Sending, sent, delivered, read.' },
    { id: 'rehearsal-and-chat-notifications', title: 'Notifications', line: 'Who is told, and when a push arrives.' },
  ],
};

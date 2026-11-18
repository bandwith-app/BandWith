import type { ChannelPage } from './types';

export const page: ChannelPage = {
  slug: 'stage',
  title: 'Stage mode',
  description: 'Stage mode puts one song on every phone in the band. The leader moves, everyone follows, even without internet over Bluetooth. A visual click keeps you in time.',
  ogTitle: 'Stage mode · One song. Every phone.',
  hero: {
    heading: { lines: ['One song.', 'Every phone.'], em: 'phone.' },
    lead: 'On gig day the whole band opens the same black, glanceable screen: run of show, setlist, chords or lyrics. The leader moves to the next song and every phone follows.',
    chips: [
      { icon: 'play', label: 'Lead' },
      { icon: 'refresh', label: 'Follow' },
      { icon: 'timer', label: 'Visual click' },
      { icon: 'wifi-off', label: 'Works without Wi‑Fi' },
    ],
    shot: 'music-stage',
    region: [0, 0.52],
    alt: 'Stage mode on a phone: Rooftop Session at Terrazza Aurora, run of show and a setlist of 10 songs, live',
  },
  flow: {
    heading: { lines: ['Four moments', 'on stage.'] },
    steps: [
      { title: 'Go live', body: 'Open the gig and tap Play, or Go live from Home on gig day. The run of show sits on top: load in, soundcheck, show, end. The next one is lit.', shot: 'music-stage', region: [0, 0.4], badge: 'Live' },
      { title: 'The band follows you', body: 'As admin you lead: tap Next, Prev or any song and every phone moves with you, with the lyrics, chords or structure of the song. A member can look ahead alone, then tap Follow leader to catch up.', shot: 'music-reader', region: [0, 0.62], badge: 'Following leader' },
      { title: 'Count it in', body: 'Start the click and a glow flashes around the edge of every phone on the beat, brighter on one. It’s visual only, no sound, and the phones stay within about 20–40 ms of each other.', shot: 'music-stage', region: [0.76, 1], badge: 'Click · 100 BPM' },
      { title: 'No signal? Still in sync.', body: 'Open the gig once while online and the setlist, charts and the gig’s Bluetooth key stay on the phone. In a basement with no signal, the leader’s phone keeps the band on the same song over Bluetooth. No pairing.', shot: 'music-stage', region: [0.33, 0.66], badge: 'Bluetooth' },
    ],
  },
  demo: {
    kind: 'stage',
    heading: { lines: ['You lead.', 'They follow.'] },
    lead: 'This is Leo’s phone, and the band’s. Move the song, strike one off, start the click. Then pull the venue Wi‑Fi and watch who keeps up.',
  },
  roles: {
    heading: { lines: ['Admins lead.', 'Members play.'] },
    lead: 'Stage mode is for the band’s own gigs, and as Live mode for its rehearsals. Deputies get the gig’s times and their part, not the band’s setlists.',
    rows: [
      { what: 'Opens Stage mode on a gig, Live mode on a rehearsal', admin: 'As leader', member: 'As follower', deputy: false },
      { what: 'Moves the current song for everyone', admin: true, member: false, deputy: false },
      { what: 'Reorders the set live, strikes songs off tonight', admin: true, member: false, deputy: false },
      { what: 'Starts the click', admin: 'On every phone', member: 'On their own phone', deputy: false },
      { what: 'Steps through songs alone, then follows again', admin: { dash: 'Leads' }, member: true, deputy: false },
      { what: 'Transposes for their own screen', admin: true, member: true, deputy: false },
    ],
  },
  details: {
    heading: { lines: ['Made for', 'a dark stage.'] },
    items: [
      { icon: 'eye', title: 'The screen stays awake', body: 'For as long as Stage mode is open. Keep the leader’s phone unlocked: a locked leader stops the band’s sync.', wide: true },
      { icon: 'minus', title: 'Strike a song tonight', body: 'Tap − at the end of a row. Prev and Next jump over it, on every phone. The gig’s setlist keeps it. Hold and drag a row to reorder.' },
      { icon: 'calendar', title: 'Rehearsals too', body: 'On an upcoming rehearsal it’s Live mode: the focus songs, chords, the click and the leader. No run of show.' },
      { icon: 'shield', title: 'A secret key per gig', body: 'Only the band’s active members get it. Only phones with the key find the leader over Bluetooth.' },
      { icon: 'music', title: 'Your key, your screen', body: 'Transpose for yourself with − key +. Nobody else’s chart changes.' },
      { icon: 'timer', title: 'A click for the eyes', body: 'Right for a count-in and a tempo reference, not for in-ears. It runs from the song’s BPM, and needs the internet: it isn’t sent over Bluetooth.', wide: true },
    ],
  },
  learn: [
    { id: 'stage-mode', title: 'Stage mode', line: 'What’s on the screen, and how to open it.' },
    { id: 'lead-stage-mode', title: 'Lead the band', line: 'Move the song, reorder live, strike songs off.' },
    { id: 'follow-in-stage-mode', title: 'Follow the leader', line: 'Let the admin turn your songs, or step alone.' },
    { id: 'stage-click', title: 'Use the click', line: 'A visual metronome in time across the band.' },
    { id: 'stage-bluetooth-sync', title: 'Without internet', line: 'Bluetooth sync, and what to do before the gig.' },
    { id: 'stage-mode-on-devices', title: 'On every device', line: 'Phones, tablets and each Duo posture.' },
  ],
};

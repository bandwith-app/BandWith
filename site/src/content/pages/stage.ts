import type { ChannelPage } from './types';

export const page: ChannelPage = {
  slug: 'stage',
  title: 'Stage mode',
  description: 'Stage mode puts one song on every phone. The leader moves and everyone follows, with a count-in, a visual click and the setlist ready for no signal.',
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
      { title: 'Count it in', body: 'As leader, tap Count in: every phone shows a full-screen countdown on the same beat, then GO. Start the click and a glow flashes around the edge of every phone, brighter on one. The click makes no sound, and the phones stay within about 20–40 ms of each other.', shot: 'music-stage', region: [0.76, 1], badge: 'Click · 100 BPM' },
      { title: 'No signal? Still in sync.', body: 'Say yes once and the phone apps download the setlists of your next 7 days: lyrics, chords, your notes and the gig’s Bluetooth key. In a basement with no signal, the leader’s phone keeps the band on the same song and the same click over Bluetooth. No pairing.', shot: 'music-stage', region: [0.33, 0.66], badge: 'Bluetooth' },
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
      { what: 'Counts the band in', admin: 'On every phone', member: false, deputy: false },
      { what: 'Starts Follow the tempo, repeats a section', admin: true, member: 'Follows', deputy: false },
      { what: 'Steps through songs alone, then follows again', admin: { dash: 'Leads' }, member: true, deputy: false },
      { what: 'Transposes for their own screen', admin: true, member: true, deputy: false },
      { what: 'Plays the songs’ audio as stage manager', admin: 'One device', member: false, deputy: false },
      { what: 'Sees who has the setlist for no signal, reminds the rest', admin: true, member: false, deputy: false },
    ],
  },
  details: {
    heading: { lines: ['Made for', 'a dark stage.'] },
    lead: 'Three things to know first. The other ten are sorted by when you reach for them.',
    featured: [
      {
        title: 'Follow the tempo',
        tag: 'Leader starts it',
        body: 'Your page moves with the leader’s phone. The bar being played is lit, and a strip says what comes next.',
        ui: { fragment: 'stage-tempo' },
      },
      {
        title: 'Ready before the gig',
        tag: 'Each member, once',
        body: 'Say yes once and the phone apps keep every setlist of the next 7 days. Admins see who is ready and remind the rest.',
        ui: { fragment: 'stage-offline' },
      },
      {
        title: 'The stage manager plays the songs',
        tag: 'One admin’s laptop',
        body: 'Cabled to the mixer, it plays each recording with no internet. Every screen jumps to the song. Phones never make a sound.',
        ui: { fragment: 'stage-manager' },
      },
    ],
    groups: [
      {
        label: 'Keeping time',
        items: [
          { title: 'Count-in, your way', line: 'One or two bars in the song’s own meter, then GO. Add Vibrate on every beat or Sound in headphones.' },
          { title: 'A click for the eyes', line: 'A tempo reference from the song’s BPM: a glow on the edge of the screen, never a sound.' },
        ],
      },
      {
        label: 'On your own screen',
        items: [
          { title: 'Your lines, lit', line: '2nd voice, Backing, All and Spoken each look their own way. Highlight my part dims the rest.' },
          { title: 'Your key, your screen', line: 'Transpose for yourself with − key +. Nobody else’s chart changes.' },
          { title: 'Full screen is the song', line: 'Song only: its number and title, then the words, chords or chart.' },
          { title: 'Hands on the instrument', line: 'Only Prev, the click and Next at the bottom. Arrow keys step too, so a page-turner pedal works.' },
        ],
      },
      {
        label: 'Running the set',
        items: [
          { title: 'Strike a song tonight', line: 'Tap − on a row. Prev and Next jump over it on every phone; the gig’s setlist keeps it.' },
          { title: 'The screen stays awake', line: 'For as long as Stage mode is open. Keep the leader’s phone unlocked.' },
          { title: 'A secret key per gig', line: 'Only the band’s active members get it, and only their phones find the leader over Bluetooth.' },
          { title: 'Rehearsals too', line: 'On a rehearsal it’s Live mode: the focus songs, chords, the click, plus the timer and notes.' },
        ],
      },
    ],
  },
  learn: [
    { id: 'stage-mode', title: 'Stage mode', line: 'What’s on the screen, and how to open it.' },
    { id: 'lead-stage-mode', title: 'Lead the band', line: 'Move the song, reorder live, strike songs off.' },
    { id: 'follow-in-stage-mode', title: 'Follow the leader', line: 'Let the admin turn your songs, or step alone.' },
    { id: 'stage-click', title: 'Use the click', line: 'A visual metronome in time across the band.' },
    { id: 'count-in', title: 'Count the band in', line: 'A countdown on every phone before the song.' },
    { id: 'follow-the-tempo', title: 'Follow the tempo', line: 'The page moves with the leader, bar by bar.' },
    { id: 'live-mode-offline', title: 'Without signal', line: 'Say yes once: your next gigs stay on the phone.' },
    { id: 'offline-members-ready', title: 'Who is ready', line: 'See who has the setlist offline, and remind the rest.' },
    { id: 'stage-bluetooth-sync', title: 'Without internet', line: 'Bluetooth sync, and what to do before the gig.' },
    { id: 'stage-manager', title: 'Stage manager', line: 'Play each song’s recording from the mixer.' },
  ],
};

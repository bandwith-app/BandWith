import type { ChannelPage } from './types';

export const page: ChannelPage = {
  slug: 'songs',
  title: 'Songs & setlists',
  description: 'One library for the band’s songs, with keys, tempos, lyrics, chords and recordings. Admins build the setlists and change them right on the gig. Everyone transposes on their own screen.',
  ogTitle: 'Songs & setlists · Ready to play.',
  hero: {
    heading: { lines: ['The band’s songs.', 'Ready to play.'], em: 'play.' },
    lead: 'Keys, tempos, lyrics with chords, charts from iReal Pro and the band’s recordings, in one library every member can read. Admins build the setlists. Each player reads the song their way, in the key they need.',
    chips: [
      { icon: 'music', label: 'Lyrics & chords' },
      { icon: 'sliders', label: 'Transpose for you' },
      { icon: 'list-music', label: 'Setlists & sets' },
      { icon: 'download', label: 'iReal Pro import' },
    ],
    shot: 'music-reader',
    region: [0, 0.58],
    alt: 'The song reader on a phone: Harbor Lights on the Chords tab, the key control, My notes and the first verse with chords above the words',
  },
  flow: {
    heading: { lines: ['From the library', 'to the stage.'] },
    steps: [
      { title: 'Fill the library', body: 'Add a song with just its title, then key, BPM, duration and genre if you want. Or import a CSV or text list of up to 2000 songs. Songs an admin adds start as Ready.', shot: 'music-repertoire', region: [0.3, 0.73], badge: '15 ready' },
      { title: 'Members suggest', body: 'A member suggests a new song, or a fix to the lyrics or chords. The admin sees Changes, Before and After, then taps Accept, Accept with changes or Reject. The band’s song stays the same until then.', shot: 'music-suggestions', region: [0.3, 0.7], badge: 'Waiting' },
      { title: 'Build the set', body: 'Tap Add songs from library…, filter by genre, tap songs in, drag them into order and tap Save setlist. Load it into a gig and the gig gets its own copy.', shot: 'music-setlist-editor', region: [0.28, 0.72], badge: '10 songs' },
      { title: 'Read it your way', body: 'Lyrics for the singer, Chords for guitar, keys and bass, Structure for drums and horns. Move the key with − and +: only your screen changes.', shot: 'music-reader', region: [0.05, 0.47], badge: 'Key of G' },
    ],
  },
  demo: {
    kind: 'songs',
    heading: { lines: ['Your key.', 'Same song.'] },
    lead: 'A made-up song in the band’s format. Switch between Lyrics, Chords and Structure, move the key up or down, and tap the key to go back. The band’s copy never moves.',
  },
  roles: {
    heading: { lines: ['Admins edit.', 'Everyone reads.'] },
    lead: 'Every active member reads every song and setlist. Changes to the band’s songs go through the admins. Deputies aren’t band members: they get their gigs, not the Repertoire.',
    rows: [
      { what: 'Reads every song, lyrics, chords and files', admin: true, member: true, deputy: false },
      { what: 'Adds songs, imports a song list', admin: 'As Ready', member: 'Suggests one at a time', deputy: false },
      { what: 'Edits a song, its chords, its key for the band', admin: true, member: 'Suggests a change', deputy: false },
      { what: 'Transposes on their own screen', admin: true, member: true, deputy: false },
      { what: 'Keeps private notes and files on a song', admin: 'Their own', member: 'Their own', deputy: false },
      { what: 'Builds, reorders and deletes setlists', admin: true, member: false, deputy: false },
      { what: 'Reads setlists, exports them as PDF', admin: true, member: true, deputy: false },
    ],
  },
  devices: {
    shot: 'music-reader',
    heading: { lines: ['One song.', 'Or the whole list.'] },
    lead: 'On a phone the song takes the screen. On an iPad, in a wide browser or on an open Duo, the Repertoire stays on one side and the song opens on the other. In Laptop pose the song fills the top half and its controls move to the bottom half.',
    tabs: [
      { dev: 'phone', cap: 'Phone · tabs, − key +, My notes, then the song.', alt: 'The song reader on a phone' },
      { dev: 'tablet', cap: 'iPad · the Repertoire in the list column, the song open beside it.', alt: 'The song reader beside the Repertoire on an iPad' },
      { dev: 'web', cap: 'Web · the same reader. The iReal Pro forum opens in its own window; paste the link back.', alt: 'The song reader in a web browser' },
      { dev: 'duoClosed', cap: 'Duo closed · one page; Back, Search and your profile sit in the rail.', alt: 'The song reader on a closed Surface Duo' },
      { dev: 'duoBook', cap: 'Duo book · the songs on the left page, the reader on the right.', alt: 'The song reader on a Surface Duo open like a book' },
    ],
  },
  details: {
    heading: { lines: ['Written for', 'the players.'] },
    items: [
      { icon: 'music', title: 'Words and chords in one text', body: 'A chord goes in brackets before its word: [Am]word. Paste a chords-over-lyrics sheet and the app merges it into inline chords. Section names in Italian, Spanish, French, German and Portuguese are understood.', wide: true },
      { icon: 'download', title: 'From iReal Pro', body: 'Tap a song or a playlist on the forum: the chords, form, key, style and tempo come in. No melody, no lyrics. ChordPro and MusicXML files work too.' },
      { icon: 'sliders', title: 'A chord editor', body: 'Admins tap a word to put a chord on it, drag a chord to move it, and copy a verse’s chords to another section.' },
      { icon: 'lock', title: 'My notes, mine only', body: 'Notes on a line, a word or a chord, and your own files. Nobody else sees them, admins included.' },
      { icon: 'timer', title: 'Find the tempo', body: 'Tap along, or work the BPM out from the recording. ÷2 and ×2 fix a half or double tempo.' },
      { icon: 'file-text', title: 'Setlists that travel', body: 'Split a setlist into sets and see the running time. Export it as a PDF with artist, key, BPM, duration and set. On a gig, admins reorder, add and remove songs right in the overview, and the lineup gets one push with what changed.', wide: true },
    ],
  },
  learn: [
    { id: 'read-a-song', title: 'Read a song', line: 'Lyrics, Chords and Structure, text size and key.' },
    { id: 'transpose-and-tempo', title: 'Transpose and tempo', line: 'For the whole band, or only on your screen.' },
    { id: 'import-from-ireal-pro', title: 'Import from iReal Pro', line: 'Chords, form, key and tempo from the forum.' },
    { id: 'my-notes-and-files', title: 'My notes and files', line: 'Private notes on a line, a word or a chord.' },
    { id: 'build-a-setlist', title: 'Build a setlist', line: 'Add songs from the library, order them, save.' },
    { id: 'edit-a-gig-setlist', title: 'Edit a gig’s setlist', line: 'Reorder, add and remove songs in the gig.' },
  ],
};

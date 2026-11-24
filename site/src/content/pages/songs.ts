import type { ChannelPage } from './types';

export const page: ChannelPage = {
  slug: 'songs',
  title: 'Songs & setlists',
  description: 'One library for the band’s songs: keys, tempos, lyrics with chords and who sings what. Admins build the setlists. Everyone transposes on their own screen.',
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
      { title: 'Read it your way', body: 'Lyrics for the singer, Chords for guitar, keys and bass, Structure for drums and horns. Move the key with − and +: only your screen changes. Singers get their own lines lit with Highlight my part.', shot: 'music-reader', region: [0.05, 0.47], badge: 'Key of G' },
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
      { what: 'Marks the voice parts, says who sings what', admin: true, member: 'Sees their part', deputy: false },
      { what: 'Keeps private notes and files on a song', admin: 'Their own', member: 'Their own', deputy: false },
      { what: 'Builds, reorders and deletes setlists', admin: true, member: false, deputy: false },
      { what: 'Reads setlists, exports them as PDF', admin: true, member: true, deputy: false },
    ],
  },
  details: {
    heading: { lines: ['Written for', 'the players.'] },
    lead: 'Three things to know first. The other six are sorted by where a song goes next.',
    featured: [
      {
        title: 'Words and chords in one text',
        tag: 'Lyrics & chords',
        body: 'A chord goes in brackets before its word: [Am]word. Paste a chords-over-lyrics sheet and the app merges it into inline chords.',
        ui: { shot: 'music-reader', region: [0.3, 0.62], alt: 'A song in the reader: Harbor Lights, verse 1, with the chords A, E, F♯m and D above the words' },
      },
      {
        title: 'Setlists that travel',
        tag: 'Sets, PDF, live edits',
        body: 'Split a setlist into sets and see the running time. Export a PDF. On a gig, the lineup gets one push with what changed.',
        ui: { shot: 'music-setlist-editor', region: [0.3, 0.66], alt: 'The setlist editor: Rooftop set, the library filtered by genre and two songs picked' },
      },
      {
        title: 'A chord editor',
        tag: 'Admins',
        body: 'Tap a word to put a chord on it, drag a chord to move it. The Voice row marks a line as Lead, 2nd voice, Backing, All or Spoken.',
        ui: { shot: 'voice-picker', region: [0.62, 0.95], alt: 'The chord editor’s Voice row: Whole line or Just these words, then Lead, 2nd voice, Backing, All and Spoken' },
      },
    ],
    groups: [
      {
        label: 'Getting songs in',
        items: [
          { title: 'From iReal Pro', line: 'Tap a song or a playlist on the forum: chords, form, key, style and tempo come in. ChordPro and MusicXML too.' },
          { title: 'Find the tempo', line: 'Tap along, or work the BPM out from the recording. Set the time signature and a count-in of 1 or 2 bars.' },
        ],
      },
      {
        label: 'Notes on the song',
        items: [
          { title: 'My notes, mine only', line: 'Notes on a line, a word or a chord, and your own files. Nobody else sees them, admins included.' },
          { title: 'Hold a line', line: 'Hold a lyric line and Note for me opens on it. At a rehearsal, Note for the band opens a band note.' },
        ],
      },
      {
        label: 'On the chart',
        items: [
          { title: 'From rehearsals', line: 'The band’s open notes from rehearsals sit above your own. On a Tempo or Key note, admins tap Set on the song.' },
          { title: 'Signs, not shorthand', line: 'Repeats, endings, segno, coda and fermatas. Under every chart, What the symbols mean explains each one.' },
        ],
      },
    ],
  },
  learn: [
    { id: 'read-a-song', title: 'Read a song', line: 'Lyrics, Chords and Structure, text size and key.' },
    { id: 'transpose-and-tempo', title: 'Transpose and tempo', line: 'For the whole band, or only on your screen.' },
    { id: 'import-from-ireal-pro', title: 'Import from iReal Pro', line: 'Chords, form, key and tempo from the forum.' },
    { id: 'my-notes-and-files', title: 'My notes and files', line: 'Private notes on a line, a word or a chord.' },
    { id: 'build-a-setlist', title: 'Build a setlist', line: 'Add songs from the library, order them, save.' },
    { id: 'chart-symbols', title: 'Chart symbols', line: 'What each sign in a chord chart means.' },
    { id: 'voice-parts', title: 'Voice parts', line: 'Lead, 2nd voice, Backing, All and Spoken in the lyrics.' },
    { id: 'who-sings-what', title: 'Who sings what', line: 'Name the singers of each part, for a song or for one gig.' },
  ],
};

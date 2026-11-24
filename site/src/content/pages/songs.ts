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
    items: [
      { icon: 'music', title: 'Words and chords in one text', body: 'A chord goes in brackets before its word: [Am]word. Paste a chords-over-lyrics sheet and the app merges it into inline chords. Section names in Italian, Spanish, French, German and Portuguese are understood.', wide: true },
      { icon: 'download', title: 'From iReal Pro', body: 'Tap a song or a playlist on the forum: the chords, form, key, style and tempo come in. No melody, no lyrics. ChordPro and MusicXML files work too.' },
      { icon: 'sliders', title: 'A chord editor', body: 'Admins tap a word to put a chord on it, drag a chord to move it, and copy a verse’s chords to another section. The Voice row marks a line, or a few words, as Lead, 2nd voice, Backing, All or Spoken.' },
      { icon: 'lock', title: 'My notes, mine only', body: 'Notes on a line, a word or a chord, and your own files. Nobody else sees them, admins included.' },
      { icon: 'timer', title: 'Find the tempo', body: 'Tap along, or work the BPM out from the recording. ÷2 and ×2 fix a half or double tempo. For Stage mode, set the time signature and a count-in of 1 or 2 bars.' },
      { icon: 'file-text', title: 'Setlists that travel', body: 'Split a setlist into sets and see the running time. Export it as a PDF with artist, key, BPM, duration and set. On a gig, admins reorder, add and remove songs right in the overview, and the lineup gets one push with what changed.', wide: true },
      { icon: 'list-music', title: 'From rehearsals', body: 'The song’s page shows the band’s open notes from rehearsals above your own. A Tempo or Key note that names the value gets a button: admins Set on the song, members Suggest to the band.', wide: true },
      { icon: 'message-circle', title: 'Hold a line', body: 'Hold a line of the lyrics and Note for me opens on it. In Live mode at a rehearsal, Note for the band opens a band note on that song, section and line.' },
      { icon: 'music', title: 'Signs, not shorthand', body: 'Repeats, endings, segno, coda and fermatas look the same in the reader and on stage. Under every chart, What the symbols mean explains each one.' },
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

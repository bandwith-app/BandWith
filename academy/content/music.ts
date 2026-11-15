import type { AreaModule } from './types';

/**
 * Repertoire, setlists & Stage. Derived from:
 * src/app/views/SetlistManagerView.tsx, src/app/components/rehearsal/AddSongModal.tsx,
 * ChordImportSheet.tsx, TempoKeyTools.tsx, ReceivedChartSheet.tsx,
 * src/app/components/songs/**, src/app/components/ui/LyricsViewer.tsx, SongViews.tsx,
 * Transpose.tsx, SongPicker.tsx, src/app/components/event/GigSetlistEditor.tsx,
 * useStageLive.ts, useStageBle.ts, src/app/components/dashboard/StageMode.tsx,
 * StageClick.tsx, src/app/components/duo/modes/FloorWedgeMode.tsx and
 * supabase/migrations 074, 085, 087_stage_keys, 103, 107, 108, 109.
 */
const music: AreaModule = {
  area: {
    id: "music",
    title: "Repertoire, setlists & Stage",
    intro:
      "Keep the band's songs in one library, build setlists for gigs, and read lyrics and chords on stage with everyone on the same song.",
    icon: "music",
  },

  articles: [
    // ───────────────────────────── Repertoire ─────────────────────────────
    {
      id: "repertoire-overview",
      title: "The Repertoire screen",
      summary: "Where the band's songs and setlists live, and what each part of the screen does.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["songs", "library", "catalogue", "repertoire", "song list", "readiness"],
      related: ["add-a-song", "song-menu-actions", "build-a-setlist", "music-what-members-can-do"],
      body: [
        {
          type: "p",
          text: "The Repertoire is the band's song library. Every song in it belongs to the band, and every active member of the band can read every song. Setlists are built from these songs.",
        },
        {
          type: "steps",
          title: "Open the Repertoire",
          items: [
            "On Home, tap the **Repertoire** tile under **Quick Actions**.",
            "Or tap your avatar at the top (**Open Identity and Account Hub**) and tap **Repertoire** under **Band assets & workflows**.",
          ],
        },
        {
          type: "list",
          title: "What is on the screen",
          items: [
            "**Songs** and **Setlists** at the top switch between the two lists. Each shows how many there are.",
            "The search field filters the list you are on: **Search songs, artists…** matches titles and artists, **Search setlists…** matches setlist names.",
            "The **Band repertoire** card shows the number of **Songs** and **Setlists**, the **Total duration** of all songs, and **Status readiness**: one dot per song, coloured by status, with the counts for **Ready**, **Learning** and **Suggested** below.",
            "Each song row shows the title, the artist and key, the duration and the BPM. A **Suggested** or **Learning** tag shows when the song is not ready yet.",
            "The round **Play** button at the left of a row plays the song's recording or opens its link. It is greyed out when the song has neither.",
            "Tap anywhere else on a song row to open its menu (see [[song-menu-actions]]).",
            "Above the songs, admins see **Suggestions from members** when something waits for review; members always see **My suggestions** (see [[review-song-suggestions]] and [[suggest-a-change-to-a-song]]).",
          ],
        },
        {
          type: "table",
          head: ["Status", "Meaning"],
          rows: [
            ["**Ready**", "The band plays it. Songs an admin adds or imports start here."],
            ["**Learning**", "The band is working on it. An approved suggestion starts here."],
            ["**Suggested**", "A member proposed it. It waits for an admin to approve or reject it."],
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Sees **Import song list** and **Add song** at the top right on the Songs list, and **New setlist** on the Setlists list. Can edit, change the status of and delete every song." },
            { role: "member", text: "Reads every song and setlist. The + button at the top right is **Suggest a song** on the Songs list; there is no button on the Setlists list." },
            { role: "deputy", text: "A deputy is not a band member and has no Repertoire. Deputies see only the gigs they were asked to play (see [[deputy-gigs]])." },
          ],
        },
        {
          type: "devices",
          rows: [
            { devices: ["tablet", "duoBook", "duoLand"], text: "The Repertoire is the list column. A setlist, a song form or the suggestions open beside it in the second pane." },
            { devices: ["duoLaptop"], text: "The **Band repertoire** card moves to the top half (the Display), and the lists stay on the bottom half." },
          ],
        },
        { type: "shot", id: "music-repertoire", caption: "The Repertoire with the Band repertoire card and the song list." },
      ],
    },
    {
      id: "add-a-song",
      title: "Add a song to the repertoire",
      summary: "Add a song in three short steps; only the title is required.",
      roles: ["admin"],
      kind: "task",
      keywords: ["new song", "create song", "add track", "song form"],
      related: ["song-fields", "suggest-a-song", "import-a-song-list", "import-chords-and-lyrics"],
      body: [
        {
          type: "steps",
          items: [
            "In the Repertoire, on **Songs**, tap **Add song** (the + button at the top right). With an empty library you can also tap **Add first song**.",
            "On step 1, **Song**, type the **Song title \\***. Add the **Original artist** if you know it. To bring in chords or lyrics now, tap **Import chords and lyrics** (see [[import-chords-and-lyrics]]).",
            "Tap **Next**. On step 2, **Details · optional**, fill in **Duration**, **BPM**, **Key** and **Genre** if you want.",
            "Tap **Next**. On step 3, **Files & links · optional**, add a recording, a chart, links, notes or lyrics.",
            "Tap **Add song**. The button turns into **Added!** and the form closes.",
          ],
        },
        {
          type: "p",
          text: "You can save at any step: tap **Add song now** under the fields to save with what you have so far.",
        },
        {
          type: "note",
          tone: "tip",
          text: "If a song with the same title and artist is already in the library, the form says “… is already in your library. Save again to add a second copy.” Tap the save button again only if you really want two copies.",
        },
        {
          type: "list",
          title: "What happens after you save",
          items: [
            "The song is added with the status **Ready**.",
            "Everyone else in the band gets a note in their notifications inbox (no push).",
            "Files you picked are uploaded when you save, into the band's private storage. If the save fails, they are removed again.",
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Adds songs straight into the library as **Ready**." },
            { role: "member", text: "Uses the same form, titled **Suggest a song**. The song is added as **Suggested** and waits for an admin. See [[suggest-a-song]]." },
          ],
        },
        {
          type: "devices",
          rows: [
            { devices: ["duoClosed"], text: "**Close** sits in the rail, under the clock, instead of the top right of the form." },
            { devices: ["tablet", "duoBook", "duoLand"], text: "The form opens in the second pane, beside the Repertoire." },
          ],
        },
      ],
    },
    {
      id: "song-fields",
      title: "Every field of a song",
      summary: "What each field in the song form does, with the limits that apply.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["song details", "bpm", "key", "duration", "genre", "recording", "chart", "youtube", "notes", "lyrics"],
      related: ["add-a-song", "transpose-and-tempo", "lyrics-and-chords-format", "play-a-song-recording"],
      body: [
        { type: "p", text: "The song form has three steps. Only the title is required; the other steps say “optional” and can be skipped." },
        {
          type: "table",
          head: ["Field", "What it does"],
          rows: [
            ["**Song title \\***", "The song's name. Required."],
            ["**Original artist**", "Shown under the title everywhere and used to spot duplicates."],
            ["**Import chords and lyrics**", "Brings in a chord chart and lyrics from the iReal Pro forum, a file or the clipboard. Once a chart is attached, a **Chord chart** card shows its key, style, tempo, bars and sections, with **Preview chords**, **Replace** and an X to remove it."],
            ["**Duration**", "Minutes and seconds in two boxes (min : sec). Used for setlist totals."],
            ["**BPM**", "Tempo, up to 3 digits. Stage mode's click uses it."],
            ["**Key**", "Free text, e.g. C maj. Shown in the list, on stage and in the reader's transpose control."],
            ["**Tap**, **BPM from the recording**, ÷2 / ×2", "Tools under BPM to find the tempo. See [[transpose-and-tempo]]."],
            ["**Transpose for the band**", "Moves the key, the chord chart and the chords in the lyrics for everyone. Shown only when there is something to transpose."],
            ["**Genre**", "Tags to pick from the band's genres, or a new one with the dashed **Genre** chip, then **Add genre**. Genres filter the library when you build a setlist."],
            ["**Recording**", "An audio file: MP3, M4A, WAV, max 50 MB."],
            ["**Chart / sheet music**", "A PDF or photo, max 20 MB."],
            ["**Choose files**", "Picks one or more files. The app sorts them into Recording or Chart by type. Files from iCloud Drive, Google Drive or Dropbox: tap **Choose files**, then **Browse**, and pick the app under Locations."],
            ["**YouTube video**", "A link to the song on YouTube. Must start with https://."],
            ["**Sheet music**", "A link to a PDF or sheet music online, used instead of an uploaded chart. Must start with https://."],
            ["**Chords**", "A link to a chord page. It is saved into the song's notes as “Chords: <link>”. Must start with https://."],
            ["**Notes**", "Band notes on the song: arrangement ideas, key changes."],
            ["**Lyrics · text, Markdown or JSON**", "The song's lyrics, with chords inline if you want. See [[lyrics-and-chords-format]]. **Paste or import lyrics** under the box opens the import sheet on its Lyrics tab."],
          ],
        },
        {
          type: "note",
          tone: "privacy",
          text: "Uploaded recordings and charts are stored privately for your band: only band members can open them.",
        },
        {
          type: "note",
          tone: "tip",
          text: "If the title is empty when you pick a file, the file name becomes the title.",
        },
      ],
    },
    {
      id: "song-menu-actions",
      title: "Song menu: every action",
      summary: "What each item in a song's menu does, and who sees it.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["song actions", "song options", "menu", "ultimate guitar", "mark as ready"],
      related: ["read-a-song", "edit-or-delete-a-song", "play-a-song-recording", "chord-editor"],
      body: [
        { type: "p", text: "Tap a song row in the Repertoire to open its menu. Items appear only when they apply to that song." },
        {
          type: "table",
          head: ["Item", "What it does", "Who"],
          rows: [
            ["**Play**", "Plays the recording in the mini player, or opens the Spotify or YouTube link.", "Everyone, when the song has a recording or link"],
            ["**Lyrics**", "Opens the song reader on the lyrics.", "Everyone, when the song has lyrics"],
            ["**Chords**", "Opens the song reader on the chord chart.", "Everyone, when the song has an iReal chart"],
            ["**Open chart**", "Opens the uploaded chart or the sheet music link.", "Everyone, when the song has one"],
            ["**Open in Ultimate Guitar**", "Opens a search for the song on Ultimate Guitar, outside the app.", "Everyone"],
            ["**Edit chords**", "Opens the chord editor.", "Admins, when the song has lyrics"],
            ["**Edit**", "Opens the song form.", "Admins"],
            ["**Suggest a change**", "Sends a correction or a note to the admin.", "Members"],
            ["**Mark as ready**", "Sets the status to Ready.", "Admins, when the song is not Ready"],
            ["**Approve · learning**", "Approves a suggested song and sets it to Learning.", "Admins, on a Suggested song"],
            ["**Back to learning**", "Moves a Ready song back to Learning.", "Admins, on a Ready song"],
            ["**Delete**", "Deletes the song after a confirmation.", "Admins"],
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "Moving a suggested song to Learning or Ready from this menu accepts the member's suggestion, and deleting it rejects it. Either way the member who suggested it is told.",
        },
      ],
    },
    {
      id: "edit-or-delete-a-song",
      title: "Edit, approve or delete a song",
      summary: "Change a song's details or status, or remove it from the library.",
      roles: ["admin"],
      kind: "task",
      keywords: ["change song", "update song", "remove song", "song status", "approve song"],
      related: ["song-fields", "song-menu-actions", "music-notifications"],
      body: [
        {
          type: "steps",
          title: "Edit a song",
          items: [
            "In the Repertoire, tap the song row, then tap **Edit**.",
            "Change what you need on any of the three steps. Tap **Save now** to save from step 1 or 2, or **Next** and then **Save song** on step 3.",
          ],
        },
        {
          type: "p",
          text: "Only the fields you changed are saved, so a bandmate's change to another field at the same time is kept. The rest of the band gets one push, for example “Song updated · Paper Boats” with “Leo M. changed: key, tempo.”",
        },
        {
          type: "steps",
          title: "Change a song's status",
          items: [
            "Tap the song row.",
            "Tap **Mark as ready**, **Approve · learning** or **Back to learning**. The tag on the row changes at once.",
          ],
        },
        {
          type: "steps",
          title: "Delete a song",
          items: [
            "Tap the song row, then tap **Delete**.",
            "Read the confirmation: it names the setlists that lose the song and the upcoming gigs that play it.",
            "Tap **Delete** to confirm, or **Cancel**.",
          ],
        },
        {
          type: "note",
          tone: "warning",
          text: "Deleting a song removes it from every setlist that has it, and its uploaded recording and chart are deleted for good. This can't be undone.",
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Edits, changes the status of and deletes every band song." },
            { role: "member", text: "Cannot edit or delete band songs. Uses **Suggest a change** instead (see [[suggest-a-change-to-a-song]])." },
          ],
        },
      ],
    },
    {
      id: "lyrics-and-chords-format",
      title: "How lyrics and chords are written",
      summary: "The band's song format: sections, inline chords, and what the app tidies when you save.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["chordpro", "markdown", "sections", "verse", "chorus", "inline chords", "format", "json"],
      related: ["read-a-song", "chord-editor", "import-chords-and-lyrics"],
      body: [
        { type: "p", text: "Lyrics are plain text with a few simple marks. The same text holds the words and the chords, so one song serves the singer and the players." },
        {
          type: "list",
          title: "The marks",
          items: [
            "A section starts with a heading line: `# Verse 1` or `[Chorus]`.",
            "A blank line separates stanzas.",
            "A chord goes in brackets right before the word it falls on: `[Am]word`. In the reader it shows above that word.",
            "`**bold**` and `*italic*` work inside a line.",
            "JSON also works, for example a list of lines or a list of sections with a name and lines.",
          ],
        },
        {
          type: "list",
          title: "What the app tidies when the song is saved",
          items: [
            "Section names are put in one form: “Rit.” becomes Chorus, “[Strofa 2]” becomes Verse 2. Names in Italian, Spanish, French, German and Portuguese are understood.",
            "Verses without numbers are numbered when there are several.",
            "A line of chords above a line of words (chords-over-lyrics sheets) is merged into inline chords.",
            "A chord standing before a space is attached to the next word.",
          ],
        },
        {
          type: "p",
          text: "Section names are written in English in the text, but each person sees them in their own app language.",
        },
        {
          type: "note",
          tone: "tip",
          text: "If the lyrics can't be drawn, the reader says “These lyrics can’t be shown. Check their format in Edit song.”",
        },
      ],
    },
    {
      id: "read-a-song",
      title: "Read lyrics and chords",
      summary: "Open a song in the full-screen reader, switch views, change the text size and transpose for yourself.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["lyrics", "chords", "structure", "reader", "text size", "song view", "chart"],
      related: ["lyrics-and-chords-format", "transpose-and-tempo", "my-notes-and-files", "stage-mode"],
      body: [
        {
          type: "steps",
          items: [
            "In the Repertoire, tap the song row and tap **Lyrics** or **Chords**. From the mini player, tap **Lyrics**.",
            "Switch between **Lyrics**, **Chords** and **Structure** with the tabs under the title. Only the views the song has are shown.",
            "Tap the − and + buttons (**Smaller text**, **Bigger text**) at the top to change the text size.",
            "To read in another key, use − and + around the key under the tabs. Tap the key to go back to the original.",
            "Tap X (**Close lyrics**) to close the reader.",
          ],
        },
        {
          type: "table",
          head: ["View", "What it shows"],
          rows: [
            ["**Lyrics**", "The words only, chords hidden."],
            ["**Chords**", "The words with their chords above them, or the iReal chart if the lyrics have no chords."],
            ["**Structure**", "The iReal chart bar by bar, or each section's chord progression in boxes."],
          ],
        },
        {
          type: "list",
          title: "Your view is remembered",
          items: [
            "The first time, the reader opens on the view for your instrument in the band: singers on Lyrics; guitar, keys and bass on Chords; drums, percussion and horns on Structure.",
            "After that it opens on the view you last picked on this device. The same choice applies in Stage mode.",
            "The text size is kept on this device and shared with Stage mode.",
          ],
        },
        {
          type: "p",
          text: "If the song is playing in the mini player, a play/pause button shows in the reader's header. Admins also see **Edit chords** there.",
        },
        {
          type: "devices",
          rows: [
            { devices: ["duoLaptop"], text: "The song fills the top half (the Display) and the reader's controls move to the bottom half (the Deck)." },
            { devices: ["tablet", "duoBook", "duoLand"], text: "The reader opens in the second pane, beside the Repertoire." },
          ],
        },
        { type: "shot", id: "music-reader", caption: "The song reader with the Lyrics, Chords and Structure tabs." },
      ],
    },
    {
      id: "transpose-and-tempo",
      title: "Transpose a song and find its tempo",
      summary: "Change the key for the whole band or only on your screen, and set the BPM by tapping or from the recording.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["transpose", "key change", "semitone", "bpm", "tap tempo", "tempo detection"],
      related: ["song-fields", "read-a-song", "stage-click"],
      body: [
        {
          type: "table",
          head: ["Where", "What it changes", "Who"],
          rows: [
            ["Song form, **Transpose for the band**", "The song's key, its chord chart and the chords in its lyrics, for everyone, once you save.", "Admins"],
            ["Reader and Stage mode, − key +", "Only what your screen shows. The song stays in its key for the band. Kept per song on this device.", "Everyone"],
          ],
        },
        {
          type: "steps",
          title: "Transpose for the whole band",
          items: [
            "Open the song's menu and tap **Edit**, then **Next** to reach **Details · optional**.",
            "Under **Key**, tap **Transpose down a semitone** (−) or **Transpose up a semitone** (+). The number between them shows how far you moved.",
            "Tap **Save now**. The band is notified that the key and chords changed.",
          ],
        },
        {
          type: "steps",
          title: "Find the BPM",
          items: [
            "In the song form, on **Details · optional**, tap **Tap** in time with the song. After two taps the BPM fills in; the count of taps shows next to the button.",
            "Or tap **BPM from the recording**, when the song has an audio file. The tempo is worked out on your device.",
            "If the result is half or double the real tempo, tap ÷2 or ×2.",
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "A tempo from the recording is an estimate: the form says “Estimated from the recording: check it by tapping along.”",
        },
      ],
    },
    {
      id: "chord-editor",
      title: "Edit a song's chords",
      summary: "Put chords on words by tapping, move them by dragging, and copy them between sections.",
      roles: ["admin"],
      kind: "task",
      keywords: ["chord editor", "edit chords", "add chord", "move chord", "copy chords", "ireal"],
      related: ["lyrics-and-chords-format", "suggest-a-change-to-a-song", "import-from-ireal-pro"],
      body: [
        {
          type: "steps",
          items: [
            "In the Repertoire, tap the song row and tap **Edit chords**. You can also tap **Edit chords** in the song reader's header.",
            "Tap a word. The bar at the bottom shows **Chord on “…”** and the chords the song already uses.",
            "Tap a chord to put it on the word, or type a new one in **New chord, e.g. F#m7** and tap **Add**. Tap **No chord** to remove it. Tap **Done** to close the bar.",
            "To move a chord, drag it onto another word.",
            "To reuse a verse's chords, tap **Copy chords from…** above a section and pick the section to copy from.",
            "If the song has an iReal chart, tap **From iReal (…)** above a section to lay the matching chart section's chords over its lines.",
            "Tap **Undo** at the top right to step back. When you are done, tap **Save chords**.",
          ],
        },
        {
          type: "list",
          title: "Checks the editor makes",
          items: [
            "**Tidy the format** shows when section names or chords are not in the band's format; one tap fixes them.",
            "“Not in the iReal chart: …” lists chords in the lyrics that the chart never plays.",
            "“The chords sound in …, the song is in ….” shows when the chords don't fit the song's key, with a button to transpose them.",
          ],
        },
        {
          type: "p",
          text: "The chord editor needs lyrics. With none, it says to add them in Edit song first. After you save, the band gets a push that the chords changed.",
        },
        {
          type: "note",
          tone: "tip",
          text: "Leaving with changes not saved asks “Save your changes?” with **Save changes**, **Discard** and **Keep editing**.",
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Edits the band's chords for everyone." },
            { role: "member", text: "Has no chord editor. Suggests a chord correction with **Suggest a change** (see [[suggest-a-change-to-a-song]])." },
          ],
        },
      ],
    },
    {
      id: "import-chords-and-lyrics",
      title: "Import chords and lyrics into a song",
      summary: "Bring in a chord chart and lyrics from the iReal Pro forum, a file, or the clipboard.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["import lyrics", "paste lyrics", "chordpro", "musicxml", "chord chart", "file import"],
      related: ["import-from-ireal-pro", "open-a-chart-from-another-app", "lyrics-and-chords-format"],
      body: [
        {
          type: "steps",
          items: [
            "In the song form, tap **Import chords and lyrics** on step 1, or **Paste or import lyrics** on step 3.",
            "Pick a tab: **From the forum**, **From file** or **Lyrics**.",
            "**From file**: tap **Choose a file** and pick a MusicXML (.musicxml, .mxl), ChordPro (.cho, .chordpro, .pro) or text (.txt) file.",
            "**Lyrics**: copy the lyrics elsewhere, then tap **Paste from clipboard**, or paste them into the box and tap **Preview**.",
            "Check the preview and tap **Use these lyrics**, or **Back**.",
            "Save the song as usual.",
          ],
        },
        {
          type: "list",
          title: "Good to know",
          items: [
            "Lyrics always show in a preview first. If the song already has lyrics, the preview says these replace them.",
            "A chord chart on its own is attached straight away, without a preview.",
            "Whatever the import brings fills in empty fields only: title, artist, key and tempo you already typed stay.",
            "When pasting, empty lines separate sections; chords above the words or in [brackets] stay with them.",
            "From iReal Pro on your device: Share › Export › MusicXML, save it to Files, then use **From file**.",
          ],
        },
        {
          type: "note",
          tone: "privacy",
          text: "Only your band sees the lyrics and charts you import. Import only what you have the right to use.",
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Imports into any song while adding or editing it." },
            { role: "member", text: "Imports while suggesting a new song. For an existing song, suggest the change instead." },
          ],
        },
      ],
    },
    {
      id: "import-from-ireal-pro",
      title: "Import a chord chart from iReal Pro",
      summary: "Tap a song or playlist link on the iReal Pro forum to bring its chords, form, key and tempo into a song.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["ireal", "ireal pro", "irealb", "chord chart", "playlist", "forum"],
      related: ["import-chords-and-lyrics", "read-a-song", "chord-editor"],
      body: [
        {
          type: "steps",
          title: "In the iPhone, iPad and Android apps",
          items: [
            "In the song form, tap **Import chords and lyrics** and stay on **From the forum**.",
            "Tap **Browse the iReal Pro forum**. The forum opens inside the app.",
            "Tap a song or a playlist link. Its chords come straight back to the form.",
            "Or paste an irealb:// link into **iReal Pro link**.",
          ],
        },
        {
          type: "steps",
          title: "On the web",
          items: [
            "In the song form, tap **Import chords and lyrics** and stay on **From the forum**.",
            "Tap **Open the iReal Pro forum**. The forum opens in its own window.",
            "Right-click a song or playlist link and choose Copy Link.",
            "Back in BandWith, tap **Paste link**, paste into **iReal Pro link**, or drag the link onto the box (it says **Drop the link here**). The forum window closes once the link is in.",
          ],
        },
        {
          type: "p",
          text: "A playlist link shows its songs (“… · 12 songs”). Songs matching your title are listed first; type in **Find a song** to narrow the list, and tap a song to use it. **Change** goes back to the link.",
        },
        {
          type: "list",
          title: "What comes in",
          items: [
            "The chords and the form (sections, bars, repeats), plus key, style, tempo and time signature. No melody, no lyrics.",
            "The title, composer (as artist), key and BPM fill the form's empty fields.",
            "The chart shows in the song reader's **Chords** and **Structure** views, and the chord editor can use it to place chords.",
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "If your browser blocks the forum window, allow pop-ups for BandWith and try again.",
        },
        {
          type: "devices",
          rows: [
            { devices: ["web"], text: "The forum can't open inside the page, so it opens in a separate window and you bring the link back with **Paste link**, a paste, or a drag." },
          ],
        },
      ],
    },
    {
      id: "open-a-chart-from-another-app",
      title: "Open a MusicXML chart from another app",
      summary: "Send a MusicXML file to BandWith and attach its chord chart to a song.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["open in", "share sheet", "musicxml", "received file", "attach chart"],
      related: ["import-chords-and-lyrics", "suggest-a-change-to-a-song"],
      body: [
        {
          type: "steps",
          items: [
            "In another app (for example iReal Pro or Files), share or open a MusicXML file with BandWith.",
            "BandWith opens a **Received file** sheet. Admins see **Attach the chord chart**; members see **Suggest the chord chart**.",
            "Pick the song it belongs to. Use **Find a song** to search. A song that already has a chart says it will be replaced.",
            "Tap **Open chords** to check it, or **Done**.",
          ],
        },
        {
          type: "list",
          items: [
            "For a new song, add the song first: the file waits in **Import chords and lyrics** › **From file** › **Received file**, where **Use it** attaches it.",
            "Tap **Discard the file** if you don't want it.",
            "A score with lyrics but no chord symbols gives no chart; to use its lyrics, open the song's Edit › **Paste or import lyrics** › **From file**.",
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "The chart is attached to the band song at once." },
            { role: "member", text: "The chart goes to the admin as a suggestion. The band's song stays the same until they accept it." },
          ],
        },
        { type: "devices", rows: [{ devices: ["web"], text: "Not available: receiving files from other apps works in the iPhone, iPad and Android apps." }] },
      ],
    },
    {
      id: "import-a-song-list",
      title: "Import a song list",
      summary: "Add many songs at once from a CSV or text file, or load the curated repertoire.",
      roles: ["admin"],
      kind: "task",
      keywords: ["csv", "excel", "spreadsheet", "bulk import", "txt", "numbers", "google sheets", "700 songs"],
      related: ["add-a-song", "repertoire-overview"],
      body: [
        {
          type: "steps",
          items: [
            "In the Repertoire, on **Songs**, tap **Import song list** (the upload button at the top right). With an empty library you can also tap **Import list (CSV/TXT)**.",
            "Pick a .csv, .tsv or .txt file, up to 2 MB.",
            "Read the line above the list: it says how many songs were imported and how many were already in your library.",
          ],
        },
        {
          type: "list",
          title: "What the file can look like",
          items: [
            "A spreadsheet saved as CSV (Excel, Numbers, Google Sheets) with a header row. Columns that are read: title (or song, name, track), artist (or band, performer), key, bpm (or tempo), duration (or length, time; m:ss or seconds) and genre.",
            "A plain list typed in Notes: one song per line, as “Title - Artist”, “Title, Artist” or just “Title”. Numbered lines and blank lines are fine.",
            "Up to 2000 songs per file.",
          ],
        },
        {
          type: "p",
          text: "Songs with the same title and artist as one already in the library are skipped. Imported songs are added as **Ready**.",
        },
        {
          type: "steps",
          title: "Load the curated repertoire",
          items: [
            "With an empty library, tap **Load 700+ songs**.",
            "The app adds the curated songs that aren't in your library yet and says how many.",
          ],
        },
        {
          type: "note",
          tone: "privacy",
          text: "Importing a song list is admin-only: it goes straight into the band's library. Members suggest songs one at a time, and an admin reviews each one.",
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Sees **Import song list** and **Load 700+ songs**." },
            { role: "member", text: "Doesn't see these buttons." },
          ],
        },
      ],
    },
    {
      id: "play-a-song-recording",
      title: "Play a recording, open a chart or a link",
      summary: "Listen to the band's recording in the mini player and open charts and links.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["play", "audio", "mini player", "recording", "spotify", "youtube", "pdf chart"],
      related: ["song-menu-actions", "song-fields", "read-a-song"],
      body: [
        {
          type: "steps",
          items: [
            "In the Repertoire, tap the round **Play** button on a song row, or tap the row and tap **Play**.",
            "A recording (an uploaded file, a Google Drive link or any audio link) plays in the mini player. Use **Pause**, **Play** and **Stop** there, and **Lyrics** to open the song reader.",
            "A Spotify or YouTube link opens outside the app.",
            "To see the chart, tap the row and tap **Open chart**.",
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "If nothing opens, the app says “Could not open this song. Check its recording or links.” If a link fails in the player, **Open the link** opens it elsewhere.",
        },
      ],
    },
    {
      id: "my-notes-and-files",
      title: "My notes and files on a song",
      summary: "Add private notes on a song, a line, a word or a chord, and keep your own files, seen by nobody else.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["personal notes", "private notes", "my notes", "annotations", "my files", "own recording"],
      related: ["read-a-song", "stage-mode", "suggest-a-change-to-a-song"],
      body: [
        {
          type: "note",
          tone: "privacy",
          text: "Your notes and files are yours only: nobody else in the band sees them, admins included. The band's song doesn't change for the others.",
        },
        {
          type: "steps",
          title: "Add a note",
          items: [
            "Open the song in the reader (**Lyrics** or **Chords**) or in Stage mode.",
            "Turn on **My notes** under the song's tabs. The first time, a sheet explains what they are; tap **Got it**.",
            "Tap **Add note**, then tap the line you want. Or tap **Note on the whole song**.",
            "For a line, choose what the note is on: **Whole line**, one of its words, or one of its chords.",
            "Type in **My note** and tap **Save note**.",
          ],
        },
        {
          type: "list",
          items: [
            "Your notes show under their line, highlighted. Notes on the whole song show above the lyrics.",
            "Tap a note to change it or tap **Delete note**.",
            "A note stays on its line even when an admin edits the chords or moves sections. If its line is no longer in the song, it moves to the top so it isn't lost.",
            "Turn **My notes** off to hide them, for example on stage. The switch is kept on this device.",
          ],
        },
        {
          type: "steps",
          title: "Add your own file",
          items: [
            "With **My notes** on, tap **Add file** and pick a recording or a score.",
            "It shows as a chip under the bar. Tap it to open it; tap its X and confirm to remove it.",
          ],
        },
        {
          type: "p",
          text: "To share a note with the band, tap **Suggest to the band** in the note sheet. It goes to the admin as a suggestion, with the line it was on.",
        },
        {
          type: "devices",
          rows: [{ devices: ["phone", "phoneLand", "duoClosed"], text: "In Stage mode the bar uses icon buttons only, so it stays on one row above the lyrics." }],
        },
      ],
    },

    // ───────────────────────────── Suggestions ─────────────────────────────
    {
      id: "suggest-a-song",
      title: "Suggest a new song",
      summary: "Propose a song for the repertoire; an admin approves or rejects it.",
      roles: ["member"],
      kind: "task",
      keywords: ["propose song", "suggest song", "song request", "new song idea"],
      related: ["add-a-song", "my-song-suggestions", "review-song-suggestions"],
      body: [
        {
          type: "steps",
          items: [
            "In the Repertoire, on **Songs**, tap **Suggest a song** (the + button at the top right).",
            "Fill in the form as for any song: **Song title \\*** is the only required field. You can import chords and lyrics and attach a recording or a chart.",
            "Tap **Suggest now** to send it early, or go through the steps and tap **Suggest a song** on the last one.",
          ],
        },
        {
          type: "list",
          title: "What happens next",
          items: [
            "The song appears in the Repertoire with a **Suggested** tag, for everyone in the band.",
            "The band's admins get a push: “Song suggested · …”. Several songs suggested within a minute send one push.",
            "When an admin approves it, it moves to **Learning** and you get a push. If it's rejected, the song and its files are deleted, and you get a push with the admin's reason if they gave one.",
          ],
        },
        {
          type: "p",
          text: "Files you attach to a suggested song are kept in your own folder until an admin accepts the song.",
        },
      ],
    },
    {
      id: "suggest-a-change-to-a-song",
      title: "Suggest a change to a song",
      summary: "Send the admin a correction to the lyrics or chords, or a note for the whole band.",
      roles: ["member"],
      kind: "task",
      keywords: ["correction", "fix lyrics", "fix chords", "note for band", "propose change"],
      related: ["my-song-suggestions", "review-song-suggestions", "my-notes-and-files"],
      body: [
        {
          type: "steps",
          items: [
            "In the Repertoire, tap the song row and tap **Suggest a change**.",
            "Choose **Lyrics or chords** or **Note for the band**.",
            "For lyrics or chords, change the text in **Lyrics with chords**. Chords go in brackets before the word: [Am]word. The line under the box says what you changed, for example “Chords changed on 2 lines”.",
            "Add a **Message for the admin (optional)** if it helps.",
            "For a note, type it in **Note for the whole band**.",
            "Tap **Send suggestion**. The sheet says **Sent to the admin** and closes.",
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "The band's song stays the same for everyone until the admin accepts your suggestion.",
        },
        {
          type: "p",
          text: "You can also start from one of your notes: open it and tap **Suggest to the band**. The note is sent with the line it was on.",
        },
        {
          type: "p",
          text: "The admins get a push named after the kind: “Lyrics correction · …”, “Chords correction · …” or “Note for the band · …”.",
        },
      ],
    },
    {
      id: "my-song-suggestions",
      title: "Follow or withdraw your suggestions",
      summary: "See which of your suggestions wait, which were accepted, and take one back.",
      roles: ["member"],
      kind: "task",
      keywords: ["my suggestions", "withdraw", "suggestion status", "pending"],
      related: ["suggest-a-song", "suggest-a-change-to-a-song"],
      body: [
        {
          type: "steps",
          items: [
            "In the Repertoire, on **Songs**, tap **My suggestions**. Its line says how many wait for the admin.",
            "**Waiting** lists the ones still open; **Reviewed** lists the rest with their outcome.",
            "Tap one to see it. **Changes**, **Before** and **After** show the difference; a reviewed one shows the admin's reason if they gave one.",
            "To take a waiting suggestion back, tap **Withdraw suggestion**, then **Withdraw suggestion** again to confirm, or **Keep it**.",
          ],
        },
        {
          type: "table",
          head: ["Tag", "Meaning"],
          rows: [
            ["**Waiting**", "Not reviewed yet."],
            ["**Accepted**", "Applied as you sent it."],
            ["**Accepted with changes**", "The admin applied it with their own edits."],
            ["**Not accepted**", "Rejected."],
          ],
        },
        {
          type: "note",
          tone: "warning",
          text: "Withdrawing a suggested new song deletes the song and the files you attached. The admins no longer see it.",
        },
      ],
    },
    {
      id: "review-song-suggestions",
      title: "Review members' suggestions",
      summary: "Accept, accept with changes or reject what members propose, with an optional reason.",
      roles: ["admin"],
      kind: "task",
      keywords: ["review", "approve", "reject", "suggestions from members", "moderate"],
      related: ["suggest-a-change-to-a-song", "suggest-a-song", "edit-or-delete-a-song"],
      body: [
        {
          type: "steps",
          items: [
            "In the Repertoire, on **Songs**, tap **Suggestions from members** (it shows “… to review”). You can also tap the push you received.",
            "On **Waiting**, tap a suggestion. It says who suggested it and when, with their message.",
            "Look at **Changes** (lines added and removed), **Before** and **After**. For a new song, a summary lists what it includes.",
            "Optionally write a **Reason (…, will see it)**.",
            "Tap **Accept**, **Accept with changes** or **Reject**.",
          ],
        },
        {
          type: "table",
          head: ["Button", "What happens"],
          rows: [
            ["**Accept**", "The change is applied to the band song. A new song moves to Learning."],
            ["**Accept with changes**", "You edit the text first, then tap **Accept with these changes**. For a new song, the song form opens."],
            ["**Reject**", "Nothing changes. A suggested new song is deleted, with its files."],
          ],
        },
        {
          type: "list",
          items: [
            "The member gets a push with the outcome and your reason.",
            "If the song changed after the suggestion, the screen warns that you are comparing with its current version.",
            "A note for the band is added to the song's notes.",
            "A suggestion that includes a chord chart also replaces the song's chart.",
            "Reviewed suggestions stay on **Reviewed**.",
          ],
        },
        {
          type: "devices",
          rows: [{ devices: ["tablet", "duoBook", "duoLand"], text: "Suggestions open in the second pane, beside the Repertoire." }],
        },
        { type: "shot", id: "music-suggestions", caption: "A lyrics correction with Changes, Before and After, and the review buttons." },
      ],
    },

    // ───────────────────────────── Setlists ─────────────────────────────
    {
      id: "build-a-setlist",
      title: "Build a setlist",
      summary: "Create a setlist in the Repertoire, add songs from the library, put them in order and save.",
      roles: ["admin"],
      kind: "task",
      keywords: ["new setlist", "create setlist", "set list", "running order", "playlist"],
      related: ["setlists-and-sets", "attach-a-setlist-to-a-gig", "edit-a-gig-setlist", "music-notifications"],
      body: [
        {
          type: "steps",
          items: [
            "In the Repertoire, tap **Setlists**, then **New setlist** (the + button at the top right). With no setlists yet you can also tap **Create first setlist**.",
            "Type a **Setlist name \\***, for example Jazz night 1st set, and tap **Create setlist**.",
            "Tap the new setlist in the list to open it.",
            "Tap **Add songs from library…**. Search with **Search library…** or tap a genre chip to filter. Tap a song to add it; tap it again to take it out. Songs in the setlist are highlighted.",
            "Tap **Done** to close the library.",
            "Drag a song by its grip (**Drag to reorder**) to move it. Tap X on a row to remove it.",
            "Change the **Setlist name** at the top if you want.",
            "Tap **Save setlist**.",
          ],
        },
        {
          type: "list",
          title: "What the editor shows",
          items: [
            "**Setlist order (… songs)** with the **Total** running time.",
            "When the setlist has more than one set, a tag per set with its songs and time, and a **Set 1**, **Set 2** tag on the first song of each set.",
            "How many songs have no duration: add one with Edit for an exact total.",
          ],
        },
        {
          type: "p",
          text: "After you save, the band's active members get one push with what changed, for example “Setlist updated · Rooftop set” and “Leo M.: 2 songs moved, 1 added.” A rename is mentioned too.",
        },
        {
          type: "note",
          tone: "tip",
          text: "Leaving the editor with changes not saved asks “Save the setlist changes?” with **Save changes**, **Discard** and **Keep editing**.",
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Creates, edits, renames and deletes setlists." },
            { role: "member", text: "Opens setlists read-only: the order, sets and running time, and **Export setlist as PDF**. No name field, no library, no grips, no Save." },
          ],
        },
        {
          type: "devices",
          rows: [{ devices: ["tablet", "duoBook", "duoLand"], text: "The setlist opens in the second pane, beside the list of setlists." }],
        },
        { type: "shot", id: "music-setlist-editor", caption: "The setlist editor with the library open and the setlist order below." },
      ],
    },
    {
      id: "setlists-and-sets",
      title: "Setlists, sets and templates",
      summary: "How setlists, sets inside them and template setlists relate to gigs.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["sets", "set 1", "set 2", "template", "saved setlist", "gig setlist"],
      related: ["build-a-setlist", "attach-a-setlist-to-a-gig", "edit-a-gig-setlist"],
      body: [
        { type: "p", text: "A setlist is an ordered list of band songs. A song appears only once in a setlist. A setlist can be split into sets (Set 1, Set 2…), for example before and after a break." },
        {
          type: "list",
          items: [
            "Sets are made when you set up a gig's setlist: **Add set** in the gig form, or **New set** when adding songs in the gig overview.",
            "In the Repertoire's setlist editor you see the sets and can move songs between them by dragging across the boundary; a new song joins the last set. Empty sets disappear when you save.",
            "Setlists marked as templates show a **Template** tag in the list. The gig form offers your saved setlists under **Load from templates**.",
            "When you load a saved setlist into a gig, the gig gets its own copy, named after the gig (for example “Rooftop Session setlist”). Changing the gig's setlist later doesn't change the one you loaded from.",
            "Every gig setlist also appears in the Repertoire under **Setlists**.",
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Writes setlists everywhere: in the Repertoire, the gig form, the gig overview and Stage mode." },
            { role: "member", text: "Reads every setlist of the band. Setlists are admin-only to edit." },
          ],
        },
      ],
    },
    {
      id: "attach-a-setlist-to-a-gig",
      title: "Attach a setlist to a gig",
      summary: "Add songs or a saved setlist while creating or editing a gig.",
      roles: ["admin"],
      kind: "task",
      keywords: ["assign setlist", "gig songs", "load template", "add set", "event setlist"],
      related: ["edit-a-gig-setlist", "setlists-and-sets", "create-a-gig"],
      body: [
        {
          type: "steps",
          items: [
            "Create a gig, or open one and tap **Edit** (see [[create-a-gig]]).",
            "Open the **Setlist & songs** section.",
            "To start from a saved setlist, tap it under **Load from templates**. Once there are songs, **Templates** shows the list again as **Replace with a template**.",
            "To add songs, tap **From library** under a set, or **Manual** to type one in. **Add songs** adds to a set you pick.",
            "Tap **Add set** for another set, give it a name in **Set name...**, or tap **Remove set**.",
            "Save the gig.",
          ],
        },
        {
          type: "p",
          text: "The gig gets its own setlist, named after the gig. When you edit a gig, the setlist it has is updated and the lineup gets one push with what changed.",
        },
        {
          type: "note",
          tone: "tip",
          text: "If the gig has no setlist, its overview says **NO SETLIST ASSIGNED**; admins can add songs right there (see [[edit-a-gig-setlist]]).",
        },
      ],
    },
    {
      id: "edit-a-gig-setlist",
      title: "Edit a gig's setlist from its overview",
      summary: "Reorder, add and remove songs right in the gig, without opening the edit form.",
      roles: ["admin"],
      kind: "task",
      keywords: ["reorder songs", "gig overview", "set picker", "which set", "new set", "drag songs"],
      related: ["attach-a-setlist-to-a-gig", "music-notifications", "gig-workspace"],
      body: [
        {
          type: "steps",
          items: [
            "Open an upcoming gig. The **SETLIST** section of the overview shows its songs.",
            "To move a song, long-press it and drag it. With a keyboard, focus its grip and use the up and down arrows.",
            "To remove a song, tap its X (**Remove song**).",
            "To add songs, tap **Add songs**. With more than one set, **Which set?** asks where; tap a set or **New set**.",
            "In **Add songs**, tick the songs (**From library**), then tap **Add … songs**. Songs already in the set show **In set**. **Manual** creates a new song and adds it.",
            "Tap **Save** in the **Unsaved changes** bar, or **Cancel** to drop the changes.",
          ],
        },
        {
          type: "list",
          items: [
            "Nothing is written until you tap **Save**. Then the gig's lineup (everyone not declined) gets one push, for example “Setlist updated · Rooftop Session” and “Leo M.: 1 song moved, 1 added.”",
            "A gig with no setlist yet gets one when you save, named after the gig.",
            "Leaving the gig with changes not saved asks “Save the setlist changes?”.",
            "Tapping **SETLIST** or the song count opens the full list in a sheet, where you can edit the same way.",
            "Past gigs, quotes and rehearsals show the setlist read-only here.",
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Edits the setlist in the overview of upcoming band gigs." },
            { role: "member", text: "Sees the songs, artists and durations read-only. With no setlist, the sheet says “The band admin has not attached a setlist yet.”" },
          ],
        },
        {
          type: "devices",
          rows: [{ devices: ["tablet"], text: "The gig workspace has its own **SETLIST** tab next to **OVERVIEW**, **RIDER & STAGE** and **MONEY**." }],
        },
      ],
    },
    {
      id: "export-a-setlist-pdf",
      title: "Export a setlist as PDF",
      summary: "Make a PDF of a setlist to print or send.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["pdf", "print setlist", "share setlist", "download"],
      related: ["build-a-setlist"],
      body: [
        {
          type: "steps",
          items: [
            "In the Repertoire, tap **Setlists** and open a setlist.",
            "Tap **Export setlist as PDF** (the document button at the top right).",
            "On a phone, pick where to send it in the share sheet. On the web, the PDF downloads.",
          ],
        },
        { type: "p", text: "The PDF has the band name, the setlist name and each song with artist, key, BPM, duration and set." },
        { type: "p", text: "The button is greyed out while the setlist is empty." },
      ],
    },
    {
      id: "delete-a-setlist",
      title: "Delete a setlist",
      summary: "Remove a setlist; the songs stay in the library.",
      roles: ["admin"],
      kind: "task",
      keywords: ["remove setlist", "delete set list"],
      related: ["build-a-setlist"],
      body: [
        {
          type: "steps",
          items: [
            "In the Repertoire, tap **Setlists** and open the setlist.",
            "Tap **Delete setlist** (the red bin at the top right).",
            "Read the confirmation: it names the upcoming gigs that lose their setlist.",
            "Tap **Delete**, or **Cancel**.",
          ],
        },
        {
          type: "note",
          tone: "warning",
          text: "Gigs that use the setlist lose it. The songs stay in your library. This can't be undone.",
        },
      ],
    },
    {
      id: "music-notifications",
      title: "Notifications about songs and setlists",
      summary: "Who is told what when songs, setlists and suggestions change.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["push", "notification", "setlist updated", "song updated", "alert"],
      related: ["build-a-setlist", "edit-a-gig-setlist", "review-song-suggestions", "notifications-inbox"],
      body: [
        {
          type: "table",
          head: ["Change", "Who hears", "How"],
          rows: [
            ["A gig's setlist saved (overview or gig form)", "The gig's lineup, except who saved", "One push: “Setlist updated · <gig>” with “2 songs moved, 1 added”"],
            ["A setlist saved in the Repertoire", "The band's active members, except who saved", "One push: “Setlist updated · <setlist>”, or that it was renamed"],
            ["A song edited (form or chord editor)", "The band's active members, except who saved", "One push: “Song updated · <song>” with the fields changed"],
            ["A song added by an admin", "The rest of the band", "Inbox note, no push"],
            ["A song suggested or a change suggested", "The band's active admins", "Push"],
            ["A suggestion reviewed", "The member who suggested it", "Push, with the reason"],
            ["Setlist reordered in Stage mode", "The band", "Inbox note, no push"],
          ],
        },
        { type: "p", text: "Texts are written in each person's own app language." },
        {
          type: "p",
          text: "An open gig reloads its setlist as soon as an admin changes it, so members see the new order without refreshing.",
        },
      ],
    },
    {
      id: "music-what-members-can-do",
      title: "What admins, members and deputies can do with songs and setlists",
      summary: "One table of who can read and who can change repertoire, setlists and Stage mode.",
      roles: ["admin", "member", "deputy"],
      kind: "reference",
      keywords: ["permissions", "member rights", "admin only", "read only", "privacy"],
      related: ["repertoire-overview", "suggest-a-change-to-a-song", "stage-mode", "who-sees-what"],
      body: [
        {
          type: "table",
          head: ["Action", "Admin", "Member"],
          rows: [
            ["Read every song, lyrics, chords and files", "Yes", "Yes"],
            ["Add a song to the library", "Yes, as Ready", "Suggests it, as Suggested"],
            ["Edit, transpose for the band, edit chords, delete a song", "Yes", "No: suggests a change"],
            ["Import a song list or load 700+ songs", "Yes", "No"],
            ["Review suggestions", "Yes, all of the band's", "Sees only their own"],
            ["My notes and my files", "Own only", "Own only"],
            ["Read setlists and export them as PDF", "Yes", "Yes"],
            ["Create, edit, reorder, delete setlists", "Yes", "No"],
            ["Open Stage mode on an upcoming gig", "Yes, as leader", "Yes, as follower"],
            ["Move the band's current song, reorder on stage, start the band's click", "Yes", "No: steps and clicks on their own phone only"],
          ],
        },
        {
          type: "note",
          tone: "privacy",
          text: "Admins don't see members' notes or files. Members see only their own suggestions; admins see all of them.",
        },
        {
          type: "roles",
          rows: [
            { role: "deputy", text: "A deputy is not a band member: no Repertoire, no setlists and no Stage mode. Their deputy gigs show the date, times, venue, role and fee offered." },
          ],
        },
      ],
    },

    // ───────────────────────────── Stage ─────────────────────────────
    {
      id: "stage-mode",
      title: "Stage mode",
      summary: "A black, glanceable gig-day screen with the run of show, the setlist and each song's lyrics or chords.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["stage", "gig day", "live", "run of show", "go live", "performance mode"],
      related: ["lead-stage-mode", "follow-in-stage-mode", "stage-click", "stage-bluetooth-sync", "stage-mode-on-devices"],
      body: [
        {
          type: "steps",
          title: "Open Stage mode",
          items: [
            "Open an upcoming band gig and tap the **Play** button at the top right (**Open stage mode**). On gig day it is highlighted.",
            "Or, on Home, tap **Go live** under your next gig.",
            "To leave, tap X (**Exit stage mode**).",
          ],
        },
        {
          type: "list",
          title: "What is on the screen",
          items: [
            "**Stage mode · <date>**, the gig title, venue and city.",
            "The run of show: Load in, Soundcheck, Show and End in 24-hour time. The next one is highlighted as **Next · …**; past ones fade.",
            "The **Setlist** with numbers, titles, key and duration. The current song is highlighted.",
            "A second tab named after your song view (**Lyrics**, **Chords** or **Structure**) shows the current song. It follows the song as it changes.",
            "**Prev** and **Next** at the bottom, with the click button between them.",
          ],
        },
        {
          type: "list",
          title: "In the song tab",
          items: [
            "Switch **Lyrics**, **Chords** and **Structure**. The choice is shared with the song reader.",
            "Change the text size with − and +.",
            "Transpose for yourself with − key +. Only your screen changes.",
            "**My notes** shows your private notes over the band's version.",
            "The run of show hides to give the song more room.",
          ],
        },
        {
          type: "list",
          title: "Good to know",
          items: [
            "Stage mode is offered for upcoming band gigs, not for rehearsals, quotes, past gigs or personal gigs.",
            "The screen stays awake while Stage mode is open.",
            "With no setlist, it says “No setlist attached to this gig.”",
            "In the phone and tablet apps, the setlist with lyrics and charts is kept on the device when you open the gig, so Stage mode works without internet. Signing out removes it.",
            "Without internet and no copy on the device, it says “Offline: the setlist couldn’t be loaded.” with **Try again**.",
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Leads: moves the band's current song, reorders the setlist and starts the band's click. See [[lead-stage-mode]]." },
            { role: "member", text: "Follows the leader, or steps through the songs alone. See [[follow-in-stage-mode]]." },
            { role: "deputy", text: "No Stage mode: deputies don't have the band's setlists." },
          ],
        },
        { type: "shot", id: "music-stage", caption: "Stage mode on gig day: run of show, setlist and Prev / Next." },
      ],
    },
    {
      id: "lead-stage-mode",
      title: "Lead the band in Stage mode",
      summary: "As admin, move the current song for everyone and change the order live.",
      roles: ["admin"],
      kind: "task",
      keywords: ["leader", "next song", "reorder live", "band follows", "live sync"],
      related: ["stage-mode", "follow-in-stage-mode", "stage-click", "stage-bluetooth-sync"],
      body: [
        {
          type: "steps",
          items: [
            "Open Stage mode on the gig.",
            "Check the status next to the setlist: **Live** means the band follows you (**Band follows you**).",
            "Tap **Next** or **Prev** to move the band to the next or previous song, or tap any song in the list (**Go to …**).",
            "To change the order, tap **Reorder**, then the up and down arrows on a song (**Move … up**, **Move … down**). Tap **Done** when finished.",
          ],
        },
        {
          type: "table",
          head: ["Status", "Meaning"],
          rows: [
            ["**Live**", "Connected over the internet: members follow you."],
            ["**Live · BT**", "Connected over the internet and sending over Bluetooth too."],
            ["**Bluetooth**", "No internet: members nearby follow you over Bluetooth."],
            ["**Offline**", "Nothing reaches the band right now."],
            ["**Saving…**, **Saved**, **Not saved**", "While reordering: the new order is saved shortly after your last move."],
          ],
        },
        {
          type: "list",
          items: [
            "Members who open Stage mode later catch up on the current song.",
            "A new order applies to everyone, also members who stopped following, and is saved to the gig's setlist. The gig behind Stage mode shows it at once.",
            "Closing Stage mode saves a move still waiting for its save.",
            "If several admins lead at once, the newest move wins.",
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "Keep your phone unlocked: Stage mode keeps the screen awake, and a locked leader's phone stops the band's sync.",
        },
      ],
    },
    {
      id: "follow-in-stage-mode",
      title: "Follow the leader in Stage mode",
      summary: "As a member, let the admin's phone turn your songs, or step through them yourself.",
      roles: ["member"],
      kind: "task",
      keywords: ["follow", "following leader", "sync", "same song"],
      related: ["stage-mode", "lead-stage-mode", "stage-bluetooth-sync"],
      body: [
        {
          type: "steps",
          items: [
            "Open Stage mode on the gig. Following is on: the button next to the setlist says **Waiting for leader** until the admin's phone is seen, then **Following leader**.",
            "Your current song, lyrics and chords change when the admin moves on.",
            "To look ahead on your own, tap **Prev**, **Next** or a song. Following stops and the button says **Follow leader**.",
            "Tap **Follow leader** to jump back to the leader's song and follow again.",
          ],
        },
        {
          type: "list",
          items: [
            "**· BT** after the label means you are linked to the leader over Bluetooth.",
            "**Offline** means nothing can reach your phone right now.",
            "Members cannot move anyone else's song or change the order.",
          ],
        },
      ],
    },
    {
      id: "stage-click",
      title: "Use the click in Stage mode",
      summary: "A visual metronome around the screen edge, in time across the band's phones.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["metronome", "click", "count-in", "tempo", "bpm", "beat"],
      related: ["stage-mode", "transpose-and-tempo"],
      body: [
        {
          type: "steps",
          items: [
            "In Stage mode, find the click button between **Prev** and **Next**. It shows the current song's BPM.",
            "Tap it (**Start the click**). A glow flashes around the screen edge on every beat, brighter on the first beat of the bar.",
            "Tap it again (**Stop the click**) to stop.",
          ],
        },
        {
          type: "table",
          head: ["Who starts it", "What happens"],
          rows: [
            ["Admin", "The click runs on every phone in Stage mode, in time with the leader's phone."],
            ["Member", "The click runs on your phone only."],
            ["Member, while the leader's click runs", "The button hides or shows it on your phone (**Hide the click on this phone**, **Show the click**)."],
          ],
        },
        {
          type: "list",
          items: [
            "The click is visual only: there is no sound. It doesn't block taps on the screen.",
            "The beats in a bar come from the song's iReal chart time signature, else 4.",
            "A song without BPM can't start a click (**No BPM for this song**). Add the BPM in the song form.",
            "Moving to another song hides the click for the song before.",
            "Phones keep in time to about 20–40 ms: right for a count-in and a tempo reference, not for an in-ear click.",
            "The band's click needs the internet: it isn't sent over Bluetooth.",
          ],
        },
      ],
    },
    {
      id: "stage-bluetooth-sync",
      title: "Stage mode without internet (Bluetooth)",
      summary: "How the band stays on the same song over Bluetooth when the venue has no signal.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["bluetooth", "offline", "no signal", "no wifi", "ble", "stage key"],
      related: ["stage-mode", "lead-stage-mode", "follow-in-stage-mode"],
      body: [
        {
          type: "p",
          text: "In the iPhone, iPad and Android apps, the admin's phone also sends the current song and the order over Bluetooth. Members' phones nearby pick it up with no pairing and no internet.",
        },
        {
          type: "steps",
          title: "Get ready before the gig",
          items: [
            "Everyone opens the gig once while online. The app keeps the setlist (with lyrics and charts) and the gig's Bluetooth key on the phone.",
            "Turn Bluetooth on and allow BandWith to use it.",
            "On stage, everyone opens Stage mode. The leader shows **Bluetooth** or **Live · BT**; members show **· BT** after their follow label.",
          ],
        },
        {
          type: "list",
          title: "When it doesn't connect",
          items: [
            "“Bluetooth is off or not allowed. Turn it on in Settings to stay in sync without internet.”",
            "“This phone has an older setlist. Connect to the internet once to follow over Bluetooth.” This shows when songs were added or removed after the phone last loaded the setlist. A new order alone is fine.",
          ],
        },
        {
          type: "note",
          tone: "privacy",
          text: "Each gig has its own secret key, given only to the band's active members. Only phones with the key find the leader and accept its messages.",
        },
        {
          type: "devices",
          rows: [{ devices: ["web"], text: "No Bluetooth sync and no copy of the setlist on the device: Stage mode on the web needs the internet." }],
        },
      ],
    },
    {
      id: "stage-mode-on-devices",
      title: "Stage mode on phones, tablets and dual-screen devices",
      summary: "How Stage mode lays out on each device and posture.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["landscape", "ipad", "surface duo", "floor wedge", "laptop pose", "full screen", "sidebar", "page turner"],
      related: ["stage-mode", "device-differences"],
      body: [
        {
          type: "devices",
          rows: [
            { devices: ["phone"], text: "One column: header, run of show, setlist or song, Prev / Next at the bottom." },
            { devices: ["phoneLand", "duoClosed"], text: "On its side (short and wide), the times and steps sit on the left and the setlist or song on the right." },
            { devices: ["tablet", "duoBook", "duoLand"], text: "Stage mode opens beside the list pane. **Hide sidebar** gives it the whole screen: then the times and steps sit on the first pane and the setlist or song on the second, split at the panes' edge so nothing sits on the fold. **Show sidebar** brings the list back. The choice is kept on the device." },
            { devices: ["duoClosed"], text: "**Open stage mode** is in the rail; on gig day it is the rail's main action. **Hide sidebar** hides the rail in Stage mode." },
            { devices: ["duoLaptop"], text: "Floor wedge: stand the device on the stage floor like a monitor. The top half shows the song counter (**Song … of …**), title, key, BPM, next song and elapsed time, or the lyrics. The bottom half has big **Prev** and **Next** pads and the set's progress. Arrow keys, Page Up/Down and Space also step, so Bluetooth page-turner pedals work." },
            { devices: ["web"], text: "Live sync over the internet and the click work. No Bluetooth, and no offline copy of the setlist." },
          ],
        },
        { type: "p", text: "Android Back and Escape leave Stage mode first, not the gig underneath." },
      ],
    },
  ],

  faq: [
    {
      q: "Can members edit songs or setlists?",
      a: "No. Members read every song and setlist. They suggest new songs and changes to lyrics, chords or notes, and an admin reviews them. Setlists are admin-only to edit.",
      roles: ["member"],
    },
    {
      q: "Who sees my notes on a song?",
      a: "Only you. Not the band, not the admins. To share one, open it and tap Suggest to the band.",
    },
    {
      q: "I transposed a song in the reader. Did it change for everyone?",
      a: "No. Transposing in the reader or in Stage mode changes only your screen. To change the key for the band, an admin uses Transpose for the band in the song form.",
    },
    {
      q: "Why can't I import a song list?",
      a: "Importing a list goes straight into the band's library, so it is admin-only. Members suggest songs one at a time.",
      roles: ["member"],
    },
    {
      q: "Does changing a gig's setlist change the saved setlist I loaded it from?",
      a: "No. A gig gets its own copy, named after the gig. The setlist you loaded from stays as it was.",
      roles: ["admin"],
    },
    {
      q: "Does the band get a notification for every song I move?",
      a: "No. Nothing is sent until you save. Then each person gets one push summing up what changed.",
      roles: ["admin"],
    },
    {
      q: "Does Stage mode work without internet?",
      a: "In the phone and tablet apps, yes: open the gig once while online, and the leader's phone keeps the band in sync over Bluetooth. On the web Stage mode needs the internet.",
    },
    {
      q: "Can I hear the click?",
      a: "No. The click is visual: a glow around the screen edge on each beat.",
    },
    {
      q: "Why does my phone stop following the leader?",
      a: "Tapping Prev, Next or a song yourself stops following. Tap Follow leader to go back to the leader's song.",
      roles: ["member"],
    },
    {
      q: "What happens to a suggested song that the admin rejects?",
      a: "It is deleted with the files you attached, and you get a push with the admin's reason if they gave one.",
      roles: ["member"],
    },
    {
      q: "Why don't I see the iReal Pro forum inside the app on the web?",
      a: "The forum can't be shown inside a web page, so it opens in its own window. Copy a link there and tap Paste link, or drag the link onto the box.",
    },
  ],

  glossary: [
    { term: "Repertoire", definition: "The band's song library. Every active member reads every song.", see: "repertoire-overview" },
    { term: "Ready / Learning / Suggested", definition: "A song's status: played by the band, being learned, or proposed by a member and waiting for an admin.", see: "song-menu-actions" },
    { term: "Setlist", definition: "An ordered list of band songs for a gig or an occasion, written by admins.", see: "build-a-setlist" },
    { term: "Set", definition: "A part of a setlist, for example before and after a break (Set 1, Set 2).", see: "setlists-and-sets" },
    { term: "Template setlist", definition: "A saved setlist you load into a gig; the gig gets its own copy.", see: "setlists-and-sets" },
    { term: "Inline chords", definition: "Chords written in brackets right before the word they fall on, like [Am]word.", see: "lyrics-and-chords-format" },
    { term: "ChordPro", definition: "A text format for lyrics with chords in brackets. BandWith imports .cho, .chordpro and .pro files.", see: "import-chords-and-lyrics" },
    { term: "MusicXML", definition: "A file format for scores. BandWith reads its chord symbols and lyrics.", see: "import-chords-and-lyrics" },
    { term: "iReal Pro chart", definition: "A bar-by-bar chord chart with form, key, style and tempo, imported from an iReal Pro link.", see: "import-from-ireal-pro" },
    { term: "Song view", definition: "How a song is shown: Lyrics, Chords or Structure. Remembered per device.", see: "read-a-song" },
    { term: "Structure", definition: "The song's sections with their chords in boxes, or the iReal chart bar by bar.", see: "read-a-song" },
    { term: "Transpose for the band", definition: "Moving a song's key, chart and chords for everyone, from the song form.", see: "transpose-and-tempo" },
    { term: "My notes", definition: "Private notes and files on a band song, visible only to you.", see: "my-notes-and-files" },
    { term: "Suggestion", definition: "A member's proposal: a new song, a lyrics or chords correction, or a note for the band.", see: "review-song-suggestions" },
    { term: "Stage mode", definition: "The black gig-day screen with run of show, setlist and the current song.", see: "stage-mode" },
    { term: "Leader", definition: "In Stage mode, the band admin whose song changes and order reach every member.", see: "lead-stage-mode" },
    { term: "Follow leader", definition: "A member's Stage mode setting that keeps their current song on the leader's.", see: "follow-in-stage-mode" },
    { term: "Click", definition: "Stage mode's visual metronome: a glow on each beat, in time across phones.", see: "stage-click" },
    { term: "Run of show", definition: "Load in, Soundcheck, Show and End times at the top of Stage mode.", see: "stage-mode" },
    { term: "Floor wedge", definition: "Stage mode on a dual-screen device in laptop posture: song info on top, big Prev / Next pads below.", see: "stage-mode-on-devices" },
  ],

  shots: [
    {
      id: "music-repertoire",
      how: "Open the web demo. On Home, tap Repertoire under Quick Actions. Stay on Songs, scroll so the Band repertoire card and the first songs show.",
      role: "admin",
      viewport: "phone",
    },
    {
      id: "music-reader",
      how: "Home › Quick Actions › Repertoire. Tap the Harbor Lights row, then tap Chords. Switch to the Chords tab if it opens on another view.",
      role: "admin",
      viewport: "phone",
    },
    {
      id: "music-suggestions",
      how: "Home › Quick Actions › Repertoire. Tap Suggestions from members, then tap the Paper Boats lyrics correction. Leave Changes selected.",
      role: "admin",
      viewport: "phone",
    },
    {
      id: "music-setlist-editor",
      how: "Home › Quick Actions › Repertoire. Tap Setlists, open Rooftop set, then tap Add songs from library… so the library and the setlist order both show.",
      role: "admin",
      viewport: "tablet",
    },
    {
      id: "music-stage",
      how: "On Home, tap Go live under the next gig (Rooftop Session, today). Stay on the Setlist tab with the run of show visible.",
      role: "admin",
      viewport: "phone",
    },
  ],
};

export default music;

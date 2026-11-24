# Practice: Stage mode in private

Status: **plan only, no product code.** Written 2026-11-23, on top of `main` 4ba3059 (release 2026-11-24b merged). The direction in §1 is the owner's, agreed the same evening. This document is the plan of the **first step**, with its screens and entry points; steps 2 and 3 are outlined only. Nothing is built until the open questions (§14) are answered.

Mockups of step 1 exist as images outside the repo (§15 lists them by name).

Contents

1. The direction that was agreed
2. Who it is for, and the problem
3. What Practice is, and what it is not
4. What exists today (the plan builds on it)
5. The entry points
6. The Practice screen
7. Nothing shared, by construction
8. Data model
9. Flags, limits, analytics, languages, Academy, handbook
10. Tests to write first, and the device checklist
11. Step 1 cut into PRs
12. Steps 2 and 3 in outline
13. Risks
14. Open questions for the owner
15. Mockups

---

## 1. The direction that was agreed

- A band member, or a person with no band, can practise at home with the app. The feature is called **Practice**.
- It is **not a new module** and **not part of the band's rehearsals**. It is Stage / Live mode opened in private.
- Entry points, in order of importance:
  1. from a gig or its setlist: **Practice this set**;
  2. from a band rehearsal: **Practice the focus songs**, before going;
  3. from a single song: **Practice**;
  4. for accounts without a band: a **Practice** card on Home, as the main action.
- What differs from Stage and from a band rehearsal:
  - nothing is shared: no leader, no Bluetooth, no Realtime, no suggestions to the band, no order for everyone;
  - notes are private, and they are the song's existing **My notes**, so they stay with the song and show again at the gig;
  - a **personal tempo**: slower for me only, the band's BPM untouched.
- Later: looping a section and a private practice log (step 2); a real personal space for people without a band, and a possible paid plan for the freelance musician (step 3). Prices and plan values are never written in the repo: **values in the pricing doc**.
- English name: "Practice". "Studio" reads as a recording studio, "Rehearsal" as the band's.

## 2. Who it is for, and the problem

**The member with a band.** The setlist for Saturday is in the app, with lyrics, chords, charts, voice parts and the member's own notes. To go through it at home today, the member has two choices, both wrong:

- the song reader (`LyricsViewer`): one song at a time, no click, no count-in, no Follow the tempo, no next song;
- Stage mode on the gig, alone: it joins the gig's live channel and starts Bluetooth, the pill says "Waiting for leader", the count-in and Follow the tempo can't be started (they are the leader's), and if the admin happens to open Stage, the member's screen starts following.

An **admin** has it worse: opening Stage alone to practise *leads*. The song steps go out to every phone with Stage open, and a drag on the setlist saves a new order for the whole band.

**The person without a band.** A solo account or a deputy has no songs in the app at all (§4.3), so today there is nothing to practise with. This is the larger gap, and it is only partly a Practice problem (§14, Q1 and Q3).

## 3. What Practice is, and what it is not

It is:

- the Stage screen, with the same song views, on the songs of a set, of a rehearsal or one song;
- driven by me alone: I step through the songs, start the click, count myself in, start Follow the tempo;
- private: my tempo, my notes, my files, my transpose, my text size.

It is not:

- a band rehearsal. No session timer, no Mark, no notes for the band, no summary, no "Practised" tick sent to anyone (step 2 looks at that link again);
- a place to change the band's material. No reorder, no strike-off, no chord editing, no band count direction, no "who sings what";
- a practice app. No tuner, no recorder, no audio time-stretch, no lesson content (§13).

## 4. What exists today (the plan builds on it)

Checked on `main` 4ba3059. Paths are from the repo root.

### 4.1 Stage and Live mode

- **One component serves every live mode.** `src/app/components/dashboard/StageMode.tsx`, `kind?: 'gig' | 'rehearsal'` (`:128`, type in `src/lib/liveMode.ts:15`). `EventDetail.tsx` mounts it as an overlay (`:3164-3200`) and, in the Duo's Laptop pose, mounts `FloorWedgeMode` over it (`:3206-3240`).
- **Who gets it.** `liveKind()` offers it for upcoming band gigs and rehearsals, never for quotes, past events or personal gigs (`src/lib/liveMode.ts:26-31`).
- **Where it opens.** The ▶ button in the event's top bar (`EventDetail.tsx:1514-1528`), the Duo rail action (`:919-931`) and Home's "Go live" (`:907-912`).
- **It already has a read-only form.** `live?: StageLiveControls` is optional: "Without it Stage mode is the plain read-only view" (`StageMode.tsx:82-86`). Without `live` there is no Prev / Next, no click and no count-in (`:1080`, `:304`), so this form is too little for Practice.
- **The live hook is almost transport-free when given no event.** `useStageLive` only opens the channel when `eventId` is set (`const live = !!eventId && open`, `src/app/components/event/useStageLive.ts:318`) and passes the same switch to Bluetooth (`useStageBle({ … open: live … })`, `:511`). `EventDetail` already calls it with `eventId: undefined` for personal gigs (`:775`). Song steps, the click, the playhead and the count-in then stay on the phone: each of them only sends `if (isLeader)` (`:1195-1200`, `:1217-1220`, `:1234-1238`, `:1288-1289`).
- **But the things a practising person needs are the leader's.** The count-in needs `isLeader` (`StageCountIn.tsx:136-139`), and so does starting Follow the tempo (`StageFollow.tsx:223-230`). A lone member gets neither.
- **And a leader without transport still writes.** With `isLeader` and a `setlistId`, a drag saves the order to `setlist_songs` (`useStageLive.ts:1076`, `canReorder` at `:1519`), and the count-in sheet offers the **band's** count direction (`StageMode.tsx:1183`). So "reuse `useStageLive` with no event" is not safe enough on its own (§7).
- **The floor wedge already runs alone.** `FloorWedgeMode` keeps its own counter when no `index` is passed, and `follow` is optional (`src/app/components/duo/modes/FloorWedgeMode.tsx:79-80`, `:85`).
- **Everything tempo-related reads the song's `bpm`.** The click (`StageClick.tsx:119`), the count-in (`StageCountIn.tsx:136`), the Follow timeline and its start (`StageFollow.tsx:172-183`, `:230-233`). Line timing is stored in beats, "so it survives a tempo change" (`src/lib/lineTiming.ts:1-5`).
  - One exception: a lyrics-only timeline fits its bars from the song's **length in seconds** and the BPM (`src/lib/playhead.ts:109`). A slower BPM with the same length gives fewer bars. Practice must scale the length with the tempo (§6.4).
- **The click is visual only.** Sound exists for the count-in (`src/lib/liveAudio.ts`, used by `StageCountIn.tsx`), not for the click (§14, Q6).
- **"Rehearsal speed · Play at 80%"** was written into the live plan as an extra (`docs/plans/live-offline-and-tempo.md:222`) and never built. My tempo (§6.4) is that idea, moved to where it belongs.
- **Kill switches** `follow_tempo`, `count_in`, `voice_parts`, `live_pack`, `ble_live` (`src/lib/appFlags.ts:22-31`, `docs/flags.md`).

### 4.2 What on a song is already private per person

| Thing | Where it lives | Private? |
| --- | --- | --- |
| **My notes** on a song, a line, a word or a chord | `song_personal_notes`, migration 109: RLS `user_id = auth.uid()` on every command, **no admin exception** (`supabase/migrations/109_song_personal_layer.sql:18-20`, `:89-97`) | yes, per account |
| **My files** (a recording, a score) | `song_personal_files` + private bucket `personal-files/<my id>/` (109) | yes, per account |
| My notes written with no signal | the live outbox (`src/lib/liveOutbox.ts:32-34`), "Note saved on this phone" (`PersonalLayer.tsx:644`) | yes |
| Transpose | `localStorage` `bw-transpose:<songId>` (`src/app/components/ui/Transpose.tsx:27-57`) | yes, per device |
| Song view, text size, Follow the tempo on / off, count-in sound and vibration | device preferences (`useSongViewPreference`, `useLyricsSize`, `StageFollow.tsx:73-84`, `src/lib/countInPrefs.ts`) | yes, per device |
| Highlight my part | device preference; the parts themselves are the band's | the choice is private |
| Lyrics, chords, chart, key, **BPM**, time signature, count-in bars, pickup, backing track, line timing | `songs` (171) | the band's; admins write, members suggest (108) |
| Voice parts, who sings what | markers in the lyrics, `songs.vocal_parts`, `setlist_songs.vocal_parts` (172); assigning is admin-only (`WhoSingsWhat.tsx:109-111`) | the band's |
| Count direction (4 3 2 1 or 1 2 3 4) | `bands.count_in_style` | the band's |
| Rehearsal notes, "Practised" ticks | `rehearsal_notes` (132) | the band sees them |

Two details matter for Practice:

- **My notes are already on Stage**, in a `stage` look (`StageMode.tsx:890-899`, `PersonalLayer.tsx:293`). Practice gets the notes surface for free.
- In a rehearsal's Live mode, tapping a line asks "Note for me" or **"Note for the band"** (`PersonalLayer.tsx:554`, `:569`). The second choice only appears when the caller passes `onBandNote` (`StageMode.tsx:893-897`). Practice does not pass it.

My notes need a song of a band I am in: the insert policy checks `bw_song_in_my_bands(song_id)` (109, `:91-92`).

### 4.3 Accounts without a band

- **How it is represented.** No "personal band": `profiles.user_mode = 'solo'`, zero `band_members` rows, no selected band (`src/lib/AuthContext.tsx:576-583`, `src/lib/OnboardingContext.tsx:381`). The onboarding offers it as "Solo schedule" (`IntentSelector.tsx:41-43`).
- **What the app does with it.** `isSolo` hides band things one place at a time: the quick actions on Home (`HomeView.tsx:272-277`), Chat (`AuthenticatedApp.tsx:4505`, `:4540`), rehearsals and quotes (`:4500-4501`), the band name in the menu becomes "My calendar" (`IdentityHub.tsx:616`). Tonight's bug (a solo account offered band-only things) is this pattern missing in some places; another job is fixing it and this plan does not touch it.
- **What a solo account owns.** Personal gigs: events with `band_id` null (`HomeView.tsx:672-674`), which have no setlist and no Stage (`liveMode.ts:27`).
- **Deputies.** An account with no band but with deputy gigs lands on Deputy gigs instead of Home (`App.tsx:340-365`). Deputies cannot read a band's setlist or songs: reading `setlist_songs` requires `bw_is_band_member` (`074_setlists_templates_admin_only.sql:42-47`). The live plan parked this as a privacy decision (`live-offline-and-tempo.md:284`).
- **There are no songs outside a band.** `songs.band_id` is `NOT NULL` (`002_complete_schema*.sql`), and My notes need a band song (above).

So, as the code stands, **an account without a band has nothing to open in Practice**. Entry point 4 needs a source of songs first (§8.3, §14 Q1).

### 4.4 Privacy rules new data must follow

- Members see only their own fee; nothing in Practice touches money.
- `anon` is revoked on every public table (100, 101). A new table grants nothing to `anon`.
- A column the app reads must be in a GRANT: `src/lib/services/__tests__/columnGrants.test.ts` fails otherwise. A new readable column is a new GRANT migration.
- RLS suites run on PGlite under `supabase/tests/*.pglite.mjs`, as admin, member, outsider and anon.
- Migrations are additive and idempotent, applied by hand after a rollback-only dry run with the migration's own `BEGIN; / COMMIT;` stripped, and only on the owner's OK.
- Account deletion and "Export my data" must know every per-person table. Today the export has no My notes (`src/lib/services/dataExport.ts:8-15`): an existing gap, noted here, not fixed here.

## 5. The entry points

Practice never uses Stage's ▶. Its buttons carry the **repeat** Dot Icon and the word "Practice", and each one has a mono line under it that says "Only you".

### 5.1 Gig → "Practice this set" (mockup A)

- **Where:** `EventDetail.tsx`, the SETLIST section (`:2212-2296`), a full-width outline button **under the setlist card and above the "Offline ready" row** (`{offlineReady}`, `:2293`).
  - Label: **Practice this set**. Line under it: "Only you · nothing reaches the band".
- **Also:** the same button
  - at the foot of the setlist drill-down sheet (`BwSheet`, `:2744-2757`);
  - in the tablet layout's Setlist tab (`:1864-1900`), under the list.
- **Not** in the top bar and **not** in the Duo rail: those keep Stage's ▶ (`:1514-1528`, `:919-931`), which on gig day is the screen's filled primary action.
- **Shown when:** a band gig, upcoming, with at least one song that has lyrics or a chart (`hasLyricsOrChart`, already used at `:1279`). Not on quotes (members can't read a quote's setlist, 178 `:559-566`), not on personal gigs, not on past gigs (§14, Q9).
- **Opens:** Practice on the gig's songs, in the saved order, starting at the first song, on the song view.

### 5.2 Rehearsal → "Practice the focus songs" (mockup B)

- **Where:** `EventDetail.tsx`, the FOCUS SONGS section (`:2298-2337`), under the chips and above "Offline ready" (`:2334`).
  - Label: **Practice the focus songs**. Line under it: "Before you go · only you".
- **Also:** at the foot of the same drill-down sheet (its title is "Focus songs · N" on a rehearsal, `:2755`).
- **Shown when:** a band rehearsal, upcoming, with at least one focus song that has lyrics or a chart.
- **Opens:** Practice on the focus songs.
- The section "From last time" sits right below (`:2347-2353`): what the band asked me to fix, then the button to go and fix it. Step 2 ties the two together (§12).

### 5.3 Song → "Practice" (mockup C)

Two places, because the app has two "song pages":

- **The song reader**, `src/app/components/ui/LyricsViewer.tsx`: a primary button pinned at the bottom of the reader, over the song.
  - Label: **Practice**, with the song's BPM at the right. Line under it: "Only you · your notes stay on the song".
  - The header is full already (title, play, edit chords, A−, A+, close: `:305-325`), so the button does not go there.
  - In the Laptop pose the reader's controls move to the Deck (`.bw-reader-controls`, `src/styles/index.css:520-538`); the button moves with them.
- **The song's row menu in Repertoire**, `src/app/views/SetlistManagerView.tsx:1121-1150`: a new item **Practice**, second in the list, after Play and before Lyrics. Shown when the song has lyrics or a chart.
- **Opens:** Practice on that one song: no Setlist tab, no Prev / Next (one song), everything else the same.

### 5.4 Home, account without a band → the Practice card (mockup F)

- **Where:** `src/app/views/HomeView.tsx`, for `isSolo`, the first card under the header: in the place where a band account has its quick actions, which solo accounts don't get (`:272-277`).
- **Content:** "Practice" as the title, the lock and "Only you", one line of what it is, "Pick up where you left" with the last song and my tempo, and two buttons: **My songs · N** and **Add a song**.
- **It depends on songs that don't exist today** (§4.3). The mockup shows the card as it should be; whether step 1 can ship it is Q1 in §14.
- A deputy-only account lands on Deputy gigs, not on Home (§4.3). It gets nothing in step 1 (§14, Q3).

### 5.5 A fifth one, proposed: Home "To practise" → Practice

Home already has a **To practise** section for members: songs with open rehearsal notes for me (`HomeView.tsx:593`, `:858`; `ToPractiseCard.tsx`). Each card opens the song reader today. With §5.3 the reader has the Practice button, so the path exists in two taps. Adding a small **Practice** button on each card makes it one (§14, Q8).

## 6. The Practice screen (mockups D, E, G)

`StageMode` gets a third kind, `'practice'`, and a small host mounts it from anywhere in the app (§7). Practice is the same component and the same styles, with parts switched off and two things added.

### 6.1 Kept from Stage

- The header's shape, full screen, Song only, the screen kept awake, system Back leaving it first.
- The Setlist tab and the song view tabs: Lyrics, Lyrics & chords, Chord chart.
- Text size, transpose.
- **My notes**: the switch, Note, my files, the notes on their lines, and writing with no signal.
- Voice parts, the legend and Highlight my part (read-only).
- Prev / Next, the click, the count-in with this phone's sound and vibration, Follow the tempo with its strip and the lit bar or line.
- The side setlist on wide layouts, the Laptop pose's floor wedge, arrow keys and page-turner pedals.
- "Offline · content from …" when the songs come from a pack, and "N changes waiting for signal" for my own notes.

### 6.2 Removed

| Removed | Why | In the code |
| --- | --- | --- |
| The run of show (load in, soundcheck, show, end) | not a gig night | `steps={[]}`, as rehearsals do (`EventDetail.tsx:3176`) |
| The leader pill: "Live", "Band follows you", "Following leader", "Waiting for leader" | there is no leader | `StageMode.tsx:794-829` |
| The Bluetooth line | no Bluetooth | `:833-844` |
| Reordering the setlist | the order is the band's | `canReorder` false |
| Striking a song off for tonight | a gig-night thing, and the band sees it | `canStrike` false (`:225`) |
| Stage manager: audio player, ▶ per song, "add a song" | plays to the house, adds to the band's setlist | `regia` not passed |
| Rehearsal session: Start rehearsal, timer, pause, summary | the band's rehearsal | `session` not passed |
| Mark and the band's rehearsal notes, "From last time" badges | visible to the band | `notes` not passed |
| "Note for the band" on a line | a suggestion to the band | `onBandNote` not passed (`:893-897`) |
| The band's count direction in the count-in sheet | a band setting | `style={null}` (`:1183`) |

In Practice I am my own leader for the three things that are the leader's on Stage: Next, the count-in and Follow the tempo all work, and none of them leaves the phone.

### 6.3 New: the marker

Nobody must take Practice for Stage, and an admin must never think the band is following.

- **Header overline:** a lock and **"Practice · only you"**, where Stage says "● Stage mode · Nov 23". Under it the title: the gig, the rehearsal or the song.
- **The slot where Stage says who drives** (right of the tabs) says something else here: the count-in options and **my tempo** (§6.4). The slot never shows "Live".
- **Exit** is "Exit practice". The dialog's name for screen readers is "Practice: {title}".
- **Song only and the floor wedge** hide the header, so their one line of text starts with the lock and "Practice · only you" (mockup G).
- **On the day of the event**, when Practice was opened from a gig or rehearsal that offers Stage today: one line under the header, "The band isn't following you here", with a link **Open Stage mode** that closes Practice and opens Stage.
- The colour stays lime (§14, Q5 shows the alternative).

### 6.4 New: my tempo (mockup E)

**What it is.** A percentage of the band's tempo, per song, for me. 100% is the band's.

- **Range:** 50% to 125%, in steps of 5%. The result is rounded to a whole BPM and kept inside 40–240 (`MIN_BPM`, `MAX_BPM`, `src/lib/tempo.ts:6-7`).
- **Why a percentage and not a BPM:** if the band moves the song from 96 to 100, my 80% follows. It is also how musicians say it ("at 80").
- **Songs with no BPM:** no control, and the same message Stage has today ("No BPM for this song"). A member can suggest the BPM to the band; an admin can add it. A personal BPM for songs without one waits for step 2.

**Where it is.**

- A pill right of the tabs: **Tempo** (outlined, at 100%) or **Tempo 80%** (filled, when it is mine).
- The click button shows **my** BPM (77, not 96).
- Laptop pose: the pill is on the Deck, next to Follow the tempo, and the Deck's status line reads "My tempo 77 · band 96".

**The sheet** (a `BwSheet`, like the count-in options):

- overline: lock, "{song} · only you"; title: **My tempo**;
- − and + (5% each), the percentage large, "77 BPM for me" under it;
- a scale from 50% to 125% with the band's tempo marked on it ("Band · 96 BPM");
- presets: 50, 60, 70, 80, 90, 100%;
- **Back to the band's tempo** (sets 100% and forgets the value);
- one paragraph: "Only in Practice, only for you. The click, the count-in and Follow the tempo slow down together. The band's 96 BPM doesn't change, and Stage always uses it."

**How it reaches the click, the count-in and Follow the tempo.** The host gives `StageMode` a copy of each song with `bpm` already multiplied. Everything downstream reads `song.bpm` (§4.1), so the three slow down together with no change to their engines. Two rules on top:

- the length in seconds is divided by the same factor, so a lyrics-only timeline keeps its bars (`playhead.ts:109`);
- changing the tempo while something runs: the click restarts at the new tempo on its next start; a running count-in or Follow the tempo stops (as a song change does today, `useStageLive.ts:1284-1287`).

**Songs played with a backing track.** On Stage the count-in is hidden for them, because the track starts the band. At home there is no track: Practice offers the count-in (the existing "Count in anyway" path, `StageCountIn.tsx:136`).

**Where it is stored.** Step 1: on the device, per account and song, next to transpose (`bw-practice-tempo:<user id>:<song id>`), cleared at sign-out like transpose. Step 2 moves it to the account (§8.2; §14, Q4).

**Stage never reads it.** The multiplication happens in the Practice host only. `EventDetail` keeps passing the band's songs to Stage.

### 6.5 Notes

- The surface is **My notes**, unchanged: the switch, "Note", the paperclip, the cards on their lines.
- Tapping a line while adding a note goes straight to the note for me. The choice sheet with "Note for the band" does not appear.
- The "i" sheet already says the right thing: "Your notes and files are yours only: nobody else in the band sees them, admins included" (`PersonalLayer.tsx:606`). Its last line, "To change it for everyone, use Suggest to the band", stays: it is the honest way out of Practice.
- A note written in Practice is on the song. It shows in the reader and on Stage at the gig, because they read the same table.

### 6.6 Offline

- **From a gig or a rehearsal:** Practice gets the songs `EventDetail` already holds, live pack included (`songsFromPack`, `:461`, `:3189`). Where Stage opens with no signal, Practice does.
- **From a song:** the song is the one on screen. My notes for it load from the server; with no signal, outside a pack, they may not be there. To check in PR 3, and to say so on screen ("Your notes need a signal for this song") rather than show an empty layer.
- **My tempo:** on the device, always there.
- **Writing:** my notes go through the live outbox, as on Stage.
- **Web app:** online only, as today.

### 6.7 Every device

- **Phone, upright and sideways:** Stage's layouts, unchanged. The pills take a line of their own when they don't fit beside the tabs, as on Stage (`StageMode.tsx:750-752`).
- **iPad and two-pane layouts:** the setlist beside the song; in a narrow pane the tabs (`:507-526`).
- **Duo closed (rail):** the rail keeps its actions; Practice adds none to it.
- **Duo book and open:** as Stage: one pane beside the app, or both in full screen.
- **Duo Laptop pose (mockup G):** the upper pane shows only the song, with the marker in its first line; the lower pane has every control: views, transpose, Follow the tempo, my tempo, count-in options, My notes, the four pads, progress and Exit.

## 7. Nothing shared, by construction

The guarantee does not rest on "we remembered to hide the button". It rests on what the Practice code can reach.

1. **A hook of its own, with no transport in it.** `usePracticeLive(songs)` returns the same `StageLiveControls` shape `StageMode` takes (`StageMode.tsx:87-120`): index, select, go, click, count-in, playhead. It is local state plus the pure libraries (`stageClick.ts`, `countIn.ts`, `playhead.ts`, `stepOver`). It does **not** import `supabase`, `useStageLive`, `useStageBle`, `useStageRegia`, `useRehearsalSession` or `useRehearsalNotes`.
2. **A test that reads the imports.** A unit test walks the import graph of the Practice host and its hook and fails if any of those modules, or `saveStageOrder`, `notifySetlistSaved`, `songSuggestions`, `rehearsalNotes` services, appears. The only server write allowed in the graph is My notes and My files (`services/personalLayer.ts`).
3. **No event id, no setlist id.** The host receives songs, a title and a band id for My notes. It is never told which event it came from, except a boolean for §6.3's "Open Stage mode" line. With no ids there is no channel topic to join and no row to save.
4. **A test that watches the wire.** An e2e spec opens Practice, steps through the songs, starts the click, the count-in and Follow the tempo, changes my tempo, and asserts: no WebSocket frame on a `stage:` topic, no request to `setlist_songs`, `setlists`, `songs` (writes), `rehearsal_*`, `song_suggestions`, `notifications`. A second browser context with Stage open on the same gig sees nothing move.
5. **The kinds don't share state.** Practice has its own host and its own open / closed state. Opening Practice does not set `isStageOpen`, so `useStageLive` for the event stays closed.
6. **My tempo never leaves the host** (§6.4).

Why not reuse `useStageLive` with no event id: it works today (§4.1), but the safety would be a set of conditions inside a 1,500-line hook that other work keeps changing. One of them changing would make an admin's practice lead the band.

## 8. Data model

### 8.1 Step 1: no table, no column, no policy

- My notes and My files: migration 109, as it is.
- My tempo: on the device.
- The only database change is the kill switch's seed row (§9.1): **migration 200**, one `INSERT … ON CONFLICT (key) DO NOTHING` into `app_flags`. The app works without the row.

### 8.2 Reserved for steps 2 and 3

The highest migration on `main` is **198**. No PR is open. 199 is left free for tonight's solo-account fix, should it need one. **Reserve 200–209 for Practice**: 200 the flag, 201–204 step 2, 205–209 step 3. Check `ls supabase/migrations` and the open PRs again when work starts.

A private per-person table in this product looks like 109. Sketch for step 2 (not final DDL):

**`practice_song_prefs`** (201): my tempo on the account, so it follows me to the iPad.

- `user_id uuid not null default auth.uid() references profiles(id) on delete cascade`
- `song_id uuid not null references songs(id) on delete cascade`
- `tempo_pct smallint check (tempo_pct between 50 and 125)`, `tempo_bpm smallint check (tempo_bpm between 40 and 240)` (only for songs with no band BPM), `updated_at`
- primary key `(user_id, song_id)`

**`practice_log`** (202): what I practised, for me.

- `id`, `user_id` (as above), `song_id` (nullable: `on delete set null`, with `song_title` copied), `practised_on date`, `seconds int`, `tempo_pct smallint`, `source text check (source in ('gig','rehearsal','song','home'))`, `created_at`
- no event id, no band id: the log does not say which gig I was preparing

Both, exactly as 109:

- `ENABLE ROW LEVEL SECURITY`; `REVOKE ALL … FROM PUBLIC, anon, authenticated`; `GRANT SELECT, INSERT, UPDATE, DELETE … TO authenticated`; nothing for `anon`.
- Four policies, each `user_id = auth.uid()`, **with no admin exception**. Insert and update also check `bw_song_in_my_bands(song_id)`.
- A trigger that pins `user_id` and `song_id` on update (109 `:114-128`).
- Not in the Realtime publication. Not in any band-wide view, RPC or analytics card: admins must not learn who practised and who didn't. Member stats (083) do not read them.
- In account deletion (cascade on `profiles`), and in "Export my data" when it is next touched.
- A PGlite suite (§10).

### 8.3 A personal space: how to represent it

Step 3, but the choice shapes Q1. Three ways:

| | **A. A personal band** (one member, `bands.is_personal`) | **B. No band, special cases** (`songs.band_id` nullable + `owner_id`) | **C. Separate tables** (`personal_songs`, `personal_setlists`) |
| --- | --- | --- | --- |
| Songs, setlists, importers, chord editor, reader | work as they are | every query and service that filters on `band_id` gets a second branch | new screens or adapters for each |
| My notes, My files, Stage, Practice, live packs | work as they are (`bw_song_in_my_bands`, `bw_my_band_ids`) | every helper and policy gets `OR (band_id IS NULL AND owner_id = auth.uid())` | parallel copies |
| RLS | existing policies apply; **new guards**: no second member, no invitations, no deputies, no band chat, no public quote pages for a personal band | the policies of `songs`, `setlists`, `setlist_songs`, 108, 109, 170, 172 and the `song-files` storage policy all change | simple (`user_id = auth.uid()`), nothing existing changes |
| Risk to privacy | low: the band-keyed suites already cover it; the guards need their own suite | high: one missed branch exposes or hides a song | low |
| Paid plan | the plan is on the band (`band_plans`), so a plan for the solo musician has a home | needs plans per person | needs plans per person |
| Account deletion | already erases one-member bands with the account (`180_account_deletion_safety.sql:461-510`) | new | new |
| Joining a real band later | "Move to the band" copies songs between two bands | the same, between null and a band | the same, between two models |
| What it costs | hiding band-only surfaces for a personal band (the list tonight's fix is making), keeping it out of every count of bands (beta counter, `bands_as_admin`, analytics), a name in the switcher ("My songs") | a long, risky sweep of RLS | building the music screens twice |
| Migration | one column, the guards, nothing to backfill (created the first time the person adds a song) | altering `songs` and its policies | new tables |

**Recommendation: A.** Everything Practice needs is keyed on a band id, and so is the privacy test suite. A personal band reuses all of it; its cost is a known list of surfaces to hide and counts to exclude. B changes the most sensitive policies in the product for the same result. Personal gigs stay as they are (`band_id` null); moving them into the personal band is a later question.

## 9. Flags, limits, analytics, languages, Academy, handbook

### 9.1 Kill switch

- A new key **`practice`** in `APP_FLAG_DEFAULTS` (`src/lib/appFlags.ts:22`), on by default, a row in `docs/flags.md`, the seed row in migration 200. `scripts/flags-doc.test.ts` keeps the table and the code in step.
- **Off:** every entry point renders nothing (§5), and an open Practice closes back to where it was opened. **Stays:** My notes, the reader, Stage. My tempo values stay on the device for when it is back.
- Inside Practice the existing switches keep working: `follow_tempo`, `count_in`, `voice_parts`. `ble_live` and `live_pack` have nothing to switch (no Bluetooth; packs are read, never downloaded, by Practice).
- No per-band flag (`band_features`) in step 1: Practice is not the band's to turn on.

### 9.2 Plan limits

- Practice is a tool, so it is in Free, whole: the product's rule is "every tool free, limits on quantities" (`docs/plans/paid-plans.md:30`).
- Step 1 adds **no limit key** to `LIMIT_KEYS` (`src/lib/plans.ts:19-30`).
- If step 2 or 3 limits a quantity (the length of the practice log kept, the number of personal songs), it is a key in `plan_limits` with its value in the database: **values in the pricing doc**, never here.
- My notes and My files are not counted against the band's storage today (`src/lib/planLimit.ts:40`); Practice changes nothing there.

### 9.3 Analytics

- Opt-in, native apps only, and "only screen names are logged by hand, never ids, names or content" (`src/lib/appAnalytics.ts:5-15`).
- Practice logs one screen name, **"Practice"**, with `enterScreen` as Stage does (`StageMode.tsx:260`). Nothing about which song, which tempo or how long.

### 9.4 Languages

About 25 new strings, each through `t()`, in the five locale files (`src/lib/i18n/locales/{it,es,fr,de,pt}.ts`), keyed by the English text. The i18n test fails on a missing key.

- New: Practice · Practice this set · Practice the focus songs · Practice · only you · Only you · nothing reaches the band · Before you go · only you · Only you · your notes stay on the song · Exit practice · Practice: {title} · My tempo · Tempo · Tempo {percent}% · {bpm} BPM for me · Band · {bpm} BPM · Back to the band's tempo · the paragraph of §6.4 · The band isn't following you here · Open Stage mode · Count yourself in · My songs · {count} · Add a song · Pick up where you left · Continue.
- Changed: "Count in the band" (`StageCountIn.tsx:399`) reads "Count yourself in" in Practice.
- The Italian name is to settle with the owner: "Studio" and "Prove" are out by the same reasoning as in English; "Esercitati" is the candidate (§14, Q7).
- An overflow pass in German and Italian on the Duo closed and in the Laptop pose, as for every release.

### 9.5 Academy

- **New article**, in the Music section (`academy/content/music.ts`): **"Practice at home"** (id `practice-at-home`): what it is, the four ways in, the marker, my tempo, notes, what it never does. Translated in `academy/content/i18n/{it,es,fr,de,pt}/music.ts`.
- **Updated:** "Stage mode" (a line and a link: "to go through the set alone, use Practice"), "Read lyrics and chords" (`read-a-song`: the button), "Song menu: every action" (`song-menu-actions`: the item), "Transpose a song and find its tempo" (`transpose-and-tempo`: my tempo is not the band's), the gig and rehearsal page articles (the buttons), the My notes article (written in Practice, shown on Stage).
- The "?" on the Practice screen opens the new article.
- Screenshots per device with the recapture recipe (`academy/scripts/capture.mjs`), the demo band, the gig at The Loft, Brooklyn.
- `prerender --update-lastmod` after the texts.

### 9.6 Handbook

- A section `id="art-practice-at-home"` in `docs/handbook/en/ch-music.html` and `docs/handbook/it/ch-music.html`. Both builds fail until it exists once the Academy article does (`docs/handbook/README.md:40`).
- Both PDFs rebuilt and checked on the contact sheets.

## 10. Tests to write first, and the device checklist

Each PR ships its tests failing first.

**Unit (vitest)**

- `practiceTempo`: percentage to BPM (rounding, the 40–240 clamp, 50–125 in steps of 5), length in seconds scaled, 100% returns the song untouched, a song with no BPM returns no control.
- `practiceSongs`: the copy given to `StageMode` carries my BPM; the original list is never mutated (the object Stage would get is the band's).
- `usePracticeLive`: select, go, the click, the count-in and the playhead with one phone; a song change stops the count-in and the playhead.
- **The import-graph test** of §7.
- `StageMode` with `kind="practice"`: the marker is there; none of these exist in the DOM: the leader pill, the Bluetooth line, the run of show, strike-off, the reorder handles, Start rehearsal, Mark, the Regia bar, "Note for the band", the band's count direction.
- **Characterisation first:** the gig and rehearsal kinds render exactly as before (the existing Stage tests stay green untouched).
- Flag off: every entry point renders nothing; an open Practice closes (`__setAppFlagsForTest({ practice: false })`).
- The click, count-in and Follow the tempo at 80% of 96: beats 779 ms apart, the count-in's length, the lit line at the right time, with a lyrics-only song included.

**e2e (Playwright, `e2e/specs/practice.spec.ts`, a row per flow in `e2e/FLOWS.md`)**

- As a **member** and as an **admin**: open from a gig, from a rehearsal, from the row menu, from the reader; the marker; Next; the click; the count-in; Follow the tempo; my tempo set, kept after closing, reset; a note on a line, then the same note in the reader and in Stage.
- **The wire test** of §7, with a second context in Stage on the same gig.
- **The admin's safety:** an admin in Practice presses Next ten times; the saved order and the other context's current song don't change.
- Offline (`context.setOffline(true)`): Practice from a gig with a pack opens, the tag shows, a note queues and syncs.
- Smoke (`@smoke`) on all 10 device profiles (`e2e/support/devices.ts:105-139`); full on `phone-portrait`; `@laptop` on `duo-laptop`; `@duo-book` on `duo-book`.
- axe (`a11y.spec.ts`): the Practice screen, the tempo sheet, the buttons. No new exceptions.
- An XState model `practice` in `e2e/models` (closed → open → clicking / counting / following → tempo sheet → closed; flag off from each state), in the required lifecycles check.
- The screen-map crawler re-run: Practice is a new state for member and admin, with no dead end.

**PGlite (`supabase/tests`)**

- Step 1: none new (no table). The existing 109 behaviour is what Practice relies on; a short suite `song_personal_notes.pglite.mjs` is worth adding now if none covers it: author reads and writes; **a band admin reads nothing**; another member nothing; outsider and anon nothing; an insert on a song of a band I'm not in is refused.
- Step 2: `practice_prefs_log.pglite.mjs`, the same five roles on both tables, plus: the tables are not in the Realtime publication, and no SECURITY DEFINER function returns their rows.

**Device checklist** (the integrated pass, before any candidate; Playwright alone is not enough)

| Device | What to look at |
| --- | --- |
| iPhone, upright | header one line, pills under the tabs, the song has the room, pads reachable by thumb |
| iPhone, sideways | setlist left, song right; the tempo pill doesn't push the tabs |
| Android phone (412 × 815) | the same; system Back leaves the tempo sheet, then Song only, then Practice |
| iPad, both ways | setlist beside the song; the sheet centred |
| Duo closed, portrait and landscape | nothing under the rail; the tempo sheet inside the pane |
| Duo book | Practice in one pane beside the app; full screen across both |
| Duo Laptop pose | song above, controls below, nothing on the fold, the sheet in the lower pane |
| Duo open, flat | as the iPad |
| Every one of them | the entry buttons on the gig, the rehearsal, the reader and the row menu; the tempo sheet and the note sheet portalled to `<body>` |

Needs the owner: ten minutes with a real instrument. Is 5% the right step? Is the lit line readable at 60%?

## 11. Step 1 cut into PRs

Sizes: **S** = a few hours with tests; **M** = about half a day to a day; **L** = more than a day, or touches the database and many screens. They are rough, and they follow the pace of the last releases.

| PR | What | Size | Depends on |
| --- | --- | --- | --- |
| **P1 · The Practice screen, hidden** | `kind: 'practice'` in `liveMode.ts` and `StageMode` (§6.2, §6.3); `usePracticeLive`; the host and `openPractice()` (a store, mounted once in `AuthenticatedApp`, like the reader at `:5367`); flag `practice` + migration 200 + `docs/flags.md`; the screen name for analytics; unit tests, the import-graph test, the characterisation tests. No entry point yet: nothing visible. | **M** | — |
| **P2 · My tempo** | `src/lib/practiceTempo.ts`, the device store, the pill, the sheet, the click's number, the rules of §6.4; unit tests. | **M** | P1 |
| **P3 · The ways in, for members** | the buttons on the gig, the rehearsal, the reader and the row menu (§5.1–5.3), the "Open Stage mode" line, the strings in five languages; `practice.spec.ts`, the wire test, `FLOWS.md`, the XState model. With Q8: the button on To practise. With Q7: the spelling. | **M** | P1, P2 |
| **P4 · Laptop pose and the device pass** | the floor wedge in Practice (the marker line, the tempo pill and status on the Deck, no follow status), iPad and Duo fixes from the checklist; `@laptop` and `@duo-book` specs. | **S–M** | P3 |
| **P5 · Academy and handbook** | the new article and the updated ones in six languages, screenshots per device, both handbook PDFs. | **M** | P3 |
| **P6 · Home card for accounts without a band** | **Not sized as part of step 1 until Q1 is answered.** With the recommendation (a personal band holding "My songs"), it is an **L** of its own: the column and guards (205–206), hiding band-only surfaces for a personal band, Songs for a solo account, the card. | **L** | Q1, Q2, tonight's solo fix merged |
| *(P2b · The click you can hear, Q6)* | *the click's beats through `liveAudio`, with the count-in's sound choices.* | *S–M* | *P2* |

**Step 1 for members (P1–P5): about four M-sized PRs, roughly two to three working days of sessions.** P1 and P5's texts can start together; P2 and P3 touch `StageMode` and go in order. P6 roughly doubles it and has decisions in front of it.

**Explicitly not in step 1**

- Looping a section, slowing down by section, a tempo that speeds up by itself.
- A practice log, streaks, statistics, anything that counts me.
- Playing the song's recording, at any speed.
- My tempo on the account (it is on the device).
- A personal BPM for songs that have none.
- Songs or setlists of my own; a personal space; a paid plan.
- Deputies practising a band's set.
- Anything the band can see about my practice, the "Practised" tick included.
- A Practice entry in the tab bar, the "+" menu or the Duo rail.
- The web app offline.

## 12. Steps 2 and 3 in outline

**Step 2 · Practice gets a memory** (reserved migrations 201–204)

- **Loop a section:** tap a section heading, "Loop": the playhead (or the click alone) repeats it, with a one-bar count-in before each pass. Built on `holdSection` (`StageFollow.tsx:240`), which already repeats a section for the leader.
- **Tempo that grows:** "+5% each pass until 100%".
- **My tempo on the account** (`practice_song_prefs`), with the device values moved up on first run.
- **A private log** (`practice_log`): what I played, how long, at what tempo; shown only to me, on the song and on Home's card.
- **The link to the band's rehearsal, on my terms:** in Practice, the open rehearsal notes for me on this song, read-only ("From last time"); when I leave, "Mark as practised?" for those notes. That tick *is* shared, and the sheet says so: "The band sees this tick."
- **A personal BPM** for songs without one.
- **Deputies** (if Q3 says yes): a deputy who said yes to a gig can read that gig's songs, read-only, until the day after, and practise them.

**Step 3 · A personal space** (reserved 205–209; options in §8.3)

- My songs and my setlists, with the importers that exist (iReal, paste, song list).
- A Home of my own for an account without a band: Practice, my songs, my personal gigs, my deputy gigs.
- "Move to the band" when I join or start one.
- **A paid plan for the freelance musician** (own gigs, earnings, deputy work), following "every tool free, limits on quantities". The limits and prices: **values in the pricing doc**. The plans stay off until the owner turns them on, like the others.

## 13. Risks

| Risk | What it looks like | What the plan does |
| --- | --- | --- |
| **Confusion with band rehearsals** | "Practice", "Rehearsal", "Live mode", "To practise" in one app; a member thinks Practice is where the band meets | The name is never used for the band's thing; every entry says "Only you"; the Academy article opens with the difference; no session timer or summary in Practice, so it doesn't look like a rehearsal |
| **An admin thinks the band is following** | gig night, Practice opened by mistake, Next pressed, nothing happens on the other phones | The marker (§6.3); ▶ stays Stage's and stays the primary action on gig day; the "Open Stage mode" line on the day |
| **A member changes something they think is private, and it is shared** | reordering, striking off, the count direction, a note for the band, the Practised tick | None of these exists in Practice (§6.2), and the code cannot reach them (§7) |
| **The reverse: they think it is shared, and it is private** | a member sets 80% and expects the band to slow down; writes "wrong chord" in My notes and expects a fix | The tempo sheet's paragraph; "for me" on the BPM; My notes' own "i" sheet and its "Suggest to the band" line |
| **My tempo leaks into Stage** | a gig counted in at 77 | Applied only inside the Practice host; a test that Stage's songs carry the band's BPM after Practice was used |
| **Scope creep into practice-app territory** | tuner, recorder, audio slow-down, lessons, gamified streaks | §3 and the "not in step 1" list; the test for anything new: *is it the band's material, read privately?* If not, it isn't Practice |
| **Scope creep into the personal space** | the Home card pulls in songs, setlists, a second Home | P6 is its own PR behind its own question; P1–P5 ship without it |
| **A shared component breaks Stage** | `StageMode` has three kinds now | Characterisation tests first; `practice` only removes and adds props, the gig and rehearsal paths are not edited; every caller listed in the PR |
| **A band admin learns who practises** | a log table readable band-wide | No table in step 1; step 2's tables have no admin exception, no Realtime, no RPC; the PGlite suite checks an admin reads nothing |
| **Tempo maths wrong on some songs** | the lit line drifts on a lyrics-only song | The length scaled with the tempo (§6.4), a test for it |
| **The silent click** | "a metronome I can't hear" at home | Q6 |

## 14. Open questions for the owner

Each with a recommendation.

**Q1 · The Home card for accounts without a band has no songs to open.** A solo account has no songs, and can't have any: songs belong to a band (§4.3).
- (a) Build "My songs" first, as the small core of the personal space (a personal band, §8.3), then the card: P6, an L, after P1–P5.
- (b) Ship the card with step 3, not in step 1.
- (c) Songs kept only on the device, as a stop-gap.
- **Recommendation: (a), in that order.** Members get Practice first (P1–P5). The card ships when it has something real behind it. (c) is code to throw away and songs to migrate later.

**Q2 · How a personal space is represented.** §8.3. **Recommendation: a personal one-member band, flagged.**

**Q3 · Deputies.** The person without a band who most needs Practice is the deputy learning Saturday's set, and deputies can't read a band's songs today. Letting a deputy who said yes read that one gig's songs is a privacy decision the live plan left open. **Recommendation: yes, read-only, that gig only, until the day after; as part of step 2, with its own RLS suite. Not in step 1.**

**Q4 · Where my tempo is kept in step 1.** On the device (like transpose: no migration, works with no signal, lost at sign-out) or on the account (follows me to the iPad; a table, a suite and an offline queue). **Recommendation: the device now, the account in step 2 with the log.** Step 1 then changes nothing in the database but one flag row.

**Q5 · The colour of Practice.** Lime, as everywhere, with the lock and "Practice · only you"; or the "personal" pink the app already uses for personal gigs, which can't be mistaken at arm's length (the alternative mockup). **Recommendation: lime.** It is the colour musicians learn on Stage for "current" and "next", and pink already means a personal gig. To look at again if the first testers mix the two screens up.

**Q6 · A click you can hear.** The click is visual only (§4.1). At home, people expect to hear it. The sound engine exists for the count-in. **Recommendation: yes, in Practice only, as P2b if it stays small (the count-in's sound choices, headphones by default); otherwise the first item of step 2.**

**Q7 · Spelling, and the Italian name.** "Practice" (the noun) is right everywhere. The buttons use the verb the American way ("Practice this set"), while the app already says "To practise" and "Practised". **Recommendation: American spelling throughout, and change the two existing strings in P3** (the US-first rule). For Italian: **"Esercitati"** for the buttons ("Esercitati su questa scaletta") and for the screen's name; to confirm with the partner.

**Q8 · A Practice button on Home's "To practise" cards.** **Recommendation: yes, in P3.** It is the place where the app already tells me what to practise.

**Q9 · Past gigs.** Practice on upcoming gigs and rehearsals only, or on past ones too (last month's set is often next month's)? **Recommendation: upcoming only in step 1.** The songs stay reachable one by one from Repertoire; a set from the past comes back with "My setlists" in step 3.

**Q10 · Where the count-in button says "Count in".** On Stage the leader counts in the band; in Practice I count myself in, on a song with a backing track too. **Recommendation: as written in §6.4, to confirm.**

## 15. Mockups

Static images of step 1, in the app's design language (tokens from `src/styles/theme.css`, type from `fonts.css`, the Dot Icons from `public/icons`, Stage's layout from `StageMode.tsx`), with the demo band Velvet Static and the gig at The Loft, Brooklyn. They are not app code and they stay out of the repo.

| File | Screen |
| --- | --- |
| `a-gig-practice-this-set.png` | Gig, scrolled to Setlist, with "Practice this set" |
| `b-rehearsal-practice-focus-songs.png` | Rehearsal, with "Practice the focus songs" |
| `c-song-practice.png` | The song reader, with "Practice" |
| `d-practice-screen.png` | Practice on a song: the marker, my tempo, a note of mine, the click |
| `e-practice-my-tempo.png` | The tempo sheet open |
| `f-home-no-band-practice-card.png` | Home of an account without a band, with the Practice card (depends on Q1) |
| `g-practice-duo-laptop.png` | Practice in the Duo's Laptop pose |
| `d-alt-practice-screen-personal-accent.png` | The alternative of Q5 |
| `overview.png` | All seven side by side, with captions |

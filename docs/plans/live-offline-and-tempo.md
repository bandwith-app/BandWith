# Live mode: setlists offline on every device + follow the tempo

Status: **plan, waiting for the owner's approval (2026-11-21).** Nothing is built.
Planned on top of `main` b30d77c. Release target: its own release, separate from the refactor, the community and sheet music (see §8).

Contents

1. What the owner wants
2. What exists today
3. Part A — the setlist offline on every member's device
4. Part B — "Follow the tempo" (on/off)
5. Extras folded into the plan
6. Data, migrations, privacy
7. Phases, rough time, testing
8. Release timing
9. Decisions taken (change any of them)
10. Later, not planned now

---

## 1. What the owner wants

The owner's words, paraphrased (2026-11-21):

1. In live mode (gig Stage and rehearsal Live mode), **lyrics, chords and structures must be available offline**.
2. A **sync with the BPM** for chords, lyrics and structure, **that can be switched on and off**.
3. **Members too** get the setlist(s) downloaded automatically on their devices. A **push notification asks them to accept the download and explains it well.**

Decisions already taken by the owner:
- Automatic download for every gig and rehearsal in the **next 7 days**.
- **The band leader starts** the tempo follow; every phone follows the same clock, and each person can switch the view off on their own device.
- The native apps (iOS, Android) come first. The web app stays online-only for now (§10).

## 2. What exists today

Checked on `main` b30d77c. Paths are from the repo root.

**Offline**
- One component serves every live mode: `src/app/components/dashboard/StageMode.tsx` (`kind='gig' | 'rehearsal'`), mounted by `EventDetail.tsx` as an overlay.
- Lyrics, chords and charts come from one query made by EventDetail: `setlist_songs.select('*, song:songs(title, artist, duration_seconds, key, bpm, lyrics, chord_chart, audio_url)')` (EventDetail.tsx ~543).
- A **native-only** copy of that list already exists: localStorage `bw-setlist-songs:<setlistId>` (`src/lib/stageBleNative.ts:67-107`). It is written only when the event is opened online; nothing prefetches it; charts are dropped when localStorage is full; it is cleared only at sign-out.
- A generic offline store already exists and is better: IndexedDB `src/lib/offline/storage.ts`, keyed per user and band, dropped on role change. Stage does not use it.
- Personal notes and files (`song_personal_notes`, `song_personal_files`) are fetched per song with no cache; file links expire after one hour.
- Lyric/chord edits do not refresh an open or cached setlist.
- "Go live" from Home needs the event in the cached list; otherwise it calls `refetchEvents`, which fails offline.
- Bluetooth (PR #93) carries only song index, order and struck-off songs — never content.
- Offline outbox exists for rehearsal notes only (`rehearsalNotesOutbox.ts`); reorder, personal notes and suggestions are lost offline.
- The web app has no service worker.

**Tempo**
- `songs.bpm`, `songs.key`, `songs.duration_seconds` exist; **no time signature** column (it lives only inside `chord_chart.time`), no count-in.
- `songs.chord_chart` (iReal-style `SongChart`, `src/lib/ireal.ts`) has sections → bars with repeats, endings, segno, coda, D.C./D.S. text, fermata, `%`/`%%`. **Nothing turns that road map into a linear order of bars.**
- `songs.lyrics` (Markdown sections + inline `[Am]` chords) has **no bars per line**. The only link between bars and lines is `proposeChordsFromChart` (an even spread, not stored).
- The synced click (`src/lib/stageClick.ts`, `useStageLive.ts`) already gives every phone the same beat (±20–40 ms, NTP-style offset) from one `startAt`. It is visual only, needs the internet, and its `bars` (count-in) field is never set by the UI.
- No playhead, no current bar/line/section, no auto-scroll anywhere. `ChordChart` renders one `data-bar` element per bar.

## 3. Part A — the setlist offline on every member's device

### 3.1 The "live pack"

One pack per event, stored in the IndexedDB offline store (`src/lib/offline/storage.ts`, key `live_pack:<eventId>`):
- event basics (title, date, venue, call time), setlist order and sets;
- per song: title, artist, key, BPM, time signature, count-in, lyrics, chord chart, line timing (Part B);
- the user's own personal notes and personal files (files saved with Capacitor Filesystem, not signed URLs);
- rehearsals: band notes and earlier notes for those songs;
- the stage key (already cached today);
- a `version` = hash of setlist + `songs.updated_at` + personal-layer timestamps.

**Never in the pack:** fees, contracts, quotes, other members' personal notes.

The localStorage `bw-setlist-songs:` copy is migrated into the pack on first run and then removed (keeps Bluetooth sync working, frees the 5 MB localStorage quota).

### 3.2 When it downloads

- On app open and app resume, when online: every upcoming gig/rehearsal **in the next 7 days** that the user takes part in (not declined) and that has a setlist.
- When a setlist or one of its songs changes, the server sends a **silent refresh** (iOS `content-available` background push, Android data message). It is best effort: iOS may delay it, so app open/resume stays the guaranteed path.
- Only after the member has accepted (§3.3). Admins get the same consent sheet the first time.
- Optional "Wi-Fi only" setting; a typical pack is text-only (tens of KB per song); personal files and audio are counted separately and shown in MB.
- A pack is deleted 24 h after the event ends, when the member leaves the band, when their role changes, and at sign-out.

### 3.3 Asking members: push + consent sheet

**The push** (server-side, translated with `profiles.preferred_language`, like 088–090):
- Sent once per member per event when the event enters the 7-day window (daily pg_cron job), or when a setlist is first attached to an event already inside the window.
- Not sent if the member already chose "Keep it automatic" (then the download is silent), declined the event, or has no app installed.
- Example (EN): **"Saturday's setlist, ready without signal"** — "Download lyrics, chords and structures for The Loft, Brooklyn (12 songs). Tap to see what's included."

**Tapping it opens the event with a consent sheet** (one screen, plain words, every Duo posture):
- Title: *Have the setlist with you, even without signal.*
- What: lyrics, chords, structures and your own notes for the songs of this gig. No fees, no contracts.
- Where: only on this device, private to you; it updates by itself until the gig and is removed the day after.
- Size: e.g. "about 1 MB".
- Buttons:
  1. **Download and keep it automatic** (primary) — this and every future setlist of this band, silently.
  2. **Only this gig.**
  3. **Not now** (asks again at most once, the day before).
- Changeable later in **Settings → Offline & live** (automatic on/off, Wi-Fi only, space used, delete all packs).

### 3.4 Where it shows in the flow

- **Event detail / readiness card:** a row "Offline ready ✓ · updated 2:32 PM" or "Download for offline".
- **Admins' readiness:** "Offline: 4 of 5 members ready" (each device reports its pack version; §6). Tapping it lists who is not ready, with "Remind" (one push).
- **Stage header:** a discreet tag "Offline · content from yesterday 6:02 PM" when the network is down; a warning if the pack is older than the last known change.
- **Home "Go live" and the rehearsal card** open from the pack when offline (no `refetchEvents`).

### 3.5 Writes while offline

One outbox (extending the rehearsal-notes outbox pattern) for: personal notes, "Note for the band"/suggestions, and the leader's reorder (applied locally and over Bluetooth at once, saved when back online). Flushed on reconnect, with a small "3 changes waiting to sync" tag.

## 4. Part B — "Follow the tempo" (on/off)

### 4.1 What the musician sees

- A switch **"Follow the tempo"** in Stage's view menu (next to Song only / Lyrics & chords / Chord chart). Per device, **off by default**, remembered like the song view.
- When on and the leader starts the song:
  - **Chord chart:** the current bar lights up; the chart scrolls to keep it in view.
  - **Structure:** the current section is highlighted; a top strip shows **"Next: Bridge in 4 bars"**.
  - **Lyrics & chords / Song only:** the current line is highlighted and the text scrolls smoothly; with no line timing (§4.3), it moves section by section with lines spread over the section's bars.
  - **Duo Laptop / floor wedge:** a big countdown "Chorus in 4" instead of the lyrics.
- When off: nothing changes from today.

### 4.2 Who drives it

- **The leader starts it** with the click: one bar of count-in (from the song's count-in setting), then bar 1. Every phone uses the clock the click already shares (`startAt` + measured offset).
- **Re-align:** the leader taps a section, bar or line → everyone jumps there. Essential live (a longer chorus, a vamp).
- **Hold:** a "Hold" button repeats the current section until released (vamps, solos). Fermatas and "ad lib" sections pause the playhead until the leader taps.
- **Stop** ends it; changing song stops it.
- Members can't move the shared playhead; they can switch the view off on their own device.

### 4.3 How the timeline is built

1. **From the chord chart (Level 1, automatic):** a new pure function `unrollChart(chart)` plays the road map out into a linear list of bars: repeats, 1st/2nd endings, D.C./D.S. al Coda/Fine, segno/coda, `%`/`%%`, "x2/3x" text, time changes. Bar durations come from BPM and time signature.
2. **Lyrics without a chart:** sections from the lyrics headings, with "bars per section" (default from the chart when sections match by name, else editable; "x2" respected).
3. **Line by line (Level 2, optional):** in the song editor, **"Sync lines"**:
   - **Tap along:** play the song's recording (`audio_url`) and tap at the start of each line; stored as beat positions (so it survives tempo changes);
   - or set **bars per line** by hand, pre-filled from the chart.
4. Songs with no BPM: the switch is shown disabled with "Add a BPM to follow this song".

### 4.4 Song editor additions

Next to BPM in `AddSongModal` / `TempoKeyTools`: **time signature** (pre-filled from the chart or import), **count-in bars** (default 1), and the optional **Sync lines** step.

## 5. Extras folded into the plan

- **Click and playhead over Bluetooth:** today only song/order/struck-off travel. The Bluetooth frame gains the click state and the playhead events (start, re-align, hold, stop). Then the whole live mode works with no internet at all.
- **Rehearsal speed (rehearsals only):** "Play at 80%". Click and follow slow down together; the song's BPM is not changed.
- **"8 of 12 songs can follow the tempo"** in the event's readiness card, with a link to the songs missing BPM or timing.
- **Optional, last:** an audible click in headphones (Web Audio, scheduled ahead on the shared clock) for whoever wants it. Can be dropped if time is short.

## 6. Data, migrations, privacy

New migration(s) (numbers at build time; every new readable column gets its explicit GRANT; prod dry run with BEGIN/COMMIT stripped first):
- `songs.time_signature text` (e.g. '4/4'), `songs.count_in_bars smallint default 1`, `songs.line_timing jsonb` (beat positions per lyric line, versioned with a lyrics hash so edits invalidate it safely).
- `live_pack_status (event_id, user_id, device_id, version, downloaded_at)` — RLS: a member writes and reads their own rows; band admins read rows of their band's events. Nothing else.
- `live_pack_prefs` per user (automatic yes/no, asked_at) — or a profile column; the per-device choice stays on the device.
- pg_cron daily job `bw_live_pack_invite_sweep()` + an insert into `notifications` with type `live_pack_ready` (server-translated like 089, push via `send-push`). A trigger on setlist change inside the window queues the silent refresh.
- `send-push`: support a silent/background variant (iOS `apns-push-type: background`, priority 5; Android data-only).

Privacy:
- Only active band members who did not decline the event (same rule as reading `setlist_songs` today). Deputies cannot read setlists today, so they are excluded (§10).
- No fees or contracts in the pack; personal notes only for their author.
- App Store privacy label: no new data types (content stays on device; the status row is app functionality).

## 7. Phases, rough time, testing

Every fix and feature ships with a failing-first test; the e2e suite gains offline Stage specs (`context.setOffline(true)`); the integrated pass (iOS sims, Duo in every posture, iPad, Android emulator) runs before any candidate.

| Phase | Content | Effort |
|---|---|---|
| **A1** | Live pack in IndexedDB, prefetch 7 days, freshness, migrate old cache, offline Go live, Stage offline tag, readiness row | 2 days |
| **A2** | Consent push + sheet + Settings → Offline & live, pg_cron sweep, silent refresh, status table + admins' "4 of 5", 6 languages | 2 days |
| **A3** | Offline outbox (personal notes, suggestions, reorder) | 0.5–1 day |
| **B1** | `unrollChart`, song time signature + count-in (migration), playhead engine on the shared clock | 1.5–2 days |
| **B2** | Follow view in chart / structure / lyrics / Song only / wedge, switch, re-align, hold, fermata | 2 days |
| **B3** | Click + playhead over Bluetooth (iOS + Android plugin) | 1 day |
| **B4** | Sync lines (tap along + bars per line), rehearsal speed, readiness count | 1.5–2 days |
| **B5** | Optional audible click | 0.5–1 day |
| **R** | Integrated pass, test on 2 real phones (owner + partner), Academy articles in 6 languages, handbook PDF, release candidate | 1.5–2 days |

Total effort: **about 13–16 session-days.** A and B touch mostly different files and can run in two parallel sessions after A1 lands (A1 changes how Stage gets its songs; B builds on it). **Wall clock: about 8–10 working days.**

Testing that needs the owner: two real phones for Bluetooth (still never tested on real devices since PR #93), and one real gig or rehearsal run before calling it done.

## 8. Release timing

- Starting Monday 23 Nov, the release candidate (web + APK + TestFlight build) is ready **around 3–4 December**, then published on the owner's go (releases stay manual).
- External TestFlight builds usually pass beta review in under a day.
- The refactor (12–15 working days), the community and sheet music stay in a **later, separate release**. Putting them all in one release would push it to January.

## 9. Decisions taken (change any of them)

1. Automatic pack for the next 7 days; members asked once by push, with "keep it automatic".
2. The leader starts and re-aligns; members only switch the view on/off.
3. "Follow the tempo" off by default, per device.
4. Native apps only for offline; web later.
5. Line timing stored in beats, not seconds.
6. This work ships as its own release before the refactor.

## 10. Later, not planned now

- Web app offline (service worker / PWA).
- Deputies getting the setlist (needs read access to songs for deputies, a privacy decision).
- Sharing song content phone to phone over Bluetooth (slow, large; today each phone downloads its own pack).
- Following the Regia audio position instead of the click (needs clock sync on the Regia messages).
- Tempo changes inside a song beyond what the chart encodes; per-gig tempo overrides.

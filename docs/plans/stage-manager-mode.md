# Stage manager mode: one person runs the tracks, every Stage view follows

Status: **plan only, no product code.** Written 2026-11-20 on top of `main` 1f84567.
Nothing here is built until the user picks a path (§9). New features are held for the next release.

Contents

1. Summary and recommended path
2. What the user asked for, and their answers
3. What exists today (the plan builds on it)
4. The three options, honestly compared
5. The role
6. Song data: timeline, tracks, cues
7. How it works on stage (sync, offline, failures)
8. Phases, rough time, testing
9. Open questions for the user
10. Sources checked

---

## 1. Summary and recommended path

- **The idea.** A band member who doesn't play (working name **stage manager**) runs the music from a tablet, phone or laptop wired to the mixer. That covers the break music and the backing tracks the band plays along to. When they start a song, every musician's Stage view jumps to it and follows it in time: the current section, the bars, the next section and the cues.
- **Recommended path: build in layers, so a beginner band and a professional band use the same feature at different depths.**
  1. **Conductor mode (P2).** The stage manager taps *Start* and *Next section*, and everyone's Stage follows over the sync that already exists (Realtime + Bluetooth). It works with no audio files at all, so it fits the user's band today, who play tracks from a phone or player outside the app. It is also the fallback when anything goes wrong.
  2. **BandWith plays the track (P3, the user's choice).** One audio file per song is imported on the stage manager's device, and a native audio engine plays it out to the mixer. The engine knows the exact playback position, and every Stage view follows that position.
  3. **Timeline authoring (P4).** Sections, bars, count-in and cues are mapped onto each track, by tapping while it plays, from the iReal chart, or from a MIDI file with markers.
  4. **Pro layer (P5, later and optional).** Multichannel outputs (track to FOH, click and guide to the in-ears), a click generated from the timeline, vamps/loops, a local-network transport, and MIDI out. Following external software (Ableton Link / MIDI clock) also lives here.
- **Why not start from external software (option b).** The user's band doesn't use any. Ableton Link on iOS needs a licence request to Ableton, and Web MIDI doesn't exist in Safari or iOS. That makes it the costliest path for the fewest bands. It stays documented as a pro add-on (§4b).
- **Rough time.** About 4–5 weeks of work for P0–P4, plus two device sessions with the user (two or more phones and an audio interface). P0 is a 2–3 day spike that decides go/no-go on the native audio engine before anything else is built.

## 2. What the user asked for, and their answers

The user's idea, paraphrased: a band member doesn't play but runs the music on stage, both the break music and the sequences the band plays along to. They are an admin with a non-playing role. From a device connected to the mixer and PA they launch a song's sequence, and everyone who plays sees that song in sync (lyrics, chords, sections), so they come in on time.

Answers given on 2026-11-20:

| Question | Answer |
|---|---|
| What plays the tracks today | A phone or a simple player |
| Should BandWith play the audio, or drive/follow existing software | **BandWith plays the tracks** |
| What musicians use on stage | Their phones, **no click** in ear |
| How tight the sync must be | "Your call. Those answers are my own band; **design for everyone from beginners to top professionals.**" |

So the design must:
- work with nothing more than a phone and a jack cable (beginners);
- scale to an audio interface, separate in-ear outputs, a click and tempo maps (professionals);
- **never need venue Wi-Fi.**

## 3. What exists today (the plan builds on it)

Checked in the code on `main` 1f84567.

**Live sync ("follow the leader")**
- `src/lib/stageLive.ts`: `StageLiveState {seq, from, songId, order, skipped}`, with a Lamport clock (`nextSeq`, `isNewer`).
- `src/app/components/event/useStageLive.ts`:
  - The admin leads. Members follow, and a member who steps away on their own stops following until they turn it back on.
  - States go on the gig's private Realtime channel `stage:event:<id>` (migration 085). Late joiners get the state again through presence.
- `src/lib/stageBle.ts`, `src/app/components/event/useStageBle.ts`, `ios/App/App/StageBlePlugin.swift`, `android/.../StageBlePlugin.java`:
  - The same state over Bluetooth LE (GATT notify, about 40–50 bytes, HMAC with the per-gig key from `stage_keys`, migration 087).
  - **Not yet tested on two real phones.**

**Synced click**
- `src/lib/stageClick.ts` and `StageClick.tsx`: a visual metronome (a glow on the screen edge).
  - The leader sends "the click starts at my time T, at B BPM" once.
  - Members measure their clock offset with ping/pong on the channel (fastest round trip wins, like NTP), then compute beat n at T + n·60/B.
  - Accuracy is about ±20–40 ms.
  - **This is exactly the mechanism the transport needs.** Today it runs over Realtime only; the click is not on the Bluetooth path.
- Tempo, transpose and time signature come from the iReal import (#126).

**Songs**
- `songs.lyrics` uses one format: Markdown-like sections (`# Verse 1`, `# Chorus`) with ChordPro chords on the word (`[Am]word`).
  - `src/lib/songFormat.ts` gives `textSections()`, canonical section kinds in every language, and the `lyrics | chords | structure` views (#152).
- `songs.chord_chart` (jsonb, migration 091) holds the iReal/MusicXML chart: sections of **bars**, with repeats, endings, segno and coda (`src/lib/ireal.ts`, `chartBarCount`).
- `songs.bpm` and `songs.duration_seconds` already exist.

**Roles**
- `band_members.role` is `'admin' | 'member'`, with a free-text `instrument` (migration 007).
- Lineups, "who covers what" and member stats read the members list:
  - `src/lib/eventLineup.ts`, `lineupSoFar.ts`, `instruments.ts`, `memberNext.ts`, `memberStats.ts`, `freeSlots.ts`, `lineupPresets.ts`.
- Privacy rules today:
  - members see only their own fee;
  - setlists are editable by admins only;
  - anon has no table access;
  - **any new readable column needs its own GRANT migration.**

**iOS**
- `Info.plist` `UIBackgroundModes` has `bluetooth-peripheral` and `remote-notification`. It does **not** have `audio` yet, which is needed so the track keeps playing when the screen locks.

## 4. The three options, honestly compared

### a) BandWith plays the track (recommended core, P3)

The stage manager's device plays the song's audio file and broadcasts where it is. Every Stage view computes the same position from it.

**Why it needs native code.** HTML `<audio>` in the WebView is not enough:
- it follows the iPhone silent switch (the track would go silent mid-gig);
- it stops when the screen locks;
- its `currentTime` is coarse;
- it can't pick the output of an audio interface.

**What gets built:** one local Capacitor plugin, `bw-stage-audio`.

| Platform | Engine | Notes |
|---|---|---|
| iOS / iPadOS | `AVAudioEngine` + `AVAudioPlayerNode`, `AVAudioSession` category `.playback` | Ignores the silent switch. Plays with the screen locked once `audio` is added to `UIBackgroundModes`. Sample-accurate start at a host time. Position from `playerTime(forNodeTime:)`. Reports the output latency (`outputLatency + ioBufferDuration`). A USB class-compliant interface shows up as a route with N channels; channel mapping for multichannel is P5. |
| Android | Media3 ExoPlayer for stereo (P3); `AudioTrack` with a channel **index mask** (or Oboe) for multichannel USB (P5) | A foreground media service so the OS doesn't kill playback. Multichannel USB support varies by phone, so it ships as "works / doesn't work on this device" after a test button. |
| Web (laptop at FOH) | Web Audio API: decoded `AudioBuffer`, `AudioContext.outputLatency` | Output-device choice (`setSinkId`) and more than 2 channels work in Chrome/Edge on desktop only. Safari plays to the system output. Files are kept in the browser's private storage (OPFS). |

**Audio files stay on the stage manager's device.**
- They are imported from Files, Drive or USB. **Nothing is uploaded by default.**
- Reasons:
  - a 30-song set is roughly 150–300 MB, and Supabase egress is the first limit the app hits (`docs/plans/scaling-and-costs.md`);
  - on stage the audio must not depend on the network.
- The database keeps only each track's metadata and a SHA-256 checksum. A backup device (a second laptop) can import the same files, and the app matches them to the songs.
- An optional cloud copy is P5.

**Feasibility and risk**
- Latency: the audio itself has none that matters, because it plays locally. The screens follow within about ±30–60 ms (§7). That is fine for sections, bars and a visual count-in, and not meant as an audible click.
- Offline: the audio is fully offline. Screen sync goes over Realtime (mobile data) and/or Bluetooth (§7).
- **Never send the track to the mixer over Bluetooth audio** (150–300 ms of lag). The app warns when the output route is Bluetooth.
- Time: about 6–9 days for P3, after the P0 spike.

### b) BandWith follows external software (deferred to P5+)

| Protocol | What it gives | Feasibility |
|---|---|---|
| **Ableton Link** | Shared tempo, beat and phase, plus start/stop, over the local network | The cross-platform library is GPLv2+ or under a proprietary licence from Ableton. On iOS it is **LinkKit, under Ableton's Link SDK licence, requested from Ableton**. GPL can't ship in the App Store. A native plugin on each platform plus a licence request. **Link carries no song position or song identity**: it tells the beat, not "bar 33 of song 7". |
| **MIDI clock + Song Position Pointer / MTC** | Position and tempo from a DAW | Web MIDI works in Chrome/Edge/Firefox desktop but **not in Safari or on iOS**. iOS/Android need native CoreMIDI / `android.media.midi` plugins, and network MIDI (RTP-MIDI) needs setup. Each DAW also needs a song-mapping convention (program change or markers). |
| **OSC** | Anything, if the software sends it | Each program speaks its own dialect, so mappings have to be maintained. A UDP socket plugin is needed. |

**Verdict.** It is valuable for professional bands already on Ableton or MainStage, but it:
- serves the fewest bands;
- needs the most native code and a third-party licence;
- still needs a song-identity convention on top.

It is deferred. **MIDI *out*** (BandWith sends program changes and clock to keyboards and lights) is cheaper, and it comes first within P5.

### c) Manual conductor mode (recommended first, P2)

The stage manager taps *Start song* (with an optional count-in) and *Next section*, or lets a bar counter run at the song's BPM. Every Stage view follows on the existing channel and Bluetooth path.

- **Latency:** the same as today's live sync. Section changes arrive in about 100–300 ms on Realtime and about 30–100 ms on Bluetooth.
- **Offline:** the Bluetooth path (once tested on two phones).
- **Native code:** none beyond adding the transport frame to the Bluetooth plugin's payload.
- **Time:** about 3–4 days.
- **Who it's for:**
  - bands like the user's today (tracks from a phone, outside the app);
  - bands with no tracks at all (a singer or MD calls the sections);
  - the safety net if the audio engine ever fails.

## 5. The role

**Working name:** "Stage manager". Italian options to choose from: *Regia*, *Tecnico di palco*, *Direttore di scena* (§9).

**Data**
- `band_members.plays boolean NOT NULL DEFAULT true`, plus `instrument = null` for non-players.
- The role stays `admin` or `member`. "Doesn't play" is a separate fact, so it combines with admin as the user asked.
- A non-admin crew member (a hired tech who shouldn't see money) is an open question (§9). It would be `plays = false` with role `member` plus a `stage_crew` capability. **v1 = admin only**, as asked.

**Never counted as a player**
- Members with `plays = false` are filtered out of:
  - lineups and lineup presets;
  - "who covers what" and instrument matching;
  - free slots, member stats, deputy suggestions;
  - the musicians' fee split.
- One helper, `isPlayer(member)`, is used by all of these modules, each with a failing-first test.

**Fees.** By default the stage manager is not in the musicians' split. Whether crew can have their own fee line is an open question (§9).

**What the stage manager sees in Stage**
- A **Transport console** instead of the musician view:
  - tonight's setlist, each song with a track status (✓ track on this device, ⚠ missing, — no track: conductor only);
  - big **Play / Stop (hold to stop, with a fade)**;
  - the armed **next song**, a count-in toggle, and **auto-advance / segue**;
  - a **Break** button that plays the break-music playlist with fade in and out, and shows "Break · 12:00" to the band;
  - **Next section / Back section** taps, which also work while a track plays, as a manual override;
  - the output device and a **Latency test** button.
- It reuses `StageLiveControls` for the order, strike-off and lead.

**Privacy**
- The rules don't change.
- The transport carries only ids, positions and section indexes. No file names or money.
- Members can read song timelines (needed to follow). Track rows (file names, checksums) are admin-only, like setlist editing.
- Any new member-readable column gets its own GRANT migration. Anon gets nothing.

## 6. Song data: timeline, tracks, cues

**Principle:** the existing song format doesn't change. A **timeline** maps musical positions (bar.beat) onto the song's sections. A **track** maps the timeline onto an audio file (ms).

**`songs.timeline` (jsonb, member-readable, admin-write).** Pure helpers live in `src/lib/stageTimeline.ts`.

```jsonc
{
  "v": 1,
  "bpm": 96,                      // default from songs.bpm / chart
  "beats": 4, "unit": 4,          // from the chart's time signature (beatsInBar)
  "countInBars": 1,
  "tempoMap": [{ "bar": 33, "bpm": 100, "beats": 4 }],   // optional, pro
  "sections": [                    // in play order (repeats expanded)
    { "text": 0, "bar": 1,  "bars": 4 },   // text = index into textSections(lyrics)
    { "text": 1, "bar": 5,  "bars": 16 },
    { "text": 2, "bar": 21, "bars": 8 },
    { "text": 2, "bar": 45, "bars": 8, "label": "Chorus ×2" }
  ],
  "cues": [{ "bar": 52, "beat": 3, "text": "Stop!", "for": ["drums"] }]
}
```

- `text` points at a section of the existing lyrics/chords text. Stage can then highlight that section, scroll to it, and show "Next: Bridge in 4 bars" in the lyrics, chords **and** structure views without duplicating any content. Sections played twice point at the same text section.
- **Defaults come for free.** A first timeline is proposed from:
  - the iReal chart (bar counts per section, repeats and endings expanded);
  - otherwise from the lyrics headings with equal 8-bar guesses for the admin to fix.
- Cues with `for` use instrument matching (`src/lib/instruments.ts`), so only the drummer sees "Stop!".

**`song_tracks` (new table, admin-only).** Columns: `id, band_id, song_id, kind ('backing' | 'click' | 'guide' | 'break'), file_name, sha256, duration_ms, sample_rate, channels, offset_ms, created_by`.
- `offset_ms` is where bar 1, beat 1 falls in this file. The count-in is before it, and a silent lead-in is fine.
- It sits on the track and not on the timeline, because two edits of the same song have different offsets.
- Break music is a band-level playlist of `kind = 'break'` tracks with no song.

**Authoring (P4), three ways, beginner to pro**
1. **Tap to map.**
   - The stage manager plays the track and taps on each section start. The app snaps the taps to the nearest bar from the BPM and offset.
   - Tap tempo plus "tap on beat 1" sets the BPM and `offset_ms`.
   - This is done once, at a rehearsal.
2. **From the chart:** the timeline comes from the iReal bars. The admin only sets `offset_ms`.
3. **MIDI file with markers** (pro). Any DAW can export a `.mid` with tempo map and marker meta events. The app reads markers as sections and tempo events as the tempo map. It needs a small SMF parser, no native code.
- Ableton `.als` locators (gzipped XML) could come later.

## 7. How it works on stage (sync, offline, failures)

**Transport state.** A new `transport` event on the existing stage channel, parsed and validated like `ClickState`, using the same Lamport `seq`:

```ts
{ seq, from, songId, trackId | null,
  state: 'stopped' | 'countin' | 'playing' | 'paused' | 'break',
  anchorAt,      // leader clock (ms) when position `anchorPos` came out of the speakers
  anchorPos,     // ms into the timeline (negative during the count-in)
  manualSection | null }   // conductor mode / override
```

- Members compute `pos = anchorPos + (now + offset − anchorAt)` with the **same clock offset that `stageClick.ts` already measures**, then `stageTimeline.positionAt(pos)`, which gives the section, bar and beat.
- The leader re-anchors on play, pause, seek, song change and every 10 s. Drift between device clocks is tiny; re-anchoring covers it.
- The leader adds its **output latency** to `anchorAt`, so screens match what the PA plays and not what the device buffer holds.
- The visual count-in and bar flash reuse `StageClick`'s glow, driven by the transport instead of a separate click state.

**Offline: venue Wi-Fi is never needed.**
- **Mobile data → Realtime.** It works in most venues, at about ±20–40 ms after clock sync.
- **Bluetooth LE**, the existing plugin. It gets a **transport frame** of about 20 bytes:
  - frame type, seq, song index (into the setlist, as today), state, section index;
  - position in ms at send time;
  - HMAC.
- Over BLE the leader notifies the position **every 500 ms**. A member takes the arrival time minus a small fixed delay (half a connection interval) and keeps the best estimate over a short window. Expected accuracy is about ±30–60 ms. That is fine for sections and bars, and no ping/pong is needed on BLE.
- Both paths run at once, and the newest `seq` wins, as today.
- **Local network (P5, pro).** A band with its own router can use the stage manager's device as a local WebSocket server, found via Bonjour/NSD. That needs a native listener on iOS (`NWListener`) and Android. It is more robust than BLE for 8+ devices.

**Failures and safety**
- **Members lose the signal:**
  - the position keeps running from the last anchor (it is just a clock);
  - after 5 s without news it shows "Sync lost · following on time";
  - after 30 s it holds on the current section.
- **The stage manager's app crashes or the phone locks:**
  - the audio keeps playing when the screen locks (background audio);
  - if the app is killed, the audio stops. This is the same risk as a phone player today; the plan's reliability bar is to be no worse.
  - Recommended setup: Guided Access / screen pinning, Do Not Disturb, charger in.
  - Note: airplane mode kills Realtime, so use "Airplane + Bluetooth on" only when everyone follows over BLE.
- **Interruptions.** A phone call or Siri interrupts `AVAudioSession`. The console shows a big "Resume" button and never restarts on its own.
- **Accidental taps:**
  - Stop needs a hold;
  - Next song only arms the song, it doesn't start it;
  - the transport is locked to one leader at a time, and taking over asks first.
- **Missing track:** that song falls back to conductor mode, and the pre-gig readiness check flags it ("2 tracks missing on this device").

## 8. Phases, rough time, testing

Every phase goes through the usual gates:
- failing-first tests;
- e2e on the 10 profiles;
- the emulator pass (iOS sims, Duo postures, Android emulator);
- 6 languages, Academy and the handbook PDF;
- releases stay manual.

| Phase | What | Rough time | Needs |
|---|---|---|---|
| **P0 spike** | `bw-stage-audio` prototype on iOS + Android: play a file to a USB interface and the jack, position events, screen lock, silent switch, interruption. Measure screen sync phone-to-phone over Realtime **and** BLE. **Go/no-go.** | 2–3 days | 2+ real phones, an audio interface |
| **P1 role** | `plays` column (migration), `isPlayer()` everywhere (lineups, coverage, stats, fees, deputies), the "Stage manager" label and settings, invite option | 2–3 days | — |
| **P2 conductor** | Transport state + parser, BLE transport frame, console (Start / Next section / count-in / Break timer), musicians follow sections with a "Next: … in N bars" strip | 3–4 days | 2-phone BLE session (also closes the open #93 test) |
| **P3 track playback** | Plugin for real (iOS, Android, web), local import + checksum matching, readiness check, latency compensation, auto-advance / segue, break playlist with fades, `audio` background mode | 6–9 days | device session with the mixer |
| **P4 timeline** | `songs.timeline` + `song_tracks` migrations, `stageTimeline.ts`, default from chart/lyrics, tap-to-map editor, offset/BPM/count-in, cues per instrument, MIDI-marker import | 4–6 days | — |
| **P5 pro (pick à la carte)** | Multichannel routing (track → 1-2, click/guide → 3-4), click synthesised from the timeline, vamps/loops, local-network transport, MIDI out (program change / clock), cloud copy of tracks, Ableton Link / MIDI-in follow | 3–8 days each | licence request to Ableton for Link on iOS |

**Total P0–P4:** about 4–5 weeks of work, plus device sessions.

**Testing that can't be faked**
- Simulators have no real Bluetooth, and their audio latency isn't real.
- P0, P2 and P3 each need a short session with the user holding the devices:
  - the Duo (iOS);
  - one Android phone;
  - ideally a second iPhone;
  - the audio interface or a jack into the mixer.
- The pure parts are unit-tested: timeline math, transport parsing, BLE frame encoding, tap snapping, MIDI marker parsing.
- The console and the follower views get Playwright e2e tests with a fake transport.

## 9. Open questions for the user

1. **Path:** start with **P0 spike → P1 role → P2 conductor**, then P3 playback? (Recommended.) Or go straight to P3 after the spike?
2. **Name in the app:** *Stage manager*, *Regia*, *Tecnico di palco*, or something else?
3. **Admin only, or also crew without money access?** (v1: admin only, as asked.)
4. **Fee:** should a stage manager have their own fee line (crew), kept out of the musicians' split?
5. **Hardware for testing:** which audio interface or cable into the mixer is available, and which second phone(s)?
6. **Pro layer:** which P5 items matter first (click in the in-ears, multichannel, MIDI out, following Ableton)?

## 10. Sources checked

- Ableton Link licensing: Ableton's Link pages and the Link repository's licence (GPLv2+ or proprietary; LinkKit for iOS under the Link SDK licence, requested from Ableton; GPL not App Store compatible). https://ableton.github.io , https://www.ableton.com/en/link/sdk/license-request/ , https://browse.dgit.debian.org/ableton-link.git/tree/LICENSE.md
- Web MIDI support: no Safari/WebKit support (WebKit bug 107250 still open); Chrome/Edge 43+, Firefox 108+. https://caniuse.com/midi , https://bugs.webkit.org/show_bug.cgi?id=107250 , https://developer.mozilla.org/docs/Web/API/Web_MIDI_API
- Capacitor audio plugins: `@capgo/native-audio` reports position about every 100 ms and needs an app-managed foreground service on Android. It isn't built for sample-accurate scheduled starts or multichannel routing, hence a small own plugin. https://github.com/Cap-go/capacitor-native-audio
- Android multichannel USB: `AudioFormat` channel index masks (recommended for USB endpoints), `AudioMixerAttributes` on newer Android. https://developer.android.com/reference/android/media/AudioFormat , https://developer.android.com/media/platform/improve-audio-playback
- To verify in the P0 spike (from platform knowledge, not re-checked today): `AVAudioSession` `.playback` vs silent switch and screen lock, `AVAudioEngine` channel maps on USB interfaces, `AudioContext.setSinkId` availability.

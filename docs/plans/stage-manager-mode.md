# Stage manager mode: the admin plays the song, every Stage view jumps to it

Status: **v1 built on this branch (2026-11-20), held for the next release.** Planned on top of `main` 1f84567, simplified the same day by the user, then built after the user's go ("Sì, costruisci").
Nothing ships until the user gives the go. No migration is needed.

What the build changed from the plan below: an off-setlist song is **saved into the setlist** (§3.2), the Bluetooth frame is **unchanged** (§3.3), and iPads with no headphone jack are covered in **§3.7**. In English the role is called **"Stage manager"**; the translations are it "Regia", es "Cabina", fr "Régie", de "Regie", pt "Cabine".

Contents

1. What the user wants (v1)
2. What exists today (most of it is already there)
3. Design
4. Work, rough time, testing
5. Decisions taken (change any of them)
6. Later, not planned now
7. Sources checked

---

## 1. What the user wants (v1)

The user's words, paraphrased (2026-11-20):

> Whoever runs the band on stage uses a laptop or tablet wired to the mixer. A band admin can launch a song from BandWith. If that song sits somewhere else in the setlist, everyone else's screen already shows the song that just started playing. Only the manager's device plays the audio; nobody else's does. That's why the role matters: it is what plays the song and sends it to the others.

So v1 means:
- **One device per band per night is the "Regia"** (the stage manager device). It must belong to an admin.
- **Play on that device** does two things:
  - it plays the song's audio file out of that device (cable → mixer);
  - every musician's Stage view jumps to that song, wherever it is in the setlist.
- **No other device ever plays audio.**

Not in v1: following sections and bars, count-ins, click, external software (Ableton / MIDI), multichannel. They are listed in §6.

## 2. What exists today (most of it is already there)

Checked on `main` 1f84567.

- **Everyone jumping to the song the admin picks already works.**
  - `useStageLive` (`src/app/components/event/useStageLive.ts`) has the admin lead.
  - When the admin moves to another song, `StageLiveState {seq, from, songId, order, skipped}` goes out on the gig's private Realtime channel (migration 085) and over Bluetooth (`useStageBle`, migration 087).
  - Members who are "following" jump to `songId`, at any position in the setlist.
- **Songs already have a band audio file.**
  - `songs.audio_url` holds an `sb://song-files/<band_id>/audio/...` reference in the private `song-files` bucket (migration 047). Only active band members can read it, and files are up to 50 MB.
  - `src/lib/services/songFiles.ts` turns the reference into a short-lived signed URL.
  - Stage mode doesn't play it today.
- **Clock sync for timing** already exists in `src/lib/stageClick.ts` (ping/pong offset). v1 only uses it to show elapsed time on the musicians' screens.
- **iOS:**
  - no `AVAudioSession` setup in the app;
  - `UIBackgroundModes` has `bluetooth-peripheral` and `remote-notification`, but not `audio`.
  - Audio in the WebView therefore follows the **silent switch** and stops when the screen locks. That has to be fixed for the tablet case (§3.4).

## 3. Design

### 3.1 Turning the Regia on
- In Stage mode, an **admin** sees a **"Regia audio su questo dispositivo"** switch. Members never see it.
- Turning it on:
  - makes this device the leader for tonight (it already is, as admin);
  - **downloads the audio of every setlist song that has one** to the device;
  - shows readiness, e.g. "Audio pronto: 9/10 · 1 brano senza audio".
- **Only one Regia per gig.** The device announces itself on the stage channel (a `regia` broadcast with its `clientId`, resent every 5 s while playing and whenever someone joins). It is not sent over Bluetooth.
  - If a second admin turns it on, the app asks "Prendere la regia da <nome>?".
  - The first device stops its audio and shows "La regia è passata a …".
- The switch is remembered for the gig on that device (`localStorage`, like the struck-off songs). If the app restarts mid-gig, it comes back as Regia, **with the audio stopped**.

### 3.2 Playing a song
- On the Regia device every setlist song with audio gets a **▶ button**, along with the current song's controls:
  - **Play / Pause**;
  - **Stop**, which needs a hold, with a short fade;
  - a position bar with elapsed and remaining time.
- **Play on any song, in any order:**
  1. it sends `StageLiveState` with that `songId` (the existing "go to song" path), so every following member jumps to it;
  2. it starts the audio locally.
- **Next song doesn't start on its own** (no auto-play). When a song ends, the Regia shows the next one ready. Play is always a deliberate tap.
- **A song that isn't in tonight's setlist** can be played from the repertoire (a search sheet). It is **added to the setlist** right after the current song (a real setlist row, in the same set), so the others see it too and it stays in the setlist afterwards. Built this way because a live-only song would vanish for members who reload, and the setlist then shows what was really played.
- **Songs with no audio** can still be "sent" with the existing go-to-song tap. They just don't play anything.

### 3.3 What the musicians see
- Nothing new to learn. Their Stage jumps to the song, as it does today when the admin moves.
- A small strip on the song: **"▶ In riproduzione · 1:12 / 3:58"**. Musicians who stopped following get **"In riproduzione: <titolo> · Vai"**.
  - The time comes from the `regia` broadcast: `{playing, positionMs, durationMs}`. Members run the clock from when the message arrived; no clock sync is needed for a clock on screen.
  - **Over Bluetooth only the jump travels**, not the strip. The Bluetooth frame stays at format v2, because older apps reject a frame with extra bytes. With no internet, members still move to the song that plays; they just don't see the time.
- **Members' devices never load or play the audio.** The player component is mounted only when the Regia switch is on locally, and it is unit-tested.

### 3.4 Audio playback per device

| Device | How | Native work |
|---|---|---|
| **Laptop (web, app.bandwith.fun)** | `<audio>` from a local blob (cached file) | None. The browser plays to the system output, so the user picks the interface/jack in the OS. |
| **iPad / iPhone** | `<audio>` in the WebView from the cached file | **Built:** the `BwAudioOutput` plugin (`ios/App/App/AudioOutputPlugin.swift`) sets `AVAudioSession` to `.playback` while the Regia is on, so the silent switch is ignored, and reports the output route. `audio` added to `UIBackgroundModes` so playback survives the screen locking. Needs a TestFlight build. |
| **Android tablet / phone** | `<audio>` in the WebView | **Built:** the same `BwAudioOutput` plugin (`AudioOutputPlugin.java`) reports the output device. Screen-lock behaviour is checked in the device session; if needed, a foreground media notification comes later. |

- **Files are cached on the Regia device before the gig:**
  - web: IndexedDB (the bytes plus the content type: Safari's private windows refuse Blobs there);
  - native: Capacitor Filesystem, `LibraryNoCloud` (no iCloud backup).
- So **on stage the audio needs no network**, and each file is downloaded once per device, not at every play. That matters because Supabase egress is the first free-tier limit (`docs/plans/scaling-and-costs.md`).
- **The output is shown and checked** (§3.7): Bluetooth or the built-in speaker gets a warning.

### 3.5 Offline on stage
- The audio is local, so it always plays.
- The screens follow over mobile data (Realtime) and/or Bluetooth, as today.
- **Venue Wi-Fi is not needed.**
- The Bluetooth path has still **never been tested on two real phones** (#93). v1's device session closes that test.

### 3.6 Role and privacy
- **Who can be Regia:** any admin of the band, as the user asked. No new member type, and no change to lineups, fees or "who covers what".
- **Privacy doesn't change:**
  - only band members can read the audio files (private bucket, as today);
  - the stage channel carries only ids, play/pause and a time;
  - no migration is needed for v1.

### 3.7 iPads and phones with no headphone jack
Checked 2026-11-20: every current iPad (and iPhones since the 7) has no 3.5 mm jack; the iPad Pro, Air, mini and, since the 10th generation, the base iPad have USB-C.
- **Ways into the mixer, best first:**
  - the mixer's own USB input (many digital mixers are a USB audio interface): one USB-C cable;
  - a class-compliant USB audio interface into the mixer;
  - Apple's USB-C (or Lightning) to 3.5 mm adapter, then the usual 3.5 mm to 2 × 6.3 mm jack or 2 × RCA cable;
  - an adapter with a USB-C PD charging port, to charge the iPad during a long gig.
- **Never Bluetooth** (latency, drop-outs).
- **Risks, handled in the app:**
  - if the cable comes out, iOS can move the sound to the speaker: `BwAudioOutput` reports every route change and the Regia bar shows a warning at once;
  - notifications would come out of the PA: the bar shows the output and a "turn on Do Not Disturb" hint while nothing plays.
- The same tips are in the Academy article `stage-manager` and in the handbook.

## 4. Work, rough time, testing

| Step | What | Rough time |
|---|---|---|
| 1 | Pure helpers + tests: Regia claim (newest wins, hand-over), `regia` state parse, play-time math | 0.5 day |
| 2 | Regia switch, pre-download + readiness, player (Play / Pause / hold-to-Stop / bar), Play = go to song + play, repertoire sheet for off-setlist songs | 1.5–2 days |
| 3 | Members' "In riproduzione" strip, "Vai" for non-followers | 0.5 day |
| 4 | iOS `AVAudioSession` `.playback` + `audio` background mode; Android lock check | 0.5 day + builds |
| 5 | 6 languages, Academy article (`stage-manager`), handbook PDF | 0.5 day |

**Total: about 3–4 days**, plus one device session.

**Testing**
- Failing-first unit tests.
- Playwright e2e:
  - a member page follows a Regia page that plays an out-of-order song;
  - a member page never creates an `<audio>` element.
- The emulator pass (iOS sims, Duo postures, Android emulator).
- **Device session with the user:**
  - laptop or iPad on the jack into the mixer, plus 2 phones;
  - Internet first, then airplane mode with Bluetooth on;
  - silent switch on, screen locked.

## 5. Decisions taken (change any of them)

Chosen as the best default, per the "best solution, don't ask" rule:
- One Regia per gig. Taking it over asks first.
- No auto-play of the next song.
- Stop needs a hold.
- An off-setlist song goes in right after the current one, and is saved into the setlist.
- Audio is cached on the Regia device before the gig, not streamed.
- Members get a time strip but never audio.
- Italian label **"Regia"**, English **"Stage manager"** (es Cabina, fr Régie, de Regie, pt Cabine). The name can change.
- The Bluetooth frame doesn't change (old apps keep working); the now-playing strip needs the internet.

## 6. Later, not planned now

Explored on 2026-11-20 and set aside by the user for now. The full exploration is in this PR's first commit.
- **Following the song inside:**
  - sections and bars on screen ("Next: Bridge in 4 bars");
  - a timeline per song (tap to map, from the iReal chart, or from a MIDI file with markers);
  - visual count-in;
  - cues per instrument.
- **Pro audio:** multichannel (track to FOH, click/guide to in-ears), a click generated from the timeline, vamps/loops, break music with fades.
- **A non-playing crew member** kept out of lineups and fees (`band_members.plays`).
- **External software:**
  - Ableton Link: LinkKit licence from Ableton for iOS, GPL elsewhere;
  - MIDI clock / Song Position: no Web MIDI in Safari or iOS, so native plugins;
  - OSC.
- **A local-network transport** for bands with their own router.

## 7. Sources checked

- Ableton Link licensing (for §6): https://ableton.github.io , https://www.ableton.com/en/link/sdk/license-request/ , https://browse.dgit.debian.org/ableton-link.git/tree/LICENSE.md
- Web MIDI support (for §6): https://caniuse.com/midi , https://bugs.webkit.org/show_bug.cgi?id=107250
- Capacitor audio plugin, considered and not needed for v1: https://github.com/Cap-go/capacitor-native-audio
- Still to verify in the device session: WKWebView `<audio>` under `AVAudioSession` `.playback` with the silent switch on and the screen locked, and Android WebView playback with the screen locked.

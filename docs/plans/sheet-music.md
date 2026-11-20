# Sheet music: read, write and draw scores in BandWith

Status: **plan + throwaway spike (2026-11-20), nothing built, nothing in a release.**
This was asked by the band's partner after rehearsals, alongside the Stage / Live mode full screen and the single music symbol registry (`src/lib/musicSymbols.ts`). Those two ship in the release; this plan does not.
No migration and no deploy come with this branch. The spike lives in `spike/sheet-music/` and is not built by Vite.

Contents

1. What is asked
2. What exists today
3. Library choice: OpenSheetMusicDisplay vs VexFlow vs Verovio
4. Phase 1: MusicXML / .mxl scores (import, show, transpose)
5. The spike, and what it measured
6. PDF scores through OMR (Audiveris): an honest look
7. Phase 2: writing notes by tapping (phone, iPad, Duo)
8. Phase 3: stylus (Apple Pencil, pens on Android / Duo) and handwriting
9. Estimates, order, risks
10. Decisions to take (change any of them)

---

## 1. What is asked

- Band members **read real scores** (melody, rhythm, chord symbols, lyrics under the notes) in a song, on stage and at rehearsal, on every device.
- They **import** scores from what they already have: MusicXML / .mxl from MuseScore, Sibelius, Finale, Dorico or iReal Pro, and PDFs.
- Later they **write** short parts in the app (a horn line, a riff, a break) by tapping, and, on tablets, **with a pen**.

## 2. What exists today

- `src/lib/musicxml.ts` already reads `.musicxml`, `.xml` and zipped `.mxl` (its own small unzip on `DecompressionStream`, with size and bar limits). It keeps only the **form and chords** (harmony, rehearsal marks, repeats, endings, segno/coda, time, fermata) and turns them into the `SongChart` in `songs.chord_chart`, the same shape as an iReal Pro import. Notes are skipped on purpose.
- `src/lib/musicSymbols.ts` (this release) is the one map from chart markers to symbols. A score viewer must use the same names for the same signs: a segno is called "Segno" in the chart, the legend and the score.
- Songs have files (`song-files` bucket, chart + audio), lyrics, transpose (`src/lib/transpose.ts`), Stage / Live mode with full screen, and offline caching through `@capacitor/filesystem`.
- Notes from the earlier feasibility look (side-session notes, 2026-11-13): iReal Pro forum links carry **no melody**, so scores only come from files people own.

## 3. Library choice

All three draw SVG in the WebView, so iOS, Android, the web and the Duo get the same engraving. Figures below are from the npm packages on 2026-11-20 (`npm pack`, gzip measured locally).

| | OpenSheetMusicDisplay 2.3.1 | VexFlow 5.6.0 | Verovio 6.4.1 |
|---|---|---|---|
| License | **BSD-3-Clause** | MIT | **LGPL-3.0-only** |
| Reads MusicXML | **yes** (and .mxl) | no: a drawing API, we would write the MusicXML → layout ourselves | yes (also MEI, Humdrum, ABC) |
| Bundle | 1.48 MB min, **380 KB gzip**, plain JS | core 506 KB / **145 KB gzip** (+ fonts) | toolkit **7.4 MB / 2.4 MB gzip** (WASM) |
| Line breaking, re-flow on resize | yes, built in | ours to write | yes, very good |
| Transposition | yes (`TransposeCalculator`, in the public package) | ours | yes (`transpose` option) |
| Chord symbols, lyrics, repeats, voltas | yes | ours | yes |
| Cursor / playback position | yes (cursor API), useful for Stage follow | ours | yes (timemap) |
| Fonts | bundled glyphs (VexFlow 1.x); no font licensing work | Bravura / Petaluma (OFL) | Leipzig / Bravura (OFL) |
| Fit for BandWith | **best**: small, permissive, MusicXML in, reflows to any width | only if we built an editor first and a viewer second | best engraving, but LGPL + WASM size; the license needs care inside a closed app bundle |

**Choice: OpenSheetMusicDisplay** for reading (phases 1–2). It is permissive, small enough to lazy-load only when a song has a score, reflows to a closed Duo or an iPad, and transposes.
VexFlow stays a candidate **for the editor's drawing layer** in phase 2 if OSMD's model proves awkward to edit live (OSMD itself draws through a patched VexFlow 1.x).
Verovio is the fallback if engraving quality on dense scores is not good enough. Before using it, get a written view on the LGPL in an app bundle (dynamic linking of a WASM module is arguable; a separately downloadable module is safer).

Known OSMD rough edges, seen in the spike:
- Chord kinds print with its own names ("Gmaj6" for a major-sixth G6). They need mapping to BandWith's chord labels (`chordLabel` in `src/lib/ireal.ts`) through OSMD's chord-symbol label settings, so a score and a chart spell the same chord the same way.
- Colours are options, not CSS. Dark mode and the Stage look set `defaultColorMusic` and friends at load time and re-render on a theme change.

## 4. Phase 1: MusicXML / .mxl scores

What a musician sees: on a song, **Add score** (MusicXML, .mxl). The song gets a **Score** view next to Lyrics / Chords / Structure, in the song sheet, in Stage / Live mode (full screen included) and on the Duo floor wedge. It has zoom, transpose (the same control and the same semitones as the chords) and dark mode. If the file has chord symbols and there is no chart yet, the chart is filled from it, as today.

Work:
1. **Storage.** Keep the original file in `song-files` (`<band_id>/score/<song_id>.mxl`). The bucket's MIME list must allow `application/vnd.recordare.musicxml(+xml)` and `.mxl`: that is a migration, with a dry run in a rolled-back transaction and the file's own BEGIN/COMMIT stripped. Add `songs.score_path text null`; a new readable column needs its own GRANT migration.
2. **Viewer.** `ScoreView` lazy-loads OSMD (dynamic `import()`, its own chunk), renders from the cached file, re-flows on container resize (the Duo hinge, rotation), and maps chord names through `chordLabel`. Marks that also exist in charts (segno, coda, D.S., fine) keep their `musicSymbols` names for screen readers. OSMD draws one SVG, so give it `role="img"` with the song's name, and a text alternative listing sections and chords from the chart.
3. **Transpose.** Feed the song's transpose to `osmd.Sheet.Transpose`; the key stays in sync with the chart's transpose control.
4. **Offline.** Cache the file like the chart PDF today, so Stage mode works without a network.
5. **Stage follow (optional in phase 1).** The Regia "now playing" can move OSMD's cursor bar by bar when a song has a tempo and an audio offset. Leave it for later if it slips.
6. **Tests.** Vitest: parse + render a small made-up score in jsdom where possible (OSMD needs a DOM with layout; use the e2e for real rendering). Playwright on all 10 profiles: open a song with a score, check the SVG has the expected bar count, transpose +2 and check the key signature changes, and check that no layer covers it on the Duo fold. Plus an emulator pass (iOS sims, Duo postures, Android) per the integration matrix.

Estimate: **6–9 working days** (storage + migration 1, viewer + lazy load 2–3, chord mapping + dark/Stage look 1–2, offline 0.5, tests + device pass 1.5–2). Academy article + handbook update: 0.5 day.

## 5. The spike, and what it measured

`spike/sheet-music/index.html` + `harbor-lights.musicxml`: a made-up 8-bar lead sheet (no real song), with chord symbols, a repeat with two endings, a tie, an accidental and a fermata. The page loads OSMD 2.3.1 from jsDelivr, renders it, transposes it, zooms, and has a "×8 bars" switch for a 64-bar score. Every step is timed on the page. Run it with `npx serve spike/sheet-music`.

Measured on 2026-11-20 (Chromium through Playwright, CPU slowed to approximate phones; WebKit in the iOS 27 simulator):

| Device / setting | Load 8 bars | First render | Transpose | 64 bars: load + render |
|---|---|---|---|---|
| Phone 412×915, CPU ×4 | 83–111 ms | 120–139 ms (first, includes warm-up) | 27–38 ms | 39–55 + 78–128 ms |
| Duo closed 466×678, CPU ×4 | 73 ms | 111 ms | 26–36 ms | 42 + 121 ms |
| iPad 1180×820, CPU ×2 | 39 ms | 49 ms | 11–17 ms | 24 + 53 ms |
| iPhone 17 Pro Max sim, Safari (WebKit) | 51 ms | renders correctly; re-flows to 2 bars per line | — | — |

Reading: rendering is **not** the bottleneck. A 64-bar lead sheet renders in about a tenth of a second on a slowed CPU, and transposing is instant. The real costs are the **380 KB gzip download** (lazy-load it only for songs with a score, and cache it for offline) and big orchestral scores (many staves), which phase 1 does not target: BandWith shows one part per musician.
Seen in the spike: the endings, tie, fermata, repeat and key signature are right; "G6" printed as "Gmaj6" (see §3).

## 6. PDF scores through OMR (Audiveris): an honest look

Most bands have PDFs, not MusicXML. OMR (optical music recognition) turns a PDF into MusicXML.

- **Audiveris** is the only serious open-source OMR. It is **AGPL-3.0**, written in Java, desktop/server only (no mobile build). It works best on **clean, printed, engraved** pages at 300 dpi. It needs a **manual correction pass** even then: rhythms in tuplets, ties vs slurs, chord symbols and lyrics are its weak points. On phone photos, handwritten charts or skewed scans it fails often enough that it is not worth offering.
- Running it means **a server** (a container with Java and Tesseract), a job queue, and minutes per page. Our Supabase plan has no such runtime; it would be a separate service with its own cost. The AGPL is fine for an unmodified service we run, but any change we make to Audiveris must be published.
- Commercial OMR (PlayScore, Newzik's, ScanScore, Soundslice) is more accurate on photos, but none offers a public API we could use under our terms today, and pricing would be per page.

**Recommendation: no OMR in the app for now.** PDFs keep working as they do (attached chart, opened full screen in Stage mode). We tell people, in the Academy, how to get MusicXML: export from MuseScore/Sibelius/Dorico; for a PDF, MuseScore's free import (it runs Audiveris on their side) or PlayScore, then fix and export. Revisit if many users ask: a 2-day spike with Audiveris in a container on 10 real band PDFs, scoring the result per bar (wrong pitch, wrong rhythm, missing chord), would tell us whether it is worth a server.

## 7. Phase 2: writing notes by tapping

Goal: short parts (4–32 bars, one staff, chords above), not full engraving software.

Design, the same on every device:
- A **staff with a caret** (the insertion point) and a **palette** at the bottom: durations (whole … sixteenth, dot, triplet), rest, accidentals, tie, and the chord symbol field. On a closed Duo or phone in portrait, the palette is two rows and the staff scrolls sideways one bar at a time. On iPad and Duo book/laptop, the palette sits beside the staff (Laptop pose: staff on the top half, palette on the bottom half, nothing on the fold).
- **Entering a pitch**: tap on a staff line/space at the caret (with a magnified "loupe" preview while the finger is down, because a finger covers three lines), or use a **one-octave piano strip**. Arrow buttons ↑/↓ move by a step, and the octave buttons move by an octave. Playback of each note gives a sound check (Web Audio, no samples needed).
- Undo/redo, copy a bar, repeat a bar (draws the `%` from the symbol registry).
- Saved as **MusicXML** (the same file type as imports), so phase 1's viewer shows it and other apps can open it.

Engine: our own small model (bars → notes) with MusicXML in/out, drawn with OSMD re-render per edit (≈20–40 ms for a short part, acceptable), or VexFlow directly if per-edit re-render feels slow on the Duo closed screen.

Estimate: **12–18 working days** for a usable v1 (model + MusicXML writer 3–4, staff + caret + hit-testing 3–4, palette and layouts for every device/posture 3–4, playback 1, undo/redo + bar tools 1–2, tests on 10 profiles + device pass 2–3).

## 8. Phase 3: stylus and handwriting

What the platforms give us:
- **Apple Pencil (iPad)** and **pens on Android tablets / foldables**: in the WebView they arrive as Pointer Events with `pointerType: 'pen'`, plus pressure and tilt. Palm rejection works when we ignore `touch` pointers while a pen is down. Coalesced events (`getCoalescedEvents`) give smooth strokes. No native plugin is needed for drawing.
- **The iPhone Duo**: no pen support has been confirmed for the device; treat it as finger-only until it is.
- **No platform recognizes handwritten music.** PencilKit and Android's ink recognition read text and shapes, not notes. Full handwritten-score recognition (like StaffPad) is a research-grade, proprietary problem.

Feasible plan, in two steps:
1. **Pen as a precise pointer (2–3 days on top of phase 2).** On tablets, the pen places notes exactly where it touches, hover shows the pitch (Pencil hover on newer iPads), and a pen tap never scrolls. This alone makes entry much faster on iPad.
2. **Gesture recognition for a small symbol set (8–12 days, a research spike first).** A $P point-cloud recognizer (a small, permissively licensed algorithm, about 200 lines) trained on our own strokes: a filled dot (notehead), an open circle (half/whole), a stem, a flag/beam stroke, sharp/flat/natural, rest shapes, a bar line. Strokes snap to the staff to get pitch and to the caret to get time. Expect about 85–95% per symbol for a careful writer after a short warm-up; every recognized symbol is shown immediately so a wrong one is erased with a scribble. Do a 3-day spike with 5 musicians writing 100 symbols each before committing to it.

Free handwriting of whole bars (recognizing rhythm from loose ink) is **not recommended**: unreliable, and slower to correct than tapping.

## 9. Estimates, order, risks

| Phase | Scope | Days | Depends on |
|---|---|---|---|
| 1 | MusicXML / .mxl score view, transpose, offline, Stage + Duo | 6–9 | one storage migration (bucket MIME + `songs.score_path` + GRANT) |
| (OMR) | not planned; 2-day evaluation spike only if users ask | (2) | a server runtime |
| 2 | Tap entry of short parts, saved as MusicXML | 12–18 | phase 1 viewer |
| 3a | Pen as precise pointer | 2–3 | phase 2 |
| 3b | Pen gesture recognition (small symbol set) | 3 spike + 8–12 | phase 3a, spike results |

Risks:
- **Bundle size**: OSMD is 380 KB gzip. It must stay out of the main chunk (lazy import) and be cached for offline use.
- **Copyright**: scores are the band's own files, stored per band like charts today. No public catalogue, no fetching scores from sites.
- **Accessibility**: an SVG score is not readable by a screen reader. The chart (sections, chords, symbol names) stays the accessible version of the same song.
- **Duo postures**: every view must fit closed, book, laptop and landscape (the posture rule). The editor's palette is the hard part in Laptop pose; plan its layout first.

## 10. Decisions to take

1. OSMD for reading (BSD-3). Change to Verovio only for engraving quality, after a license check.
2. One part per musician in phase 1 (no full scores with many staves).
3. No OMR in the app for now; Academy guidance on exporting MusicXML instead.
4. The editor writes MusicXML, not a private format.
5. Pen recognition only after a measured spike, for a small symbol set.

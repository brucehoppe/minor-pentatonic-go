# Changelog

All notable changes to this project. Versions are release dates, with a suffix for
a second release on the same day.

## Unreleased

- Windows: the server states every file's Content-Type itself. Go otherwise asks the
  Windows registry, where `.js` is sometimes mapped to `text/plain`; with `nosniff`
  set, a browser on such a PC would have refused the desk's scripts and shown a blank
  page. Found by the new Windows CI job; a test walks every embedded file.
- 5 boxes: **Chord inside each box** rings the minor chord that sits inside every
  box (the Em, Dm, Cm, Am and Gm shapes of CAGED), names the shape, where its root
  is and the chord's frets in the key on screen (A minor in Box 1 is 5 7 7 5 5 5).
  Every chord note is one of the box's own dots; a test checks that in three keys.
- Keys and notes are spelt the way they are written. The Key menu says B♭ minor,
  E♭ minor and G♯ minor (it said A#, D# and G#), and dot labels follow the key, so
  B♭ minor pentatonic reads B♭ D♭ E♭ F A♭. Modes spell each degree from its own
  number (F Lydian's raised fourth is B, E♭ Dorian is E♭ F G♭ A♭ B♭ C D♭), power
  chords are B♭5 and E♭5, and Phrygian dominant on B♭ no longer starts from A♯. The
  Note names view stays a sharps-between-naturals reference, and file names stay ASCII.
- CI runs the Go tests on Windows too, so the listen tests meet the real Windows
  port-in-use error.
- 12-bar trainer: chords and target tones are spelt the way a chart spells them, by
  letter. A blues in F now shows B♭7 (it said A#7), with target tones B♭ D F A♭,
  while the ♯IV diminished chord in A stays D♯dim7. Names that would need a double
  accidental fall back to the plain spelling.
- Windows: starting the app a second time reopens the running desk, as it does on
  macOS. Windows reports a taken port as `WSAEADDRINUSE`, which Go's
  `syscall.EADDRINUSE` does not equal there, so the second launch failed with a
  "listen" error instead. A test covers the Windows reading from any platform.
- The 12-bar trainer poster is now the Rats of Chaos of Grid Lock kangaroo-rat graphic; the front-page kaiju stays.
- README: the Rats of Chaos of Grid Lock banner sits on the front page, captioned "Your backing band: Rats of Chaos of Grid Lock" and saying they are your fictional band (a 1600 px JPEG of about 400 kB under `docs/`).
- README: says that Rats of Chaos of Grid Lock, the 12-bar trainer's backing band, is your fictional band.
- The two kaiju graphics are bigger so they no longer get lost: the masthead
  guitarist is 320 px wide (was 182) and the Rats of Chaos poster on the 12-bar
  trainer 300 px (was 155), with a larger caption; on phones 150 and 165 px. Both
  images were already large enough to stay sharp.
- The **Key** (or **Root**) label beside the key menu is larger, bold blue capitals
  with a pink underline, and the menu has a blue border, so it can't be missed:
  the key decides what every diagram shows.
- Downloading a take is now hard to miss. When a take ends, a bordered "Your take
  is ready" panel appears in the Record row (under Play along, on every view) with
  the player and the downloads marked ↓, WAV and MP3 first, then solo only and the
  compressed file, and a line saying the file goes to your browser's Downloads
  folder and that every take is also kept in Songs → Your takes. After a download
  the status names the file. A kept take now has its own **Download take** button
  in Songs → Your takes (its compressed recording); before, only the Layers
  downloads and Export all (zip) were there. Checked in Chrome by recording a take
  and downloading it: a 16-bit stereo WAV, a 192 kbps MP3 and a WebM, all valid.
- Screenshots refreshed for the redesigned desk (home, 5 boxes, All 12 keys, Open
  tunings, 12-bar trainer), with two new ones: Tuner & bends, showing a bend
  checked against its target, and Practice. The README's file layout and test
  instructions list the pitch, tuner and changes modules and `tests/pitch.test.mjs`.
  The bend log says "Last bend" for one bend, not "Last 1 bends".
- Fixes from a UI and function sweep of every view, at 1280, 375 and 320 px wide,
  clicking every safe button with the console watched. Blues boxes: the Box 1–5
  isolate buttons threw (`R is not defined`) and left the map label stale; they
  now name the box's frets. On phones, All 12 keys scrolled sideways (a fixed
  420 px column) and any card holding a wide diagram could widen its column;
  columns now fit the screen and the card scrolls inside itself. Long options in
  the Record settings no longer run off the edge. The heading over Phrygian
  dominant's five diagrams ran into its subtitle ("neighbourhoodsPhrygian"); the
  subtitle now sits on its own line. The tuner shares the recorder's stereo input,
  so Input 2 of an interface can be tuned and no second permission prompt comes;
  it tells a screen reader only when the string or direction changes, not 40
  times a second; and a stray pitch (another string ringing) can no longer keep a
  bend check from ending.
- Adopt the quieter risograph layout: a compact kaiju masthead, collapsible lesson
  index, contextual key/root menu and diagram settings, and one current learning
  stage with an expandable course outline. Playback controls sit above the lesson
  in normal page flow, so they cannot cover fretboards. Band/mix options collapse,
  small screens use one column, and keyboard navigation lands on the lesson title.

- Tuner & bends, a new view under Fundamentals. A tuner for standard, half a step
  down, dropped D and the three open tunings (the string you're tuning, how many
  cents off, which way to turn, and a reference tone per string), and a bend and
  vibrato check: pick a string, fret and bend (or one of four classic bends in the
  key on screen), hear the target, play it, and when the note ends it says where
  the bend landed (in tune within 15 cents, flat or sharp by how much, or how far
  it got) and the vibrato's speed, width and whether the speed held steady, with
  the pitch drawn against the target. Recent results are kept. Pitch is YIN on the
  shared input, in `web/pitch.js`, tested against synthetic plucked strings from
  low E to 1318 Hz (within 3 cents), and checked in Chrome on a synthetic bend 20
  cents flat with a 5.5 Hz, 25-cent vibrato: read as 18 to 22 cents flat, 5.5 Hz,
  22 cents.
- Start here remembers which stages you've passed. "I passed this test" on each
  stage; the first one not passed is marked "You are here", and a Today card at
  the top shows it, its test, your streak and what to do next. Stage 1 now opens
  the tuner, the Rhythm lab and the 12-bar trainer; stage 4 opens the bend check.
- Lick tempos: each lick keeps the tempo you last played it cleanly at ("Played
  it clean at this tempo"), shows the history, and offers Warm up at 5 below and
  Try 5 above. Today names the lick you've left longest and its tempo.
- One-minute changes, in Practice: pick two chords from twelve common pairs (chord
  boxes shown), switch between them for a minute, tap or press Space on each
  change, and try to beat your best; a stopped minute isn't counted.
- Today is rebuilt around these: play today, tune up, your stage, the lick to push,
  the chord change to beat, and how your recent bends landed, five items at most,
  each with a button that goes there. Practice days now also count starting the
  12-bar trainer, finishing a take, a focus timer running out, a checked bend, a
  lick tempo, a minute of changes or a passed stage, not only the ear drill and a
  logged session.
- Practice: a Today card (streak and what to do next) and an ear drill that ties
  each pentatonic degree to its sound, weighted toward the ones you miss.
- Critique of the finished app, and fixes: the Record settings (input, what to
  record, this take, latency, file options) fold into one collapsed section
  instead of filling the toolbar on every view; the Songs view's labels and status
  lines match the rest of the desk; a take that could not be kept in the library
  says so, without hiding the earlier message; a dot on the Songs button shows
  when a take is ready for its two-day re-listen, from any view; slash chords
  (Am/G) and add9, m9, maj9, 11, 13 and 7sus4 are understood; timing analysis
  reads at most the first fifteen minutes of a take, bounding memory.
- Hear the model: every lick has a button that plays it first, as written, at
  the current tempo. Practice theory gains a card and a reference for Hewitt
  (2001, DOI 10.2307/3345614), stating what the study did and did not show (82
  band students; a model helped only alongside self-evaluation; not intonation,
  technique or tempo). The microphone is asked for `latency: 0`, the Record row
  advises headphones with backing, and a test streams a ten-minute run-through
  to storage in 600 chunks and gets a whole WAV back.
- Timing feedback: onsets are read from the guitar-only signal (a 16 ms energy
  window and energy flux, timed to the sample) and set against the beat with the
  latency calibration taken off. The headline is consistency, the spread in ms,
  apart from the lean ahead of or behind the beat, overall and by section; a dot
  per note on the waveform. Compare two takes from the same section or first
  bar, in sync, with Switch. Progress per song: ratings, timing spread,
  mistakes, clean run-throughs, section ratings over time. Tested on synthetic
  guitar with known note times: within 12 ms on E, A and high e strings and on
  a quiet one. Checked in Chrome on real worklet audio.
- Looper: record 1, 2, 4, 8 or 12 bars at the set tempo, with a count-in, on
  exact audio-clock frames, and hear it repeat with no gap; solo over it with
  or without recording (the loop plays into the recording bus). Chords can be
  entered for the loop and the chord-tone overlay follows them; the latency
  calibration puts it back on the beat. Checked in Chrome: two bars at
  120 bpm recorded as exactly 4.000 s and looped through bar 1, bar 2, bar 1.
- Layers: a solo recorded over a rhythm take can be heard as two layers with a
  volume and mute each, plus a click on the recording's beat; the solo is kept
  compressed on its own for this, from a second recorder beside the main one.
  Download solo only, rhythm only or both mixed. It is a listening aid, not a
  studio.
- Use as backing: a take of your own rhythm playing becomes a backing under
  Your songs, with sections, loop, slow-down, count-in and chords like an
  imported song. It is stored once (it points at the take), starts that many
  milliseconds early by your latency calibration so a solo lines up, and warns
  if you haven't calibrated. A solo recorded over it is linked back to it and
  named for it; deleting the rhythm take removes the backing.
- Chords and sections: a song can have chords (`Am | Dm | E7`, repeating) and
  named sections, each with chords of its own, added by hand or built from a Song
  structure form. Chord tones can Follow backing in every view, lighting the
  chord the song is on, and choosing a song sets the key for the pentatonic
  box. Loop any section, or record one alone: the take is named and linked
  for the song and ends with the section. Checked in Chrome: Am, Dm, E7 change
  on each 2-second bar of a real WAV.
- Solo and song together: a take with backing is the guitar and the backing in
  one recording, and your guitar is also kept on its own, on the same audio
  clock and the same length to the sample, as a mono stem: Download solo only
  (WAV). It is linked from the take in the library. Checked in Chrome: with a
  drone as backing, the mix carries it 12 dB above the stem, which does not.
- Your takes: finished takes are kept in a library (the compressed file plus
  focus, cold/retest, mistake marks and calibration), listed in the Songs view.
  Open one for a waveform with bar lines, sections and marks (click to jump),
  playback with slow-down and an A–B loop, 1–5 ratings for the whole take and
  each section, a suggested weakest section, and a note for what to fix next.
  Two days later the desk prompts a re-listen and shows both ratings side by
  side. Export all writes a zip of takes and a JSON of ratings, markers and
  stats, never a song file. The database moves to version 3 for this.
- Fixed: in Safari the Songs view could say "Song storage is unavailable". An
  earlier build had left the browser's database at version 2 without the song
  tables, so no upgrade ran and every read of them failed. The desk now checks
  that all its tables exist after opening and, if any are missing, reopens one
  version higher to create them; it uses a database a newer build has already
  taken further; it lets go of the database when another tab wants to upgrade
  it; and it says so when an older tab is blocking the upgrade. The error now
  names what went wrong.
- Build scripts: `scripts/build.sh` (macOS and Linux) and `scripts/build.ps1`
  (Windows) build the program from source, run the tests first, and
  cross-compile (`--target windows-x64`, `-Arch arm64`, and so on). CI builds
  with `build.sh` on both operating systems.
- Fixed: `install.sh --zip` (and `install.ps1 -ZipPath`) checked a ZIP against
  the first `SHA256SUMS-*.txt` in its folder, so a folder holding several
  releases, such as `dist/`, refused a good download. They now use the file that
  lists the ZIP. A regression test covers it. Verified end to end: a full
  `release.sh` build installed and ran, its signature verifies, and a tampered
  ZIP is refused.
- Security review recorded in SECURITY.md: the client, the server, the
  installers and the workflows. The installers now accept only a well-formed
  release tag, and an imported song is limited to 300 MB. `govulncheck` finds
  nothing in the Go program, which has no third-party dependencies.
- Security hardening of the local server: a Permissions-Policy that allows the
  microphone to the desk alone and switches off camera, location, payment, USB,
  serial, Bluetooth and screen capture; a Cross-Origin-Resource-Policy so no
  other site can embed its files; only GET and HEAD reach files (a POST or PUT
  is refused with 405); and read, write, idle and header-size limits.
- Songs view: import an MP3, M4A or WAV you own, kept in this browser and never
  uploaded. Title, key, tempo (typed or tapped), first downbeat and form; play
  at 100/90/75/50% with pitch kept, a four-beat count-in and an A–B loop. The
  song plays through the audio graph so a take with backing records it, and a
  take made over a song is named and linked to it, at the slowed tempo.
- Latency calibration: a loopback beep measured to the sample, or tapping
  along to a click for headphones, plus a manual trim. The offset is stored
  with every take. Press M (or the big button) during a take to mark a
  mistake; marks are saved as they happen and listed when the take is saved.
- Record button moves into the Play along bar, usable from every view, and
  guitar + backing is the default. Each take picks its length (full run-through,
  a 12-bar chorus, or a drill of 8 or 4 bars), one focus, and cold attempt or
  retest. A drill over the trainer ends on the exact downbeat after its last
  bar. Files are named `<song>-<section|full>-<bpm>bpm-<date>-<cold|retest>`.
- Triads and Inversions each open with an interactive explorer (from the
  drafts in `triads-explorer/` and `inversions-explorer/`), with the existing
  material below. Triads: Build it, Change one note, Inside barre chords.
  Inversions: every grip up the neck on four string sets, a card stack, the
  pentatonic behind the grip, Play all. They share `web/chord-explorer.js`,
  have their own Key menu kept in step with the toolbar's Root buttons, play
  through the app's audio (so they
  work in Lockdown Mode), and colour notes by job with the root as a square.
  In these two views chords are spelt as on a chart: E♭, A♭, B♭, C♯, F♯.
- The 12-bar trainer opens with a poster for its backing band, Rats of Chaos of
  Grid Lock.
- The 12-bar trainer has a backing band, first part: drums and bass,
  synthesised in `web/band.js`. Four feels (shuffle, straight rock, slow blues
  12/8, funk 16ths), a swing slider from 50% to 75% with the triplet feel
  marked, shuffle-walk or root–fifth bass that follows split bars, an optional
  ride, tap tempo, and settings remembered. Checked in Chrome: every hit within
  7 ms of the grid. Keys (dominant-7th stabs on the offbeats of 2 and 4, a held
  chord in 12/8) and a boogie 5–6 rhythm guitar join them, with a mixer: volume
  and on/off per part, so you can play the bass or rhythm part yourself.
  Practice modes: loop N choruses or forever, a tempo ladder (+5 bpm a chorus
  to a target, without a restart), a key cycle (up a 4th or random), drop-out
  bars and trade fours. The chord-tone overlay can follow the band's chord,
  whatever it is (IIm7, VI7, a diminished passing chord), in every view. On
  the compatibility engine the band renders each chorus in advance, from the
  same score, and plays it from bar 1; the status line says so.
- A take with backing can no longer clip: the backing is mixed in 3 dB under
  the guitar, with a limiter after both and a trim for the compressor's
  built-in make-up gain. A take that peaked at 0 dB now peaks near -3 dB.
  Guitar-only takes are untouched. What you hear doesn't change.
- WAV masters can be 24-bit, and MP3 quality is a choice: standard (128 kbps mono,
  192 stereo), high (192/256) or best (320). Both are remembered on the device;
  changing the MP3 quality re-encodes on the next download. Masters stored before
  this read as 16-bit.
- Download MP3 as well as WAV and the compressed original. It is encoded from
  the lossless master with LAME (lamejs 1.2.1, LGPL-3.0, shipped unmodified in
  `web/vendor/` with its licence texts) in a background worker: 128 kbps for a
  mono take, 192 kbps for stereo. Saved masters can be taken as MP3 too.
- The WAV is now a true master rather than decoded from the compressed file. An
  AudioWorklet (`rec-worklet.js`) captures the raw audio on the audio thread and it
  is streamed to IndexedDB as you play, so takes have no length limit (the
  30-minute cap is gone), survive a crash, and an armed take starts on the exact
  sample of bar 1. Masters not yet downloaded, including interrupted takes, are
  listed with Download WAV and Discard.
- Record a take from any audio input, guitar only (mono) or with the backing mixed
  in (stereo), with the browser's voice processing switched off. It can start on
  bar 1 after the 12-bar trainer's count-in. Play it back, then download the
  compressed original or a WAV; each button shows the file size. On a two-input interface you can record just the input
  the guitar is in, centred. Monitor input plays the input through the
  computer's output, for headphones on a USB amp rather than the interface.
  Check input shows a live level for each of the interface's two inputs, so
  you can see which one the guitar is in; click a bar to pick it. It says when
  there is no signal, when the signal is on the other input, and when the level
  is hot or clipping.
  Recording and monitoring share one open input, released after five idle
  minutes, so Safari asks for the microphone at most once per visit. Where Safari
  withholds the microphone because of Lockdown Mode, the Record row says so and
  how to exclude the site (or the app, for another browser built on Safari's
  engine such as DuckDuckGo).
  A WebM take now states its length, so players show it and can seek. Browser
  recorders write WebM as a stream and leave it out; the desk adds it before you
  download. The page's policy
  now allows `blob:` media, which is where the take plays back from.
- Standard MIT `LICENSE` text so GitHub recognises it; the bundled fonts are
  listed in `THIRD_PARTY_NOTICES.md`, which now ships in every release package.
- Live demo on GitHub Pages. The Quit control appears only when the page is
  served by the app itself.
- Releases are built and published by CI from a version tag, with build
  provenance attestations.
- Security policy, contributing guide and issue templates.
- Fixed: the Quit row showed on the live demo, because the row's `display:flex`
  overrode its `hidden` attribute. Hidden now always wins.
- A tab and home-screen icon, drawn from the app icon. The page no longer
  probes for the local app anywhere but loopback, so the demo loads without
  errors.

## 2026.09.18.1

- Fixed: a fret line in Box 3 disappeared at normal zoom, because the five-fret
  diagram is scaled down further than the four-fret ones.
- Docs: macOS 15 and later first-launch steps (System Settings → Privacy &
  Security → Open Anyway) in the README and in each download's README.

## 2026.09.18

First public release.

- One-line installers for Windows (`install.ps1`) and macOS (`install.sh`) that
  verify downloads against SHA-256 checksums and need no administrator rights.
- Beats are scheduled on the audio clock, so the metronome, 12-bar trainer,
  rhythm lab and solo player keep time while the page is busy.
- Security: Content-Security-Policy, loopback-only `Host` check, no inline
  scripts, defensive reads of saved data.
- All five typefaces bundled; no network requests at all.
- Smaller hero image (JPEG, about 100 kB); bounded audio cache; drones fade out.
- Seven Licks diagrams describe each lick for screen readers.

# Changelog

All notable changes to this project. Versions are release dates, with a suffix for
a second release on the same day.

## Unreleased

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

# Changelog

All notable changes to this project. Versions are release dates, with a suffix for
a second release on the same day.

## Unreleased

- Triads and Inversions each open with an interactive explorer (from the
  drafts in `triads-explorer/` and `inversions-explorer/`), with the existing
  material below. Triads: Build it, Change one note, Inside barre chords.
  Inversions: every grip up the neck on four string sets, a card stack, the
  pentatonic behind the grip, Play all. They share `web/chord-explorer.js`,
  follow the toolbar's Root buttons, play through the app's audio (so they
  work in Lockdown Mode), and colour notes by job with the root as a square.
  In these two views chords are spelt as on a chart: E♭, A♭, B♭, C♯, F♯.
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

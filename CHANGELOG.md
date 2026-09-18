# Changelog

All notable changes to this project. Versions are release dates, with a suffix for
a second release on the same day.

## Unreleased

- Record a take from any audio input, guitar only (mono) or with the backing mixed
  in (stereo), with the browser's voice processing switched off. It can start on
  bar 1 after the 12-bar trainer's count-in. Play it back, then download the
  compressed original or a WAV; each button shows the file size. A take stops
  itself at 30 minutes. On a two-input interface you can record just the input
  the guitar is in, centred. Monitor input plays the input through the
  computer's output, for headphones on a USB amp rather than the interface. The page's policy
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

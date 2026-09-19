# Third-party notices

The Minor Pentatonic Practice Desk is MIT licensed (see [LICENSE](LICENSE)). It
embeds five typefaces and an MP3 encoder that are **not** covered by that licence.
The typefaces are listed first; the encoder, LAME, under its own heading below. Each is licensed
under the [SIL Open Font License, Version 1.1](https://openfontlicense.org), and the
full licence text travels with the font files, inside the binary and in every
release package.

| Typeface | Used for | Copyright | Licence file |
|---|---|---|---|
| DM Mono | practice desk | 2020 The DM Mono Project Authors | `web/assets/fonts/OFL-DM-Mono.txt` |
| Bricolage Grotesque | practice desk | 2022 The Bricolage Grotesque Project Authors | `web/assets/fonts/OFL-Bricolage-Grotesque.txt` |
| Work Sans | Seven Licks lesson | 2019 The Work Sans Project Authors | `web/assets/fonts/OFL-Work-Sans.txt` |
| Archivo Black | Seven Licks lesson | 2017 The Archivo Black Project Authors | `web/assets/fonts/OFL-Archivo-Black.txt` |
| Space Mono | Seven Licks lesson | 2016 The Space Mono Project Authors | `web/assets/fonts/OFL-Space-Mono.txt` |

The running app serves each licence at `/assets/fonts/<licence file name>`.
`reference/fonts/` holds copies of DM Mono and Bricolage Grotesque, with their
licences, for the standalone reference page.

## LAME MP3 encoder

The recorder's **Download MP3** uses [LAME](https://lame.sourceforge.io) through
[lamejs](https://github.com/zhuker/lamejs) 1.2.1, a JavaScript port of LAME. Browsers
record Opus and AAC but cannot write MP3 themselves. lamejs is licensed under the
**GNU Lesser General Public License, version 3** (LGPL-3.0), not the MIT licence.

- It ships **unmodified** as a separate file, `web/vendor/lame.min.js`, loaded only by
  the MP3 worker (`web/mp3-worker.js`). You may replace it with your own build of
  lamejs; its source is at https://github.com/zhuker/lamejs. A test pins the file's
  SHA-256, so any change to it is deliberate.
- The licence texts travel with it, inside the binary and in every release package:
  `web/vendor/LGPL-3.0.txt`, and `web/vendor/GPL-3.0.txt`, which the LGPL builds on.
  LAME's own note on using it is `web/vendor/LAME-LICENSE.txt`.
- The running app serves each at `/vendor/<file name>`.

The artwork, including the kangaroo rat, is original to this project and is
covered by the MIT licence above.

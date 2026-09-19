# Security policy

## Reporting a vulnerability

Please report security problems **privately**, not in a public issue:
open the repository's **Security** tab and choose **Report a vulnerability**
(GitHub private vulnerability reporting). Only the maintainer can see the report.

Please include what you found, how to reproduce it, and which version you tested
(`minor-pentatonic -version`, or the version shown in the page footer). You should
get a reply within a week.

## Supported versions

Fixes go into the latest release only. The installers always fetch the latest
release, so updating means running the install command again.

## What the app does, for context

- It serves only files embedded in the binary, only on `127.0.0.1`, and rejects
  requests whose `Host` is not a loopback name (DNS-rebinding protection).
- Pages run under a Content-Security-Policy that allows no inline or third-party
  scripts, and cannot be framed by other sites.
- `/quit` needs `POST` plus a custom header, so another site cannot trigger it.
- It makes no network requests of its own and collects nothing. Practice data
  stays in the browser's local storage on your computer.
- Recordings and imported songs are kept in the browser's IndexedDB on your
  computer and are never uploaded. Only the desk itself may use the microphone
  (`Permissions-Policy`), and camera, location, payment, USB, serial, Bluetooth
  and screen capture are switched off. Other sites cannot embed its files
  (`Cross-Origin-Resource-Policy`), and only `GET` and `HEAD` reach them.
- Text that comes from storage or a file (take names, song titles, input device
  names) reaches the page only through escaping or `textContent`, and stored
  settings are checked for shape before use. An imported song is limited to
  300 MB.
- The one third-party code in the page is the LAME MP3 encoder (lamejs 1.2.1),
  shipped unmodified in `web/vendor/`; a test pins its SHA-256. The Go program has
  no third-party dependencies, and `govulncheck` reports none in the standard
  library it uses.
- The installers verify every download against the release's SHA-256 checksums,
  the macOS one also verifies the app's code signature, and both accept only a
  well-formed release tag for `--version` / `-Version`. Releases carry a build
  provenance attestation (`gh attestation verify <file> --repo brucehoppe/minor-pentatonic-go`).
- The release and CI workflows pin every action to a commit, run with read-only
  permissions except where a job needs more, and take inputs through validated
  environment variables.

Reports about any of these guarantees failing are especially welcome.

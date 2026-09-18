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
- The installers verify every download against the release's SHA-256 checksums.

Reports about any of these guarantees failing are especially welcome.

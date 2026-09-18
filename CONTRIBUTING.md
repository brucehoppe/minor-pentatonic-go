# Contributing

Thanks for your interest. Bug reports, corrections to the music theory, and small
focused pull requests are all welcome.

## Before you start

For anything larger than a fix, please open an issue first so we can agree on the
approach. The app is deliberately small: one Go binary, no runtime dependencies,
no build step for the frontend, and nothing fetched from the network.

## Working on it

You need Go 1.26.8 or newer, and Node.js 24 or newer for the frontend tests.

```sh
go run . -dev        # serves ./web from disk: edit, then reload the browser
go test ./...        # Go tests plus the headless frontend suite
node --test tests/app.test.mjs   # frontend suite on its own
```

Where things live:

- `main.go`: the local server, security headers and launch behaviour.
- `web/`: everything the browser gets. `app.js` holds the whole practice desk;
  its mutable state is in the single `state` object near the top.
- `tests/app.test.mjs`: the frontend suite. Read the "SUPPORTED SELECTORS" note at
  the top before relying on `querySelectorAll` in new code.

## Rules the tests enforce

- No inline `<script>` or `on…=` handlers in pages; the Content-Security-Policy
  would silently block them.
- No external URLs in the app: cite sources as text (title, DOI, PubMed ID).
- New timed audio should use `beatLoop`, which schedules on the audio clock.
- Anything read back from `localStorage` must be validated and escaped.

## Pull requests

- Keep each pull request to one change, with tests for new behaviour.
- CI must pass: `gofmt`, `go vet`, `go test -race` and the frontend suite on Linux
  and macOS, plus the installer jobs on Windows and macOS.
- Add a line to the "Unreleased" section of `CHANGELOG.md`.

By contributing you agree that your work is released under the project's
[MIT licence](LICENSE).

#!/bin/bash
# Installs the Minor Pentatonic Practice Desk on macOS 11 or later.
#
#   curl -fsSL https://raw.githubusercontent.com/brucehoppe/minor-pentatonic-go/main/scripts/install.sh | bash
#
# Downloads the latest release, checks it against the release's SHA-256 checksums,
# puts the app in Applications and opens it. Nothing else is installed.
#
# Options (to pass them through the one-liner: ... | bash -s -- --user):
#   --user            install into ~/Applications (never needs a password)
#   --system          install into /Applications, asking for an administrator
#                     password (sudo) if your account cannot write there
#   --dir DIR         install into DIR instead
#   --version TAG     a particular release, such as v2026.09.18 (default: latest)
#   --zip FILE        install from a release ZIP already on disk; a SHA256SUMS-*.txt
#                     beside it is used to check it
#   --no-launch       do not open the app afterwards
#   --uninstall       remove it
#
# Permissions: with no option the app goes into /Applications when your account can
# write there (any administrator account can, without a password) and otherwise into
# ~/Applications, so it never has to ask. The app is ad-hoc signed but not notarised;
# a download made by curl carries no quarantine flag, so Gatekeeper's "unidentified
# developer" prompt does not appear, and a --zip that a browser downloaded has the
# flag removed after its checksum is verified. The app only listens on 127.0.0.1,
# so the firewall has nothing to ask either.
#
# Written for the bash 3.2 that ships with macOS, and uses only tools macOS
# includes (curl, shasum, ditto, xattr).
set -euo pipefail

REPO="brucehoppe/minor-pentatonic-go"
APP="Minor Pentatonic Practice Desk"
PORT=7534

step() { printf '\033[36m==>\033[0m %s\n' "$*"; }
die()  { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

MODE=auto DIR="" VERSION=latest ZIP="" LAUNCH=1 UNINSTALL=0
while [ $# -gt 0 ]; do
  case "$1" in
    --user)      MODE=user ;;
    --system)    MODE=system ;;
    --dir)       [ $# -ge 2 ] || die "--dir needs a folder"; DIR="$2"; MODE=dir; shift ;;
    --version)   [ $# -ge 2 ] || die "--version needs a tag"; VERSION="$2"; shift
                 # the tag goes into a URL, so allow only what a release tag contains
                 case "$VERSION" in (*[!A-Za-z0-9._-]*|'') die "--version must be a release tag such as v2026.09.18";; esac ;;
    --zip)       [ $# -ge 2 ] || die "--zip needs a file"; ZIP="$2"; shift ;;
    --no-launch) LAUNCH=0 ;;
    --uninstall) UNINSTALL=1 ;;
    -h|--help)   sed -n '2,30p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)           die "unknown option: $1 (try --help)" ;;
  esac
  shift
done

[ "$(uname -s)" = Darwin ] || die "this installer is for macOS. On Windows use scripts/install.ps1; elsewhere: go install github.com/$REPO@latest"

# ------------------------------------------------------------ where it goes
SUDO=""
case "$MODE" in
  user)   DIR="$HOME/Applications" ;;
  system) DIR="/Applications"
          if [ ! -w "$DIR" ] || { [ -e "$DIR/$APP.app" ] && [ ! -w "$DIR/$APP.app" ]; }; then
            SUDO="sudo"
            step "Installing into /Applications needs an administrator password."
          fi ;;
  dir)    ;;
  auto)   if [ -w /Applications ] && { [ ! -e "/Applications/$APP.app" ] || [ -w "/Applications/$APP.app" ]; }; then
            DIR="/Applications"
          else
            DIR="$HOME/Applications"
          fi ;;
esac
TARGET="$DIR/$APP.app"

# Ask a running copy to quit through the app's own Quit, so it can be replaced.
stop_app() {
  curl -fsS -m 2 -X POST -H 'X-Quit: 1' "http://127.0.0.1:$PORT/quit" >/dev/null 2>&1 && sleep 0.5 || true
}

# ------------------------------------------------------------ uninstall
if [ "$UNINSTALL" = 1 ]; then
  stop_app
  removed=0
  # without --dir, look in both places it could be
  if [ "$MODE" = auto ]; then set -- "/Applications/$APP.app" "$HOME/Applications/$APP.app"; else set -- "$TARGET"; fi
  for app in "$@"; do
    [ -e "$app" ] || continue
    step "Removing $app"
    if [ -w "$(dirname "$app")" ] && [ -w "$app" ]; then rm -rf "$app"; else sudo rm -rf "$app"; fi
    removed=1
  done
  [ "$removed" = 1 ] || die "$APP is not installed"
  echo "$APP has been removed. Your practice log lives in your browser and was not touched."
  exit 0
fi

# ------------------------------------------------------------ fetch
WORK="$(mktemp -d "${TMPDIR:-/tmp}/minor-pentatonic-install.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

SUMS=""
if [ -n "$ZIP" ]; then
  [ -f "$ZIP" ] || die "no such file: $ZIP"
  ZIP="$(cd "$(dirname "$ZIP")" && pwd)/$(basename "$ZIP")"
  TAG=local
  SUMS="$(ls "$(dirname "$ZIP")"/SHA256SUMS-*.txt 2>/dev/null | head -n 1 || true)"
  [ -n "$SUMS" ] || printf '\033[33mwarning:\033[0m no SHA256SUMS file beside the ZIP, so it cannot be verified. Only continue with a ZIP you trust.\n' >&2
else
  if [ "$VERSION" = latest ]; then API="https://api.github.com/repos/$REPO/releases/latest"
  else API="https://api.github.com/repos/$REPO/releases/tags/$VERSION"; fi
  step "Finding the release"
  JSON="$(curl -fsSL -H 'Accept: application/vnd.github+json' "$API")" ||
    die "could not reach GitHub ($API). Download the macOS ZIP from https://github.com/$REPO/releases and run: install.sh --zip <file>"
  # No jq on a stock Mac, so pick the two download URLs out of the JSON by pattern.
  urls="$(printf '%s' "$JSON" | grep -o '"browser_download_url": *"[^"]*"' | sed 's/.*"\(https[^"]*\)"$/\1/')"
  TAG="$(printf '%s' "$JSON" | grep -o '"tag_name": *"[^"]*"' | head -n 1 | sed 's/.*"\([^"]*\)"$/\1/')"
  ZIP_URL="$(printf '%s\n' "$urls" | grep -- '-macos\.zip$' | head -n 1 || true)"
  SUMS_URL="$(printf '%s\n' "$urls" | grep '/SHA256SUMS-[^/]*\.txt$' | head -n 1 || true)"
  [ -n "$ZIP_URL" ]  || die "release ${TAG:-?} has no macOS build"
  [ -n "$SUMS_URL" ] || die "release ${TAG:-?} has no SHA256SUMS file, so its download cannot be verified. Nothing was installed."
  ZIP="$WORK/$(basename "$ZIP_URL")"
  SUMS="$WORK/$(basename "$SUMS_URL")"
  step "Downloading $(basename "$ZIP") ($TAG)"
  curl -fL --progress-bar -o "$ZIP" "$ZIP_URL"
  curl -fsSL -o "$SUMS" "$SUMS_URL"
fi

# ------------------------------------------------------------ verify
if [ -n "$SUMS" ]; then
  step "Checking the SHA-256 checksum"
  name="$(basename "$ZIP")"
  want="$(awk -v n="$name" '{f=$2; sub(/^\*/, "", f)} f == n {print tolower($1); exit}' "$SUMS")"
  [ -n "$want" ] || die "$name is not listed in $(basename "$SUMS"). Nothing was installed."
  got="$(shasum -a 256 "$ZIP" | awk '{print tolower($1)}')"
  [ "$got" = "$want" ] || die "checksum mismatch for $name (expected $want, got $got). The download is damaged or has been tampered with. Nothing was installed."
fi

# ------------------------------------------------------------ install
step "Unpacking"
ditto -x -k "$ZIP" "$WORK/unpacked"   # ditto keeps the bundle's signature and symlinks intact
[ -d "$WORK/unpacked/$APP.app" ] || die "the ZIP does not contain $APP.app"
# A --zip saved by a browser carries the quarantine flag, which makes Gatekeeper
# refuse an un-notarised app. The checksum above is what vouches for it.
xattr -dr com.apple.quarantine "$WORK/unpacked/$APP.app" 2>/dev/null || true
codesign --verify --deep --strict "$WORK/unpacked/$APP.app" 2>/dev/null ||
  die "the app's code signature does not verify. Nothing was installed."

step "Installing to $TARGET"
stop_app
$SUDO mkdir -p "$DIR"
$SUDO rm -rf "$TARGET"
$SUDO ditto "$WORK/unpacked/$APP.app" "$TARGET"

echo
printf '\033[32m%s %s is installed.\033[0m\n' "$APP" "$TAG"
echo "  Open it from Launchpad, Spotlight or $DIR."
echo "  Remove it with: curl -fsSL https://raw.githubusercontent.com/$REPO/main/scripts/install.sh | bash -s -- --uninstall"

if [ "$LAUNCH" = 1 ]; then open "$TARGET"; fi

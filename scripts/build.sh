#!/usr/bin/env bash
# Build the Minor Pentatonic Practice Desk from source on macOS or Linux.
#
#   ./scripts/build.sh                       build for this computer
#   ./scripts/build.sh --target windows-x64  cross-compile (windows-x64, windows-arm64,
#                                            macos-arm64, macos-x64, linux-x64)
#   ./scripts/build.sh --version 2026.09.19 --out ./out --skip-tests
#
# This makes just the program: one file, with the web pages embedded. To package
# the macOS app, the disk image and the Windows ZIPs for release, use release.sh.
# To install what you built, see install.sh (macOS) or install.ps1 (Windows).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

VERSION="$(date +%Y.%m.%d)-dev" OUT="." TARGET=host TESTS=1
while [ $# -gt 0 ]; do
  case "$1" in
    --version)    [ $# -ge 2 ] || { echo "--version needs a value" >&2; exit 1; }; VERSION="$2"; shift ;;
    --out)        [ $# -ge 2 ] || { echo "--out needs a folder" >&2; exit 1; }; OUT="$2"; shift ;;
    --target)     [ $# -ge 2 ] || { echo "--target needs a name" >&2; exit 1; }; TARGET="$2"; shift ;;
    --skip-tests) TESTS=0 ;;
    -h|--help)    sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)            echo "unknown option: $1 (try --help)" >&2; exit 1 ;;
  esac
  shift
done
case "$VERSION" in (*[!A-Za-z0-9._+-]*|'') echo "--version may hold letters, digits and . _ + - only" >&2; exit 1;; esac

command -v go >/dev/null || { echo "Go is not installed. Get it from https://go.dev/dl/" >&2; exit 1; }

case "$TARGET" in
  host)          GOOS_="$(go env GOOS)"; GOARCH_="$(go env GOARCH)" ;;
  windows-x64)   GOOS_=windows GOARCH_=amd64 ;;
  windows-arm64) GOOS_=windows GOARCH_=arm64 ;;
  macos-arm64)   GOOS_=darwin  GOARCH_=arm64 ;;
  macos-x64)     GOOS_=darwin  GOARCH_=amd64 ;;
  linux-x64)     GOOS_=linux   GOARCH_=amd64 ;;
  *) echo "unknown target '$TARGET' (host, windows-x64, windows-arm64, macos-arm64, macos-x64, linux-x64)" >&2; exit 1 ;;
esac
NAME=minor-pentatonic; [ "$GOOS_" = windows ] && NAME=minor-pentatonic.exe

if [ "$TESTS" = 1 ]; then
  echo "==> Running tests"
  go vet ./...
  go test ./...
fi

mkdir -p "$OUT"
echo "==> Building $NAME $VERSION for $GOOS_/$GOARCH_"
GOOS="$GOOS_" GOARCH="$GOARCH_" CGO_ENABLED=0 \
  go build -trimpath -ldflags "-s -w -X main.version=$VERSION" -o "$OUT/$NAME" .
echo "==> Built $OUT/$NAME ($(du -h "$OUT/$NAME" | cut -f1))"
[ "$GOOS_" = "$(go env GOOS)" ] && [ "$GOARCH_" = "$(go env GOARCH)" ] && echo "    Run it with: $OUT/$NAME"
exit 0

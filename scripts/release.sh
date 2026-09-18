#!/usr/bin/env bash
# Build consumer distribution packages for Windows 11 and macOS.
#
#   ./scripts/release.sh [version]
#
# Produces, in dist/:
#   minor-pentatonic-<version>-macos.dmg          drag-to-Applications disk image
#   minor-pentatonic-<version>-macos.zip          the same .app, zipped
#   minor-pentatonic-<version>-windows-11-x64.zip
#   minor-pentatonic-<version>-windows-11-arm64.zip
#   SHA256SUMS-<version>.txt
#
# The macOS build is a universal binary (Apple silicon + Intel) wrapped in a
# proper .app bundle so it can be double-clicked. It is ad-hoc signed; without a
# paid Apple Developer ID it cannot be notarised, so first launch needs the
# right-click > Open gesture. The per-platform READMEs explain this.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT="$PWD"

VERSION="${1:-$(date +%Y.%m.%d)}"
APP="Minor Pentatonic Practice Desk"
BIN="minor-pentatonic"
ID="com.brucehoppe.minor-pentatonic"
AUTHOR="Bruce Hoppe"
DIST="$ROOT/dist"
# Stage outside dist/ so intermediates can never be mistaken for artifacts and a
# failed run leaves no debris in the output directory.
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/minor-pentatonic-release.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
LDFLAGS="-s -w -X main.version=$VERSION"

say() { printf '\033[1m==>\033[0m %s\n' "$1"; }

say "Minor Pentatonic Practice Desk $VERSION — coded by $AUTHOR"

# ---------------------------------------------------------------- tests
say "Running tests"
go vet ./...
go test ./...

mkdir -p "$STAGE" "$DIST"

# ---------------------------------------------------------------- windows
build_windows() {
  local arch="$1" label="$2"
  local out="$STAGE/windows-$arch"
  say "Building Windows 11 $label"
  mkdir -p "$out"
  GOOS=windows GOARCH="$arch" CGO_ENABLED=0 \
    go build -trimpath -ldflags "$LDFLAGS" -o "$out/$BIN.exe" .

  cat > "$out/README.txt" <<TXT
$APP $VERSION - Windows 11 $label
Coded by $AUTHOR

GETTING STARTED

  1. Extract this ZIP folder somewhere you can find again, such as Documents.
     Windows will not run the program from inside the ZIP.
  2. Double-click $BIN.exe.
  3. The practice desk opens in your default browser.

  A small console window stays open while the app runs. Leave it there.

STOPPING IT

  Click Quit at the top of the page, or close the console window,
  or press Ctrl+C in the console.

  Running it a second time while it is already running does not start a second
  copy - it reopens the practice desk in your browser. Use that if you close
  the tab.

IF WINDOWS SMARTSCREEN APPEARS

  SmartScreen warns about programs it has not seen before. This build is not
  code-signed, so the warning is expected.
  Click "More info", then "Run anyway".

WHAT IT DOES AND DOES NOT DO

  Runs a small web server on your own machine, bound to 127.0.0.1 only. It is
  not reachable from your network or the internet, and it sends nothing
  anywhere. Your practice log and progress checklist are stored by your
  browser, on this computer.

  No Go runtime, no internet connection and no extra files are needed.
  Everything is inside the one .exe.

  Prefer an installer? In PowerShell, this checks the download, adds a Start
  menu shortcut and an entry in Settings > Apps, and needs no administrator
  rights:
      irm https://raw.githubusercontent.com/brucehoppe/minor-pentatonic-go/main/scripts/install.ps1 | iex

  To remove it, delete the folder.

COMMAND LINE OPTIONS (optional)

  $BIN.exe -no-open        start without opening a browser
  $BIN.exe -addr 127.0.0.1:8080   use a different port (the default is 7534)
  $BIN.exe -version        print the version and author
TXT

  printf 'Minor Pentatonic Practice Desk %s\nCoded by %s\n' "$VERSION" "$AUTHOR" > "$out/AUTHOR.txt"

  [ -f "$ROOT/LICENSE" ] && cp "$ROOT/LICENSE" "$out/LICENSE.txt"
  cp "$ROOT/THIRD_PARTY_NOTICES.md" "$out/THIRD_PARTY_NOTICES.txt"
  # zip adds to an archive that already exists rather than replacing it, so
  # rebuilding a version would leave entries from the previous build behind.
  # Every artifact is removed before it is written.
  rm -f "$DIST/$BIN-$VERSION-windows-11-$label.zip"
  ( cd "$out" && zip -qr9 "$DIST/$BIN-$VERSION-windows-11-$label.zip" . -x '.*' )
}

build_windows amd64 x64
build_windows arm64 arm64

# ---------------------------------------------------------------- macos
say "Building macOS universal binary"
GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 go build -trimpath -ldflags "$LDFLAGS" -o "$STAGE/$BIN-arm64" .
GOOS=darwin GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "$LDFLAGS" -o "$STAGE/$BIN-amd64" .
lipo -create -output "$STAGE/$BIN-universal" "$STAGE/$BIN-arm64" "$STAGE/$BIN-amd64"
lipo -archs "$STAGE/$BIN-universal"

say "Generating the icon"
ICONSET="$STAGE/icon.iconset"
mkdir -p "$ICONSET"
for spec in "16 16x16" "32 16x16@2x" "32 32x32" "64 32x32@2x" \
            "128 128x128" "256 128x128@2x" "256 256x256" "512 256x256@2x" \
            "512 512x512" "1024 512x512@2x"; do
  set -- $spec
  python3 "$ROOT/scripts/make-icon.py" "$ICONSET/icon_$2.png" "$1" > /dev/null
done
iconutil -c icns "$ICONSET" -o "$STAGE/AppIcon.icns"

say "Assembling the .app bundle"
BUNDLE="$STAGE/macos/$APP.app"
mkdir -p "$BUNDLE/Contents/MacOS" "$BUNDLE/Contents/Resources"
cp "$STAGE/$BIN-universal" "$BUNDLE/Contents/MacOS/$BIN"
chmod +x "$BUNDLE/Contents/MacOS/$BIN"
cp "$STAGE/AppIcon.icns" "$BUNDLE/Contents/Resources/AppIcon.icns"

cat > "$BUNDLE/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>$APP</string>
  <key>CFBundleDisplayName</key><string>$APP</string>
  <key>CFBundleIdentifier</key><string>$ID</string>
  <key>CFBundleExecutable</key><string>$BIN</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.music</string>
  <key>NSHighResolutionCapable</key><true/>
  <!-- A local server whose interface is the browser, not a windowed Mac app, so it
       is an agent rather than a Dock application. The executable is also only a
       launcher: it starts a detached server, opens the browser and exits, which is
       what keeps repeated double-clicks working. See launchedFromBundle in main.go. -->
  <key>LSUIElement</key><true/>
  <key>NSHumanReadableCopyright</key><string>Coded by $AUTHOR</string>
</dict>
</plist>
PLIST
plutil -lint "$BUNDLE/Contents/Info.plist"
printf 'APPL????' > "$BUNDLE/Contents/PkgInfo"

say "Ad-hoc signing"
codesign --force --deep --sign - --timestamp=none "$BUNDLE"
codesign --verify --deep --strict --verbose=1 "$BUNDLE"

cat > "$STAGE/macos/README.txt" <<TXT
$APP $VERSION - macOS (Apple silicon and Intel)
Coded by $AUTHOR

GETTING STARTED

  1. Drag "$APP" into the Applications folder.
  2. THE FIRST TIME ONLY, macOS refuses to open it (see below):
       macOS 15 Sequoia and later: double-click it, click Done, then open
         System Settings > Privacy & Security, scroll down and click
         "Open Anyway" next to $APP, and confirm.
       macOS 11 to 14: right-click (or Control-click) the app in
         Applications, choose Open, then click Open in the dialog.
     After that, double-click it like any other app.

  The practice desk opens in your default browser.

WHY THE FIRST-LAUNCH STEP

  macOS blocks downloaded apps that have not been notarised by Apple, which
  requires a paid Apple Developer account. Double-clicking one shows a warning
  with no way through; the steps above tell macOS you trust it. You only have
  to do it once.

  To skip this entirely, install with the one-line installer instead: its
  download is checked against the release checksums and is not blocked.
      curl -fsSL https://raw.githubusercontent.com/brucehoppe/minor-pentatonic-go/main/scripts/install.sh | bash

  If macOS still refuses, run this in Terminal, then try again:

      xattr -dr com.apple.quarantine "/Applications/$APP.app"

IT HAS NO DOCK ICON - THAT IS DELIBERATE

  The app is a small web server; its interface is the browser page it opens.
  Double-clicking starts it in the background and opens the page, then the icon
  you clicked is done - there is no window and no Dock icon to go back to.

  Double-click it again any time to reopen the practice desk. It will not start
  a second copy, and it does not matter whether it was already running. Use that
  if you close the browser tab.

STOPPING IT

  Click Quit at the top of the page.

  If you have closed the tab, double-click the app to bring it back, then Quit.

WHAT IT DOES AND DOES NOT DO

  Runs a small web server on your own machine, bound to 127.0.0.1 only. It is
  not reachable from your network or the internet, and it sends nothing
  anywhere. Your practice log and progress checklist are stored by your
  browser, on this Mac.

  Universal binary: runs natively on Apple silicon and on Intel Macs.
  Requires macOS 11 Big Sur or later. No installer or runtime is needed.

  To remove it, drag the app to the Trash.

COMMAND LINE OPTIONS (optional)

  "/Applications/$APP.app/Contents/MacOS/$BIN" -no-open
  "/Applications/$APP.app/Contents/MacOS/$BIN" -addr 127.0.0.1:8080   (a different port; the default is 7534)
  "/Applications/$APP.app/Contents/MacOS/$BIN" -version
TXT

printf 'Minor Pentatonic Practice Desk %s\nCoded by %s\n' "$VERSION" "$AUTHOR" > "$STAGE/macos/AUTHOR.txt"

[ -f "$ROOT/LICENSE" ] && cp "$ROOT/LICENSE" "$STAGE/macos/LICENSE.txt"
cp "$ROOT/THIRD_PARTY_NOTICES.md" "$STAGE/macos/THIRD_PARTY_NOTICES.txt"
ln -s /Applications "$STAGE/macos/Applications"

say "Packaging macOS"
# The dmg takes the whole staging folder. The zip cannot: it must leave out the
# Applications symlink, which only means anything inside a mounted disk image. So it
# lists what goes in, which means anything added to the staging folder above has to
# be added here too — that is how LICENSE.txt came to be in the dmg but not the zip.
mac_extras=(README.txt AUTHOR.txt THIRD_PARTY_NOTICES.txt)
if [ -f "$STAGE/macos/LICENSE.txt" ]; then mac_extras+=(LICENSE.txt); fi
rm -f "$DIST/$BIN-$VERSION-macos.zip"
( cd "$STAGE/macos" && zip -qr9 --symlinks "$DIST/$BIN-$VERSION-macos.zip" "$APP.app" "${mac_extras[@]}" )
rm -f "$DIST/$BIN-$VERSION-macos.dmg"
hdiutil create -quiet -volname "$APP" -srcfolder "$STAGE/macos" \
  -ov -format UDZO -fs HFS+ "$DIST/$BIN-$VERSION-macos.dmg"

# ---------------------------------------------------------------- checksums
say "Checksums"
( cd "$DIST" && shasum -a 256 \
    "$BIN-$VERSION-macos.dmg" \
    "$BIN-$VERSION-macos.zip" \
    "$BIN-$VERSION-windows-11-x64.zip" \
    "$BIN-$VERSION-windows-11-arm64.zip" > "SHA256SUMS-$VERSION.txt" )
cat "$DIST/SHA256SUMS-$VERSION.txt"

say "Done. Artifacts in dist/"
ls -lhd "$DIST"/*"$VERSION"* | sed 's/^/    /'

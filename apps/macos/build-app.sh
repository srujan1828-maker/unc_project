#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ "$(uname -s)" != Darwin ]]; then
  echo 'Building the macOS app requires a Mac with Xcode Command Line Tools.' >&2
  exit 1
fi
case "${1:---universal}" in
  --universal) artifact_arch=universal ;;
  --native) artifact_arch="$(uname -m)" ;;
  *) echo 'Usage: bash build-app.sh [--universal|--native]' >&2; exit 1 ;;
esac
sign_identity="${OMNI_CODESIGN_IDENTITY:--}"
if [[ -n "${OMNI_NOTARY_PROFILE:-}" && "$sign_identity" == - ]]; then
  echo 'Notarization requires OMNI_CODESIGN_IDENTITY set to a Developer ID Application identity.' >&2
  exit 1
fi
xcrun --find swift >/dev/null
if [[ "$artifact_arch" == universal ]]; then
  # Build slices separately; this also works with Command Line Tools without an Xcode project.
  swift build -c release --arch arm64
  arm_bin="$(swift build -c release --arch arm64 --show-bin-path)"
  swift build -c release --arch x86_64
  intel_bin="$(swift build -c release --arch x86_64 --show-bin-path)"
else
  swift build -c release
  bin_path="$(swift build -c release --show-bin-path)"
fi
mkdir -p build
staging="$(mktemp -d "$PWD/build/staging.XXXXXX")"
trap 'rm -rf "$staging"' EXIT
app="$staging/OmniSync.app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
if [[ "$artifact_arch" == universal ]]; then
  lipo -create "$arm_bin/OmniSync" "$intel_bin/OmniSync" -output "$app/Contents/MacOS/OmniSync"
else
  cp "$bin_path/OmniSync" "$app/Contents/MacOS/OmniSync"
fi
cp Resources/Info.plist "$app/Contents/Info.plist"
plutil -lint "$app/Contents/Info.plist"
swift scripts/make-icon.swift "$staging/AppIcon.iconset"
iconutil --convert icns --output "$app/Contents/Resources/AppIcon.icns" "$staging/AppIcon.iconset"
if [[ "$artifact_arch" == universal ]]; then
  lipo "$app/Contents/MacOS/OmniSync" -verify_arch arm64 x86_64
fi
if [[ "$sign_identity" == - ]]; then
  codesign --force --sign - "$app"
else
  codesign --force --options runtime --timestamp --sign "$sign_identity" "$app"
fi
codesign --verify --deep --strict --verbose=2 "$app"
archive="$PWD/build/OmniSync-macos-$artifact_arch.zip"
ditto -c -k --sequesterRsrc --keepParent "$app" "$archive"
if [[ -n "${OMNI_NOTARY_PROFILE:-}" ]]; then
  xcrun notarytool submit "$archive" --keychain-profile "$OMNI_NOTARY_PROFILE" --wait
  xcrun stapler staple "$app"
  xcrun stapler validate "$app"
  ditto -c -k --sequesterRsrc --keepParent "$app" "$archive"
fi
# Only generated build outputs are replaced; application data and Keychain are untouched.
rm -rf build/OmniSync.app
mv "$app" build/OmniSync.app
mkdir -p "$staging/volume"
ditto build/OmniSync.app "$staging/volume/OmniSync.app"
ln -s /Applications "$staging/volume/Applications"
dmg="$PWD/build/OmniSync-macos-$artifact_arch.dmg"
hdiutil create -ov -volname OmniSync -srcfolder "$staging/volume" -format UDZO "$dmg"
if [[ -n "${OMNI_NOTARY_PROFILE:-}" ]]; then
  xcrun notarytool submit "$dmg" --keychain-profile "$OMNI_NOTARY_PROFILE" --wait
  xcrun stapler staple "$dmg"
  xcrun stapler validate "$dmg"
fi
(cd build && shasum -a 256 "$(basename "$archive")" "$(basename "$dmg")" > SHA256SUMS)
echo "Built build/OmniSync.app, $(basename "$archive"), and $(basename "$dmg")."
if [[ "$sign_identity" == - ]]; then
  echo 'Development build: ad-hoc signed, not notarized. See apps/macos/README.md for installation.'
fi

# OmniSync for macOS

A native SwiftUI companion for macOS 13 or newer, on Apple silicon and Intel Macs. It connects to the OmniSync service in this repository; the service can run on this Mac or another trusted device.

## Build and open on a Mac

Install Xcode Command Line Tools (`xcode-select --install`) or Xcode. From the repository root:

```sh
bash apps/macos/build-app.sh --native
open apps/macos/build/OmniSync.app
```

Alternatively, double-click **Build OmniSync.command** in this folder. This builds for the current Mac and opens the app. Building the companion does not require Node.js. Hosting the workspace service and running integration tests do require Node.js 24.

To build for both Apple silicon and Intel:

```sh
bash apps/macos/build-app.sh --universal
```

Outputs appear in `apps/macos/build/`:

- `OmniSync.app`, with its icon and application metadata.
- `OmniSync-macos-universal.zip` and `OmniSync-macos-universal.dmg` (or architecture-specific names with `--native`).
- `SHA256SUMS`, containing checksums for the archives.

Open the DMG and drag OmniSync into Applications. Start the installed app before enabling **Launch at login**. The default build is ad-hoc signed for local development; it is not a notarized public release. Keep Gatekeeper enabled. Use a local source build for development, or a Developer ID signed and notarized build for distribution.

## Connect the Mac

1. Start the service using the root [README](../../README.md). Create the owner workspace in your browser with the local first-run setup key.
2. Select **Add device** in the web workspace and create a member invitation.
3. Enter the workspace origin, a device name, and the invitation code in OmniSync. For a service on this Mac, use `http://127.0.0.1:47800`; another device requires a trusted HTTPS address. See [NETWORKING.md](../../docs/NETWORKING.md).
4. Your session is stored in macOS Keychain. Browser and companion sessions are separate, so the browser may need its own invitation.

The menu-bar icon stays available when the window is closed. Choose **Show OmniSync** to reopen it. A denied or locked Keychain produces an explicit error; unlock the login Keychain and choose **Retry saved Keychain session**. An expired or revoked session returns to pairing. **Forget this connection** removes the local Keychain entry; the owner can revoke its device entry in the web workspace.

## Included behavior

- Native pairing, connection status, polling/reconnect, device roster, and role-aware controls. Observers and guests can copy/download but cannot send.
- Explicit clipboard sharing and copying; typed text; recipient selection. There is no automatic clipboard surveillance.
- Multiple-file picker and file drops, processed sequentially with progress and cancellation. Folders are rejected.
- Streaming SHA-256 verification, a 1 GiB per-file limit, and 1 MiB upload chunks. Reselect the same file and recipient after interruption to resume.
- Save dialog, download size/hash verification, atomic destination replacement after the dialog's overwrite confirmation, and Reveal in Finder. A failed checksum leaves the destination untouched.
- Menu-bar actions and opt-in launch at login using `SMAppService`. System Settings approval may be required.
- Native light/dark appearance, resizable window, labeled controls, keyboard submission, and Command-period cancellation.

Chat, collaborative notes, tasks, administration, and browser screen sharing remain in **Open web workspace**. This companion does not yet provide native screen capture, remote input injection, virtual-display drivers, or automatic OS notification/clipboard synchronization.

## Tests

With Node.js 24 dependencies installed and Swift available:

```sh
npm run test:macos
bash apps/macos/build-app.sh --universal
bash apps/macos/scripts/smoke-test.sh
```

The integration runner creates a temporary service and a private fixture; it tests enrollment, Unicode clipboard, cancellation/resume, multi-chunk and empty files, checksum failures, overwrite refusal, revocation, and redirect rejection. Fixtures and credentials are removed after the run. On macOS, the suite also tests Keychain save/update/read/delete using a unique dummy account that is cleaned up afterward. The app smoke test disables saved-session loading and checks that the packaged process stays running through startup; it does not automate every UI control.

The cross-platform networking core was compiled and integration-tested on Linux with Swift 6.0.3. Linux uses the pinned `swift-crypto` package; macOS uses the system CryptoKit framework and has no external Swift dependencies. Linux cannot build SwiftUI/AppKit, run the Keychain test, or produce/launch the `.app` and DMG. The macOS CI job has now passed Swift/Keychain tests, universal app/DMG packaging, signature verification, and the packaged-app startup check in [workflow run 38124915195](https://github.com/srujan1828-maker/unc_project/actions/runs/38124915195). That run uploaded the universal development archives. Real-device acceptance beyond the startup and automated tests remains necessary.

Before distribution, verify on real Apple silicon and Intel Macs: pairing/restart, Keychain lock/unlock, file-provider permissions, drop/picker cancellation, overwrite confirmation, menu-bar reopening, login-item registration, network loss, and device revocation.

## Developer ID signing and notarization

The build script accepts an existing signing identity and an existing `notarytool` Keychain profile. It never stores signing passwords in source:

```sh
OMNI_CODESIGN_IDENTITY='Developer ID Application: Your Name (TEAMID)' \
OMNI_NOTARY_PROFILE='your-existing-notary-profile' \
bash apps/macos/build-app.sh --universal
```

With these variables supplied, the script enables the hardened runtime, signs and verifies the app, submits the ZIP and DMG to Apple's notarization service, staples the resulting tickets, and refreshes checksums. Without `OMNI_NOTARY_PROFILE`, no notarization submission occurs. Certificates and an Apple Developer account are not supplied by this repository.

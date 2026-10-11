# OmniSync

[![Platform checks](https://github.com/srujan1828-maker/unc_project/actions/workflows/ci.yml/badge.svg)](https://github.com/srujan1828-maker/unc_project/actions/workflows/ci.yml)

**A local workspace for your devices, files, and ideas.**

This repository now contains a working development release: a responsive web/PWA workspace, a persistent local service, a CLI, and native macOS, Android, Windows, and Linux companion clients. It is **not the complete multi-year product roadmap**. See [feature status](docs/FEATURE_STATUS.md) for exactly what works and what remains.

The updated supplied product brief is preserved in [PRODUCT_VISION.md](docs/PRODUCT_VISION.md). It describes the intended product, not the current release's capabilities.

## Start the workspace

Requires **Node.js 24** and npm. No account, API keys, hosted database, or subscription is required.

```sh
npm ci
npm run build
npm start
```

Open the local service at `http://127.0.0.1:47800` in your browser. The first-run form asks for the **local setup key** stored in `.omnisync/bootstrap-key`. Open that file locally and paste its contents into the form; do not commit or share it. The key is removed after setup. The browser that creates the workspace becomes its owner.

To develop with hot reload:

```sh
npm run dev
```

The web development server uses port **5173**, and the local API uses **47800**. Use one browser origin consistently: `localhost` and `127.0.0.1` have different cookie and offline-storage scopes.

## Connect another device

1. Configure trusted HTTPS on the local service or a loopback reverse proxy using [the network guide](docs/NETWORKING.md). Plain HTTP is intentionally limited to loopback.
2. Open the same HTTPS workspace address on both devices.
3. On the owner's device, choose **Add device**, then choose a member, guest, or observer invitation.
4. Enter the 10-character, single-use code on the other device. It expires after five minutes.
5. Adjust permissions in **My devices**. Members start with screen access off. Guests and observers are read-only and can accept screen invitations.

Native clients join this same service. Their sessions are separate from browser sessions, so opening the full web workspace may require another pairing invitation.

## Included in this release

- Owner setup, device roster, expiring invitations, per-device capabilities, revocation, and lockdown.
- Manual text/link clipboard sharing, search, pins, recipient targeting, and retention.
- File drops, bounded-memory 1 MiB chunks, upload resume, pause/retry in the web UI, per-chunk and whole-file SHA-256 verification, recipient ACLs, and download checksums in native/CLI clients.
- Chat, shared sticky notes, in-app notifications, and opt-in browser notifications.
- Live Yjs scratchpad with per-browser IndexedDB persistence and offline-edit merging after reconnection.
- Task board with assignment/due dates and optimistic version checks; consent-based file requests; presence/focus status.
- Browser screen invitation/accept/stop and WebRTC signaling. Direct video requires a browser/network that allows WebRTC UDP; no TURN relay is bundled.
- Local audit hash chain, verification API, export, and search across the loaded clipboard, files, chat, and notes.
- Responsive layouts, dark mode, keyboard search, PWA app shell, and explicit empty/error states.
- Native companion source: SwiftUI + menu bar, Kotlin/Compose + Android share target, WPF/.NET, and GTK 4. These implement pairing, manual clipboard sharing, and verified files.

Screen sharing suppresses this app's browser notification delivery and hides its clipboard card text. It does **not** suppress other OS notifications or blur sensitive content elsewhere. `Ctrl/Cmd + Shift + Escape` ends this browser's screen sessions while the page has focus. Owner lockdown revokes all other device sessions.

## Build the native clients

See [native development](docs/NATIVE_CLIENTS.md) for commands, dependencies, and test limitations.

| Client  | Build / launch                                         | Current validation                                                                    |
| ------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Android | `cd apps/android && ./gradlew assembleDebug`           | Debug APK compiled; physical-device run pending                                       |
| Windows | `dotnet build apps/windows/OmniSync.csproj -c Release` | Compiled with zero warnings/errors; Windows UI run pending                            |
| macOS   | `cd apps/macos && bash build-app.sh`                   | Mac CI passes tests, universal packaging, and app startup                             |
| Linux   | `python3 apps/linux/client.py`                         | GTK window and native share action exercised under Xvfb; transport integration passed |
| CLI     | `npm run omni -- --help`                               | Real uploads, downloads, checksums, and clipboard exchange tested                     |

## Verification

See [the validation record](docs/VALIDATION.md) for results, coverage, and build artifact requirements.

```sh
npm run build       # TypeScript and production bundle
npm test            # Service, permissions, native transport, CLI, and CRDT tests
npm run test:e2e    # Chromium UI and two-browser workflow
npm audit           # Dependency advisory check
```

The browser tests use system Chromium at `/usr/bin/chromium` in the cloud environment. Set `CHROMIUM_PATH` for another installed browser, or leave it unset on a machine without that executable to use Playwright's installed Chromium. Run `npx playwright install chromium` if needed.

The actual video-delivery test explicitly skips when the host's managed Chromium policy sets `WebRtcIPHandling=disable_non_proxied_udp`. Pairing, screen consent, SDP signaling, and stop behavior are tested separately. A skipped media test does not establish working screen video on real hardware.

## Data and trust

State lives in `.omnisync/`: SQLite, uploaded files, and the initial setup key. The service does not contact cloud providers. The app shell may be cached by the service worker; API responses and downloaded files are excluded. The shared scratchpad also persists in IndexedDB on each participating browser.

This release uses **trusted-host HTTPS and revocable device sessions**, not the end-to-end identity/PAKE protocol envisioned in the brief. The service operator can read stored content. Data and search results are not encrypted at rest by the application. Use a trusted host and full-disk encryption. Native session credentials use OS secure storage; CLI credentials use a user-private file.

The owner browser is the administrative identity. Preserve its browser profile/cookies and back up the data directory. If owner access is lost, run `npm run recover-owner` on the service host, open the private `.omnisync/recovery-key` file, and select **Recover owner access** on the browser's join screen. The key expires after ten minutes and works once. Recovery preserves workspace data and other devices, invalidates previous owner sessions, and clears outstanding invitations. For a custom data directory, pass `-- --data-dir /path/to/data`. Do not delete the data directory to recover access.

All five platform jobs passed in [GitHub Actions run 38138761406](https://github.com/srujan1828-maker/unc_project/actions/runs/38138761406), which provides downloadable service/web, Android, Windows, macOS, and Linux artifacts. See [artifact installation](docs/RELEASE_ARTIFACTS.md); a workflow definition alone does not establish a successful platform build.

See [security](docs/SECURITY.md), [implemented protocol](docs/PROTOCOL.md), and [architecture](docs/ARCHITECTURE.md).

## Repository layout

```text
apps/web/       React/TypeScript workspace and PWA shell
apps/macos/     Native SwiftUI companion and menu-bar app
apps/android/   Native Kotlin/Compose companion and share target
apps/windows/   Native WPF/.NET companion
apps/linux/     Native GTK 4 companion and Python transport
server/         Express, SQLite, WebSocket, file engine, Yjs collaboration
tools/          CLI and native/cloud build helpers
tests/          Service, browser, native transport, and GUI checks
docs/           Product brief, feature status, security, networking, protocol
```

MIT license. Third-party dependencies retain their own licenses.

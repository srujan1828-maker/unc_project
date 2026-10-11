# Validation record

These checks ran in the prepared Linux cloud workspace. They validate this development release, not the entire product vision or a signed production distribution.

| Check                         | Result                               | Coverage and limits                                                                                                                                                                        |
| ----------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Clean dependency install      | Passed                               | `npm ci` using the provided lockfile; Node.js 24                                                                                                                                           |
| Production build              | Passed                               | TypeScript checking and Vite bundle                                                                                                                                                        |
| Service and integration tests | 18 passed                            | Real HTTP/WebSocket requests, SQLite persistence, pairing, permissions, revocation, file integrity/resume, native Python transport, CLI, tasks, requests, CRDT merging, and owner recovery |
| Browser workflow              | 2 passed                             | Two Chromium contexts; clipboard, files, chat, notes, collaboration, offline scratchpad merge, mobile layout, themes, screen consent/signaling, revocation, and owner recovery             |
| Accessibility                 | Passed in tested views               | Axe WCAG A/AA checks on the light dashboard and dark settings; not a full manual accessibility audit                                                                                       |
| Screen video delivery         | 1 skipped                            | Managed Chromium `WebRtcIPHandling=disable_non_proxied_udp` blocks direct media networking; real video remains unverified                                                                  |
| Dependency advisory audit     | 0 vulnerabilities reported           | `npm audit`; Node dependency point-in-time result                                                                                                                                          |
| Android                       | Build and lint passed                | Debug APK; no emulator or physical-device run                                                                                                                                              |
| Windows                       | Release build and publish passed     | Linux cross-compilation for Windows x64; WPF/DPAPI runtime remains untested                                                                                                                |
| Linux                         | GTK interaction and transport passed | Xvfb window, service connection, text-share action, verified file exchange; Secret Service enrollment needs a desktop session                                                              |
| macOS                         | Core: 5 tests passed                 | Swift networking core compiled/tested on Linux; SwiftUI, Keychain, app/DMG packaging, and UI still require macOS                                                                           |
| Production startup            | Passed                               | Service health and built HTML return HTTP 200; first-run setup key has mode 0600                                                                                                           |

Run the portable checks with `npm run check`. Native commands are in [NATIVE_CLIENTS.md](NATIVE_CLIENTS.md). CI definitions are included, but have not been executed on a remote CI runner.

## Local build artifacts

The ignored `artifacts/` directory contains a source archive, an Android debug APK, a Windows x64 archive, and SHA-256 checksums. These are development artifacts:

- Android uses a debug signing key. Pairing still requires an invitation from your workspace owner.
- Windows is a framework-dependent package: install the **.NET 8 Desktop Runtime (x64)** on Windows, extract the complete archive, and run `OmniSync.exe`. This is not an installer or a code-signed release.
- The source archive excludes credentials, workspace data, dependency caches, and build outputs. Start with its README.

Remaining functional work is tracked in [FEATURE_STATUS.md](FEATURE_STATUS.md). Physical-device acceptance steps are in [NATIVE_CLIENTS.md](NATIVE_CLIENTS.md#physical-device-acceptance-checklist).

# Validation record

These checks ran in the prepared Linux cloud workspace and, where noted, GitHub-hosted platform runners. They validate this development release, not the entire product vision or a signed production distribution.

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
| macOS                         | Core + Mac CI passed                 | Five portable Swift tests pass locally; Mac CI also passes Keychain tests, universal packaging, signature verification, and app startup                                                    |
| Production startup            | Passed                               | Service health and built HTML return HTTP 200; first-run setup key has mode 0600                                                                                                           |

Run the portable checks with `npm run check`. Native commands are in [NATIVE_CLIENTS.md](NATIVE_CLIENTS.md). GitHub workflow run [38138761406](https://github.com/srujan1828-maker/unc_project/actions/runs/38138761406) passed **all five jobs** for code commit `7491823`: web/service, Windows, macOS, Android, and Linux. It produced five downloadable artifacts. Android SDK setup was corrected to use the runner's SDK with Java 21; assembly and lint now pass remotely. The macOS job passed Swift/Keychain tests, universal ZIP/DMG packaging, signature verification, and packaged-app startup. Public job pages confirm step outcomes; full logs and downloads require GitHub sign-in. Physical-device acceptance and production signing remain separate.

## Local build artifacts

The ignored `artifacts/` directory contains a source archive, an Android debug APK, a Windows x64 archive, and SHA-256 checksums. These are development artifacts:

- Android uses a debug signing key. Pairing still requires an invitation from your workspace owner.
- Windows is a framework-dependent package: install the **.NET 8 Desktop Runtime (x64)** on Windows, extract the complete archive, and run `OmniSync.exe`. This is not an installer or a code-signed release.
- The source archive excludes credentials, workspace data, dependency caches, and build outputs. Start with its README.

Remaining functional work is tracked in [FEATURE_STATUS.md](FEATURE_STATUS.md). Physical-device acceptance steps are in [NATIVE_CLIENTS.md](NATIVE_CLIENTS.md#physical-device-acceptance-checklist).

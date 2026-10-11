# Feature status

This is a development release built from both supplied README documents. It does not implement every feature in the product vision. Nothing in this table is a claim of release signing, app-store approval, physical-device interoperability, or production security certification.

## Implemented

| Area                | What exists                                                                           | Practical limit                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Local service       | Persistent workspace, device sessions, SQLite state, WebSocket updates                | One trusted host and one space per data directory; not decentralized peer discovery                                                           |
| Pairing             | Single-use 40-bit code, five-minute expiry, rate limiting, owner-selected permissions | HTTPS trust required; not PAKE, public-key identity, QR scanning, or mDNS                                                                     |
| Device permissions  | Clipboard, files, chat, notifications, screen; revoke and lockdown                    | Owner/member/guest/observer roles; no admin delegation or guest auto-expiry                                                                   |
| Clipboard           | Manual text and URL sharing, pins, search, retention, specific recipient              | No continuous OS clipboard watcher, images, RTF, OCR, password-manager detection                                                              |
| Files               | 1 GiB per file, 5 GiB total reserved storage, sequential chunks, resume, checksums    | Stored on the service, not P2P; no folders, parallel chunks, filesystem mounts, or background mobile transfers                                |
| Native companions   | Pairing, clipboard buttons, file picker/upload/save, platform credential storage      | Companion features only; browser provides the full collaboration UI                                                                           |
| Chat / notes        | Shared conversation and sticky-note board                                             | Latest 200 messages; no threads/reactions; no offline queue for chat                                                                          |
| Scratchpad          | Yjs text CRDT, persisted service state, browser IndexedDB, offline merge              | One shared plain-text note, 16,000 visible characters / bounded CRDT snapshot; not rich markdown co-editing or multi-document version history |
| Tasks               | To do / doing / done, assignee, due date, optimistic concurrency                      | Online mutations only, 200 tasks, no automatic conversion of every object into a task                                                         |
| File requests       | Explicit request, file-picker sharing, decline, manual mark-sent                      | No access to recipient filesystem, automatic approved folders, or automatic fulfillment detection                                             |
| Presence / focus    | Available/busy/focus/away and recent connection status                                | Focus mutes this app's browser notifications, not OS-wide notifications                                                                       |
| Screen workflow     | Host OS picker, viewer invitation, explicit acceptance, signaling, stop               | One sender/viewer, LAN/overlay reachability, no bundled STUN/TURN/SFU; real video test blocked in current managed browser                     |
| Share-safe behavior | Hides app clipboard text and suppresses browser alerts during a screen session        | Other apps and OS notifications are unaffected; no OCR/blur guarantee                                                                         |
| Emergency action    | In-page shortcut ends own screen sessions; owner lockdown revokes others              | Not an OS-wide hotkey; does not retract downloaded files or erase offline copies                                                              |
| Search              | Pages, devices, loaded files, clipboard, chat, sticky notes                           | Client-side, limited to loaded history; no FTS index, transcript search, or encrypted index                                                   |
| Audit               | Metadata hash chain, verification endpoint, JSON export                               | Detects partial changes, not a malicious administrator rewriting the whole chain                                                              |

Owner recovery is implemented through a local administrator-issued, private ten-minute key and a browser recovery form. It preserves data while invalidating previous owner sessions and outstanding invitations.

## Build and test evidence

- Production web build and TypeScript checks run locally.
- Service tests exercise real network requests, SQLite state, ACLs, integrity failures, persistence, invitations, guest/observer enforcement, task version conflicts, file requests, and independent Yjs edits.
- Two Chromium contexts exercise pairing, clipboard, file upload/download, chat, notes, live/offline scratchpad merge, task changes, requests, presence, responsive layout, themes, revocation, and screen consent/signaling.
- Actual WebRTC video-delivery test is present but skipped under this environment's managed `disable_non_proxied_udp` policy. It must pass on a suitable host before screen media is considered validated.
- Android `assembleDebug` builds an APK and `lintDebug` passes. No emulator or physical phone session has been tested.
- Windows Release build and Windows x64 publish succeed under .NET 8 Windows targeting. The WPF interface and DPAPI behavior need a Windows run.
- Linux GTK opens under Xvfb and shares text through the real service. Its Python transport verifies a full upload/download. Desktop keyring integration still needs testing on a user's desktop session.
- macOS networking core compiled with Swift 6.0.3 and passed five tests on Linux, including real-service file exchange, cancellation/resume, and revocation. The companion now includes recipient selection, progress/cancellation, menu-bar reopening, login items, and app/DMG packaging. SwiftUI, Keychain, login-item behavior, packaging, and GUI validation still require a Mac. CI covers those build/test steps but has not been executed remotely.

## Remaining core roadmap

- **Transport / identity:** mDNS/BLE discovery, per-device keys, authenticated PAKE pairing, mutual TLS/Noise, QUIC, service-independent P2P, Wi-Fi Direct/hotspot flows, network path selection.
- **OS continuity:** automatic clipboard adapters, notification listeners and reply actions, media controls, SMS/contact/call interfaces, native foreground services, OEM battery handling, login items, tray integration beyond the Mac menu bar.
- **Screen and input:** native capture/encode/decode, hardware tuning, OS input injection, pointer crossing, virtual-display drivers, multi-display layouts, webcam/microphone devices, native screen annotations.
- **Storage:** two-way folder synchronization, conflicts/versions, remote filesystem browsing, FUSE/SMB/WebDAV mounts, photo backup, download approval policy, cloud providers and encrypted cloud drops.
- **Product lifecycle:** device session rotation UI, packaging/signing/notarization, updater channels, translations, performance/battery benchmarks, physical-device regression runs.
- **Automation:** rules engine, signed remote commands, remote power/find-device, plugin sandbox, provider integrations.

## Added collaboration roadmap (README 2, section 6.10)

| Priority | Delivered / partially delivered                                                                                                                                          | Still to implement                                                                                                                                                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | Scratchpad; observer role; file requests; presence/focus; limited in-app share-safe mode; invitation preapproval; basic device policies; in-page stop and owner lockdown | Follow mode, seamless presenter handoff, multi-cursor annotations, OS remote-control grants, screenshot editing, pending-join approval queue, admin role, policy expiry, global emergency hotkey                                                          |
| P1       | Basic task board; bounded unified search; activity export; offline scratchpad                                                                                            | Voice huddles/SFU, consented recording, threaded comments/reactions/mentions, team folders and versions, temporary localhost tunnels, pair-work layout, browser extension/tab groups, one-time encrypted secrets, offline chat/task queues, daily digests |
| P2       | None claimed                                                                                                                                                             | On-device captions/transcripts, AI summaries, polls, calendar scheduling, integrations/webhooks, terminal streaming                                                                                                                                       |

Do not add controls that imply access to native capabilities before the corresponding adapter, permission prompt, failure handling, and real-device tests exist.

# 🌐 OmniSync — One Workspace Across Every Device

> A local-first, cross-platform ecosystem that links **macOS, Windows, Linux, Android** (and any browser) into one unified workspace: shared clipboard, drag-and-drop file sharing, notification and call relay, screen peeking, remote control, and using any device as an extra display — over your LAN first, over the internet later.

**Status:** 📐 Design phase · **Build order:** macOS → Android → Windows → Linux → Web · **License:** MIT

---

## 📑 Table of Contents

1. [Vision](#1-vision)
2. [How to Read the Feature Tables](#2-how-to-read-the-feature-tables)
3. [Reality Check (Read This First)](#3-reality-check-read-this-first)
4. [System Architecture](#4-system-architecture)
5. [Connectivity Modes](#5-connectivity-modes)
6. [Complete Feature Catalog](#6-complete-feature-catalog)
7. [Platform Guide: macOS](#7-platform-guide-macos)
8. [Platform Guide: Android](#8-platform-guide-android)
9. [Platform Guide: Windows](#9-platform-guide-windows)
10. [Platform Guide: Linux](#10-platform-guide-linux)
11. [Platform Guide: Web Companion (PWA)](#11-platform-guide-web-companion-pwa)
12. [Cross-Platform Feature Matrix](#12-cross-platform-feature-matrix)
13. [Protocol Specification](#13-protocol-specification)
14. [Security & Privacy Model](#14-security--privacy-model)
15. [Internet Mode & Cloud Relay](#15-internet-mode--cloud-relay)
16. [Teams, Spaces & Accounts](#16-teams-spaces--accounts)
17. [Build vs. Reuse: Premade Tools](#17-build-vs-reuse-premade-tools)
18. [Repository Structure](#18-repository-structure)
19. [Roadmap & Milestones](#19-roadmap--milestones)
20. [Learning Map (What to Study vs. What to Delegate)](#20-learning-map-what-to-study-vs-what-to-delegate)
21. [AI-Assisted Development Workflow](#21-ai-assisted-development-workflow)
22. [Testing & Troubleshooting](#22-testing--troubleshooting)
23. [FAQ](#23-faq)
24. [Contributing & License](#24-contributing--license)

---

## 1. Vision

Today your devices are islands. Moving a file from a phone to a laptop means a cable, a chat app, or an email to yourself. OmniSync makes your devices behave like **one computer with many screens**:

- **Copy** on your phone → **paste** on your laptop.
- **Drag** a file to the top of your screen → it appears on every device in your Space.
- **See** a notification or incoming call on your desktop and act on it there.
- **Peek** at any teammate's or your own other device's screen in one click.
- **Extend** your Mac or Windows desktop onto a tablet, a spare laptop, or a phone.
- **Control** any device with the keyboard and mouse you are already using.

### Design principles

| Principle | Meaning |
| :-- | :-- |
| **Local-first** | Everything works with no internet and no account. Cloud is optional. |
| **Native UI, shared core** | Each platform gets a real native app. Networking logic is written once and shared. |
| **Lightweight** | Idle CPU near zero, RAM under ~100 MB per desktop client. No Electron. |
| **Permissioned** | Every capability (screen view, control, files, notifications) is granted per device and revocable. |
| **Reuse over reinvent** | Use proven open-source building blocks wherever they exist. |
| **Ship small, grow steadily** | Each milestone is a usable app. |

---

## 2. How to Read the Feature Tables

| Symbol | Meaning |
| :-: | :-- |
| ✅ | Supported with normal public OS APIs |
| 🟡 | Possible but needs a workaround, extra permission, driver, or has limits (explained in notes) |
| 🔴 | Blocked by the OS or not realistically possible |
| ➖ | Not applicable on this platform |
| 🔮 | Planned for a later phase |

---

## 3. Reality Check (Read This First)

An honest scope note so the project doesn't stall on hidden walls. These came up while planning and change the design in places.

| Idea | Reality | What OmniSync does instead |
| :-- | :-- | :-- |
| **Mac as Wi-Fi client and hotspot simultaneously** | A single Wi-Fi radio can't be both on macOS. | Don't make the Mac host. The **phone** hosts a Local-Only Hotspot or both devices join the same router; a **virtual overlay network** keeps addresses stable. |
| **Turning on the phone's hotspot silently over Bluetooth** | Android's public API (`LocalOnlyHotspot`) can start a private hotspot and return its SSID/password, but needs the app in the foreground state with permissions, and *regular* hotspot toggling is not exposed to apps. | Use `LocalOnlyHotspot` or **Wi-Fi Direct**; use the "Speed Mode" flow only as an optional accelerator. Prefer same-router LAN when available. |
| **Sub-20 ms screen streaming** | Realistic on a good 5 GHz network is roughly **30–80 ms** end to end. | Target <60 ms; tune with low-latency encoder presets, small GOP, no B-frames. |
| **Capturing phone call audio** | Android blocks call-audio capture for normal apps. | Relay **call alerts and controls** (answer, reject, mute, reply with SMS). Audio via Bluetooth headset profile is OS-dependent and treated as experimental. |
| **`REMOTE_SUBMIX` system audio** | Restricted to system apps. | Use Android's **AudioPlaybackCapture** (Android 10+) through MediaProjection. Apps that opt out can't be captured. |
| **Background clipboard on Android 10+** | Apps can't read the clipboard while in the background. | Use a **Quick Settings tile / share-sheet "Send to OmniSync"**, foreground-triggered sync, or an opt-in accessibility-based method. Desktop → phone is easy; phone → desktop needs one tap. |
| **Virtual display on macOS** | There is no fully public API for creating virtual displays. Popular tools use the private `CGVirtualDisplay`. | Ship as a direct-download app (not App Store); or offer an alternative using an HDMI dummy plug / third-party virtual display. |
| **Virtual display on Windows** | Needs an Indirect Display Driver, which must be signed (or the PC in test mode). | Bundle an open-source IDD with a clear install step, or support mirroring first. |
| **Disabling ADB when a banking app opens** | Banking apps already block screen capture (`FLAG_SECURE`), and accessibility-service monitoring invites Play Store rejection. | Replace with a **Privacy Guard**: pause screen sharing and hide notification content while sensitive apps are foregrounded (user-selected list). |
| **Wireless ADB as a core dependency** | Powerful but fragile and a security risk if left on. | Use ADB only as an **optional developer mode**. The main path is OmniSync's own app protocol. |
| **Call/SMS access** | `READ_SMS`/`SEND_SMS` and default-dialer roles are restricted on Google Play. | Distribute via **sideloaded APK / F-Droid** for the full feature set; a "Play-safe" build omits them. |

**Biggest scope warning:** the full list below is a multi-year, multi-person project. The roadmap in §19 is intentionally sliced so **v0.1 (clipboard + file send between Mac and Android) is shippable in weeks**, and every later release adds one capability.

---

## 4. System Architecture

```
┌───────────────────────────────────────────────────────────────────────┐
│                           YOUR SPACE (trust group)                    │
│                                                                       │
│  ┌────────────┐   ┌────────────┐   ┌────────────┐   ┌─────────────┐  │
│  │  macOS     │   │  Windows   │   │  Linux     │   │  Android    │  │
│  │ SwiftUI    │   │ WinUI 3    │   │ GTK4       │   │ Kotlin /    │  │
│  │ Menu Bar   │   │ Tray       │   │ Tray/Panel │   │ Compose     │  │
│  └─────┬──────┘   └─────┬──────┘   └─────┬──────┘   └──────┬──────┘  │
│        │  native bindings (UniFFI / FFI / sidecar)           │        │
│  ┌─────▼────────────────▼────────────────▼───────────────────▼─────┐  │
│  │                    OmniCore  (shared engine)                    │  │
│  │ Discovery · Pairing · Crypto · Transport · File engine ·        │  │
│  │ Clipboard bus · Notification bus · Stream signaling · Relay     │  │
│  └─────┬──────────────┬───────────────┬───────────────┬────────────┘  │
│        │              │               │               │               │
│     mDNS/BLE      QUIC/TCP+TLS     WebRTC media     Cloud/Direct      │
│   (find peers)  (control + files)  (screens/audio)  (internet mode)   │
└───────────────────────────────────────────────────────────────────────┘
```

### Layers

| Layer | Responsibility | Typical tech |
| :-- | :-- | :-- |
| **UI shell** | Native look, tray/menu, permissions, onboarding | SwiftUI · WinUI 3 · GTK4 · Jetpack Compose |
| **Platform adapters** | OS-specific hooks (clipboard, notifications, capture, input, virtual display) | Per-platform native APIs |
| **OmniCore** | Everything that is the same on all platforms | Rust (recommended) or per-platform ports of one protocol |
| **Transport** | How bytes move | mDNS, BLE GATT, TCP/QUIC + TLS, WebRTC, WireGuard-based mesh |
| **Relay (optional)** | When devices can't reach each other directly | STUN/TURN, cloud drive, self-hosted relay |

> **Practical tip:** do **not** start with the shared Rust core. Start with one clear protocol document (§13), implement it natively on macOS and Android first, and extract the shared core once you've felt the pain of duplicate logic. Tools like **UniFFI** can later generate Swift/Kotlin bindings from a Rust crate.

---

## 5. Connectivity Modes

OmniSync picks the best available path automatically and shows it in the UI as a connection badge.

| Mode | When it's used | Strength | Notes |
| :-- | :-- | :-- | :-- |
| **LAN direct** | Both devices on the same Wi-Fi/Ethernet | Fastest, no internet | Found by mDNS/Bonjour (`_omnisync._tcp`) |
| **Speed Mode (phone hotspot / Wi-Fi Direct)** | Different/restricted networks, large transfers | High bandwidth, bypasses client isolation | Phone starts a private hotspot; desktop auto-joins using credentials shared over an authenticated channel |
| **BLE heartbeat** | Always-on presence + tiny payloads | Near-zero battery | Presence, proximity, wake-up signals, short clipboard text |
| **USB** | Cable attached | Most stable | Optional ADB-based or USB-tether path |
| **Overlay mesh (WireGuard-style)** | Devices on different networks | Stable virtual IPs, encrypted | Use **Tailscale / Headscale / NetBird / ZeroTier** instead of building your own tunnel |
| **WebRTC P2P** | Screen/audio streaming, internet P2P | NAT traversal built in | Needs STUN; TURN (e.g., **coturn**) as fallback |
| **Cloud relay** | Peer offline / unreachable | Works anywhere | Google Drive, Dropbox, OneDrive, Nextcloud, S3-compatible |
| **Direct host link** | One-off share to anyone | No account for receiver | Sender's device serves the file; receiver opens a link |

**Selection order:** LAN direct → overlay mesh → WebRTC P2P → TURN/relay → cloud drop.

---

## 6. Complete Feature Catalog

Grouped into **modules**. Each module can ship independently. The per-platform sections later say how each is implemented.

### 6.1 Core Connectivity & Pairing
- **Auto-discovery** of devices (mDNS + BLE) with no IP typing
- **PIN / QR pairing**, then permanent trust with revocable per-device permissions
- **Connection health dashboard**: latency, throughput, path used (LAN / mesh / relay)
- **Auto-reconnect** after sleep, network change, Wi-Fi roaming
- **Device roster** with names, icons, battery, online status, last seen
- **Proximity awareness** (BLE RSSI): auto-lock, auto-connect when near, "device left behind" alert

### 6.2 Top Shelf — Universal Drop Zone
- Auto-hiding slide-down bar at the top edge of the desktop (or notification-shade card on Android)
- Drag files, folders, text, links, images, screenshots; choose **who** receives (one device / all devices / a Space)
- **Smart routing**: tiny items instantly; large files via fastest path; offline recipients get queued
- **Transfer queue** with pause, resume, retry, speed/ETA, and checksum verification
- **Folder sync (opt-in)**: a shared "Drop Folder" mirrored across chosen devices
- **Clipboard & snippet shelf**: pinned items, history, images, rich text
- **Recents & versions**: re-send, restore a previous version of a dropped file
- **Auto-expiring shares**: set an expiry for links and cloud-hosted drops

### 6.3 Universal Clipboard
- Text, rich text, images, files, and URLs
- **Clipboard history** (searchable, per-device, encryptable, size-capped)
- **Sensitive content filter**: skip password-manager entries; optional "don't sync" apps
- **Paste-as-plain-text** quick action; **OCR on copied images** (extract text)
- **Clipboard rooms**: temporary shared clipboard for a team session

### 6.4 Notifications, Calls & Messages
- Mirror phone notifications to desktop with **reply, dismiss, open-on-phone** actions
- Per-app filters, Do-Not-Disturb sync, and **content hiding** for sensitive apps
- **Call alerts** with caller name, answer / reject / silence from the desktop
- **SMS/MMS** viewer and composer on desktop (sideload build)
- **Contact sync**: search and share contacts, click-to-call (phone dials), click-to-text
- Desktop → phone **notifications** (e.g., "build finished", "download complete")
- **Link handoff**: send a URL from any device to open in another device's browser

### 6.5 Media & Audio
- Media remote: play/pause/next/previous, volume, seek, now-playing card with artwork
- **Audio routing**: stream phone media audio to a desktop, or desktop audio to a phone/speaker
- **Phone as microphone** for the PC, **PC as speaker** for the phone
- **Phone as webcam** (virtual camera on desktop)
- **Cast** local media files to any device in the Space

### 6.6 Screen Features
- **AnyPeek**: one-click live thumbnail of any permitted device; click to expand
- **Screen share**: stream a screen/window/region to one or many viewers in the Space
- **Display extension**: use any device (tablet, laptop, phone) as a second monitor
- **Mirror mode** and **window-only mirroring**
- **Remote control**: keyboard, mouse, touch, clipboard, file drag between local and remote
- **Presenter mode**: laser pointer, annotation overlay, "follow my cursor" for viewers
- **Quick recording & screenshots** pushed straight to the Top Shelf
- **Session consent prompts** with visible on-screen indicator while being viewed

### 6.7 Shared Input & Workspace
- **Shared keyboard & mouse** across computers (move the cursor off one screen's edge onto another's), plus shared clipboard
- **Phone as trackpad / keyboard / presentation remote / numpad**
- **Workspace layouts**: save/restore a multi-device display arrangement
- **Handoff**: continue a browser tab, document, or note on another device

### 6.8 Files & Storage
- **Remote file browser** for any device with thumbnails and search
- **Mount as drive**: phone storage shown in Finder / Explorer / file manager (via SMB/WebDAV/FUSE)
- **Two-way folder sync** (Syncthing-style) with conflict handling
- **Large-file engine**: parallel chunking, resume after disconnect, integrity check
- **Photo backup/upload** from phone to desktop in the background (Wi-Fi + charging rules)
- **Quick "Send to…"** from OS share sheets and context menus

### 6.9 Collaboration (Teams)
- **Spaces** (teams/rooms) with owner, member, guest roles
- **Team chat** (text, files, reactions), **presence** (online, busy, sharing screen)
- **Shared whiteboard / sticky notes** pinned to the Top Shelf
- **Co-viewing & co-control** sessions with a permission request
- **Activity feed**: who shared what, with an audit trail
- **Guest links**: time-limited, view-only, no install (web companion)

### 6.10 Must-Have Collaboration Suite (Teams at Their Best)

Priority key: **P0** = ship with the first Spaces release · **P1** = shortly after · **P2** = nice to have.

#### A. Real-Time Working Together
| # | Feature | What it does | Pri |
| :-: | :-- | :-- | :-: |
| 1 | **Follow Mode** | Click a teammate and your viewer follows their shared window/screen, like "follow" in design tools; they can see who is following | P0 |
| 2 | **Pass the Mic (presenter handoff)** | One-click switch of who is presenting without stopping the session; queue of "I want to share next" | P0 |
| 3 | **Multi-cursor & annotation overlay** | Every viewer gets a named, colored cursor; draw, highlight, and point on a shared screen; annotations fade after a few seconds | P0 |
| 4 | **Request / Grant Control** | A viewer taps "Request control"; the host approves for N minutes; a hotkey ends it instantly; a visible border shows who is in control | P0 |
| 5 | **Co-editing Scratchpad** | A shared, live text/markdown note per Space where everyone types at once (conflict-free merging) | P0 |
| 6 | **Voice huddles** | Drop-in audio rooms with push-to-talk, mute, noise suppression; optional camera. No scheduling needed | P1 |
| 7 | **Live captions & transcripts** | On-device speech-to-text for huddles; searchable transcript; per-speaker labels | P2 |
| 8 | **Session recording (with consent banner)** | Record a screen share or huddle to a local file; everyone sees a clear recording indicator | P1 |
| 9 | **Spectator / Observer role** | Join read-only to watch a demo or incident without any chance of touching anything | P0 |

#### B. Sharing & Review of Work
| # | Feature | What it does | Pri |
| :-: | :-- | :-- | :-: |
| 10 | **Annotate-and-send screenshots** | Hotkey → region capture → draw/blur/arrow → drop to Top Shelf in one motion | P0 |
| 11 | **Comments on any shared item** | Threaded comments, @mentions, and emoji reactions on files, screenshots, clips, and notes | P1 |
| 12 | **File Requests** | Ask a teammate for a file ("send me the report PDF") — their device shows a prompt to pick/approve and sends it back; they can auto-approve from specific folders | P0 |
| 13 | **Shared Team Folders** | Folder synced across chosen members with roles (view/edit), version history, undo-delete, and optional file locks to avoid overwrite fights | P1 |
| 14 | **Live Link Share (localhost tunnel)** | Share your running dev server or local web app with the team as a temporary secure link | P1 |
| 15 | **Read-only Terminal Share** | Stream your terminal to teammates (and optionally allow one to type); great for debugging and teaching | P2 |
| 16 | **Pair-Work Mode** | Combines screen share + control + huddle + scratchpad into one "start session" button with a sensible layout | P1 |
| 17 | **Browser Tab Handoff & Shared Tab Groups** | Send a tab to a teammate; keep a shared "reading list" of links synced across the Space (browser extension) | P1 |

#### C. Staying Organized
| # | Feature | What it does | Pri |
| :-: | :-- | :-- | :-: |
| 18 | **Quick Tasks & Assignments** | Turn any drop, message, or note into a task assigned to someone with a due date; simple board (To do / Doing / Done) | P1 |
| 19 | **Unified Search** | One search box over files, drops, chat, clipboard history, notes, and transcripts, local-index only | P1 |
| 20 | **Activity Feed & Daily Digest** | Who shared/changed what, mentions, and transfers in one timeline; optional summary notification | P1 |
| 21 | **Presence, Status & Focus Mode** | Online / Busy / Presenting / Away; Focus Mode mutes team pings and hides notification previews | P0 |
| 22 | **Polls & Quick Votes** | One-tap polls in chat or on the Top Shelf for fast decisions | P2 |
| 23 | **Shared Calendar View & Session Scheduling** | See team availability (local calendar import), schedule a session, auto-launch it at start time | P2 |
| 24 | **AI-assisted summaries (on-device or opt-in cloud)** | Summarize a chat thread, a session transcript, or a pile of drops; extract action items into Quick Tasks | P2 |
| 25 | **Integrations & Webhooks** | Connect GitHub, Slack, Discord, Notion, Google Calendar; incoming/outgoing webhooks | P2 |

#### D. Trust, Safety & Control for Teams
| # | Feature | What it does | Pri |
| :-: | :-- | :-- | :-: |
| 26 | **Share-Safe Mode** | While screen sharing, auto-pause desktop notifications, hide the clipboard shelf, and let the host share a single window/region only; optional auto-blur of detected sensitive text (e.g., API keys/emails) | P0 |
| 27 | **One-Time Secret Share** | Send passwords/tokens that self-destruct after one view or N minutes, never stored in history | P1 |
| 28 | **Approval Workflows** | Guests and new members need owner approval; sensitive actions (control, file download from a device) can require a "tap to allow" | P0 |
| 29 | **Granular Roles & Policies** | Owner / Admin / Member / Guest / Observer; policies like max file size, allowed regions, "no remote control", "view-only for guests" | P0 |
| 30 | **Audit Log & Session History** | Exportable record of joins, controls, transfers, and revocations (metadata only, not content) | P1 |
| 31 | **Offline-First Collaboration** | Notes, tasks, and chat queue locally and merge safely when devices reconnect | P1 |
| 32 | **Emergency Stop** | One hotkey/gesture on every platform ends all outgoing sessions and shares immediately | P0 |

#### Implementation notes for these features
| Concern | Recommendation |
| :-- | :-- |
| **Many viewers on one screen share** | Pure peer-to-peer mesh breaks down past ~3–4 viewers (the host would upload N copies). Add an **SFU** (e.g., **LiveKit**, mediasoup, or Janus) that can run on the host device, a spare PC, or a small server. |
| **Voice/video huddles** | Don't build from scratch: embed **LiveKit** or **Jitsi** components, or use WebRTC with Opus audio plus the platform's echo-cancellation. |
| **Co-editing notes/tasks/whiteboard** | Use a CRDT library (**Yjs** or **Automerge**) so edits merge without a central server and work offline. |
| **Search** | Local full-text index (e.g., **SQLite FTS5** or **Tantivy**); encrypt the index; never upload it. |
| **Live Link Share** | Route over the overlay mesh (Tailscale/NetBird) or a tunnel tool (e.g., **cloudflared**, **bore**); issue expiring tokens. |
| **Transcripts/captions** | Run **Whisper-class** models locally (whisper.cpp) so audio never leaves the device; offer an opt-in cloud option for weak hardware. |
| **Sensitive-text blur** | Simple on-device pattern matching (API-key/email/phone regexes) on captured frames or via OCR; treat as a helper, not a guarantee. |
| **Task/chat storage** | Local SQLite per device, synced as signed, append-only events within the Space; this also powers the audit log and offline-first behavior. |

### 6.11 Device Management
- **Remote power**: lock, sleep, restart, shutdown, **Wake-on-LAN**
- **Battery & health** for all devices, low-battery alerts
- **Find my device**: ring, lock, show last known location (Wi-Fi/BLE based)
- **Remote terminal / SSH shortcut** and **remote command palette** (opt-in, signed commands)
- **App launcher**: open a specific app or URL on another device
- **System info**: storage, RAM, CPU, network

### 6.12 Automation & Extensibility
- **Rules engine**: "When phone joins home Wi-Fi → start sync", "When battery < 15% → notify all"
- **Triggers & actions API** (local REST/WebSocket) and **CLI** (`omni send file.pdf --to laptop`)
- **Plugin system** for community modules (sandboxed, permission-declared)
- **Shortcuts / Quick Settings tiles / hotkeys** on every platform
- **Webhooks** for integration (e.g., notify on Slack/Discord when a drop arrives)

### 6.13 Security & Privacy
- End-to-end encrypted transport, per-device keys, verified pairing
- **Privacy Guard**: pause sharing when sensitive apps are in the foreground
- **Per-capability permissions** with expiry ("allow control for 30 minutes")
- **Lockdown mode**: instantly revoke all sessions
- Local audit log; optional encrypted history

### 6.14 Accessibility & Quality of Life
- Dark/light/auto themes, keyboard-only operation, screen-reader labels
- Localization-ready strings
- Bandwidth caps and **battery saver profile**
- Onboarding wizard with permission checklist and a **diagnostics page** that tells users exactly what's blocking a feature

---

## 7. Platform Guide: macOS

**Role:** primary desktop host/client. **Stack:** Swift, SwiftUI (+ AppKit where needed). **Minimum OS:** macOS 13 (Ventura) recommended; newer APIs are used when present. Apple Silicon first; Intel optional.

### 7.1 Required software
| Tool | Purpose |
| :-- | :-- |
| **Xcode** (latest) | IDE, simulator, signing, notarization |
| **Command Line Tools** | `git`, `clang`, build utilities |
| **Homebrew** | Install helper tools |
| **Rust toolchain (rustup)** | Shared core (later) |
| **FUSE-T or macFUSE** | Only if using FUSE mounting (SMB/WebDAV mount needs nothing extra) |
| **FFmpeg** (optional) | Prototyping encode/decode before moving to VideoToolbox |
| **Android Platform Tools (`adb`)** | Dev mode / debugging the Android side |
| **Apple Developer account** | Needed for notarization and wider distribution (a free account is enough to run locally) |

### 7.2 UI & interaction
- **Menu bar app** with `MenuBarExtra` (accessory app, no Dock icon via `LSUIElement`)
- **Top Shelf** as a borderless, non-activating `NSPanel` anchored to the top edge; reveals on cursor dwell or hotkey; accepts drag/drop via `onDrop`/`NSDraggingDestination`
- **Settings window** (SwiftUI `Settings` scene), onboarding wizard, device list, transfer queue
- **Global hotkeys** (e.g., a Carbon/`KeyboardShortcuts`-style package)
- **Share extension / Services menu / Finder Quick Action**: "Send with OmniSync"
- **Widgets & Shortcuts (App Intents)**: automate from the Shortcuts app

### 7.3 Feature implementation map
| Feature | macOS approach |
| :-- | :-- |
| Discovery | `NWBrowser` / Bonjour for `_omnisync._tcp` |
| BLE heartbeat | **CoreBluetooth** as *Central*; Android advertises as GATT *Peripheral* |
| Transport | **Network.framework** (TCP/TLS or QUIC) |
| Clipboard | `NSPasteboard` (poll `changeCount`) — text, RTF, images, file URLs |
| Notifications (incoming) | `UNUserNotificationCenter` banners with actions |
| Media control | `MPNowPlayingInfoCenter` + `MPRemoteCommandCenter`; read local playback via media-key events |
| Screen capture | **ScreenCaptureKit** (screen, window, app, with audio) |
| Video encode | **VideoToolbox** (H.264 / HEVC hardware) |
| Video decode (as client) | VideoToolbox + `AVSampleBufferDisplayLayer` / Metal |
| Display extension (host) | 🟡 Virtual display via private `CGVirtualDisplay` (direct distribution only) or an HDMI dummy |
| Display extension (client) | ✅ Full-screen/windowed receiver using hardware decode |
| Remote control (inject) | `CGEvent` (needs **Accessibility** permission) |
| Mount Android storage | ✅ SMB/WebDAV via `NetFS`; 🟡 FUSE-T if native FS semantics needed; modern option: **File Provider** extension |
| Audio streaming | `AVAudioEngine` (playback/capture), ScreenCaptureKit audio capture |
| Phone as webcam | 🟡 Receive stream → Camera Extension (CoreMediaIO) |
| Wi-Fi join | `CoreWLAN` (join SSID with credentials from the secure channel) |
| Wake-on-LAN | UDP magic packet via sockets |
| Login at startup | `SMAppService` |
| Auto-update | **Sparkle** framework |
| Secure storage | **Keychain** for device keys |

### 7.4 Permissions the user must grant
- **Screen & System Audio Recording** (screen sharing)
- **Accessibility** (remote control, global input, shared keyboard/mouse)
- **Bluetooth**, **Local Network** (discovery), **Notifications**, **Files & Folders** (as needed), **Camera/Microphone** (calls, webcam features)
- The onboarding wizard should detect each missing permission and deep-link to the right System Settings pane.

### 7.5 Packaging & distribution
- Developer ID signing + **notarization**, shipped as `.dmg`, Homebrew Cask (`brew install --cask omnisync`), Sparkle updates
- Mac App Store build = reduced edition (no private display APIs, tighter sandbox)

### 7.6 Known limitations
- Single Wi-Fi radio: can't be client and hotspot at once → use phone-hosted hotspot, router LAN, or overlay mesh.
- Virtual display relies on private API or hardware dummy.
- App Sandbox restricts spawning arbitrary binaries; bundle helpers inside the app and sign them.

### 7.7 macOS milestone checklist
- [ ] Menu bar app skeleton with device list
- [ ] Bonjour discovery + pairing PIN screen
- [ ] Clipboard sync (text → images → files)
- [ ] Top Shelf drop panel + file send/receive
- [ ] Notification receiver + media remote
- [ ] Screen viewer (AnyPeek) → screen sharing
- [ ] Display extension (host & client)
- [ ] Remote control, shared keyboard/mouse
- [ ] Android storage mount

---

## 8. Platform Guide: Android

**Role:** mobile companion, notification/call/SMS source, camera/mic provider, extra-display client. **Stack:** Kotlin, Jetpack Compose, Coroutines/Flow. **Min SDK:** 26 (Android 8) feature-gated; target the latest SDK. Android 11+ recommended for the full feature set.

### 8.1 Required software
| Tool | Purpose |
| :-- | :-- |
| **Android Studio** (latest stable) | IDE, emulator, profiler |
| **Android SDK + Platform Tools** | Build tools, `adb` |
| **JDK 17** (bundled with Studio) | Build toolchain |
| **A physical phone** | BLE, hotspot, MediaProjection, and notification features can't be fully tested in the emulator |
| **scrcpy** (optional) | Reference implementation and debug mirroring |
| **Rust + `cargo-ndk`** (later) | Shared core as a native library |

### 8.2 UI & interaction
- **Compose UI**: device list, transfer center, settings, permission checklist
- **Persistent minimal notification** (foreground service) with quick actions
- **Quick Settings tiles**: Send clipboard, Speed Mode, Start AnyPeek
- **Share-sheet target**: "Send to OmniSync" from any app (Android Sharesheet)
- **Home-screen widget** and **App Shortcuts**
- **Floating bubble** (optional) for quick drops
- **Receiver UI** for display extension: full-screen `SurfaceView` with touch passthrough

### 8.3 Feature implementation map
| Feature | Android approach |
| :-- | :-- |
| Keep-alive | **Foreground Service** with the correct `foregroundServiceType` (`connectedDevice`, `mediaProjection`, `dataSync` as needed); ask users to exempt from battery optimization |
| Discovery | `NsdManager` (mDNS) for LAN; BLE scanner for nearby desktops |
| BLE presence | `BluetoothLeAdvertiser` + `BluetoothGattServer` (phone acts as Peripheral) |
| Transport | TCP/TLS or QUIC via a shared core or OkHttp/Netty-class libs |
| Speed Mode | `WifiManager.startLocalOnlyHotspot` or **Wi-Fi Direct** (`WifiP2pManager`) / Wi-Fi Aware |
| Notification mirror | **NotificationListenerService** (user enables in special access settings) |
| Notification reply | `RemoteInput` actions captured from the original notification |
| Media control | `MediaSessionManager` (via listener access) → controller commands |
| Clipboard | `ClipboardManager` (foreground), Quick Settings tile, share target; 🟡 background via accessibility |
| Files | Scoped storage + **Storage Access Framework**; `MANAGE_EXTERNAL_STORAGE` only for the full-drive mode |
| Remote file browser / mount | Lightweight **SMB/WebDAV/HTTP** server inside the app (or a `DocumentsProvider`) |
| Contacts | `ContactsContract` (read, with permission) |
| SMS | `SmsManager` / SMS provider — 🟡 restricted on Play, fine for sideload |
| Calls | `TelecomManager` (answer/end with `ANSWER_PHONE_CALLS`), `CallScreeningService`/`InCallService` for richer UI; 🔴 call audio capture |
| Screen capture (host) | **MediaProjection** (+ `MediaCodec` H.264/HEVC encode) — consent prompt each session |
| Display extension (client) | `MediaCodec` hardware decode → `SurfaceView`; touch events returned to host |
| System audio | `AudioPlaybackCapture` (API 29+) through MediaProjection |
| Mic / camera providers | `AudioRecord`, **Camera2/CameraX** → stream to desktop virtual devices |
| Remote control (inject) | 🟡 `AccessibilityService.dispatchGesture` (user-enabled), or shell-level input in developer mode |
| Battery/device info | `BatteryManager`, `ConnectivityManager`, `StatFs` |
| Find my device | Ring (alarm stream), `DevicePolicyManager.lockNow` (needs admin), location |
| Privacy Guard | `UsageStatsManager`/foreground-app detection; pause streams and hide notification text for user-chosen apps |
| Background jobs | **WorkManager** for photo backup and scheduled sync |

### 8.4 Permissions (and why)
`POST_NOTIFICATIONS` · `BLUETOOTH_SCAN/ADVERTISE/CONNECT` · `NEARBY_WIFI_DEVICES` (Android 13+) · `ACCESS_FINE_LOCATION` (hotspot/legacy BLE) · `FOREGROUND_SERVICE_*` types · Notification-listener access · `READ_CONTACTS` · `ANSWER_PHONE_CALLS` / `READ_PHONE_STATE` · `READ/SEND_SMS` (sideload only) · `CAMERA` · `RECORD_AUDIO` · storage access (SAF or all-files) · battery-optimization exemption · Accessibility (optional features).
Show a **permission checklist screen** that explains each one in plain language and links to the exact settings page.

### 8.5 Packaging & distribution
- Debug APK for development; signed release APK/AAB
- **Two flavors:** `full` (sideload/F-Droid: SMS, calls, accessibility features) and `play` (store-compliant subset)

### 8.6 Known limitations
- Aggressive OEM battery managers (Xiaomi, Oppo, Vivo, Samsung) kill background services — include per-brand setup tips.
- Background clipboard reads are blocked on modern Android.
- MediaProjection needs user consent each session; Android 14+ adds single-app capture.
- Can't capture call audio or DRM-protected content.

### 8.7 Android milestone checklist
- [ ] Foreground service + minimal notification
- [ ] NSD advertisement + BLE GATT peripheral
- [ ] Pairing screen (PIN/QR) + trusted-device storage
- [ ] Clipboard tile + share-sheet send
- [ ] File receive/send with progress and resume
- [ ] Notification listener + reply actions
- [ ] Media session control
- [ ] Hotspot / Wi-Fi Direct Speed Mode
- [ ] Display-extension receiver (decoder + touch return)
- [ ] MediaProjection screen host + audio capture
- [ ] Contacts / SMS / call controls (full flavor)

---

## 9. Platform Guide: Windows

**Role:** powerful desktop host and client, display-extension source, remote control target. **Stack:** C# with **WinUI 3 (Windows App SDK)**, plus Win32 interop where needed. **Minimum OS:** Windows 10 1809+; Windows 11 recommended.

> **Hardware note:** older low-power CPUs (e.g., a 5th-gen Intel Core i3) usually offer **H.264 hardware encode via Quick Sync but no HEVC**. Default to H.264, lower resolutions/bitrates, and 30 fps on such machines; expose a "Performance profile" setting.

### 9.1 Required software
| Tool | Purpose |
| :-- | :-- |
| **Visual Studio 2022+ Community** | IDE with **.NET Desktop Development** and **WinUI/Windows App SDK** workloads |
| **.NET SDK (LTS)** | C# runtime & tooling |
| **Windows SDK** | Win32/WinRT headers |
| **Git for Windows** | Source control |
| **Rust (MSVC toolchain)** | Shared core (later) |
| **WDK + a virtual display driver** | Only for the display-extension driver work |
| **FFmpeg / GStreamer** (optional) | Prototyping capture-encode-stream pipelines |
| **Inno Setup / WiX / MSIX tooling** | Installer packaging |

### 9.2 UI & interaction
- **System tray icon** (WinUI 3 has no built-in tray; use a Win32 `Shell_NotifyIcon` wrapper or a maintained helper library)
- **Top Shelf** as a transparent, always-on-top window docked at the top edge, accepting `DragDrop` from Explorer
- Settings, onboarding, transfer queue, device list (WinUI 3 pages)
- **Explorer context menu**: "Send with OmniSync"; **Send To** shortcut; global hotkeys
- **Jump list** and **Start-menu pin** for quick actions

### 9.3 Feature implementation map
| Feature | Windows approach |
| :-- | :-- |
| Discovery | mDNS via a .NET library or native `DnsServiceBrowse`; Bluetooth via WinRT |
| BLE | `Windows.Devices.Bluetooth` GATT **client** to the Android peripheral |
| Transport | `System.Net.Sockets` / `SslStream`, or **QUIC** (`System.Net.Quic`) |
| Clipboard | `AddClipboardFormatListener` / `Clipboard.ContentChanged` (event-driven, no polling) |
| Notifications | **AppNotificationManager** toast with action buttons and inline reply |
| Media control | **SMTC** (System Media Transport Controls) for both reading and controlling |
| Screen capture | **Windows.Graphics.Capture** (preferred) or **DXGI Desktop Duplication** |
| Video encode | Media Foundation hardware MFTs (NVENC / Quick Sync / AMF) or FFmpeg |
| Display extension (host) | 🟡 **Indirect Display Driver** (open-source Virtual Display Driver); signing/test mode required |
| Display extension (client) | Direct3D 11 + hardware decode (Media Foundation / FFmpeg) |
| Remote control (inject) | `SendInput` (note: UAC/secure desktop needs a service) |
| Shared keyboard/mouse | Low-level hooks + injected input (Deskflow/Input Leap-style) |
| Audio streaming | **WASAPI** loopback (capture system audio) and render |
| Virtual camera / mic | 🟡 Media Foundation virtual camera (Windows 11) or a bundled virtual-camera driver |
| Wake-on-LAN | UDP magic packet |
| Firewall rules | Installer adds inbound rules (admin) or the app guides the user |
| Autostart | Registry Run key / Startup Task |
| Windows service | Optional background service to survive logoff and handle UAC prompts |
| Updates | MSIX/App Installer or a lightweight updater (e.g., Velopack-style) |
| Secure storage | **DPAPI / Credential Locker** for keys |

### 9.4 Permissions & prompts
- **Firewall** (inbound private network), **Bluetooth**, **Notifications**, **Microphone/Camera** (when used)
- **Admin/UAC** only for driver install, firewall rules, and the optional service
- Remote control of elevated windows requires the service component.

### 9.5 Packaging & distribution
- `winget` manifest, MSIX or installer `.exe`, code signing (reduces SmartScreen warnings), portable ZIP for testers.

### 9.6 Known limitations
- Driver signing for virtual displays; unsigned drivers need test mode.
- Windows Defender Firewall prompts on first run; guide users to allow **Private** networks only.
- WinUI 3 is heavier than raw Win32; if footprint becomes an issue, move the tray/service part to a small native helper.

### 9.7 Windows milestone checklist
- [ ] Tray app + onboarding + device list
- [ ] mDNS discovery + pairing
- [ ] Clipboard + toast notifications
- [ ] Top Shelf + file transfer
- [ ] SMTC media control
- [ ] Windows.Graphics.Capture streaming (AnyPeek)
- [ ] IDD display extension host
- [ ] Remote input + shared keyboard/mouse
- [ ] Installer + autostart + firewall rules

---

## 10. Platform Guide: Linux

**Role:** developer-friendly desktop client/host. **Stack:** Rust or C with **GTK4 + libadwaita** (or Qt6), D-Bus integration. Targets **Wayland first** (X11 supported). Works on Arch/Hyprland/Sway, GNOME, KDE.

### 10.1 Required software
| Tool | Purpose |
| :-- | :-- |
| **GCC/Clang, `pkg-config`, Meson/CMake or Cargo** | Build tools |
| **GTK4, libadwaita** | UI toolkit |
| **gtk4-layer-shell** | Top Shelf on wlroots compositors (Hyprland, Sway, etc.) |
| **PipeWire + xdg-desktop-portal (+ compositor portal backend)** | Screen/audio capture on Wayland |
| **Avahi** | mDNS discovery |
| **BlueZ** | Bluetooth LE |
| **GStreamer** (`gst-plugins-*`, VA-API/NVENC plugins) | Capture → encode → stream pipeline |
| **libnotify / D-Bus** | Notifications |
| **wl-clipboard** (Wayland) or **xclip/xsel** (X11) | Clipboard (or use portal/`wlr-data-control`) |
| **`uinput` / libei / portal RemoteDesktop** | Input injection |
| **`firewalld` / `ufw` / `nftables`** | Opening ports |

**Arch example:**
```bash
sudo pacman -S gtk4 libadwaita gtk4-layer-shell pipewire xdg-desktop-portal \
  xdg-desktop-portal-hyprland avahi bluez gstreamer gst-plugins-good gst-plugin-pipewire \
  wl-clipboard rust
```
*(swap the portal backend for your compositor: `-gnome`, `-kde`, `-wlr`, `-hyprland`.)*

### 10.2 UI & interaction
- **Tray icon** via StatusNotifierItem/AppIndicator (works with Waybar's tray module, KDE, GNOME with the AppIndicator extension)
- **Top Shelf** via `gtk4-layer-shell` (overlay layer, anchored top) on wlroots compositors; 🟡 on GNOME Wayland, which lacks layer-shell → fall back to a regular always-on-top style window, a GNOME Shell extension, or a panel applet
- **CLI** (`omni …`) is a first-class interface, great for scripts and keybinds
- **Hyprland/Sway integration**: bindable commands for `omni send`, `omni peek`, toggling Top Shelf
- **.desktop file**, MIME handlers, and file-manager actions (Nautilus/Dolphin/Thunar/Nemo scripts)

### 10.3 Feature implementation map
| Feature | Linux approach |
| :-- | :-- |
| Discovery | Avahi (`_omnisync._tcp`) |
| BLE | BlueZ over D-Bus (GATT client) |
| Transport | Tokio/`rustls` or GLib sockets; QUIC via `quinn` |
| Clipboard | Wayland data-control protocol / portal; X11 selections |
| Notifications | `org.freedesktop.Notifications` (D-Bus) with actions |
| Media control | **MPRIS** (D-Bus) for reading/controlling any player |
| Screen capture | **xdg-desktop-portal ScreenCast → PipeWire**; user approves each source |
| Video encode | GStreamer with VA-API / NVENC / x264 |
| Display extension (host) | 🟡 Hyprland/Sway **headless outputs** (`hyprctl output create headless` / `swaymsg create_output`); X11: `xrandr` virtual monitor; **evdi** kernel module as an alternative |
| Display extension (client) | GStreamer decode → GTK `Paintable`/GL |
| Remote control (inject) | 🟡 Portal **RemoteDesktop** (+ libei), or `uinput` with a udev rule/group |
| Audio streaming | PipeWire (monitor sources for system audio capture) |
| Mount Android storage | `gvfs`/`mount.cifs`/`davfs2` or **FUSE** (`sshfs`-like pattern) |
| Phone as webcam | **v4l2loopback** virtual camera |
| Wake-on-LAN | UDP magic packet / `wakeonlan` |
| Autostart | systemd user service / XDG autostart |
| Secure storage | **Secret Service** (libsecret / KWallet / GNOME Keyring) |
| Power/lock | `loginctl`, `systemctl`, logind D-Bus |

### 10.4 Packaging & distribution
- **AUR** package (first target for Arch), **Flatpak** (portals-friendly), **AppImage**, `.deb`/`.rpm`, plus a systemd user unit for the background daemon.

### 10.5 Known limitations
- Wayland is deliberately restrictive: capture and input injection go through portals with user prompts.
- Layer-shell isn't universal (GNOME).
- Hardware encode depends on drivers (Mesa VA-API, NVIDIA proprietary).
- Distro fragmentation: prefer Flatpak + AUR to start; document per-compositor setup.

### 10.6 Linux milestone checklist
- [ ] Headless daemon + CLI (`omni send`, `omni devices`)
- [ ] Avahi discovery + pairing
- [ ] Clipboard + notifications + MPRIS
- [ ] GTK4 tray app + Top Shelf (layer-shell)
- [ ] Portal screen capture → streaming
- [ ] Headless virtual output for display extension
- [ ] Remote input via portal/libei
- [ ] AUR + Flatpak packages

---

## 11. Platform Guide: Web Companion (PWA)

**Role:** zero-install access from any browser — iOS, ChromeOS, a borrowed laptop, or guests. **Stack:** TypeScript, a lightweight framework (SvelteKit/React), Service Worker, WebRTC, WebSocket.

### Features
| Feature | Web approach |
| :-- | :-- |
| Join a Space / guest link | Link or QR → browser connects over WebRTC/WebSocket |
| View screens (AnyPeek, shares) | WebRTC video in a `<video>` element |
| Send/receive files | WebRTC DataChannel (chunked) with progress and resume |
| Clipboard | Async Clipboard API (user gesture required) |
| Notifications | Web Push / Notification API |
| Display extension (client) | Fullscreen WebRTC video + touch/pointer events back to host |
| Chat, whiteboard, presence | WebSocket/DataChannel |
| Install as app | PWA manifest + service worker |

### Limitations
No background BLE/mDNS, limited background execution, browser clipboard gating, no virtual-display hosting. The web client is **a viewer/participant**, not a host.

### Dev tools
Node.js LTS, a bundler (Vite), a local HTTPS dev cert (WebRTC and clipboard need a secure context), a signaling server (can be a tiny WebSocket service run by the host device).

---

## 12. Cross-Platform Feature Matrix

*(Host = this platform can originate/serve it; Client = can receive/consume it.)*

| Feature | Android | macOS | Windows | Linux | Web |
| :-- | :-: | :-: | :-: | :-: | :-: |
| Auto-discovery (mDNS) | ✅ | ✅ | ✅ | ✅ | ➖ |
| BLE presence / heartbeat | ✅ | ✅ | ✅ | ✅ | 🔴 |
| PIN / QR pairing | ✅ | ✅ | ✅ | ✅ | ✅ |
| Clipboard sync (text) | 🟡 | ✅ | ✅ | ✅ | 🟡 |
| Clipboard sync (images/files) | 🟡 | ✅ | ✅ | ✅ | 🟡 |
| Top Shelf drop zone | 🟡 (share sheet/bubble) | ✅ | ✅ | ✅ (🟡 GNOME) | 🟡 (page) |
| File transfer + resume | ✅ | ✅ | ✅ | ✅ | ✅ |
| Remote file browser | ✅ (server) | ✅ | ✅ | ✅ | ✅ |
| Mount as drive | ➖ | ✅ | ✅ | ✅ | ➖ |
| Notification mirror (out) | ✅ | 🟡 | ✅ | ✅ | ➖ |
| Notification display (in) | ✅ | ✅ | ✅ | ✅ | 🟡 |
| Notification reply | ✅ | ✅ | ✅ | ✅ | 🟡 |
| Media remote | ✅ | ✅ | ✅ | ✅ (MPRIS) | ✅ |
| Contacts / SMS | 🟡 (sideload) | ✅ viewer | ✅ viewer | ✅ viewer | ✅ viewer |
| Call alerts & controls | 🟡 | ✅ | ✅ | ✅ | 🟡 |
| Call audio routing | 🔴 | 🔴 | 🔴 | 🔴 | 🔴 |
| Audio streaming (media) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Phone as mic / webcam | ✅ source | 🟡 sink | 🟡 sink | ✅ sink (v4l2loopback) | ➖ |
| AnyPeek (view screen) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Screen share (host) | ✅ | ✅ | ✅ | ✅ (portal) | 🟡 (`getDisplayMedia`) |
| Display extension (host) | 🔴 | 🟡 | 🟡 | 🟡 | 🔴 |
| Display extension (client) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Remote control (target) | 🟡 | ✅ | ✅ | 🟡 | ➖ |
| Remote control (controller) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Shared keyboard/mouse | ➖ | ✅ | ✅ | 🟡 | ➖ |
| Phone as trackpad/remote | ✅ | ✅ target | ✅ target | ✅ target | ➖ |
| Wake-on-LAN | ✅ sender | ✅ | ✅ | ✅ | ➖ |
| Find my device | ✅ | 🟡 | 🟡 | 🟡 | ➖ |
| Rules engine / CLI / API | 🟡 | ✅ | ✅ | ✅ | 🟡 |
| Team chat / whiteboard | ✅ | ✅ | ✅ | ✅ | ✅ |
| Follow mode / presenter handoff | ✅ viewer | ✅ | ✅ | ✅ | ✅ |
| Annotation overlay & multi-cursor | ✅ viewer | ✅ | ✅ | 🟡 (Wayland overlay) | ✅ |
| Request/grant control flow | ✅ | ✅ | ✅ | ✅ | ✅ |
| Co-editing scratchpad / tasks | ✅ | ✅ | ✅ | ✅ | ✅ |
| Voice huddles (+ optional video) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Session recording | 🟡 | ✅ | ✅ | ✅ | 🟡 |
| Annotate-and-send screenshot hotkey | 🟡 (share-sheet/tile) | ✅ | ✅ | ✅ | 🟡 |
| File requests | ✅ | ✅ | ✅ | ✅ | ✅ |
| Shared team folders + versions | ✅ | ✅ | ✅ | ✅ | 🟡 (upload/download) |
| Live link share (localhost tunnel) | ➖ | ✅ | ✅ | ✅ | ➖ |
| Read-only terminal share | ➖ | ✅ | ✅ | ✅ | ✅ viewer |
| Share-Safe Mode (auto-pause notifications) | ✅ | ✅ | ✅ | ✅ | 🟡 |
| One-time secret share | ✅ | ✅ | ✅ | ✅ | ✅ |
| Unified local search | 🟡 | ✅ | ✅ | ✅ | 🟡 |
| Live captions / transcripts (local) | 🟡 | ✅ | ✅ | ✅ | 🟡 |
| Emergency stop | ✅ (tile/shortcut) | ✅ | ✅ | ✅ | ✅ |
| Cloud relay (Drive/Dropbox/etc.) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Direct host download link | ✅ | ✅ | ✅ | ✅ | 🟡 |

---

## 13. Protocol Specification

A written protocol is what lets four very different apps interoperate. Keep this doc as the single source of truth and version it.

### 13.1 Channels
| Channel | Transport | Purpose |
| :-- | :-- | :-- |
| **Control** | TLS 1.3 over TCP (or QUIC) | Pairing, capabilities, commands, small data (clipboard, notifications, chat) |
| **Bulk** | Separate TLS/QUIC streams | Files and folder sync, parallel chunks |
| **Media** | WebRTC (SRTP) | Screen, audio, camera |
| **Presence** | BLE GATT + mDNS TXT records | Who's near/online, wake-up |
| **Signaling** | Control channel / WebSocket | WebRTC offers/answers/ICE |

Suggested starting ports (configurable): **47800** control, **47801** bulk, **47802** UDP/media, **mDNS** service `_omnisync._tcp`.

### 13.2 Message envelope (conceptual)
Every control message is a length-prefixed frame containing:

| Field | Meaning |
| :-- | :-- |
| `v` | Protocol version |
| `id` | Unique message ID (for ack/retry/ordering) |
| `type` | e.g., `hello`, `pair.request`, `clipboard.push`, `notify.post`, `file.offer`, `stream.offer`, `ctl.input` |
| `from` / `to` | Device IDs (public-key fingerprints) |
| `ts` | Timestamp |
| `body` | Type-specific payload (JSON or a compact binary encoding such as CBOR/Protobuf) |

### 13.3 Core message types
| Group | Types |
| :-- | :-- |
| Session | `hello`, `capabilities`, `ping`, `bye` |
| Pairing | `pair.request`, `pair.confirm`, `pair.revoke` |
| Clipboard | `clipboard.push`, `clipboard.pull`, `clipboard.clear` |
| Notifications | `notify.post`, `notify.dismiss`, `notify.reply`, `notify.action` |
| Media | `media.state`, `media.command` |
| Files | `file.offer`, `file.accept`, `file.chunk`, `file.done`, `file.resume`, `file.cancel` |
| Streams | `stream.offer`, `stream.answer`, `stream.ice`, `stream.stop`, `display.config` |
| Control | `ctl.request`, `ctl.grant`, `ctl.input`, `ctl.release` |
| Device | `dev.status`, `dev.ring`, `dev.lock`, `dev.wake` |
| Team | `chat.msg`, `presence.update`, `space.invite`, `space.member` |

### 13.4 Pairing flow
1. Device A shows a **6-digit PIN or QR** (contains its device ID + a one-time secret).
2. Device B discovers A, connects, and both run an **authenticated key exchange** (e.g., a PAKE like SPAKE2, or a Noise handshake) using the PIN.
3. Each device stores the other's **public key and name** in secure storage and assigns a **permission set** (default: clipboard + files; screen view/control off).
4. Future connections authenticate with the stored keys; no PIN needed.

### 13.5 File transfer essentials
- Offer → accept → chunked stream with **per-chunk checksums**, a **whole-file hash**, and resume offsets
- **Parallel chunking** (e.g., 4 streams) for large files on fast links
- Back-pressure to avoid memory spikes; stream from disk, never load whole files in RAM

---

## 14. Security & Privacy Model

| Area | Approach |
| :-- | :-- |
| **Identity** | Each device holds an Ed25519 (or similar) keypair created on first launch; device ID = key fingerprint |
| **Transport** | Mutually authenticated TLS 1.3 / Noise; no plaintext on the wire |
| **Pairing** | PIN/QR with PAKE; show short authentication strings to detect man-in-the-middle |
| **Permissions** | Per device and per capability; time-limited grants; clear on-screen "being viewed/controlled" indicator |
| **Secrets at rest** | Keychain / DPAPI / Secret Service / Android Keystore |
| **Cloud relay** | Files are **end-to-end encrypted before upload**; the cloud provider only sees ciphertext |
| **Remote control** | Always requires explicit consent; a hotkey ends any session instantly |
| **Privacy Guard** | Pauses sharing and masks notification content for sensitive apps |
| **Lockdown mode** | One click revokes all sessions and tokens |
| **Audit log** | Local, tamper-evident record of pairings, sessions, and transfers |
| **Don't roll your own crypto** | Use vetted libraries (rustls, libsodium, platform crypto, Noise implementations) |
| **Supply chain** | Pin dependencies, sign releases, publish checksums |

**Threat notes:** LAN attackers (spoofed discovery), stolen paired devices (use revocation), malicious Space guests (view-only default), malware reading clipboard history (encrypt history, allow disable).

---

## 15. Internet Mode & Cloud Relay

When devices aren't on the same network, OmniSync uses the best of these (user-selectable).

| Method | How it works | Best for |
| :-- | :-- | :-- |
| **Overlay mesh** | Tailscale / Headscale / NetBird / ZeroTier gives each device a stable private IP across networks; all LAN features then "just work" | Personal devices, the least code to write |
| **WebRTC P2P + STUN/TURN** | Direct connection with NAT traversal; self-hosted **coturn** as fallback | Screen sharing, live sessions |
| **Cloud drop (E2E-encrypted)** | Upload an encrypted blob to the user's **Google Drive, Dropbox, OneDrive, Nextcloud, or S3-compatible bucket** (via OAuth; **rclone**-style backends); send the link/metadata over the control channel | Receiver offline, large async shares |
| **Direct host link** | The sender's device temporarily serves the file; the receiver downloads over the mesh/P2P or through a tunnel; the link expires | One-off shares, no cloud storage used |
| **Self-hosted relay** | A small server you run (also serves signaling and guest links) | Teams wanting full control |

**Cloud setup notes:** register your own OAuth app per provider, store tokens in the OS keychain, request the minimum scope (e.g., app-folder-only), and let users set auto-delete after N days.

---

## 16. Teams, Spaces & Accounts

- **Space** = a trust group: a signed list of member devices/users with roles (**Owner, Member, Guest**).
- **Phase 1 (no accounts):** a Space is created locally and joined by QR/PIN. The Space membership list is signed by the owner's key.
- **Phase 2 (accounts):** optional sign-in maps an account to its devices, enabling auto-pairing for "all my devices" and invitation by email/ID.
- **Roles:** **Owner** (everything, including deleting the Space) · **Admin** (manage members and policies) · **Member** (share, view, request control per grants) · **Guest** (time-limited, view-only by default, needs approval to join) · **Observer** (read-only spectator for demos and incidents).
- **Policies:** disable remote control, restrict screen sharing to approved members, cap file size, require approval for downloads.
- **Same-account behavior:** drag to the Top Shelf and choose **"My devices"** or **"Space"**; everything flows without further prompts.

---

## 17. Build vs. Reuse: Premade Tools

Reusing proven projects saves months. Study them, borrow ideas, or integrate them directly (check each license).

| Need | Reuse candidate | Notes |
| :-- | :-- | :-- |
| Phone ↔ desktop clipboard, notifications, file share, media, SMS, remote input | **KDE Connect** (open protocol, apps for Android/Linux/Windows/macOS) | The closest existing project to OmniSync's "continuity" half — read its protocol docs |
| Android screen mirroring/control | **scrcpy** | Excellent reference for capture-encode-control; can power dev mode |
| Local file sharing | **LocalSend** (open protocol), **Syncthing** (folder sync) | Great models for discovery, transfer, and conflict handling |
| Remote desktop / AnyPeek | **RustDesk** (open source, self-hostable) | Study or embed for the remote-control path |
| Low-latency streaming / second screen | **Sunshine + Moonlight** | Proven GPU capture/encode pipeline and clients on many platforms |
| Shared keyboard & mouse | **Deskflow / Input Leap / Barrier** | Cursor-crossing across machines |
| Overlay networking | **Tailscale / Headscale / NetBird / ZeroTier / WireGuard** | Skip building a TUN/TAP tunnel yourself |
| Cloud storage backends | **rclone** | One interface to dozens of providers |
| Video pipeline | **FFmpeg**, **GStreamer**, **libwebrtc / webrtc-rs / Pion** | Don't write codecs |
| Virtual display (Windows) | Open-source **Virtual Display Driver (IDD)** | Starts you at "signed and working" |
| Virtual display (Linux) | `v4l2loopback`, headless compositor outputs, **evdi** | |
| Auto-update | **Sparkle** (macOS), MSIX/Velopack (Windows) | |
| Discovery | Platform Bonjour/NSD/Avahi, or **libp2p** | |
| Cross-language core | **UniFFI** (Rust → Swift/Kotlin/Python) | |
| Multi-viewer streaming, voice/video huddles | **LiveKit**, mediasoup, Janus, or Jitsi components | SFU so one host can serve many viewers without melting its uplink |
| Real-time co-editing (notes, tasks, whiteboard) | **Yjs**, **Automerge** (CRDTs) | Offline-friendly, no central server required |
| Local transcripts/captions | **whisper.cpp** | On-device speech-to-text |
| Local search index | **SQLite FTS5**, **Tantivy** | Fast, private full-text search |
| Localhost sharing | **cloudflared**, **bore**, overlay mesh | Expiring links for dev servers and local apps |
| Whiteboard UI | **tldraw**, **Excalidraw** (embeddable) | Skip building a drawing engine |

**Strategy:** Phase 1 can even be "KDE Connect-compatible" for the continuity features so you get a working multi-platform baseline quickly, then add what's unique (Top Shelf, Spaces, display extension, automation).

---

## 18. Repository Structure

```
omnisync/
├── README.md
├── docs/
│   ├── protocol.md            # the message/channel spec (§13)
│   ├── security.md
│   ├── architecture.md
│   └── platform-notes/        # per-OS gotchas
├── core/                      # shared engine (Rust) — added after prototypes
│   ├── discovery/
│   ├── pairing/
│   ├── transport/
│   ├── files/
│   ├── clipboard/
│   ├── streaming/
│   └── relay/
├── apps/
│   ├── macos/                 # Xcode project (SwiftUI)
│   ├── android/               # Android Studio project (Kotlin/Compose)
│   ├── windows/               # Visual Studio solution (WinUI 3)
│   ├── linux/                 # GTK4 app + daemon + CLI
│   └── web/                   # PWA companion
├── drivers/
│   └── windows-idd/           # virtual display driver integration
├── tools/
│   ├── cli/                   # `omni` command line
│   ├── relay-server/          # optional self-hosted relay/signaling
│   └── scripts/
├── plugins/                   # sample plugins
├── tests/
│   ├── protocol-conformance/  # same test vectors run against every client
│   └── e2e/
└── .github/workflows/         # CI builds per platform
```

---

## 19. Roadmap & Milestones

Each version is a **usable release**. Don't start the next until the current one is stable on at least two platforms.

| Version | Name | Platforms | Deliverables |
| :-: | :-- | :-- | :-- |
| **v0.1** | *Handshake* | macOS + Android | Menu bar app, foreground service, discovery, PIN pairing, **text clipboard sync**, send single file |
| **v0.2** | *Shelf* | macOS + Android | Top Shelf drop zone, transfer queue with resume, share-sheet send, images/files in clipboard |
| **v0.3** | *Mirror* | + Notifications | Notification mirroring with reply, media remote, battery/status, Privacy Guard |
| **v0.4** | *Speed* | + Speed Mode | Hotspot / Wi-Fi Direct bridge, parallel chunking, remote file browser, drive mount |
| **v0.5** | *Windows* | + Windows | Tray app, clipboard, notifications, Top Shelf, files, SMTC |
| **v0.6** | *Peek* | All three | Screen capture streaming (AnyPeek), viewer clients, consent UI |
| **v0.7** | *Extend* | All three | Display extension (host + client), Android decoder, touch return |
| **v0.8** | *Control* | All three | Remote control, shared keyboard/mouse, phone as trackpad |
| **v0.9** | *Linux & Web* | + Linux, PWA | Daemon + CLI + GTK app, portal capture, web viewer/guest links |
| **v1.0** | *Spaces* | All | Teams, roles & policies, chat, presence/focus, cloud relay, overlay-mesh integration, E2E-encrypted cloud drops, approval workflows, emergency stop, **all P0 collaboration features** from §6.10 |
| **v1.1** | *Collab Pro* | All | **P1 collaboration features**: voice huddles, session recording, comments, team folders, live link share, file requests polish, quick tasks, unified search, activity feed, one-time secrets, offline-first sync |
| **v1.2** | *Smart Team* | All | **P2 collaboration features**: live captions, AI summaries, polls, calendar sessions, integrations & webhooks, terminal share |
| **v1.x** | *Extras* | All | Rules engine, plugin API, webcam/mic, SMS/call controls, find-my-device |

### Suggested weekly pacing for a student (adjust freely)
| Weeks | Goal |
| :-- | :-- |
| 1–2 | Set up toolchains; build "hello" apps on macOS and Android; read the protocol sketch |
| 3–4 | Make two apps discover each other on the LAN and exchange a text message |
| 5–6 | Pairing + clipboard sync (text) |
| 7–9 | File sending with progress; Top Shelf prototype |
| 10–12 | Notification mirroring + media remote; first public beta (v0.3) |

---

## 20. Learning Map (What to Study vs. What to Delegate)

Your goal is to *understand* the system, not just paste generated code. For each topic: **take away** the idea, then **practice** with a tiny exercise.

### Study these (high value)
| Topic | Take-away | Mini exercise |
| :-- | :-- | :-- |
| **Sockets (TCP vs UDP)** | A connection is two endpoints exchanging bytes; TCP guarantees order, UDP doesn't | Write a C or Python echo server/client, then send a file over it |
| **Framing & serialization** | Streams have no message boundaries; you add length prefixes and encode data (JSON/CBOR) | Send 3 messages back-to-back and read them separately |
| **Concurrency / async** | Do waiting work without freezing the UI (threads, coroutines, async/await) | Download two files "at once" in Python `asyncio` |
| **App lifecycle (Android)** | The OS can pause/kill your app; foreground services and WorkManager are how you stay alive legitimately | Make a service that logs every 10 s even with the screen off |
| **State-driven UI (SwiftUI/Compose)** | UI is a function of state; change the data and the screen updates | Build a toggle + list that updates itself |
| **mDNS / service discovery** | Devices announce "who I am and what I offer" on the LAN | Use a library to advertise and browse a fake service |
| **Basic cryptography concepts** | Keys, hashes, signatures, key exchange — what they guarantee | Verify a file hash; read how TLS handshakes work conceptually |
| **Video basics** | Codecs, bitrate, keyframes, latency vs quality tradeoffs | Use FFmpeg to encode a clip at two bitrates; compare size |
| **Git & project hygiene** | Branches, commits, issues | Keep a changelog per milestone |

### Learn lightly, then rely on libraries/AI
- Encryption implementations, codec internals, GPU rendering pipelines, kernel/driver code, and platform boilerplate (entitlements, manifests, installers). Understand *what* they do; let proven libraries and generated scaffolding handle *how*.

### Language bridge
- **C/C++ → Swift/Kotlin/C#/Rust**: the logic you know carries over; the new parts are optionals, null-safety, value vs reference types, and ownership (Rust). Write small utilities in each before the real app.

---

## 21. AI-Assisted Development Workflow

AI tools can generate large parts of the scaffolding, but they also **invent API names and outdated steps**, so build in verification.

**Workflow**
1. **Spec first.** Give the AI this README's relevant section and the protocol doc, not just "build me X."
2. **One feature per prompt.** "Implement clipboard sync on macOS using `NSPasteboard`, polling `changeCount`; no UI changes."
3. **Ask for explanation, not just code.** "Explain each part and what could go wrong."
4. **Verify against official docs.** Check every unfamiliar API name and permission in Apple/Android/Microsoft docs.
5. **Test immediately.** Run it on a real device; keep a manual test checklist per feature.
6. **Commit small.** Every working step is a commit so you can roll back bad generations.
7. **Review security-sensitive code yourself or with a second opinion** (pairing, crypto, file paths, permissions).

**Prompt template**
```
Context: <platform, language, min OS, existing files>
Goal: <single feature>
Constraints: native APIs only, no new dependencies unless justified, handle errors and cancellation
Output: file list + code + short explanation + how to test + permissions required
```

**Division of labor (example)**
- A terminal agent (e.g., your preferred CLI agent) for multi-file scaffolding
- The IDE-integrated assistant for UI and inline completion
- A separate chat assistant for debugging errors, reviewing protocol design, and explaining concepts

---

## 22. Testing & Troubleshooting

### Test plan
- **Protocol conformance tests:** shared test vectors every client must pass
- **Unit tests:** framing, chunking, resume, crypto helpers
- **Integration tests:** two real devices on LAN, then across subnets, then through the overlay mesh
- **Network chaos:** Wi-Fi drop/roam, sleep/wake, high latency, packet loss
- **Performance targets:** idle CPU <1%, idle RAM <100 MB (desktop), file throughput near link speed, screen latency <60 ms on 5 GHz
- **Battery tests (Android):** overnight idle drain, active transfer drain

### Common problems
| Symptom | Likely cause | Fix |
| :-- | :-- | :-- |
| Devices don't discover each other | **Client isolation / guest Wi-Fi** (common on campus networks), mDNS blocked, firewall | Use Speed Mode hotspot or an overlay mesh; check Local Network permission (macOS) and Private-network firewall rule (Windows) |
| Android app stops in background | OEM battery optimization | Exempt the app; use the per-brand guide; ensure foreground service is running |
| Clipboard doesn't arrive from phone | Android background clipboard restriction | Use the tile/share target or keep the app in foreground |
| Notifications not mirrored | Notification-listener access not granted | Enable in special app access settings |
| Black screen when sharing | Missing Screen Recording permission (macOS), DRM content, or protected window | Grant permission; relaunch app; exclude protected windows |
| High latency / stutter in display extension | Wi-Fi congestion, 2.4 GHz band, CPU encode | Use 5 GHz/Ethernet on the host, lower resolution/bitrate, enable hardware encoding |
| Windows virtual display missing | Driver unsigned/not installed | Install signed driver or enable test mode (developers only) |
| Wayland capture prompt every time | Portal behavior | Use the portal's "remember" option where supported |
| Mount shows empty folders | Missing storage permission on Android | Grant all-files/SAF access |

---

## 23. FAQ

**Is this possible for one student to build?**
A focused subset (clipboard, files, Top Shelf, notifications, basic screen view) absolutely is. Display extension and remote control across four OSes are the hard parts — plan them for later, and reuse existing tools.

**Why not just use Flutter/Electron for everything?**
They speed up UI but make deep OS integration (menu bar panels, virtual displays, capture, input injection, BLE) harder and heavier. A hybrid is possible: native shells with a shared core, which is this plan.

**Can it work with iPhone/iPad?**
Not in the first phases. iOS restricts background networking, clipboard, and notification access. The web companion plus a limited native iOS app (file send, viewer) is the realistic route.

**Does it need the internet?**
No. Internet mode is optional and layered on top.

**Can multiple people use it at once?**
Yes, via Spaces: shared Top Shelf, presence, chat, and view/control sessions with consent.

**How is this different from KDE Connect, AnyDesk, or Sidecar?**
Those each cover a slice. OmniSync's goal is a single, consistent, cross-platform experience (drop shelf + continuity + peek + extend + teams) — and reusing those projects' ideas and code where possible.

---

## 24. Contributing & License

### Contributing
- Open an issue before large features; link it to a roadmap milestone.
- Follow the protocol spec; any protocol change needs a version bump and conformance-test update.
- Keep platform code idiomatic (Swift API guidelines, Kotlin conventions, .NET naming, Rust `clippy`/`rustfmt`).
- Security-sensitive changes require review.
- Particularly welcome: Linux compositor support, additional cloud providers (Nextcloud, S3), hardware encoder tuning, accessibility, translations, OEM battery-optimization guides.

### License
Released under the **MIT License**. Bundled third-party components (FFmpeg, GStreamer, drivers, libraries) keep their own licenses — review each before redistribution (note that some FFmpeg builds are GPL/LGPL, and virtual display drivers have their own terms).

---

*OmniSync — one workspace, every device.*

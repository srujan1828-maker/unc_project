# Native companion development

All native clients use the service described in [PROTOCOL.md](PROTOCOL.md). They are real native sharing clients, not Electron shells. Their current scope is enrollment, manual text clipboard sharing, and verified files. Use the web workspace for chat, tasks, scratchpad, permissions, and screen sessions.

Browser cookies and native credentials are distinct. A native client's “Open full workspace” action opens the service in your browser, which may need its own pairing code. Create the owner account in the browser before pairing companions.

## Android

Requirements: Android SDK platform 35, build-tools 35.0.0, JDK 17 or newer, and Gradle 8.11.1 (wrapper included). Android Studio can open `apps/android` directly.

```sh
cd apps/android
./gradlew assembleDebug
```

APK: `apps/android/app/build/outputs/apk/debug/app-debug.apk`.

On the prepared cloud machine, `python3 tools/build-android.py` selects the installed workspace toolchains and passes the existing HTTPS proxy to Gradle with normal certificate validation. It does not print proxy credentials. This helper also runs arbitrary Gradle targets, for example `python3 tools/build-android.py lintDebug`.

Minimum Android version is 8.0 (API 26); target SDK is 35. The app requests Internet access only. File selection uses Storage Access Framework; downloads use the system create-document picker. The Android share sheet accepts text or one file and waits for the user to send it. Transfers remain foreground work; no long-running foreground service is claimed. A 1 GiB temporary cache copy bounds upload preparation to disk rather than RAM.

The session is encrypted using AES-GCM and an Android Keystore key. HTTPS uses the default platform verification. Debug builds may trust a user-installed CA through the explicit debug network-security configuration; release builds trust system CAs. Localhost HTTP is allowed for development (`adb reverse tcp:47800 tcp:47800`); arbitrary LAN HTTP is not.

The debug APK is built in this environment. Real phone pairing, file-provider edge cases, OEM lifecycle behavior, and Android Keystore persistence need a physical-device test. Release signing is not configured; never distribute the debug certificate as a production identity.

## macOS

See the dedicated [macOS build and usage guide](../apps/macos/README.md). Requirements: macOS 13+, Xcode Command Line Tools with Swift 5.9+.

```sh
bash apps/macos/build-app.sh --native
open apps/macos/build/OmniSync.app
# Build Apple silicon + Intel ZIP/DMG:
bash apps/macos/build-app.sh --universal
# Real service integration and Mac-only Keychain tests:
npm run test:macos
```

The SwiftUI companion includes menu-bar reopening, optional launch at login, Keychain sessions, role-aware clipboard/file actions, recipient selection, multiple-file selection/drop, progress/cancellation, upload resume, verified downloads, and overwrite confirmation. It connects to an existing service; it does not bundle Node.js or the service.

Packaging includes an app icon, application metadata, signature verification, universal archives, and checksums. Default builds are ad-hoc signed for development. Optional Developer ID signing/notarization uses an existing identity and Keychain profile. No signing credentials are supplied or stored in the repository.

The extracted Swift networking core compiled on Linux and passed five tests, including real-service pairing, Unicode clipboard, cancellation/resume, verified multi-chunk/empty downloads, hash rejection, overwrite refusal, revocation, origin validation, and redirect rejection. SwiftUI/AppKit, Keychain, login items, actual `.app`/DMG generation, and Mac UI execution still require macOS. The [macOS CI job](https://github.com/srujan1828-maker/unc_project/actions/runs/38138761406) has passed Swift/Keychain tests, universal app/DMG packaging, signature verification, a startup smoke test, and archive upload. Physical-device acceptance remains pending.

## Windows

Requirements: Windows 10/11 and .NET 8 SDK with desktop support.

```powershell
dotnet build apps/windows/OmniSync.csproj -c Release
dotnet run --project apps/windows/OmniSync.csproj
```

This client uses **WPF** instead of WinUI 3 to keep the first native build small and portable across the .NET desktop toolchain. It has native clipboard/file dialogs, file drop support, and DPAPI CurrentUser credential protection. The project can cross-compile on Linux with Windows targeting enabled; it can only run its UI on Windows.

The Release build compiled with zero warnings and errors in this environment. The GUI, Windows clipboard contention, file picker, and DPAPI recovery need a Windows machine. No tray daemon, IDD driver, input injection service, installer, or code-signing certificate is bundled.

## Linux

Debian/Ubuntu prerequisites:

```sh
sudo apt install python3 python3-gi gir1.2-gtk-4.0 libsecret-tools
python3 apps/linux/client.py
```

Use the system Python that owns the PyGObject bindings (often `/usr/bin/python3`). The desktop must provide an unlocked Secret Service keyring. `secret-tool` stores the session; only the server origin is stored in the application config. The GTK interface runs on Wayland or X11 and reads clipboard text only when the user presses its clipboard button.

The Python transport is independently integration-tested against the service. The GTK window, connection, and native text-share action were exercised under Xvfb. Keyring enrollment requires a desktop secret-service session and is not covered by the headless GUI test.

`apps/linux/omnisync.desktop` is a launcher template. Install an `omnisync-linux` script in your PATH pointing to the checked-out client before installing that launcher. No system-wide install is performed by repository setup.

## CLI

```sh
npm run omni -- join --server https://your-host:47800 --name "My terminal"
npm run omni -- devices
npm run omni -- clipboard "A note for my devices"
npm run omni -- send ./report.pdf --to DEVICE_ID
npm run omni -- files
npm run omni -- receive TRANSFER_ID --output ./received-report.pdf
```

Enrollment prompts for the pairing code. Session files live in the user's config directory. `--config PATH` selects a separate identity. `--server` never reuses an existing token for another origin. Downloads refuse to overwrite existing files and verify SHA-256 before renaming the temporary result.

## Physical-device acceptance checklist

1. Use a correctly trusted HTTPS certificate and pair a fresh client.
2. Restart both service and native client; confirm persistence and reconnect.
3. Send Unicode clipboard text in both directions using explicit user gestures.
4. Send a zero-byte file and a multi-chunk file; compare hashes after saving.
5. Interrupt an upload, reselect the same file, and verify resume offsets.
6. Revoke the client from the owner workspace; confirm API access stops.
7. Verify OS credential-store behavior while locked/unlocked and after restart.
8. Test denied file access, cancelled pickers, unavailable networks, and disk-full errors.
9. On capable browsers, run the actual WebRTC video test and then exercise the real OS capture picker.

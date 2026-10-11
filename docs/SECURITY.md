# Security model and limits

## Trust boundary

Trust the service host and each paired device. This release does not provide end-to-end encryption for stored files, clipboard, messages, or scratchpad content. The service administrator can read them. SQLite and file contents are not encrypted at rest; browser IndexedDB scratchpad content is also plaintext to that browser profile. Use OS disk encryption and private OS accounts.

Device sessions are random 256-bit tokens; only their SHA-256 hashes are stored in the service database. Browser sessions use HttpOnly, SameSite=Strict cookies and Secure cookies when serving HTTPS or behind a configured trusted HTTPS proxy. Native clients use bearer tokens. Session lifetime is 90 days; revocation takes effect on subsequent API access and closes realtime sessions.

The owner's first setup requires a random local key written with mode 0600 in a private data directory. Invitations carry 40 random bits, are rate-limited, expire after five minutes, and work once. They authorize the selected role and capabilities. These are trusted-host enrollment tokens, **not** a PAKE or cryptographic verification of peer identities. Share them only with the intended recipient.

## Access controls

- Owner manages settings, invitations, device permissions, revocation, and lockdown.
- Member can use enabled capabilities. New member screen access defaults off.
- Guest and observer can read permitted workspace content and accept an invited screen session; mutation routes reject them. They do not automatically expire in this release.
- Targeted files and clipboard items are scoped to sender/recipient. File access checks apply before downloads.
- Scratchpad updates check current role and chat permissions; file requests never read another device's filesystem.
- Viewer acceptance is required before SDP or ICE messages are relayed. Screen access can be revoked. A hostile peer could retain previously received content; revocation cannot retract copies.

## Transport and browser protections

The service binds to loopback by default. Non-loopback binds require TLS credentials. The bundled direct TLS server requires TLS 1.3. An explicitly configured HTTPS reverse proxy must be trusted and must be the only public route to the loopback service.

Exact Host/Origin validation prevents accidental cross-origin requests and DNS rebinding. Mutating HTTP requests require a custom protection header. WebSockets require an allowed Origin and a live device session. Native clients disable HTTP redirects so credentials are not forwarded to an unexpected destination. TLS certificate verification stays enabled; there is no “ignore TLS errors” option.

Uploads are limited and chunked, names reject path separators/control bytes, actual paths are generated IDs, and both chunk and whole-file hashes are verified. Browser rendering escapes user content through React. Downloads use attachment disposition and `nosniff`. CSP disallows remote scripts and framing. The service worker does not cache API responses or file downloads.

## Credential storage

| Client  | Storage                                                                   |
| ------- | ------------------------------------------------------------------------- |
| Browser | HttpOnly cookie scoped to the workspace origin                            |
| macOS   | Keychain                                                                  |
| Android | AES-GCM ciphertext; key in Android Keystore; backup disabled              |
| Windows | DPAPI CurrentUser-protected credential                                    |
| Linux   | Secret Service through `secret-tool`; unlocked desktop keyring required   |
| CLI     | Private local JSON file (0600 on POSIX); not encrypted by the application |

On Windows, the CLI relies on the user's profile directory ACLs; use the native client for DPAPI protection. Never copy session files or the workspace data directory into version control.

## Operational limits

No security audit, penetration test, signing/notarization, or production hardening claim is made. The audit chain catches accidental or partial changes but has no external trust anchor. There is no automatic secret detection, antivirus scanning, application-layer encryption at rest, cloud E2E, or global privacy guard. Keep backups of the stopped service's full data directory and protect them as sensitive data.

Owner recovery requires local access to the service host's private data directory. `npm run recover-owner` creates a random 256-bit key in a mode-0600 file and stores its hash and ten-minute expiry in SQLite. There is no HTTP endpoint for creating this key. The browser's recovery form consumes it once, invalidates previous owner sessions and outstanding invitations, closes the owner's realtime sessions, and preserves the existing owner identity and shared data. Recovery attempts are rate-limited and use the same Origin/Host/request-header checks as pairing. A host administrator can already read or modify workspace data; this flow makes legitimate recovery possible without deleting it.

Screen-safe mode only affects this application's clipboard cards and browser notifications. Always use the OS/browser window picker carefully. Focus mode does not suppress other apps. A local page shortcut cannot replace an OS-global emergency stop.

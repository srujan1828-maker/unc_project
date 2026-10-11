# Connecting over your network

The default service listens on `127.0.0.1:47800`. This is suitable for one computer's development and tests. To connect a phone or another computer, provide a trusted HTTPS address reachable by both devices.

## Direct TLS

Obtain a certificate trusted by your devices, with a subject alternative name matching the hostname you will use. For a development LAN, `mkcert` or your own managed development CA is suitable if you deliberately install that CA on each test device. Do not bypass browser or client certificate verification.

```sh
OMNI_HOST=0.0.0.0 \
OMNI_PORT=47800 \
OMNI_ORIGINS=https://desktop.example:47800 \
OMNI_TLS_CERT=/absolute/path/to/certificate.pem \
OMNI_TLS_KEY=/absolute/path/to/private-key.pem \
npm start
```

Replace `desktop.example` with the real hostname covered by the certificate and resolvable on your network. The exact origin must match the browser address, including the port. Multiple deliberate origins may be comma-separated. HTTP origins and HTTPS origins are different.

The server requires TLS credentials for any non-loopback bind and uses TLS 1.3. Keep private keys outside the repository. Allow the service's TCP port through your OS firewall for the intended private network only.

## Trusted reverse proxy

Keep the Node service on loopback and terminate HTTPS with a local reverse proxy:

```sh
OMNI_HOST=127.0.0.1 \
OMNI_SECURE_PROXY=1 \
OMNI_ORIGINS=https://your-real-workspace-host \
npm start
```

Forward the original Host/Origin headers and WebSocket upgrades for `/events`. `OMNI_SECURE_PROXY=1` makes the app treat its public route as HTTPS and set Secure cookies; it does not create a proxy or secure a plaintext public listener. Never use it as a substitute for actual HTTPS.

Example Caddy configuration (replace the hostname and certificate paths):

```caddyfile
your-real-workspace-host {
    tls /path/to/fullchain.pem /path/to/private-key.pem
    reverse_proxy 127.0.0.1:47800
}
```

The browser UI and all native clients use this same server origin. No automatic LAN discovery is implemented yet.

## Screen connections

Signaling uses the authenticated service WebSocket. Screen media uses a direct browser WebRTC connection. Both devices must have a direct network path (same LAN or a functioning overlay network); browser policy and firewall rules must permit WebRTC UDP. The server does not proxy video. There are no bundled STUN/TURN credentials or internet relays.

In the current cloud environment, managed Chromium disables non-proxied UDP. Invitation/consent/signaling tests work, but actual media cannot connect. Leave that policy in place and test the media path on a suitable desktop/CI browser.

## Development dependencies

Core setup needs the npm registry. Android builds use Google Maven, Maven Central, the Gradle plugin repository, and official Android/Gradle distributions. Windows builds use NuGet and an installed .NET SDK. The service itself requires no outgoing network request for normal LAN sharing.

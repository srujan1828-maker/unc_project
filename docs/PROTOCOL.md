# OmniSync local-service protocol v1

This documents the implemented trusted-host protocol. It is distinct from the conceptual framed peer protocol in the product vision. All paths start with `/api`; bodies are JSON unless stated otherwise. Errors return `{ "error": "human-readable message" }` with a non-2xx status.

Use HTTPS outside localhost. Mutating requests require `X-Omni-Client: 1`. Web clients authenticate by HttpOnly cookie. Native/CLI clients send `X-Omni-Cli: 1` during setup/join to receive a session token, then authenticate with `Authorization: Bearer <session>`. Never place tokens in URLs. Redirects are not part of the protocol.

| Method / path                  | Purpose                                                                      |
| ------------------------------ | ---------------------------------------------------------------------------- |
| `GET /health`                  | Public health/version                                                        |
| `GET /bootstrap`               | Whether the workspace has an owner                                           |
| `POST /setup`                  | First owner: `key`, `spaceName`, `name`, `platform`                          |
| `POST /join`                   | Enroll with `code`, `name`, `platform`                                       |
| `GET /state`                   | Current device, roster, permitted content, limits, transport and focus state |
| `POST /invitations`            | Owner: `role` and optional full `permissions` map                            |
| `PATCH /devices/:id`           | Rename or owner-managed permissions                                          |
| `DELETE /devices/:id`          | Owner revokes non-owner device                                               |
| `POST /lockdown`               | Owner revokes all other devices/invitations                                  |
| `PATCH /settings`              | Owner changes `name`, `retentionDays` (1–30)                                 |
| `POST /clipboard`              | `text`, optional `target` device ID                                          |
| `PATCH /clipboard/:id`         | Sender/owner sets `pinned`                                                   |
| `DELETE /clipboard/:id`        | Sender/owner removes an accessible item                                      |
| `POST /transfers`              | Offer `name`, `size`, hex `sha256`, optional `target`                        |
| `PUT /transfers/:id/chunk`     | Binary chunk; headers `X-Offset`, `X-Chunk-SHA256`                           |
| `POST /transfers/:id/complete` | Verify and publish a fully uploaded file                                     |
| `GET /transfers/:id/download`  | Authorized attachment; `X-File-SHA256` response header                       |
| `DELETE /transfers/:id`        | Sender/owner removes an accessible transfer and its bytes                    |
| `POST /messages`               | Chat `text`                                                                  |
| `POST /notes`                  | Note `text`, `color` (`sage`, `peach`, `lavender`)                           |
| `DELETE /notes/:id`            | Author/owner removes a note                                                  |
| `POST /notifications`          | `target`, `title`, `body`                                                    |
| `DELETE /notifications/:id`    | Recipient dismisses an alert                                                 |
| `GET /collaboration`           | Yjs snapshot (base64), tasks, scoped requests, presence                      |
| `PATCH /presence`              | `status`: `available`, `busy`, `focus`, `away`                               |
| `POST /tasks`                  | `text`, optional `assignee`, optional ISO `due` date                         |
| `PATCH /tasks/:id`             | `status` and matching `version`; conflict returns 409                        |
| `DELETE /tasks/:id`            | Creator/owner removes task                                                   |
| `POST /file-requests`          | `target`, `text`; recipient chooses whether to send                          |
| `PATCH /file-requests/:id`     | Recipient marks `declined` or `fulfilled`                                    |
| `POST /emergency-stop`         | Ends current device's screen sessions                                        |
| `GET /audit/verify`            | Owner verifies audit chain                                                   |
| `GET /audit/export`            | Owner downloads metadata audit JSON                                          |

Capabilities are `clipboard`, `files`, `chat`, `notifications`, and `screen`. Member defaults enable all except screen. Guest/observer roles also prohibit mutations independent of the capability flags.

## Owner recovery

`POST /recover-owner` accepts a local administrator-issued `key` before session authentication, with request-header and origin protections and five attempts per minute per connection address. Success issues a session for the existing owner, invalidates prior owner sessions/invitations, and consumes the ten-minute key. Only `npm run recover-owner` on the service host can issue recovery keys; they are never returned by an HTTP endpoint.

## Files

Chunks are at most **1,048,576 bytes**. The sender must use the committed offset returned by the service. A bad checksum returns 422; a stale offset returns 409. Re-offering identical metadata resumes the sender's incomplete upload. `complete` streams a whole-file hash and accepts zero-byte files. Native/CLI downloaders compare the final hash before installing the result. Browser downloads use server verification and trusted HTTPS; the browser does not independently hash its download.

The target is either a device UUID or `null` for workspace-wide sharing. Recipients may be offline. A successful upload means the file is ready on the service, not that a recipient has downloaded it.

## WebSocket `/events`

Connections require an allowed Origin and valid session. `state.changed` is a content-free invalidation; clients refetch their authorized state. `ping`/`pong` supports service round-trip display. The service also uses WebSocket heartbeat frames.

Screen messages:

1. Sender chooses an OS screen, then sends `{type:"screen.request",to:deviceId}`.
2. Server returns `screen.pending` to sender and `screen.request` to viewer with a generated `callId`.
3. Viewer sends `screen.accept` or `screen.stop` with `callId`.
4. Only after acceptance, peers exchange `screen.signal` with `signal.description` (offer/answer) or `signal.candidate`.
5. Either participant sends `screen.stop`. Revocation, disconnect, authentication expiry, or invitation timeout also stops the session.

Only the two participants can access the call. The browser does not implement remote OS input. A member requires screen permission to send/view; a guest/observer can only accept a view invitation.

Scratchpad messages use `{type:"scratchpad.update",update:base64YjsUpdate}`. The service validates and applies updates, persists the merged state, and returns `scratchpad.update` with the merged snapshot to authorized connected clients. Offline clients merge before resending. Visible text and encoded-state sizes are capped; no arbitrary plugin messages are accepted.

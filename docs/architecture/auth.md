# Hub-Owned Authentication and Client Sessions

Haus clients authenticate directly with a Haus Hub. Onboarding, session persistence, token rotation, logout, expiration, and re-authentication are owned jointly by Haus client runtimes and Hub auth contracts. OAuth and integration credentials remain isolated to provider vaults, while client sessions are scoped to trusted Haus actors.

## Trust Model and Identities

A client session is established when a client completes authenticated pairing and exchanges its `PairingGrant` for an active `ClientSession`:

- **Client Session**: Bound to a home ID, Hub ID, unique client ID, client role (`admin`, `member`, `guest`, `node`), and human-readable device name.
- **Session Tokens**: Cryptographically strong Bearer tokens (`sessionToken`) with monotonic/wall-clock expiration timestamps and rotating `refreshToken`s.
- **Constant-Time Verification**: Verification of session tokens and refresh tokens uses constant-time string comparisons (`timingSafeStringEqual`) to prevent timing side channels.
- **Renderer Isolation**: Tokens, secrets, and raw hub credentials never cross IPC to renderers, logs, or unencrypted storage. The UI and renderer processes observe only `ClientSessionView` (`sessionId`, `hubId`, `homeId`, `clientId`, `clientRole`, `clientName`, `state`, `expiresAt`).

## Lifecycle and HTTP Endpoints

The Hub exposes authenticated endpoints under `/api/auth/`:

| Endpoint            | Method | Authentication          | Payload / Outcome                                                                                                                         |
| :------------------ | :----- | :---------------------- | :---------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/auth/pair`    | `POST` | Valid `PairingGrant`    | Exchanges pairing grant for active `ClientSessionView` and `ClientSessionCredentials`.                                                    |
| `/api/auth/resume`  | `POST` | `Bearer <sessionToken>` | Body: `{ sessionId }`. Confirms active session and returns fresh `ClientSessionView`. Rejects revoked or expired sessions with HTTP 401.  |
| `/api/auth/refresh` | `POST` | Valid `refreshToken`    | Body: `{ sessionId, refreshToken }`. Rotates both `sessionToken` and `refreshToken`, extends expiration, and returns updated credentials. |
| `/api/auth/logout`  | `POST` | `Bearer <sessionToken>` | Revokes the session on the Hub, invalidating current and refresh tokens.                                                                  |
| `/api/auth/session` | `GET`  | `Bearer <sessionToken>` | Returns `ClientSessionView` for the authenticated actor.                                                                                  |

## Secure Client Persistence

### Desktop (Electron)

`DesktopHubSessionManager` coordinates with `SecureStore`:

- Credentials are encrypted at rest using OS system keychain via Electron's `safeStorage` in `hub-session.enc`.
- Cold start resumes the session without prompting the user.
- If expired, automatic reauth refreshes credentials.
- If revoked, `hub-session.enc` is atomically wiped and the UI enters `reauth-required` state.
- Network outages leave credentials safely stored; reconnect recovers seamlessly.

### Mobile (React Native / Expo)

`MobileHubSessionManager` coordinates with `MobilePersistence`:

- Credentials are encrypted in hardware-backed secure storage via `SecureStore` (key `haus.mobile.hub-session.v1`).
- Tokens are strictly excluded from snapshots, layout caches, and logging envelopes.
- Background/foreground transitions and network reconnects trigger resume verification.
- Remote revocation removes stored credentials and transitions the client to `reauth-required`.

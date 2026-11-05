# Authenticated Haus Hub discovery and pairing

`@haus/core/pairing` defines the platform-neutral contracts for Haus Hub discovery, candidate validation, manual-address fallback, and authenticated pairing.

Discovery over mDNS/Zeroconf is strictly untrusted metadata. Network advertisement never authenticates a Hub or authorizes access. Pairing establishes verified identity, mutual trust, home binding, bounded session expiry, and explicit revocation.

## Discovery and address validation

Network discovery accepts advertised services (`_haus._tcp`, `_haus-hub._tcp`, `haus-hub`, `haus`) conforming to protocol version 1. It extracts candidates into `DiscoveredHub`.

- **Local address filtering:** Only private IPv4 (RFC 1918, RFC 3927 link-local, RFC 6598 CGNAT, and loopback), unique-local IPv6 (`fc00::/7` and loopback), or verified local hostnames (`.local`, `.lan`, `.home.arpa`, `localhost`) are accepted. Public internet addresses and interface-scoped IPv6 addresses (`fe80:...%...`) are rejected.
- **Credential sanitation:** Advertised services containing credentials, tokens, or private keys in TXT records (`token`, `secret`, `password`, `key`, `node_key`) are rejected.
- **Port and metadata sanitation:** Ports are restricted to safe integers in `1..65535`. Display names are sanitized to strip control characters and capped at 128 characters.
- **Manual-address fallback:** `parseManualHubAddress` accepts direct user-entered endpoints (`192.168.1.50`, `192.168.1.50:8443`, `https://hub.local:8443`, `[fd00::1]:8443`). It normalizes endpoints and subjects them to the exact same local-target validation. Manual candidates are marked `source: 'manual'` and possess zero inherent trust; they must complete the authenticated pairing handshake identically to discovered candidates.

## Authenticated pairing lifecycle

`HubPairing` manages pairing sessions on the Hub and verifies candidate authenticity:

1. **Session Initiation:** The Hub creates an ephemeral session (`createSession`) with a cryptographically bounded lifetime (default 5 minutes), a secure challenge code (e.g. 6-digit PIN or short authentication string), and the Hub's canonical identity (`hubId`, `homeId`, `fingerprint`, `publicKey`).
2. **Client Confirmation:** The client submits its identity (`clientId`, `clientName`, `clientRole`), the challenge code, and optional expected `homeId`.
3. **Constant-Time Verification:** Challenge codes are compared using constant-time string comparison (`timingSafeStringEqual`) to prevent side-channel timing attacks.
4. **Grant Issuance:** On success, a `PairingGrant` is recorded, binding the client identity and role to the Hub and home.

## Security invariants and rejections

- **Spoofed Hub rejection (`spoofed_hub`):** If an untrusted discovery candidate advertises a `hubId` or `fingerprint` that does not match the authenticated Hub identity, or if a grant is asserted against a mismatched Hub, the operation fails closed with `spoofed_hub`.
- **Wrong-home rejection (`wrong_home`):** If a client is configured for or expecting `home-A`, and the Hub belongs to `home-B`, pairing is rejected with `wrong_home`.
- **Expired session rejection (`pairing_expired`):** If confirmation is attempted after the session TTL has elapsed, the session transitions to `expired` and throws `pairing_expired`. Expired grants fail validation with `grant_expired`.
- **Cancelled session rejection (`pairing_cancelled`):** A client or user can explicitly abort an in-flight session (`cancelSession`). Delayed confirmation attempts fail immediately with `pairing_cancelled`.
- **Invalid code rejection (`invalid_pairing_code`):** Mismatched codes reject the attempt and mark the session `rejected`.
- **Grant revocation (`grant_revoked`):** Hub administrators can revoke a client grant (`revokeGrant`). Subsequent authorization checks fail immediately with `grant_revoked`.

Evidence: `packages/core/test/pairing.test.ts` exercises discovery candidate filtering, public IP rejection, credential leakage rejection, manual address fallback, constant-time comparison, and all rejection invariants (spoofed identity, wrong home, expired session, cancelled session, invalid code, and grant revocation). Desktop/mobile UI adoption follows in P2.2 and client auth session integration in P2.3.

# Owned Home Assistant adapter

HA protocol and credential interpretation stay inside `packages/ha`. The Hub composes the neutral `@haus/core/provider` ports; an HA adapter must not import Hub application/storage types. Existing desktop/mobile authentication and legacy Node camera clients remain compatibility paths until their explicit migration tasks.

`@haus/ha/provider` currently exports a validated credential codec, endpoint validation and the owned refresh exchange. It does not yet export a complete provider implementation or replace the installed runtime.

## Credentials and endpoints

Credential envelopes have version 1 and distinguish static access tokens from OAuth credentials. OAuth includes the access token, refresh token, client ID and expiry. The codec rejects malformed/extra fields and oversized/invalid UTF-8 input; decoded values do not alias the caller's object. These values belong only in the local encrypted vault and trusted provider context.

HTTP and WebSocket endpoints preserve reverse-proxy prefixes, reject URL credentials/query fragments and require matching origin/security. Supervisor's explicit `/core/websocket` path remains representable without assuming the normal `/api/websocket` path. Endpoint validation is not discovery authentication; the Hub still needs an enrolled, authorized configuration.

The refresh exchange follows the [official HA authentication API](https://contributors.home-assistant.io/core/internals/auth-api/). It sends one form POST to the enrolled token endpoint, never follows redirects, bounds the response and respects cancellation. Definitive rejection requires sign-in. Transport/server/malformed failures remain uncertain and are handled by the core refresh service's durable blocking policy. Optional replacement refresh tokens are retained; missing response token type supports the existing HA refresh response shape, while an explicit non-Bearer type rejects. Static credentials do not make an OAuth request.

## Remaining transport work

The owned provider must use `HaHomeAdapter` with the durable identity registry and v2 owner/epoch binding. Inventory exposes readings/events only; physical commands route through the Hub's authorized journaled dispatcher. Preserve installed aliases and keep native camera/media sources independent of HA loss.

Do not use an independently refreshing WebSocket Auth instance in this path: the installed `home-assistant-js-websocket` default socket factory can refresh tokens itself. All refresh must pass through the pinned provider context. A replacement transport must track actual socket/open/request work, stop reconnect admission on Close and prevent delayed timeouts from resurrecting a closed connection. Automatic reconnect may restore reads/subscriptions, never replay physical commands. Failed or unresolved shutdown cannot release ownership.

Acceptance still needs loopback WebSocket/auth/inventory/service/reconnect/fencing tests and actual Hub bootstrap/API wiring. Current evidence is `packages/ha/test/provider.test.ts`: 14 codec, endpoint and real loopback HTTP cases, including token rotation, legacy refresh response, rejection, cancellation after request receipt, redirect blocking and bounded/malformed responses. No household service is contacted.

# Owned Home Assistant adapter

HA protocol and credential interpretation stay inside `packages/ha`. The Hub composes the neutral `@haus/core/provider` ports; an HA adapter must not import Hub application/storage types. Existing desktop/mobile authentication and legacy Node camera clients remain compatibility paths until their explicit migration tasks.

`@haus/ha/provider` exports a validated credential codec, endpoint validation, the owned refresh exchange, `OwnedHaTransport`, `HaProvider` conforming to `@haus/core/provider`, and `haIntegrationDefinition`.

## Credentials and endpoints

Credential envelopes have version 1 and distinguish static access tokens from OAuth credentials. OAuth includes the access token, refresh token, client ID and expiry. The codec rejects malformed/extra fields and oversized/invalid UTF-8 input; decoded values do not alias the caller's object. These values belong only in the local encrypted vault and trusted provider context.

HTTP and WebSocket endpoints preserve reverse-proxy prefixes, reject URL credentials/query fragments and require matching origin/security. Supervisor's explicit `/core/websocket` path remains representable without assuming the normal `/api/websocket` path. Endpoint validation is not discovery authentication; the Hub still needs an enrolled, authorized configuration.

The refresh exchange follows the [official HA authentication API](https://contributors.home-assistant.io/core/internals/auth-api/). It sends one form POST to the enrolled token endpoint, never follows redirects, bounds the response and respects cancellation. Definitive rejection requires sign-in. Transport/server/malformed failures remain uncertain and are handled by the core refresh service's durable blocking policy. Optional replacement refresh tokens are retained; missing response token type supports the existing HA refresh response shape, while an explicit non-Bearer type rejects. Static credentials do not make an OAuth request.

## Transport and provider ownership

The owned provider uses `HaHomeAdapter` with the durable identity registry and v2 owner/epoch binding. Inventory exposes readings and events only; physical commands route through the Hub's authorized journaled dispatcher. Preserved installed aliases and native camera/media sources remain independent of HA loss.

`OwnedHaTransport` directly implements the HA WebSocket protocol using `ws`:

- It never initiates an independent token refresh inside WebSocket reconnect: token refresh during reconnect is delegated exclusively through `context.refresh()`.
- On unexpected disconnect, it transitions to `'reconnecting'` and restores subscriptions (`subscribe_entities`), but in-flight commands are rejected with lost acknowledgement and NEVER replayed.
- On lost acknowledgement (socket dropped or timeout while command in flight), it returns `status: 'unknown'`, which the command dispatcher journals without allowing replay.
- On close, it cancels pending work, clears reconnect timers, tears down the socket, and prevents any delayed timeout or callback from resurrecting the connection.

Current evidence is 23 loopback tests across `packages/ha/test/provider.test.ts` and `packages/ha/test/provider-protocol.test.ts`, plus real clean-container acceptance against a pinned official HA Container. Workspace types, lint, architecture checks, and 831 tests pass. No household service was contacted.

Runtime acceptance was completed on 2026-11-04 against `ghcr.io/home-assistant/home-assistant:2024.10.0` running as an isolated fixture container on Black Laptop (`192.168.5.115:8124`) with fresh configuration and no Haus integrations or add-ons. The test proved clean onboarding and OAuth token acquisition, virtual entity creation (`input_boolean.acceptance_switch`), `HaProvider` connection and inventory snapshot (8 devices, 13 endpoints), subscription event streaming, physical command dispatch (`turn_on` and `turn_off` with correlation IDs and verified state updates), invalid command rejection, token refresh via `/auth/token`, and clean shutdown. The test container was stopped and removed immediately after verification.

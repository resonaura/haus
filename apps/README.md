# Haus applications

The Haus Hub server and the native desktop and mobile clients live in one monorepo so their APIs, device/recording protocols, and shared contracts have a single source of truth.

Deployment artifacts remain scoped to each application:

- [`hub`](hub) — standalone NestJS Haus Hub server (`@haus/hub`), owning the home core, local protocols (MQTT, Matter, Zigbee, Thread, HomeKit/HKSV), Kitsune compatibility runtime, optional NVR storage/recording/streaming roles, host telemetry, and the shared Docker build context.
- [`desktop`](desktop) — Electron + React desktop client (`@haus/desktop`) for macOS, Windows, and Linux.
- [`mobile`](mobile) — Expo / React Native mobile client (`@haus/mobile`) for iOS and Android.

> Note: The legacy standalone `apps/node` worker application has been retired and consolidated into [`apps/hub`](hub).

Use the root pnpm workspace for development (`pnpm dev`, `pnpm mobile`) and `pnpm check` for the complete verification suite.

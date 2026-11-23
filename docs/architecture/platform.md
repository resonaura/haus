# Haus platform architecture

Status: active platform architecture (updated 2026-11-22). Active tasks live in [`PLAN.md`](../../PLAN.md); archived migration plans and dated evidence live in [`docs/history/`](../history/).

## Product and onboarding

Haus owns the home model, user experience, onboarding, sessions, rooms, devices, Apps, scenes, scripts, automations, cameras, and host telemetry. Haus runs 100% standalone with native core protocols (MQTT, Matter, Zigbee, Thread), Kitsune virtualization (HA integrations via `ha-flow`, HACS, Homebridge, Scrypted, and managed Docker Apps), native HomeKit/HKSV publishing, and built-in NVR recording/AI detection.

Home Assistant is strictly an optional external compatibility adapter and migration source (`packages/ha`, `custom_components/haus`). No core Haus feature requires a running Home Assistant instance.

Default client discovery advertises and scans for Haus Hubs (`_haus._tcp`). Discovery is untrusted metadata; authenticated pairing establishes home-scoped identity, grants, and sessions. Manual address entry and explicit "Add/Import Home Assistant" remain available when connecting to legacy installations.

## Workspace packages and dependency direction

| Path                          | Responsibility                                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/hub`                    | Single standalone NestJS Haus Hub server: API, TypeORM/SQLite persistence, native protocols, Kitsune runtime, HomeKit, optional NVR/AI/telemetry roles.      |
| `apps/desktop`, `apps/mobile` | Native Electron and Expo/React Native clients consuming the shared Haus domain and Hub APIs.                                                                 |
| `packages/core`               | Platform-neutral domain model, canonical identities, readable addresses (`type::area:device:entity`), commands/receipts, sessions, auth, pairing, and ports. |
| `packages/state`              | Selector-based Zustand vanilla store with optimistic reconciliation; consumes neutral contracts with no backend-specific imports.                            |
| `packages/ui`                 | Shared UI tokens, categories, formatters, controls, and time-series chart components.                                                                        |
| `packages/icons`              | Analytical continuous-corner Liquid Glass enclosure/rim & brand icon engine, versioned cache, and persistent C++20 `haus-icon-worker`.                       |
| `packages/ipc`                | Direct E2EE binary IPC transport, cryptography, and terminal/Docker stream runtimes.                                                                         |
| `packages/apps`               | Neutral Apps manifest, deny-by-default permission policy, container lifecycle orchestration, and least-privilege Docker driver.                              |
| `packages/kitsune`            | Isolated compatibility runtime (`GPL-3.0-only`) for HA integrations (`ha-flow`), HACS, Homebridge, Scrypted, and native camera vendor bridges.               |
| `packages/mqtt`               | Native MQTT broker/client, HA-compatible discovery & template parsing, availability, command routing, and 7-day reboot/stale grace retention.                |
| `packages/matter`             | Native Matter controller, commissioning, and full cluster support.                                                                                           |
| `packages/zigbee`             | Native Zigbee coordinator, ZCL clusters, and permit-join management.                                                                                         |
| `packages/thread`             | Native Thread controller, operational datasets, and credential vault.                                                                                        |
| `packages/homekit`            | Apple Home HAP bridges, per-camera accessories, HKSV prebuffer/recording, HAP-BLE, and SRTP streaming/talkback.                                              |
| `packages/media`              | FFmpeg/ffprobe invocation, recording/streaming engines, snapshots, and native C++ WebRTC/RTP media pipeline; injected via `MediaRuntime`.                    |
| `packages/ai`                 | Local camera activity detection (C++ native engine and pinned NanoDet ONNX model).                                                                           |
| `packages/bridge`             | Authenticated native camera bridge discovery and ownership protocol (`_rsnra-camera._tcp`).                                                                  |
| `packages/servers`            | Host telemetry, hardware/memory probes, systemd service inventory, and node client communications.                                                           |
| `packages/ha`                 | Optional external Home Assistant REST/WebSocket/OAuth/Supervisor adapter, brand icon resolver, and integration catalog utilities.                            |

Dependencies point inward: adapters depend on `packages/core`; `packages/core` never imports an adapter or OS/framework runtime. Apps act as composition roots wiring concrete adapters. Prefer object-oriented composition with constructor-injected ports for stateful services; pure parsing/formatting and React hooks remain functions.

## Independent runtime axes

1. **Device & integration backends:** Native core protocols (MQTT, Matter, Zigbee, Thread), Kitsune isolated runtimes (HA `ha-flow`, HACS, Homebridge, Scrypted), native HomeKit, or optional external HA adapter. Multiple sources coexist cleanly in one home.
2. **App/container runtime:** Least-privilege Docker Apps (`@haus/apps`), optional Supervisor adapter (`@haus/ha/apps`), or host service managers. Capabilities are declared explicitly—never inferred from the presence of another API.
3. **Host & NVR roles:** Coordinator, media relay, recording archive, AI analysis, and host telemetry all compose inside `apps/hub`. One Hub is a complete supported installation; additional Hubs expand capacity and redundancy.

## Haus-owned domain & addressing

- Canonical records use opaque persistent Haus IDs, source references, rooms, physical devices, endpoints, capabilities, typed readings, physical units (Kelvin, Celsius, normalized HSV), and availability. Provider keys, entity domains, service names, and HAP characteristic IDs remain behind adapters.
- Readable addresses follow `type::area:device:entity` with lowercase kebab-case segments. Canonical IDs, history, permissions, and recording associations remain invariant across renames or room moves; moving a device updates its active readable address consistently while preserving unambiguous old aliases.
- Identity storage maps `(home, adapter instance, record kind, external identity) -> Haus ID` plus physical aliases without deriving identity from display labels or transient IP addresses. Conflicting imports fail visibly rather than silently clobbering an existing record.
- Events carry protocol version, source instance, session/epoch, sequence, and correlation ID. Stale sessions/generations are rejected, and one provider disconnecting marks only its own devices unavailable.

## Single-writer ownership, fencing & safety

- Every exclusive resource has one authoritative writer and generation: integration session, rotating-token refresh, automation execution, radio coordinator, HomeKit identity, or leased media job.
- Only the owning Hub stores and rotates an integration credential in its local encrypted vault (AES-256-GCM, excluded from ordinary replication and backups); other Hubs forward authorized actions through the owner.
- A network partition does not prove a peer is dead: preserve authorized local assignments, expose stale/unavailable state honestly, and require verified fencing/revocation before takeover.
- Commands carry correlation/idempotency identity and explicit `accepted`, `confirmed`, `failed`, or `unknown` receipts. Ambiguous physical actions (locks, heating/boil, motors, toggles, Talkback) are never automatically replayed after a lost acknowledgement.
- HomeKit bridges and camera identities remain pinned to their physical Hub across coordinator changes unless moved explicitly by the user.

## Persistence & lifecycle

- All Hub SQLite persistence uses TypeORM with `better-sqlite3`, typed `EntitySchema`, explicit forward migrations (`synchronize: false`), and transaction-scoped managers; see [storage](storage.md).
- `createHubService` loads configuration before acquiring resources, supports `HAUS_DATA_DIR` (and compatible `HAUS_DATA`), and registers ordered teardown: close discovery, reject new transport admissions, abort active responses, stop media/policy/telemetry/protocol workers, drain request handlers, and close storage and Nest.

## Apps, permissions & compatibility

- Managed **Apps** declare manifests covering image/digest, architectures, health checks, options/secrets, ports, namespaced mounts, device nodes, network mode, resource limits, and restart policy (`packages/apps`). Unknown privileges deny by default, and arbitrary host root or Docker socket mounts are rejected.
- Kitsune runs third-party integrations/plugins in dedicated child processes (`ha-flow` Python worker, isolated Node workers for Homebridge/Scrypted) with bounded memory, explicit capability checks, and persistent per-entry/plugin state. See [apps manifest](apps-manifest.md), [apps drivers](apps-drivers.md), and [Kitsune README](../../packages/kitsune/README.md).

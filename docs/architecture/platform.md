# Haus platform architecture

Status: accepted direction, implementation tracked in PLAN.md. Work solo. Preserve installed identities and protocols during migration.

## Names and dependency direction

| Name                          | Responsibility                                                                                                                                                                                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/hub`                    | Home coordinator, authenticated API, persistent identity/catalog, permissions, automation orchestration and cluster scheduling. Replaces the misleading Helper product name.                                                                    |
| `apps/node`                   | Worker daemon. Media, recording, analysis, storage and telemetry are advertised roles; NVR is a role, not the definition of a machine.                                                                                                          |
| `apps/desktop`, `apps/mobile` | Clients of the same Haus domain and capabilities.                                                                                                                                                                                               |
| `packages/core`               | Haus-owned domain, commands, events, identity and adapter ports. No provider protocols, platform libraries or operating-system assumptions.                                                                                                     |
| `packages/state`              | Shared state/lifecycle and optimistic projection infrastructure; consumes ports and injected strategies. No backend-specific requests or entity shapes.                                                                                         |
| `packages/ha`                 | Home Assistant REST/WebSocket/OAuth, registries, service/feature mapping, Supervisor integration, ingress, discovery and the thin HA-facing presentation. Legacy wire-shaped UI projection stays explicitly inside this adapter until replaced. |
| `packages/apps`               | App descriptions, lifecycle, permissions and deployment ports, plus the Docker driver. Supervisor driver belongs to `ha` and implements the same port.                                                                                          |
| `packages/kitsune`            | Camera vendor integration and plugin compatibility.                                                                                                                                                                                             |
| `packages/media`              | Source validation and media contracts.                                                                                                                                                                                                          |
| `packages/homekit`            | Apple Home/HAP/HKSV presentation.                                                                                                                                                                                                               |
| `packages/bridge`             | Authenticated native bridge protocol.                                                                                                                                                                                                           |

Do not create an empty package per future idea. Extract a `fabric` package only when shared cluster runtime implementation has a real consumer on both Hub and Node. Homebridge gets a one-word `homebridge` adapter when it is implemented; the core must already work with an independent adapter in tests.

Dependencies point inward: adapters depend on core; core never imports an adapter. Apps are composition roots that explicitly select available adapters. Frontends ask for capabilities rather than infer them from a provider or OS name.

Use object-oriented composition for domain/runtime services: `Home`, `HomeRuntime`, `Identities`, `Hub`, `Node`, `Apps` and concrete adapters own their state and lifecycle. Constructors receive explicit ports. Keep contracts as interfaces; do not introduce a universal base class or inheritance tree that makes one backend's lifecycle mandatory for every other backend. Pure parsing/formatting functions and React hooks can remain functions.

## Three independent choices

1. Automation/device backend: HA, native bridges, Kitsune, a future Homebridge adapter or a future native automation engine. Multiple sources can coexist in one home.
2. App/deployment runtime: Supervisor, Docker, an external service manager or a future HausOS agent.
3. Host/worker roles: coordinator, media, archive, analysis and telemetry. One machine may run multiple roles or none of the media roles.

Home Assistant is not Home Assistant OS. HA Container lacks Supervisor apps; do not detect app management from the existence of the HA WebSocket API. Green/HAOS can use Supervisor; HA in Docker on Ubuntu/HausOS uses the same automation adapter with a different Apps adapter. Homebridge's accessory/service/characteristic model is different again; unavailable history/automation functionality must stay unsupported rather than be simulated.

## Haus-owned model

Canonical records use opaque persistent Haus IDs, source references, rooms, physical devices, endpoints, capabilities, typed readings, units and availability. Provider keys, entity domains, service names, bit flags and HAP characteristic IDs remain behind the adapter. A canonical command identifies an endpoint, capability, operation, arguments and correlation ID. A receipt means accepted/confirmed according to its explicit status; HTTP success alone never means that a physical device reached the requested state.

An identity store retains `(adapter instance, external identity) -> Haus ID` and explicit physical aliases. Never derive identity from a room, label or IP. Preserve existing camera/recording IDs as imported aliases; adopting the model must not re-enroll cameras, invalidate Apple Home pairing or remap archive digests. Do not join devices from different backends merely because their names match.

Events carry a protocol version, source instance, session/epoch, sequence and correlation ID where available. Reject events from replaced sessions and stale source revisions. A disconnected provider marks only its own devices unavailable; native/Kitsune cameras and worker recording remain independent. Cached facts remain readable but are not declared fresh.

## Coordination and failover

Hub is a role, not a permanent dependency on the HA machine. Run the coordinator beside HA on Green if resources allow, or on a separate server. HA failure is a source failure, not a whole-home shutdown. Worker owners continue recording with existing scoped grants while the coordinator is briefly absent; expiration and privacy revocation remain enforced.

Control metadata and credentials have one explicit authority per home/term. Media placement can move between capable nodes using priorities, measured load and leases. A future standby coordinator needs durable replicated metadata plus election/fencing before it can issue writes. Do not call an in-memory WebSocket bus or two independent SQLite files a highly available cluster. Never broadcast/replay ambiguous physical actions after failover: heating, unlock, motor movement and Talkback must not fire twice.

## Apps and permissions

The product presents **Apps**. Supervisor add-ons and Docker containers are backend-specific installations, represented with stable app IDs, version, lifecycle, health, resource readings and advertised actions. A discovered arbitrary container is not automatically a managed Haus app. Docker actions require an explicit deployment grant and target an enrolled daemon/container; never mount a Docker socket into desktop/mobile or expose it through a general proxy.

Separate home/device control permissions from host/app administration. Keep tokens and private protocol payloads in adapters/secure stores. A generic UI cannot request arbitrary Supervisor/Docker paths. App manifests declare ports, mounts, devices, network needs, resource budgets, secrets and update/rollback policy. HausOS can implement the same ports without adopting HAOS or Supervisor.

## Migration order and acceptance

1. Inventory the current HA coupling. Move wire types/transports, HA-specific model interpretation and ingress out of core. Extract a real neutral lifecycle/state path used by the existing HA client; do not merely rename `HassEntity`.
2. Introduce canonical contracts, source-scoped identity and normalized HA adapter. Prove the same runtime accepts a second independent provider with no HA transport, and isolates provider failure.
3. Move backend HA/Supervisor implementations into `ha`, inject ports into Hub services, and preserve exact legacy API/auth compatibility at the adapter boundary.
4. Add the Apps port with real Supervisor and Docker drivers; use neutral capability-driven presentation. Do not claim a Homebridge driver or HausOS image exists merely because the ports support them.
5. Rename source apps to Hub/Node and update workspace, image builds, tests, packaging and docs. Installed add-on slug, image coordinates, discovery IDs, API version and persistent data paths are compatibility contracts; migrate them explicitly rather than globally replacing strings.
6. Enforce import boundaries in CI. Test actual HA normalization/command mapping, backend-independent runtime, app lifecycle permissions and existing media/storage regressions. Publish/deploy separately from source refactoring.

Audit: current `core/types` and `core/home-model` contain HA wire records/domain feature bits; `core/ha-client`, `core/ha-transport`, `core/helper-ingress` implement HA transport/ingress; `state` constructs the HA client directly. Desktop has its own OAuth/WebSocket and raw registry/management layer; mobile has OAuth/mDNS/ingress. Hub's HA client, Supervisor backups, host telemetry, provider discovery and migration helpers also need adapter extraction. The HACS-required `custom_components/haus` entry remains a thin Python platform shim; its mandated location is not the domain-core location.

Primary references checked during design: [HA WebSocket protocol](https://developers.home-assistant.io/docs/api/websocket/), [HA installation types](https://www.home-assistant.io/installation/), [Supervisor communication](https://contributors.home-assistant.io/apps/guides/communication/), [Docker Engine API/version negotiation](https://docs.docker.com/reference/api/engine/), [Homebridge API](https://developers.homebridge.io/homebridge/interfaces/API.html).

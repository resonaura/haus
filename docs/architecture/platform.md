# Haus platform architecture

Status: accepted direction, reconciled on 2026-11-04. Implementation is tracked in `PLAN.md`; the observed source baseline is in `docs/history/baseline-2026-11-04.md`. Preserve installed identities and protocols during migration.

## Product and onboarding

Haus owns the home model, user experience, onboarding, sessions, rooms, devices, Apps, scenes, scripts and automations. Home Assistant is a supported compatibility runtime. Haus may manage HA Container on a supported host, connect an existing HAOS installation, or later host an independent adapter. No user-facing feature may require the optional HA integration merely to function in Haus.

Default discovery advertises and finds Haus Hubs. Discovery is untrusted metadata; pairing establishes a home-scoped identity and permission. Keep manual address entry and explicit Add/Import Home Assistant for existing installations. Adapt supported HA configuration flows behind Haus APIs, with an explicit fallback for OAuth/external/selectors that are not supported yet.

## Names and dependency direction

| Name                          | Responsibility                                                                                                                                                                                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/hub`                    | Composition root for an independently useful home Hub: API, persistent identity/catalog, permissions, assigned integrations and local execution. A Hub may also coordinate shared configuration.                                                |
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

NVR/media remains a Node role. Extract `packages/nvr` only when actual consumers need the same implementation. Keep stateful services in strict TypeScript ESM, use one-word lowercase paths where clear, separate contracts from their implementations and keep authored files within 500 lines. Existing larger legacy files are migration debt and must not grow.

Dependencies point inward: adapters depend on core; core never imports an adapter. Apps are composition roots that explicitly select available adapters. Frontends ask for capabilities rather than infer them from a provider or OS name.

Use object-oriented composition for domain/runtime services: `Home`, `HomeRuntime`, `Identities`, `Hub`, `Node`, `Apps` and concrete adapters own their state and lifecycle. Constructors receive explicit ports. Keep contracts as interfaces; do not introduce a universal base class or inheritance tree that makes one backend's lifecycle mandatory for every other backend. Pure parsing/formatting functions and React hooks can remain functions.

## Three independent choices

1. Device/integration backend: HA, native bridges, Kitsune or a future Homebridge adapter. Multiple sources can coexist in one home. Haus owns its native rule model and execution independently of those providers.
2. App/deployment runtime: Supervisor, Docker, an external service manager or a future HausOS agent.
3. Host/worker roles: coordinator, media, archive, analysis and telemetry. One machine may run multiple roles or none of the media roles.

Home Assistant is not Home Assistant OS. HA Container lacks Supervisor apps; do not detect app management from the existence of the HA WebSocket API. Green/HAOS can use Supervisor; HA in Docker on Ubuntu/HausOS uses the same automation adapter with a different Apps adapter. Homebridge's accessory/service/characteristic model is different again; unavailable history/automation functionality must stay unsupported rather than be simulated.

## Haus-owned model

Canonical records use opaque persistent Haus IDs, source references, rooms, physical devices, endpoints, capabilities, typed readings, units and availability. Provider keys, entity domains, service names, bit flags and HAP characteristic IDs remain behind the adapter. A canonical command identifies an endpoint, capability, operation, arguments and correlation ID. A receipt means accepted/confirmed according to its explicit status; HTTP success alone never means that a physical device reached the requested state.

An identity store retains `(home, adapter instance, record kind, external identity) -> Haus ID` and explicit physical aliases. Record kind distinguishes a provider device from its endpoint even if their external keys match. Never derive identity from a room, label or IP. Preserve existing camera/recording IDs as imported aliases; adopting the model must not re-enroll cameras, invalidate Apple Home pairing or remap archive digests. Do not join devices from different backends merely because their names match. Conflicting imports fail visibly rather than silently replacing an ID.

Events carry a protocol version, source instance, session/epoch, sequence and correlation ID where available. Reject events from replaced sessions and stale source revisions. A disconnected provider marks only its own devices unavailable; native/Kitsune cameras and worker recording remain independent. Cached facts remain readable but are not declared fresh.

## Coordination and failover

One Hub is a complete supported installation. A second Hub adds capacity and resilience without requiring a witness, NAS, cloud service or third machine. Multiple Hubs may actively own different resources. A coordinator manages shared configuration and placement; it is not a required network/database hop for already-authorized local integration, automation or media work.

Each exclusive resource has one authoritative writer and a generation: integration session, rotating-token refresh, automation execution, radio coordinator, HomeKit identity or leased job. Credential ownership is independent of coordinator placement. Only the owner stores/refreshes an integration credential; other Hubs request authorized operations through it. Ordinary state replication contains configuration, identity and durable receipts, not refresh tokens or pairing material.

HA failure affects its source only. Existing owners continue local work within their grants and privacy policy when a coordinator disappears. A network partition does not prove that an owner is dead: do not open a second integration session, refresh its token, run a second rule owner or replay physical commands merely because a peer is unreachable. Keep existing assignments; expose the affected resource as unavailable when safe takeover cannot be established. A reassignable job moves only after the old owner is verifiably fenced/revoked and the replacement has a new generation.

Commands have correlation/idempotency identity, owner generation and explicit accepted, confirmed, failed or unknown outcomes. A timeout after dispatch is unknown, not proof of rejection. Reconcile state before deciding on any new action. Never automatically replay ambiguous heating, unlocking, motor movement, toggle commands or Talkback.

HomeKit accessories/bridges stay pinned to one physical Hub when coordinator roles change. An explicit user-requested move warns that Apple Home removal and pairing may be needed. Preserve Haus camera IDs and recordings throughout. Worker media placement may change without transferring the HAP identity.

## Local rules

Haus scenes describe desired endpoint states; scripts express ordered/conditional work; automations bind events, conditions and actions. Compile validated rules when saved and keep them resident beside their event sources. The local event → condition → command path uses no coordinator/database/network lookup unless the action targets another owner.

Execute independent scene actions concurrently within each adapter's limits; preserve dependencies and report cancellation/partial failure. Import HA rules gradually. Unsupported syntax remains owned by HA, and an imported Haus rule must never run alongside the old rule by accident. Record the execution owner and history. Measure software-path p50/p95/p99 separately from device response and compare on the same hardware before claiming a speed improvement.

## Apps and permissions

The product presents **Apps**. Supervisor add-ons and Docker containers are backend-specific installations, represented with stable app IDs, version, lifecycle, health, resource readings and advertised actions. A discovered arbitrary container is not automatically a managed Haus app. Docker actions require an explicit deployment grant and target an enrolled daemon/container; never mount a Docker socket into desktop/mobile or expose it through a general proxy.

Separate home/device control permissions from host/app administration. Keep tokens and private protocol payloads in adapters/secure stores. A generic UI cannot request arbitrary Supervisor/Docker paths. App manifests declare ports, mounts, devices, network needs, resource budgets, secrets and update/rollback policy. HausOS can implement the same ports without adopting HAOS or Supervisor.

Compatibility is tiered: ordinary containers, simple Supervisor Apps, Supervisor-integrated Apps, hardware/host Apps and HAOS-only Apps have different requirements. Declare supported capabilities and reject unknown privileges. HA Container does not acquire Supervisor semantics because Haus runs beside it. Keep Supervisor as an adapter for installations that actually provide it; implement only explicit compatibility APIs with bounded permissions.

## Migration and unresolved choices

`PLAN.md` owns the migration sequence. The baseline confirms that HA wire/client/view code has already moved to `packages/ha`, neutral core/state contracts exist, Apps drivers exist, and source composition roots are named Hub/Node. Extraction behind ports, complete identity/ownership semantics, manifests and full graph enforcement remain incomplete. The installed add-on slug, image coordinates, API versions, persistent data paths, grants and archives are compatibility contracts.

The optional `custom_components/haus` stays a separate Python HA-facing shim while users depend on its entities. It is not needed for a Haus Hub to operate. Remove installed dependencies only through an explicit migration with identity comparison and rollback. Rehearse restored data on an isolated Black Laptop environment before any production migration; block production egress, radios, MQTT, HomeKit publication and writer leases first.

These implementation choices remain open and must be resolved with the corresponding plan task: durable configuration replication/fencing mechanism; trust bootstrap and recovery UX; supported HA config-flow subset; App manifest/privilege schema and compatibility levels; native rule syntax/import subset; and the supported host/OS matrix. No particular database, consensus library, host OS or Homebridge implementation is selected merely by this document.

# Haus plan

Updated: 2026-11-04
Status: active; the user resumed execution on 2026-11-04. Continue in milestone order.

This file is the current execution source of truth. Read it before choosing work. The plan that preceded this architecture reset is preserved in [`docs/history/plan-legacy-2026-11-04.md`](docs/history/plan-legacy-2026-11-04.md); it contains 63 unchecked requirements and dated acceptance evidence. Do not silently drop, merge, or mark those requirements complete. The first planning milestone maps them into stable IDs and checks their status against the current code.

## Product direction

Haus is the home platform and owns its user experience, identity, devices, rooms, onboarding, integrations, Apps, scenes, automations, cameras, and system management. Home Assistant remains a supported compatibility runtime for its integrations and existing installation. Haus may manage a Home Assistant Container on a supported host; it does not pretend that Container includes Supervisor Apps or all HAOS features. Existing HAOS installations remain a supported connection/migration source during the transition.

Default discovery finds authenticated Haus Hubs only. A Home Assistant instance is connected through an explicit import/add flow. Haus features must work without the optional `custom_components/haus` integration; keep that integration as a separate HA-facing adapter while users depend on its entities or flows.

Haus automation, scenes, and scripts are the target user-facing model. Migrate supported HA rules gradually, retain unsupported rules on their current runtime, and never run old and new copies together without an explicit choice. A local rule should execute beside its event source without a coordinator/database/network round trip. Measure Haus software latency separately from the device's physical response; compare p50/p95/p99 against HA on the same hardware before claiming it is faster.

## Hub and ownership decisions

- One Hub is a complete supported installation. Adding a second Hub must improve useful capacity and resilience without requiring a third witness, cloud service, NAS, or Linux administrator.
- Multiple Hubs may be active. The system has one authoritative writer for each exclusive resource at a time: integration session, automation execution, radio coordinator, HomeKit bridge/accessory identity, or leased job. Resource ownership is independent of which Hub currently coordinates shared configuration.
- The coordinator manages shared configuration and assignments. Local automation executors, integration owners, and media workers continue their already-authorized work without a live coordinator dependency.
- A network partition does not prove that the other Hub is dead. Keep each Hub's existing local assignments; do not promote a second writer or duplicate an integration session, token refresh, automation, or physical command. If safe ownership cannot be proven, mark only that resource unavailable and offer recovery. Stateless/reassignable work may fail over after its generation/lease and old owner are safely invalidated.
- Replicate non-secret configuration and durable receipts deliberately. Do not copy refresh tokens or pairing secrets into ordinary state replication. One process owns refresh-token rotation for each integration session.
- An unknown physical-command result is not permission to retry. Record `unknown`, refresh state, and require a new decision where necessary. Do not replay locks, heat/boil, motors, switches with toggle semantics, or Talkback after a lost acknowledgement.
- HomeKit is pinned to one physical Hub, not silently moved when coordinator roles change. A user-requested move must explain that bridges/cameras may need to be removed and paired again; preserve Haus identities and recordings either way.
- Keep NVR/media as a Node role. Create `packages/nvr` only if a measured, real multi-consumer boundary justifies it.

## Architecture and code style

- `apps/hub` and `apps/node` are composition roots. Packages contain reusable domain contracts or adapters. Dependencies point inward: `core` is platform-neutral; adapters implement its ports; apps wire concrete implementations through constructor injection.
- Prefer object-oriented composition for stateful services and lifecycles. Do not introduce universal base classes. Keep pure parsing, formatting, and UI hooks as functions.
- Use strict TypeScript ESM for new application and service code. Do not add plain JS/MJS without a concrete runtime/tooling reason. Python is allowed where HA's integration platform requires it; native code is allowed for established native runtime needs. Migrate legacy files in behavior-preserving slices.
- Use one-word lowercase names for apps, packages, and files whenever clear. If a concept needs multiple words, prefer a short category directory and a one-word filename. Avoid camelCase, PascalCase, and snake_case in file names; use kebab-case only when a one-word name would be unclear. TypeScript symbol casing follows language conventions.
- No explicit `any`. Validate untrusted runtime data with the repository's schema/type-guard approach; do not conceal unsafe casts with `as unknown as T`, broad non-null assertions, `@ts-ignore`, or disabled lint rules.
- Keep authored source, tests, configs, and active docs at 500 lines or fewer. Split by responsibility before the limit. Existing oversized files are migration work and must not grow. Frozen historical records, generated/vendor output, lockfiles, and required upstream/legal material are documented exceptions.
- Keep docs and comments short and useful. `PLAN.md` owns current tasks, `docs/architecture/` owns stable architecture decisions, `AGENTS.md` owns agent rules, and `docs/history/` owns dated evidence. Avoid duplicate specifications.

## Execution rules

1. Continue from the next unchecked task ID without asking between tasks. Keep each task small enough to implement and review in one focused work session; split it before implementation if needed. Do not let an edge case turn one task into a multi-day rewrite.
2. Read the affected public contracts, callers, tests, and deployment compatibility paths. Preserve existing IDs, archive associations, permissions, pairings, protocols, and user changes.
3. A task is complete only when its acceptance evidence exists. Record checks truthfully; distinguish mocks, isolated systems, and physical acceptance.
4. No production migration, node restart, HomeKit/radio ownership transfer, destructive archive operation, or real device-control test is implicit in a code task. Obtain task-specific authorization before such work.
5. Keep the user's established operational limits from the legacy plan in force, including Narnia being offline, no Bedroom light tests, and avoiding unnecessary Miku load/restarts. Reconfirm time-sensitive constraints before live operations.

## Milestone 0 — Reconcile the repository and preserved work

- [x] **P0.1 Baseline the current branch.** Record commit, dirty state, workspace/package responsibilities, build entry points, and actual status of the architecture tasks already checked in the legacy plan. Do not infer completion from names or folder moves.
      Accept: concise path-to-responsibility map and evidence for each status. Check: read-only source/config review.
- [x] **P0.2 Preserve and index legacy requirements.** Map all 63 old open checkboxes into stable IDs under a relevant backlog category; mark each as open, duplicate, already implemented, superseded, or deferred only with code/user evidence. Keep unmatched items open and link their original text.
      Accept: one-to-one accounting; zero silently lost requirements.
- [x] **P0.3 Reconcile architecture documentation.** Update `docs/architecture/platform.md` to match the Hub, ownership, automation, HA compatibility, and Apps decisions in this plan. Resolve stale statements instead of leaving competing “accepted” designs.
      Accept: one consistent architecture and an explicit list of genuinely undecided choices.
- [x] **P0.4 Record a clean-checkout baseline.** Capture exact tool versions, relevant workspace commands, current failures, and build/test status before implementation.
      Accept: reproducible baseline; no claim that unrun checks passed.

Evidence: [baseline](docs/history/baseline-2026-11-04.md), [63-entry index](docs/backlog/legacy.md), and [reconciled architecture](docs/architecture/platform.md). Source at clean commit `8c999d1` passes workspace types, lint, architecture boundaries and 707 tests. Formatting has six existing source violations, recorded in the baseline; changed docs are formatted separately.

## Milestone 1 — Identity, authorization, and single-writer contracts

- [x] **P1.1 Define canonical source and resource identities.** Model stable Haus home/device/endpoint IDs separately from provider IDs, integration instances, room/name/IP, and ownership. Preserve imports and aliases for existing camera/NVR identities.
      Accept: mapping and collision rules plus fixtures for duplicate names and changed IPs.
      Evidence: `@haus/core/identity` defines scoped references, atomic repository contract, conflict-rejecting registry and explicit imports. The HA adapter adopts existing mappings before allocation. [Identity rules](docs/architecture/identity.md) record persistence/rollout boundaries. Focused core/HA/Apps checks pass: eight files, 20 tests; workspace types, adapter builds, lint and architecture checks pass. Production composition/database adoption is part of P5 implementation, not claimed here.
- [x] **P1.1a Apply the user's readable ID format and re-enrollment rules.** Use `type::area:device:entity`, e.g. `switch::bedroom:surge-protector:socket-1`. Segments use lowercase kebab-case only; no underscores, camelCase or alternate separators. Omit an entity name that repeats the device and strip an exact device-name prefix. Persist readable addresses/aliases and explicit replacement/rebinding so reinstalling an integration preserves scene/automation references. Moving rooms must not silently rewrite IDs.
      Evidence: `Addresses` plus format/parser and atomic persistence ports in `@haus/core/identity`; five address tests cover the exact syntax, duplicate names, aliases, collisions, room changes and re-enrollment preserving a scene target. Existing installed entity IDs remain on their compatibility path until P4/P5 migrate clients/rules and persistent stores.
- [x] **P1.2 Define integration-session ownership.** Specify which Hub stores and uses each credential, how an owner is revoked, and what the other Hubs can request through it. Keep secrets out of ordinary replication, renderer state, and logs.
      Accept: owner/revoke/reconnect states and a test proving a credential cannot be active in two owners.
      Evidence: `@haus/core/session` defines process-scoped ownership, durable atomic repository ports and local vault access. Revocation blocks use before cleanup and permits a new generation only after verified fencing; failure keeps ownership reserved. Six session tests cover competing owners, stale processes, revocation races and reauthorization. [Session contract](docs/architecture/session.md) distinguishes the trusted ports from authenticated routing and production fencing still required in P5.
- [ ] **P1.3 Serialize token refresh and reauthorization.** One owner/process refreshes a rotating token; recovery handles timeout, stale refresh, reauth-required, and a Hub returning after revocation.
      Accept: concurrency/replay tests and redacted diagnostics.
- [ ] **P1.4 Define command receipts and retry policy.** Give commands correlation/idempotency identity, owner generation, and explicit accepted/confirmed/failed/unknown outcomes.
      Accept: lost-ack tests prove unsafe physical actions are not automatically repeated.
- [ ] **P1.5 Version provider events and ownership.** Reject stale sessions/generations and isolate one provider's disconnect from unrelated devices and media.
      Accept: reconnect, duplicate, out-of-order, and partition contract tests.

## Milestone 2 — Haus Hub onboarding and compatibility boundary

- [ ] **P2.1 Specify authenticated Haus Hub discovery and pairing.** mDNS is only discovery; pairing establishes identity, trust, expiry, revocation, and manual-address fallback.
      Accept: spoofed, expired, wrong-home, and cancelled pairing cases are rejected.
- [ ] **P2.2 Make Haus Hub the default discovery target.** Remove automatic HA discovery from onboarding while retaining an explicit “Add/Import Home Assistant” path and saved connections.
      Accept: desktop and mobile fixtures show only Haus Hubs by default; legacy HA users can add/import HA explicitly.
- [ ] **P2.3 Define Hub-owned auth and session APIs.** Onboarding, session persistence, logout, expiry, and reauth stay in Haus clients and Hub contracts; credentials never leak to renderer logs.
      Accept: resume/revoke/reconnect scenarios across desktop and mobile.
- [ ] **P2.4 Adapt HA config flows by supported capability.** Reuse existing flow work behind Haus APIs. Inventory OAuth, external steps, custom selectors, and reauth per integration; provide an honest fallback for unsupported flows.
      Accept: a per-flow support matrix; no claim of universal HA UI compatibility.
- [ ] **P2.5 Separate HA runtime lifecycle from Hub orchestration.** Add an injected runtime port for status, configuration, backup, update, and stop; keep HA protocol details in `packages/ha`.
      Accept: a fake runtime and HA adapter share one contract; legacy API/data paths remain compatible.

## Milestone 3 — Apps and host runtime

- [ ] **P3.1 Define the Haus Apps manifest and permission contract.** Model image/version, supported architecture, health, options/secrets, ports, mounts, devices, network, resources, ingress, and lifecycle. Unknown privileges deny by default.
      Accept: schema and policy matrix; no arbitrary host or Docker-socket grant.
- [ ] **P3.2 Audit and complete existing Docker/Supervisor drivers.** Identify supported operations and missing contracts; retain Supervisor as an adapter, not a product-wide requirement.
      Accept: driver contract tests and explicit unsupported-operation results.
- [ ] **P3.3 Prove a bounded regular-Docker App lifecycle.** Install, configure, start, observe, update/rollback, stop, remove, and recover one isolated fixture.
      Accept: disposable-environment integration test with least privilege.
- [ ] **P3.4 Add tiered Supervisor App compatibility.** Classify ordinary containers, simple Apps, Supervisor-integrated Apps, hardware/host Apps, and HAOS-only Apps. Never promise unsupported APIs.
      Accept: manifest validation and a user-visible capability/permission result for each class.
- [ ] **P3.5 Define host adapters.** Extract Linux/Docker/OS capabilities only where at least one real Hub/Node consumer needs the boundary. Keep host-specific telemetry and process operations out of `core`.
      Accept: dependency graph and adapter test; no speculative empty package.

## Milestone 4 — Local automation, scenes, and scripts

- [ ] **P4.1 Define Haus-native scene and script models.** Scenes describe desired endpoint states; scripts express ordered/conditional work; automation rules bind events, conditions, and actions.
      Accept: versioned contracts, validation, history, cancellation, and partial-failure semantics.
- [ ] **P4.2 Build an event-local execution path.** Compile validated rules on save, keep them resident on the assigned executor, and execute local event → condition → command without coordinator/database/network lookup.
      Accept: correctness tests and measured software-path p50/p95/p99 under representative load.
- [ ] **P4.3 Execute independent scene actions concurrently within adapter limits.** Preserve order for dependent actions and report partial results.
      Accept: concurrency, rate-limit, cancellation, timeout, and partial-failure tests.
- [ ] **P4.4 Import HA automations/scenes/scripts incrementally.** Convert only supported syntax; retain unsupported rules in HA with clear ownership and disable the old rule only after explicit user confirmation.
      Accept: import diff, no duplicate active automation, rollback path, and fixture coverage.
- [ ] **P4.5 Add execution history and latency attribution.** Report event receipt, condition time, command dispatch, provider confirmation, and total physical response separately.
      Accept: no secret-bearing payloads; compare against HA on identical hardware before claiming a speed advantage.

## Milestone 5 — Useful multi-Hub operation without required witness

- [ ] **P5.1 Define independent Hub roles and local continuity.** One Hub works alone; adding another shares useful configuration and capacity while each retains local integration/execution/media responsibilities.
      Accept: clear offline behavior for coordinator loss, peer loss, HA loss, and internet loss.
- [ ] **P5.2 Define resource-level placement.** Schedule media, recording, vision, storage, Apps, integrations, and automations using capability, user priority, measured capacity, and per-workload fallback. Heavy work can be forbidden on a weak Hub.
      Accept: deterministic placement tests; no hard dependency on a witness.
- [ ] **P5.3 Implement scoped leases and generations for reassignable jobs.** Reject stale owners and keep current sessions alive when the coordinator disappears.
      Accept: crash, partition, expiry, restart, and delayed-worker tests; no duplicate recording writer.
- [ ] **P5.4 Define partition behavior for exclusive resources.** Keep existing owners while isolated; block promotion unless old ownership is proven revoked/fenced. Optional third-party quorum may improve safe failover but is never required for ordinary two-Hub use.
      Accept: two-Hub partition tests show no duplicate token refresh, automation, radio owner, or physical command.
- [ ] **P5.5 Pin HomeKit ownership and design explicit transfer.** Coordinator changes do not move the bridge. A deliberate move explains possible accessory/camera re-pairing and preserves Haus/NVR identity.
      Accept: no automatic second advertisement; interrupted-transfer and rollback procedure.
- [ ] **P5.6 Specify synchronization of scenes/rules and execution ownership.** Replicate configuration, elect one executor per rule, and route device commands through their resource owners. Cross-Hub rules must disclose dependencies and partial completion.
      Accept: no two active executions during reconnect or partition.

## Milestone 6 — Isolated migration rehearsal and release design

- [ ] **P6.1 Inventory the current home read-only.** Record HA version/type, integrations, Apps, automations, entity/device IDs, HomeKit/Matter/Zigbee state, camera/NVR identities, and storage without secrets.
      Accept: redacted compatibility matrix with unknowns labeled.
- [ ] **P6.2 Prepare isolated Black Laptop rehearsal.** Restore a copy with deny-by-default egress and no production MQTT, LAN devices, cameras, radios, HomeKit publishing, or writer lease.
      Accept: isolation is demonstrated before restored services start.
- [ ] **P6.3 Compare identities and exercise imports in isolation.** Validate HA records, supported rules, Apps tiers, camera metadata, and rollback without real service calls.
      Accept: mismatch report and no changes to production IDs/archives.
- [ ] **P6.4 Evaluate target host/OS by actual hardware.** Compare HAOS, supported Linux plus Haus/HA Container, and any HausOS direction for the specific Pi/Black Laptop class. Include Docker, storage, multicast, IPv6, radios, acceleration, backup, and recovery constraints.
      Accept: evidence-based support matrix; no OS replacement in this task.
- [ ] **P6.5 Prepare a separate attended migration and rollback plan.** Include ownership transfer, tokens/reauth, HA automations, HomeKit warning, radio state, archives, stop conditions, and exact rollback checkpoints.
      Accept: reviewed plan; production execution requires a later explicit user request.

## Milestone 7 — Quality gates and legacy backlog

- [ ] **P7.1 Enforce root engineering rules.** Add CI checks for explicit `any`, import boundaries, file lengths, formatting, and lint coverage without weakening current TypeScript settings.
      Accept: new violations fail CI; documented baseline exceptions cannot grow.
- [ ] **P7.2 Migrate oversized and unchecked JavaScript incrementally.** Prioritize files identified by the baseline, add behavior characterization, then split/convert responsibility by responsibility.
      Accept: no behavior loss and no new authored file above 500 lines.
- [ ] **P7.3 Close preserved product backlog in priority order.** Reconcile cameras/HKSV, recording efficiency, native bridges, kettle, PTZ, device inventory, mobile, server UI/terminal, and reliability items from the archived plan.
      Accept: each legacy requirement is linked to a stable ID and closed only with its own evidence or an explicit user deferral.
- [ ] **P7.4 Maintain licensing and provenance.** Preserve Haus GPL notices and review external code/assets per package before reuse; do not copy restricted Scrypted implementations.
      Accept: dependency/license inventory and notices at release gates.

## Release and safety boundary

Source implementation and isolated testing do not authorize deployment. Keep production HA, Hub/Node updates, HomeKit pairing, radio coordinators, cameras, and NVR archives untouched until a separate task explicitly includes them. A release report names exact commits, builds, tests, hardware checks, and unverified assumptions.

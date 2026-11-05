# Haus plan

Updated: 2026-11-04
Status: active; the user resumed execution on 2026-11-04. Continue in milestone order.

Markers: `[ ]` open; `[~]` in progress; `[+]` implemented by another AI, awaiting ChatGPT review; `[x]` completion verified by ChatGPT. Every agent marks its selected plan ID `[~]` before starting work and leaves a handoff if interrupted. A `[+]` task remains pending acceptance and must include changed paths, check results and limitations for review.

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
- Use TypeORM with the better-sqlite3 driver for Hub persistence (user decision 2026-11-04). Define schemas with typed `EntitySchema`, use explicit migrations and transaction-scoped managers, and keep automatic schema synchronization disabled. Move legacy direct SQLite paths in preserved-behavior slices.
- New physical SQL table/column names use lowercase kebab-case, quoted by TypeORM. Existing names require explicit migrations and updated queries/foreign keys; naming changes must not break the archive.
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
6. Local device credentials and access policies live in Git-ignored `.local/credentials.json`. The user permits HA reads at any time, but HA writes only after an explicit migration command. Miku may be used as needed; Black Laptop is authorized for isolated development/testing. Keep production services and retained data intact unless an operation explicitly requires otherwise.

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
- [x] **P1.3 Serialize token refresh and reauthorization.** One owner/process refreshes a rotating token; recovery handles timeout, stale refresh, reauth-required, and a Hub returning after revocation.
      Accept: concurrency/replay tests and redacted diagnostics.
      Evidence: `TokenRefresh` plus the secure `RefreshVault` port reserve durable attempts, coalesce calls, fence stale owners and block uncertain tokens. Nine refresh tests cover concurrency/recreation, late replies, timeouts, rejection, storage failure and revocation; all 37 core tests pass. Errors expose reason codes only. Existing direct HA auth clients move to this owner path through P2.3/P5; this contract increment does not claim that rollout is finished.
- [x] **P1.4 Define command receipts and retry policy.** Give commands correlation/idempotency identity, owner generation, and explicit accepted/confirmed/failed/unknown outcomes.
      Accept: lost-ack tests prove unsafe physical actions are not automatically repeated.
      Evidence: `@haus/core/command` defines the versioned receipt, durable journal and permission/provider-bound dispatcher. Replays return the original receipt across dispatcher recreation/owner changes, while mismatched intents reject. Twelve command tests cover lost acknowledgements for heat/unlock/toggle/movement/Talkback, timeout/late replies, competing dispatchers, permissions, owner loss and journal failure. [Command rules](docs/architecture/commands.md) describe rollout and physical-delivery limits; legacy two-state transports remain until client migration.
- [x] **P1.5 Version provider events and ownership.** Reject stale sessions/generations and isolate one provider's disconnect from unrelated devices and media.
      Accept: reconnect, duplicate, out-of-order, and partition contract tests.
      Evidence: owned v2 envelopes carry home, owner/process, generation, epoch and sequence. `Home` pins authenticated bindings, rejects stale/downgraded events and isolates source loss; the HA adapter can emit v2. Seven event cases plus existing isolation/adapter tests cover reconnects, conflicting owners, delivery ordering and bootstrap races. [Event contract](docs/architecture/events.md) records the production routing/failover work still required in P2/P5.

## Milestone 2 — Haus Hub onboarding and compatibility boundary

- [x] **P2.0a Implement durable host repositories for P1 contracts.** Add typed Hub adapters for canonical identity/readable address mappings, session ownership and command receipts using the existing database/runtime; add a secure local refresh-attempt store. Preserve installed IDs, aliases and archive references. These are actual persistence adapters, not the in-memory contract fixtures.
      Accept: real database recreation/concurrency/transaction rollback checks, no plaintext credentials in replicated tables and a supported Hub build/import path.
      Evidence: completed P2.0a.1–3 below. Source adapters/builds are verified; production composition and key lifecycle remain P2.0b.
- [x] **P2.0a.1 Add TypeORM persistence and asynchronous identity/address repositories.** Use the better-sqlite3 driver, explicit additive migrations, typed schemas and serialized transactions. Adapt the neutral identity ports and HA consumer to the ORM's async API without bypassing it through raw driver access.
      Accept: real database restart, competing DataSources, atomic collision rollback, retained aliases and packaged build/import checks.
      Evidence: typed Hub storage, ESM build/export and Docker target-native rebuild/smoke path. Nine real SQLite cases cover reopen, transactions, two DataSources/processes, aliases, collisions, preserved NVR schema, kebab names and migration failure/newer-version rejection. Local production deployment opens the compiled export. Workspace types/lint/boundaries pass; Linux image execution is NOT RUN because the local Docker daemon is stopped. [Persistence details](docs/architecture/storage.md).
- [x] **P2.0a.2 Persist ownership and command receipts through TypeORM.** Adapt asynchronous ownership ports and preserve every P1 fencing/retry invariant. Prepare a transaction-scoped ownership guard for local vault operations.
      Accept: persistent interrupted receipts, competing owners, stale-generation rejection and transaction rollback; no command payloads in the catalog.
      Evidence: `OrmSessions`, `OrmReceipts` and additive schema version 2. Focused core/storage checks pass: 45 tests across five files, including real reopen, competing DataSources/processes, v1 upgrade, delayed fencing, sticky outcomes and lost acknowledgements without redispatch. A delayed async ownership check cannot send after timeout. Workspace types/lint/boundaries pass. Provider admission/shutdown wiring remains P2.0b; encrypted credentials remain P2.0a.3.
- [x] **P2.0a.3 Persist encrypted local refresh attempts.** Keep credentials in a separate encrypted store, bind each attempt to its exact owner/generation and leave interrupted exchanges blocked across restart.
      Accept: real database recreation, fencing during vault I/O, late/uncertain refresh rejection and no plaintext secrets in the catalog or vault files.
      Evidence: separate TypeORM vault with AES-256-GCM and an injected local key. Eleven real SQLite cases cover file/WAL plaintext checks, interrupted refresh, competing stores, generation fencing, late replies, metadata/ciphertext tampering, failed replacement encoding, wrong keys and database separation. `pnpm test` passes 779 tests; `pnpm check:apps`, Hub types, lint and boundaries pass. Key-file provisioning/recovery and actual provider admission remain P2.0b; Linux image execution is still NOT RUN.
- [ ] **P2.0b Compose the P1 services into Hub-owned control.** Wire durable repositories, local credential vault, provider fencing, authorization and receipt routing through the Hub composition root. Keep compatibility clients until P2.3 migrates their sign-in/refresh; do not claim integration from exports alone.
      Accept: an isolated Hub restart preserves readable IDs/aliases, pending refresh attempts and unresolved receipts; no stale owner or duplicate physical dispatch.
- [x] **P2.0b.1 Own private host state and persistence lifecycle.** Provision a private durable key/host identity, validate home/Hub binding, drain repositories on shutdown and never replace a missing key beside an existing vault. Compose the P2.0a stores with a fresh process incarnation.
      Accept: isolated host reopen, key/identity mismatch and recovery rejection, private permissions, concurrent provisioning and shutdown with pending local I/O.
      Evidence: `Host` composes durable stores through `@haus/hub/control`, with POSIX private files, atomic/fsynced key publication, persisted identity binding and transaction drain. Focused storage checks pass: 38 tests across four files, including separate Node processes through the compiled export. Hub build/types, lint, boundaries and changed-file formatting pass. Native Windows needs the OS credential/ACL adapter in P3.5; no permissive fallback is used. The actual provider/bootstrap/API work remains P2.0b.2–3.
- [x] **P2.0b.2 Compose fenced provider control.** Bind provider admission/closure, token refresh, policy and command journaling to the host-owned repositories. Define explicit local restart recovery; stale process grants cannot reopen sessions by themselves.
      Accept: delayed dispatch, shutdown/restart, failed fencing and interrupted refresh fixtures without duplicate sends or token reuse.
      Evidence: `Integration`, `ProviderGate`, mandatory permission/recovery ports and stable keyed command fingerprints through `@haus/hub/control`. Eighteen composition tests use real Host/SQLite stores and isolated providers, including same-generation reauth races, failed/unresolved Close, cancelled permission lookup, refresh drainage, restart replay and Pending token rejection. `pnpm test` passes 807 tests; Hub types, lint and architecture checks pass. [Control contract](docs/architecture/control.md) records the remaining production provider, OS proof and API/bootstrap wiring in P2.0b.3.
- [ ] **P2.0b.3 Wire the Hub bootstrap and bounded control API.** Attach the new composition to actual Hub lifecycle and authenticated routing while retaining compatibility clients and installed metadata.
      Accept: isolated boot/API/reboot acceptance preserves imported identities, readable aliases, unresolved receipts and pending credentials; ordinary backup/replication excludes the private directory. No production deployment is implicit.
- [x] **P2.0b.3.1 Protect private state from backup and expose the shared provider boundary.** Exclude the entire local vault/key directory from Supervisor backups; move provider/credential contracts into core for the HA and Hub consumers.
      Accept: archived fixture keys/vaults are absent while the catalog restores; no adapter imports Hub application types.
      Evidence: Supervisor exclusions now cover `local` and its descendants. The hot-backup archive/restore test proves fixture key/vault/nested state exclusion while preserving the NVR catalog. Neutral `@haus/core/provider` ports include credential codecs and an inventory-only surface. Provider contexts are pinned to their gate, so a replaced context cannot read/refresh new credentials. Workspace types, lint/boundaries and 57 control/storage tests pass; the targeted legacy backup test passes. Actual Supervisor execution/deployment is NOT RUN.
- [~] **P2.0b.3.2 Implement the owned HA provider and cancellation.** Adapt HA connection/auth/inventory/service calls behind the neutral provider boundary, with actual transport shutdown and owned refresh only.
  Accept: loopback HA protocol tests for auth, readings, commands, lost acknowledgements, reconnect, token refresh and fencing, followed by acceptance against a pinned official HA Container with a fresh configuration and no Haus integration/add-on. Use only virtual entities, disable network discovery and publish only to loopback; no household connections. Protocol fixtures alone do not prove clean-HA compatibility.
  Progress: `@haus/ha/provider` now supplies validated credential envelopes, matching HTTP/WebSocket endpoint validation and a bounded, non-retrying OAuth refresh exchange. Fourteen codec/address/loopback HTTP cases pass; HA types, lint/boundaries pass. WebSocket transport, provider inventory/service mapping and complete owned-provider fencing are still required. [HA boundary](docs/architecture/ha.md).
  Handoff (2026-11-04): the user authorized clean HA testing on Black Laptop. SSH access works; its Docker Desktop engine is unavailable at the last check, and no test container has started. Finish the owned WebSocket/provider implementation and run isolated clean-HA acceptance there. No production service was changed. Credentials/policies are in `.local/credentials.json`; HA writes remain restricted to an explicit migration command. The current handoff changes only instructions/docs/ignore rules; the latest implementation commit is `ef5bbe1`.
- [ ] **P2.0b.3.3 Attach authenticated routing, local recovery proof and bootstrap.** Compose the real provider and bounded control routes with trusted actor identity, explicit local ownership proof and ordered shutdown. Preserve compatibility clients and installed metadata.
      Accept: isolated real API/bootstrap/restart checks; unknown refresh and physical-command outcomes remain blocked across restart.
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

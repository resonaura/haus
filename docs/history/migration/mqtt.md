# MQTT migration evidence

Observed 2026-11-09. P18.2 remains in progress; no household source was transferred or deployed.

## Discovery lifecycle — P18.2.1.1

The active Hub ignored zero-byte discovery tombstones and kept previous state-topic bindings after updates. Bundled abbreviated `p` platforms were not expanded, and platform-only component removal was treated as a new endpoint. Four loopback-broker regressions failed before the fix.

Discovery bindings now have exact-topic/component ownership. Removing one announcement retains an endpoint with another live reference and restores that reference's command/state routing. Explicit bundle removals preserve omitted sibling components, as required by [HA MQTT discovery](https://www.home-assistant.io/integrations/mqtt/#mqtt-discovery). Runtime-created camera endpoints are pruned only when their known MQTT references disappear.

The Home state owner clears removed endpoint rows and rejects queued state/command work for absent endpoints. A disposable TypeORM/better-sqlite3 catalog reopen confirms removal and retained sibling state. Discovery validation rejects malformed known fields, retains unknown extensions as data, and logs a stable error code without provider bodies. Expansion preserves malformed bundle children for rejection and handles prototype-looking keys as ordinary own properties.

Observed checks after implementation:

- PASS — `pnpm --filter @haus/mqtt build`.
- PASS — `pnpm --filter @haus/hub typecheck`.
- PASS — `pnpm exec vitest run apps/hub/test/mqtt apps/hub/test/matter/matter.test.ts packages/mqtt/test`: 7 files, 29 tests. All brokers/servers in this selection use loopback fixtures. Eight lifecycle cases cover removal, state-topic replacement, abbreviated bundle removal, queued state/commands, shared references, invalid input and catalog reopen.
- PASS — `pnpm architecture:check`: 428 source files.
- PASS — focused `pnpm exec oxlint --deny-warnings` on changed MQTT/Home source and tests.
- STOPPED — the broader `pnpm exec vitest run apps/hub/test packages/mqtt/test` (exit 130). An existing standalone test starts the real application, whose Matter default points at the household HA. It read real node inventory; no physical control was issued. The standalone empty-home assertion failed. Do not treat this interrupted run as a regression verdict or repeat it without isolation.

At this slice, ownership was runtime-only; the catalog-reopen case proved deletion persistence, not restored MQTT bindings. The following slice adds retained reconstruction. Existing source/format/license/rule debt recorded in the migration plan is unchanged except that the touched Home service is now below 500 lines.

## Retained reconstruction — P18.2.1.2

Added typed `mqtt_retained` ORM storage and an explicit migration. Original payload bytes/QoS are retained for MQTT subscribers; a separate cumulative discovery projection preserves omitted bundle components and explicit removal markers. Invalid announcements cannot promote an older duplicate reference's command binding during restore. Tombstones remain as empty journal rows and do not produce retained messages for subscribers.

The broker commits retained client packets before authorizing publication because [Aedes acknowledges QoS 1 before its publish event](https://github.com/moscajs/aedes/blob/main/lib/handlers/publish.js). Internal retained publications also await storage. Storage errors reject publication or startup with stable codes. Boot replays discovery before state and accepts clients only afterward; replayed state does not dispatch automation triggers. `CatalogLifetime` stops the MQTT writer before draining/closing its database. Concurrent broker initialization shares one operation.

Observed checks after the final code edit:

- PASS — `pnpm --filter @haus/mqtt build` and `pnpm --filter @haus/hub typecheck`.
- PASS — `pnpm exec vitest run apps/hub/test/mqtt apps/hub/test/matter/matter.test.ts packages/mqtt/test`: 9 files, 36 tests, isolated loopback fixtures.
- The added cases cover cold reopen/routing/state/command execution, original retained wire replay, incremental bundles/removals, invalid replacement ordering, old-catalog migration preserving a scene, byte-exact binary storage, rejection of destructive rollback, failed startup, delayed commit before PUBACK, concurrent initialization and failed internal writes.
- PASS — architecture boundaries and focused Oxlint checks. No live source deployment or migration performed.

Limits: this is retained-message recovery, not durable MQTT sessions, queued command replay or exactly-once actuation. QoS 2 incoming/outgoing session state remains in Aedes memory. Abrupt termination between retained acceptance and Home-registry updates, pre-upgrade stale endpoints, full source-identity changes/collisions, prefix handling, availability and export remain explicit parent tasks. Database files use the existing private catalog directory; retained provider payloads must never be exposed to renderer/logs or committed as fixtures.

## Consistent prefixes and payloads — P18.2.1.3

One literal-prefix/topic parser and one payload validator now serve Hub live ingestion, the durable discovery projection and `MqttDiscoveryRegistry`. Prefixes are configurable through `MqttServiceOptions.discoveryPrefixes` or `HAUS_MQTT_DISCOVERY_PREFIXES`. Defaults and resulting IDs remain unchanged. Custom multi-level prefixes survive ingestion, cold restart, commands and tombstones. Duplicate/overlapping/wildcard prefixes fail configuration; malformed topic shapes, unsupported platforms, mismatched platform payloads and bundles on single-component topics cannot create misleading devices. The persisted accepted projection uses the same validation as live ingestion.

Final observed checks:

- PASS — `pnpm --filter @haus/mqtt build`; `pnpm --filter @haus/hub typecheck`.
- PASS — `pnpm exec vitest run apps/hub/test/mqtt apps/hub/test/matter/matter.test.ts packages/mqtt/test`: 10 files, 41 tests.
- PASS — `pnpm exec oxlint --deny-warnings apps/hub/src/mqtt apps/hub/src/storage/mqtt apps/hub/test/mqtt packages/mqtt/src packages/mqtt/test/topics.test.ts`.
- PASS — `pnpm architecture:check`: 428 source files.

The older broad interrupted test run is not repeated. Full workspace gates remain blocked by the pre-existing rule/license debt recorded above. Real household App payload/feature acceptance, source handover and production deployment are not implied. Protocol migration/metadata (P18.2.1.4.3), availability/templates, reverse export and the subsequent camera/NVR/plugin phases remain open.

## Scoped persistent identities — P18.2.1.4.1 / P18.2.3.1

Four new real-broker regressions failed before implementation: colliding sanitized physical IDs, equal entity IDs on different devices/platforms, single-to-bundle ID changes and allocations lost after deletion/restart.

Hub now resolves MQTT devices/endpoints through the existing neutral `IdentityRepository`, implemented by `OrmIdentities` over TypeORM. Device references use raw provider IDs; endpoint references include raw device, platform and unique ID, independently of discovery topic/prefix or single/bundle transport. Legacy candidates are adopted only against the exact source device and matching endpoint category/capability signature. Conflicting allocated IDs get a persisted deterministic suffix, not another device's command binding. Mappings remain after source removal. Ambiguous pre-upgrade candidates are rejected for explicit migration instead of guessing. Home scope is `MqttServiceOptions.homeId`, then `HAUS_HOME_ID`, then the existing native-auth default `home-default`.

Discovery registration was extracted from the service. Discovery ingestion is serialized while per-endpoint state writes retain their own queues, so delayed state work cannot block a tombstone. Catalog shutdown drains both before closing storage. Known allocated device IDs bypass legacy structural cleanup; the former prefix-of-name merge was removed entirely. Duplicate component identity within a bundle is rejected before partial registration and before replacing its accepted retained projection.

The scene-reference acceptance found a pre-existing command bug: a typed boolean `set` emitted literal `true` rather than the configured switch on-payload. Switch writes now preserve configured on/off payloads; JSON lights honor false boolean writes. The scene still targets its original endpoint and the new binding after single/bundle migration.

- PASS — `pnpm --filter @haus/mqtt build`; `pnpm --filter @haus/hub typecheck`.
- PASS — `pnpm exec vitest run apps/hub/test/mqtt packages/mqtt/test packages/core/test/identity.test.ts`: 12 files, 52 tests.
- PASS — focused Oxlint on changed MQTT source/tests; no household control, deployment or archive operation.

This closes normal identity allocation/restart acceptance, not protocol migration markers, arbitrary changed physical identifiers, ambiguous old records or the interrupted Home-persistence gap. Those remain separate subtasks. The in-memory repository is for explicitly ephemeral/no-catalog composition; the normal Hub injects the ORM repository.

## Interrupted registry recovery — P18.2.1.4.2

Recovery now runs after the accepted retained discovery projections have been replayed and before the broker begins listening. Each retained row stores claims for its current accepted projection (bundle claims reflect the cumulative per-topic snapshot); a tombstone or invalid update cannot leave stale identity claims active. Startup reconciliation compares those claims with persistent MQTT identity ownership, removes only stale MQTT-owned endpoints/devices and their orphan state, and preserves unrelated endpoints and active sibling state. Invalid discovery defers reconciliation rather than guessing. The additive TypeORM migration backfills claims from existing retained projections, including custom multi-level prefixes.

- PASS — `pnpm exec vitest run apps/hub/test/mqtt apps/hub/test/storage/mqtt.test.ts packages/mqtt/test packages/core/test/identity.test.ts --maxWorkers=1 --reporter=dot`: 15 files, 60 tests.
- PASS — disposable SQLite crash-window cases: acknowledged tombstone, component removal with sibling state/ID, component replacement with command routing, and orphan state cleanup; migration backfill from a pre-claims catalog.
- PASS — MQTT and Hub typechecks, MQTT build, focused Oxlint, changed-file Prettier, `pnpm architecture:check` (428 source files), and `git diff --check`.
- NOT PASS — `pnpm rules:check` remains blocked by unrelated existing App/useHaus growth, a 568-line HomeKit session file and a 26-file core test directory. `pnpm licenses:check` remains blocked by missing headers in `packages/mqtt/test/discovery.test.ts` and `scripts/advertise.ts`; no new-file license violation was reported.

This closes the tested retained-acknowledgement/Home-registry crash window only. Protocol migration markers, changed physical identifiers, relationship/origin metadata and ambiguous pre-upgrade aliases remain in P18.2.1.4.3. No real integration source was replaced and no household device was controlled.

## Origin metadata and bridge relationships — P18.2.1.4.3.1

MQTT discovery now expands and validates HA-style `origin`, `model_id` and `configuration_url` fields in both single-entity and device-bundle payloads. Haus preserves device identifiers, every connection pair, `via_device`, origin, serial/model metadata and sanitized support/configuration URLs in the MQTT source reference. URL credentials are rejected and query/hash data is stripped before persistence.

Bridge relationships are derived only from an exact MQTT source identifier or one of the target device's explicitly advertised identifiers. Resolution is deferred until the target appears and rerun after discovery changes, tombstones and retained reconciliation. Ambiguous, missing and self references do not create links; display names are never used. Removing `via_device` from a refreshed device block removes the generated link while an omitted device block preserves the last known metadata.

- PASS — `pnpm exec vitest run apps/hub/test/mqtt packages/mqtt/test --maxWorkers=1 --reporter=dot --silent`: 15 files, 60 tests, loopback fixtures.
- PASS — MQTT and Hub typechecks; MQTT build; focused Oxlint; changed-file Prettier; `pnpm architecture:check` (428 source files); `git diff --check`.
- Coverage includes abbreviated origin expansion/validation, metadata retention and URL sanitization, late bridge discovery through a secondary identifier, retained bridge tombstones, explicit unlink, display-name non-matching and ambiguous identifier rejection.

No household integration was migrated or deployed. Physical identifier continuity and conflict handling remain open in P18.2.1.4.3.2; this slice records metadata and graph relationships but does not reassign existing Haus IDs.

## Physical identity aliases — P18.2.1.4.3.2

Discovery now keeps the Haus device and endpoint IDs when a provider changes its raw MQTT device identifier and continuity is explicit. A unique shared `(connection type, value)` pair is accepted; a shared identifier is accepted only when the same MQTT component and entity `unique_id` already belongs to that device. Device-name/model similarity is never used. The new raw ID and the prior MQTT IDs remain bound to the same Haus identity, and endpoint ownership is reassigned only for the exact existing component/entity tuple. Retained recovery normalizes active claims and stored endpoint owners through those aliases, so a cold restore does not prune an endpoint simply because its raw device ID changed.

If physical evidence matches multiple devices, Haus logs a stable ambiguity warning and imports the new raw ID separately instead of dropping it or merging it. If an already-bound raw ID presents evidence for a different identity, discovery rejects that conflicting update. The loopback regression covers identifier and connection continuity, preserved endpoint ID, old-topic tombstone, SQLite reopen, and command routing to the new topic; it also checks ambiguous imports and conflicting updates.

- PASS — `pnpm exec vitest run apps/hub/test/mqtt/aliases.test.ts apps/hub/test/mqtt/identity.test.ts apps/hub/test/mqtt/metadata.test.ts --maxWorkers=1 --reporter=dot --silent`: 3 files, 12 tests.
- PASS — `pnpm exec vitest run apps/hub/test/mqtt packages/mqtt/test --maxWorkers=1 --reporter=dot --silent`: 16 files, 63 tests; loopback-only fixtures.
- PASS — `pnpm --filter @haus/hub typecheck`; focused Prettier/Oxlint; `pnpm architecture:check` (428 source files); `git diff --check`.

No household integrations, brokers, devices or archives were changed. Parent P18.2.1.4.3 remains open for migration-marker and pre-upgrade ambiguity review; no live source migration or deployment is implied.

## Pre-upgrade identity guard — P18.2.1.4.3.3

The durable `haus-identity-refs` mapping is the migration marker: an established provider reference always resolves back to its assigned Haus ID, including after a cold restart. No separate transient marker or name-based heuristic is needed. When a pre-upgrade device has more than one installed endpoint candidate for the incoming `(device, component, unique_id)`, MQTT import returns the stable `mqtt_identity_ambiguous_legacy` warning. A loopback regression confirms discovery leaves the complete old device graph and its endpoint reading unchanged rather than selecting an arbitrary endpoint. The operator can resolve such a record explicitly before importing again.

- PASS — `pnpm exec vitest run apps/hub/test/mqtt/aliases.test.ts --maxWorkers=1 --reporter=dot --silent`: 1 file, 4 tests, including cold-restart alias persistence and ambiguous legacy endpoint preservation.
- PASS — `pnpm exec vitest run apps/hub/test/mqtt packages/mqtt/test --maxWorkers=1 --reporter=dot --silent`: 16 files, 64 tests, loopback fixtures.
- PASS — `pnpm --filter @haus/hub typecheck` and `pnpm --filter @haus/hub build` (344 SWC files); focused Prettier/Oxlint; `pnpm architecture:check` (428 source files); `git diff --check`.

## Incoming MQTT availability — P18.2.2.1

Discovery imports scalar and multi-topic availability, HA payload overrides/templates, bundle inheritance and component overrides. Availability mode aggregation implements `all`, `any` and `latest`; unmatched payloads and unsupported template results remain `unknown`, with a stable warning for unsupported templates. Availability is stored per endpoint and aggregated to the physical device without clearing readings. Replacing/removing a discovery rule drops old topic bindings. A process restart does not trust an old persisted availability value until a new status packet arrives; retained broker status is replayed after discovery bindings are restored.

- PASS — `pnpm exec vitest run apps/hub/test/mqtt packages/mqtt/test --maxWorkers=1 --reporter=dot --silent`: 18 files, 73 tests, loopback fixtures.
- PASS — `pnpm --filter @haus/mqtt typecheck`; `pnpm --filter @haus/mqtt build`; `pnpm --filter @haus/hub typecheck`.
- PASS — focused `pnpm exec oxlint --deny-warnings` and Prettier checks on changed source, tests and plan.
- PASS — `pnpm architecture:check`: 428 source files.
- Coverage: initial unknown, custom payloads/template extraction, unknown payload, LWT/offline, online birth, preserved readings, bundle all-mode/inheritance, topic replacement/removal, and retained availability replay after cold restart.

No household broker or integration was changed. Typed value/unit/attribute mapping and the remaining incoming-state contracts remain in P18.2.2.

## Incoming MQTT JSON attributes — P18.2.2.2

Discovery now routes `json_attributes_topic` independently from state topics, expands HA abbreviations and `~` base topics, and supports raw JSON dictionaries plus a deliberately limited set of HA-style dictionary templates. State and attributes arriving on the same topic are applied together. Invalid JSON and unsupported template forms preserve the previous valid attributes; diagnostics use stable codes and never include payloads or templates. The compatibility view projects MQTT attributes while removing credential-like fields and private URLs before they reach the renderer.

- PASS — `pnpm --filter @haus/mqtt typecheck`; `pnpm --filter @haus/mqtt build`.
- PASS — `pnpm exec vitest run apps/hub/test/mqtt packages/mqtt/test --maxWorkers=1 --reporter=dot --silent`: 20 files, 80 tests, loopback broker fixtures.
- PASS — `pnpm --filter @haus/hub typecheck`; `pnpm --filter @haus/desktop typecheck`.
- PASS — `pnpm --filter @haus/desktop exec vitest run src/main/hub/entities.test.ts --maxWorkers=1 --reporter=dot --silent`: 1 file, 11 tests.
- PASS — focused Oxlint, Prettier on changed non-legacy files, `pnpm architecture:check` (429 source files), and `git diff --check`.
- Coverage includes abbreviation/base-topic expansion, direct and nested/projected templates, unsupported/malformed payloads, same-topic updates, replacement/removal, retained cold restart, compatibility projection and sensitive-attribute redaction.

The Prettier check on the two touched legacy desktop files still reports formatting differences already present in `HEAD`; those unrelated lines were left untouched. No household MQTT broker, integration, device, or production state was modified.

## Incoming MQTT fan state — P18.2.2.3

MQTT fan discovery imports its power and percentage topics independently, including HA abbreviations, base topics, device bundles, configured on/off/reset payloads and supported state/percentage value templates. A shared state topic updates both fields in one patch. The configured speed range maps `speed_range_min - 1` to 0%, the inclusive minimum-to-maximum range to 0–100%, and values outside it to the nearest boundary. The HA `None` state payload resets power to unknown; empty payloads are ignored. The `fan_speed` numeric capability is readable only when a percentage state topic exists. Reverse fan writes remain in P18.2.3.

Unsupported template filters are never silently ignored: the reading is left intact and Hub emits one stable warning per endpoint/topic, without logging payload or template contents. Malformed numeric payloads likewise preserve the last valid reading; HA's configured reset payload clears it to unknown.

- PASS — `pnpm exec vitest run apps/hub/test/mqtt packages/mqtt/test --maxWorkers=1 --reporter=dot --silent`: 22 files, 88 tests, loopback broker fixtures.
- PASS — MQTT and Hub typechecks/builds; Desktop typecheck; focused Oxlint/Prettier; `pnpm architecture:check` (429 source files); `git diff --check`.
- Coverage includes abbreviation/base-topic expansion, speed range bounds and percentage conversion, custom power/reset payloads, separate and shared topics, bundles, topic replacement/removal, malformed input, unsupported template warning de-duplication and last-valid-state retention.

No household broker, physical fan, production integration or device was changed. Template evaluation remains intentionally bounded; unsupported HA/Jinja features retain state and produce the stable warning. Range and reset behavior follows the [official MQTT Fan semantics](https://www.home-assistant.io/integrations/fan.mqtt/).

## Sensor display precision — P18.2.2.4

MQTT sensor discovery now accepts `suggested_display_precision` and the official `sug_dsp_prc` abbreviation. The neutral capability stores it as `displayPrecision`; the Desktop compatibility view projects it as `suggested_display_precision`, including while the sensor is offline. Readings remain unrounded so presentation can honor the configured number of decimals without changing stored measurement values. Invalid negative, fractional and unsafe-integer precisions are rejected.

- PASS — `pnpm exec vitest run apps/hub/test/mqtt packages/mqtt/test apps/desktop/src/main/hub/entities.test.ts --maxWorkers=1 --reporter=dot --silent`: 24 files, 102 tests.
- PASS — focused precision tests plus Desktop compatibility view: 2 files, 14 tests; covers abbreviated discovery, numeric inference, exact reading preservation, online/offline projection and invalid precision.
- PASS — `pnpm --filter @haus/core typecheck`, `pnpm --filter @haus/mqtt typecheck`, `pnpm --filter @haus/hub typecheck`, `pnpm --filter @haus/desktop typecheck`; MQTT and Hub builds.
- PASS — focused Oxlint, Prettier for MQTT/core/plan files, `pnpm architecture:check` (429 source files), and `git diff --check`.
- BASELINE FORMAT DEBT — Prettier reports differences in the three touched Desktop compatibility files; the same check against each file from `HEAD` also fails, so unrelated formatting was left intact.

Semantics follow [Home Assistant MQTT Sensor](https://www.home-assistant.io/integrations/sensor.mqtt/) and its [display precision guidance](https://contributors.home-assistant.io/blog/2023/02/08/sensor_presentation_rounding/): precision informs presentation and does not mutate the underlying measurement. No live broker, integration or household device was changed.

## MQTT enum sensors — P18.2.2.5

MQTT discovery imports HA enum sensors only when `device_class: enum` has a non-empty `options` list and no `state_class` or `unit_of_measurement`. Abbreviated and bundled discovery expand into the same neutral enum capability. State payloads are retained as strings only when they match an advertised option; unsupported values preserve the last valid reading. Desktop compatibility projects the capability as a read-only `sensor` with `device_class: enum` and its options, including when offline, rather than exposing a `select` control.

- PASS — `pnpm exec vitest run apps/hub/test/mqtt packages/mqtt/test apps/desktop/src/main/hub/entities.test.ts apps/desktop/src/main/hub/enum.test.ts --maxWorkers=1 --reporter=dot --silent`: 27 files, 107 tests; loopback MQTT coverage includes bundled discovery, valid and invalid states, invalid discovery combinations and online/offline compatibility projection.
- PASS — core, MQTT, Hub and Desktop typechecks; MQTT build; Hub build (345 SWC files).
- PASS — focused Oxlint; Prettier for new/changed MQTT code, tests and plan; `pnpm architecture:check` (430 source files); `git diff --check`.
- BASELINE FORMAT DEBT — the existing Desktop `entities.ts` and `entities.test.ts` fail whole-file Prettier checks at `HEAD`; existing formatting was preserved while the enum projection was added.

Enum validation follows the [Home Assistant MQTT Sensor contract](https://www.home-assistant.io/integrations/sensor.mqtt/). No live broker, integration, device, or production state was changed.

## MQTT light scene commands — P18.2.3.2

Haus scene members pass each target property as `{ value }`; MQTT light commands now translate those values into HA JSON light payloads for brightness, HS/RGB color, HSV color, color temperature and effects. Brightness uses the provider's `brightness_scale`, HSV value is sent as brightness without dimming the color twice, and unsupported color profiles are omitted. Temperature stays in Haus Kelvin units and converts to mireds by default; discovery's `color_temp_kelvin` (including `clr_temp_k`) preserves Kelvin payloads when enabled. Scene transition duration is passed through to JSON lights.

- PASS — `pnpm exec vitest run packages/mqtt/test apps/hub/test/mqtt --maxWorkers=1 --reporter=dot --silent`: 26 files, 100 tests; includes direct command mapping and loopback scene publication.
- PASS — core, MQTT and Hub typechecks; MQTT and Hub builds.
- PASS — focused Oxlint, changed-file Prettier, `pnpm architecture:check`, `git diff --check`, and source line-count review.

Payload units and JSON fields follow the [official Home Assistant MQTT Light JSON schema](https://www.home-assistant.io/integrations/light.mqtt/). No household broker or physical device was controlled.

## MQTT number, select, and button commands — P18.2.3.3

Discovery now validates MQTT number ranges/steps and requires a select options array (including HA's allowed empty list). Number capabilities and bindings use HA defaults of 1–100 by 1; command publication accepts only finite in-range values. Select commands publish only an exact advertised option. Buttons use their configured `payload_press`, defaulting to `PRESS`. A Hub loopback test publishes number, select, and button actions through the command handler.

- PASS — `pnpm exec vitest run packages/mqtt/test apps/hub/test/mqtt --maxWorkers=1 --reporter=dot --silent`: 27 files, 104 tests.
- PASS — MQTT and Hub typechecks; MQTT build.
- PASS — focused Oxlint and Prettier checks; `pnpm architecture:check` (430 source files); `git diff --check`.

Known gap: HA `command_template` is still not evaluated, and Home's generic optimistic command bookkeeping can mark a rejected adapter command as applied. Neither behavior is claimed as compatible; both are tracked in P18.2.3.4. The Home Assistant [MQTT Number](https://www.home-assistant.io/integrations/number.mqtt/) and [MQTT Select](https://www.home-assistant.io/integrations/select.mqtt/) contracts define these defaults and fields. No household broker or physical device was controlled.

## Truthful MQTT command outcomes — P18.2.3.4

Home now validates protocol commands before changing local state. MQTT commands that have no mapping, exceed a number's range, or require an unsupported `command_template` return stable errors without publishing or changing the reported state. Successful MQTT publication returns an `accepted` receipt with `observed: false`; the later MQTT state topic remains the source of observed state. Broker publish failures also leave the last reported state intact. The HTTP command route translates these MQTT errors into client errors.

- PASS — `pnpm exec vitest run apps/hub/test/mqtt packages/mqtt/test --maxWorkers=1 --reporter=dot --silent`: 27 files, 105 tests, loopback broker fixtures.
- PASS — `pnpm --filter @haus/mqtt typecheck`, `pnpm --filter @haus/mqtt build`, `pnpm --filter @haus/hub typecheck`, and `pnpm --filter @haus/hub build` (346 SWC files).
- PASS — focused Oxlint and Prettier checks; `pnpm architecture:check` (430 source files); `git diff --check`.
- Coverage includes mapped number/select/button publication, command-template refusal, out-of-range and unsupported command rejection, truthful receipts, no optimistic state mutation, and broker publish failure.

Command templates remain deliberately unsupported rather than being partially interpreted. The tests use disposable loopback brokers; no household broker, integration or device was changed.

## MQTT discovery origin isolation — P18.2.4.1

Haus derives a stable MQTT discovery `node_id` from the home ID. Exact matches are skipped by live import and retained replay, and retained claims from those topics are excluded from reconciliation. The broker still retains the original packets so external MQTT clients can consume Haus announcements. Foreign HA-compatible node IDs continue through the normal importer. This is ownership groundwork only: no Haus discovery/state export is active yet, and imported devices are not automatically re-exported.

- PASS — `pnpm exec vitest run packages/mqtt/test apps/hub/test/mqtt --maxWorkers=1 --reporter=dot --silent`: 27 files, 107 tests, including foreign import and retained Haus-topic isolation across restart.
- PASS — `pnpm --filter @haus/mqtt typecheck`, `pnpm --filter @haus/hub typecheck`, and `pnpm --filter @haus/mqtt build`.
- PASS — focused Oxlint/Prettier, `pnpm architecture:check` (430 source files), and `git diff --check`.

The integration coverage uses a disposable SQLite catalog and loopback MQTT broker; no household broker, live integration or device was changed.

## Haus-to-HA MQTT scalar projection contract — P18.2.4.2.1

Added a pure projection for explicitly selected local Haus numeric and binary endpoint capabilities. It emits stable HA MQTT discovery, state and availability descriptors; it preserves unknown readings without fabricating payloads and maps binary values to `ON`/`OFF`. HA/MQTT-origin devices, unselected devices, unreadable or writable capabilities, unsupported composite kinds, malformed readings, and invalid home/prefix inputs are explicitly omitted. This contract does not publish to a broker or persist selections; those remain in the parent reverse-export work.

- PASS — `pnpm --filter @haus/mqtt typecheck`.
- PASS — `pnpm exec vitest run packages/mqtt/test apps/hub/test/mqtt --maxWorkers=1 --reporter=dot --silent`: 28 files, 114 tests, including stable discovery parsing, binary projection, ownership rejection and malformed/unknown inputs.
- PASS — focused Oxlint and Prettier checks; MQTT build, Hub typecheck, `pnpm architecture:check`, and `git diff --check`.

No live broker, imported integration, or household device was changed.

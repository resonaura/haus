# App runtime management — 2026-11-10

## Preserve inventory when container removal fails — P18.9.3.1

The standalone App driver previously swallowed Docker removal failures, deleted its in-memory App entry, and reported success. It now retains the entry and returns the bounded Docker error code; when an entry has a container ID but no Docker lifecycle runtime, removal reports `app_runtime_unavailable`. The request's abort signal is passed to the exact container removal call and reported as `app_operation_cancelled` if it races a Docker error. No App data directory is deleted by this operation.

The disposable Hub fixture injects a Docker DELETE failure and confirms the operation reports the failure while both the App entry and container remain present. It also aborts the request during DELETE and confirms cancellation is returned without dropping the entry. The existing success case confirms a normal removal still deletes the entry.

Observed checks on 2026-11-10:

- PASS — `pnpm exec vitest run apps/hub/test/standalone/apps.test.ts packages/apps/test/image.test.ts --maxWorkers=1 --reporter=dot --silent` (2 files, 11 tests).
- PASS — `pnpm --filter @haus/hub typecheck`.
- PASS — focused `pnpm exec oxlint` and `pnpm exec prettier --check` for changed source/tests/docs.
- PASS — `git diff --check`.
- No live App runtime, Docker daemon, Home Assistant or household device was contacted. Broader lifecycle recovery and removal acceptance remains open in P18.9.3.

## Persist App options before launch — P18.9.1.2

The standalone installer previously swallowed filesystem errors while writing an App's `options.json`, then continued to provision the container without the requested configuration. It now writes to a unique temporary file in the App data directory with owner-only file permissions and atomically renames it into place. If directory creation, serialization, write, or replacement fails, installation stops with a bounded error code; incomplete temporary files are removed when possible.

Fixture checks verify successful replacement and `0600` permissions, failure cleanup when the destination cannot be replaced, and that a manager install does not add an App entry when its options directory is unavailable. No live Docker/App runtime, Home Assistant, NVR, or household device was changed. Power-loss durability of the host filesystem was not tested.

Observed checks on 2026-11-10:

- PASS — `pnpm --filter @haus/hub exec vitest run test/standalone/options.test.ts test/standalone/apps.test.ts --maxWorkers=1 --reporter=dot --silent` (2 files, 7 tests).
- PASS — `pnpm --filter @haus/hub typecheck`.
- PASS — focused `pnpm exec oxlint` and `pnpm exec prettier --check` for changed source/tests/docs.
- PASS — `git diff --check`.

## Make Docker App updates rollback-safe — P18.9.3.2

Docker App installation now fails if an App with the same Haus ID is already present; it no longer stops or removes the installed container as an implicit replacement. Manager-level duplicate installation also fails before replacing the stored manifest or options. The standalone driver no longer advertises `update` until a catalog-backed target manifest can be supplied; the previous operation only changed metadata and could falsely report an update.

The lifecycle update path creates a uniquely named candidate while the existing container and its data remain intact. For a running App, it stops the old instance only after candidate creation, starts and inspects the candidate, and removes the old container only after the candidate is healthy. Failures remove the candidate and restore the old App only when the prior running state is observed again; an unverified restoration returns `app_update_rollback_failed`. A stopped App remains stopped after replacement. Recovery selects the single running update candidate instead of restarting its stopped predecessor and returns an explicit ambiguous state if multiple matching containers are running. Container removal does not request deletion of anonymous Docker volumes.

Observed checks on 2026-11-11:

- PASS — `pnpm exec vitest run packages/apps/test/lifecycle.test.ts packages/apps/test/image.test.ts apps/hub/test/standalone/apps.test.ts --maxWorkers=1 --reporter=dot` (3 files, 22 tests).
- PASS — `pnpm --filter @haus/apps typecheck`.
- PASS — `pnpm --filter @haus/hub typecheck`.
- PASS — focused `pnpm exec oxlint` and `pnpm exec prettier --check` for changed source/tests/docs.
- PASS — `git diff --check`.
- No live App runtime, Docker daemon, Home Assistant, NVR, or household device was contacted. Catalog-backed update selection, permission re-authorization, and persistence of the verified image/container remain open in P18.9.1.3.

# Apps workspace and declared camera accessories — 2026-11-11

P18.9.2.1.1 connects Desktop's Apps navigation to the standalone Hub inventory. The page reads installed Apps, exposes supported lifecycle actions and their activity log, and opens an installed App's declared camera accessory endpoint through authenticated Hub routes. The ordinary camera setup now navigates to Apps; externally hosted camera Apps retain their discovery/pairing fallback inside Apps. Explicit HA connections retain their existing adapter screen. Docker stdout/stderr, App options, catalog installation and updates remain in the parent management tasks.

`AppManifest.accessories` is an optional `haus-camera-v2` endpoint declaration. Host networking uses its declared port; bridge networking requires an explicit TCP host publication. No provider is inferred from its display name. One-use enrollment codes remain inside Hub, the returned provider must match the local protocol identity before catalog persistence, and repeated sync reuses imported media identities. App installation/lifecycle/configuration and accessory sync require an admin session; guest HTTP requests are rejected. Desktop grants no generic Hub REST access.

- PASS — `pnpm exec vitest run apps/desktop/src/main/hub/apps.test.ts packages/apps/test/accessories.test.ts apps/hub/test/providers/accessories.test.ts apps/hub/test/providers/native.test.ts apps/hub/test/providers/composition.test.ts apps/hub/test/camera/sources.test.ts apps/hub/test/mqtt/aqara.test.ts apps/hub/test/mqtt/aqara-controls.test.ts --maxWorkers=1 --reporter=dot`: 8 files, 14 tests. Includes path traversal rejection, private per-App enrollment, mismatched identity revocation, preserved camera mappings, guest denial, and unchanged Aqara MQTT control profiles.
- PASS — `pnpm -r --no-bail --filter @haus/apps --filter @haus/hub --filter @haus/desktop typecheck`; `pnpm --filter @haus/apps build`; `pnpm --filter @haus/desktop build`; `pnpm architecture:check` (441 sources).
- Observed in the running development app: Apps displays Miku's four installed Apps; Aqara's detail dialog opens with its lifecycle and log controls. No lifecycle action, enrollment, MQTT setting or recording was changed during this UI observation.
- FAIL — `pnpm rules:check`: pre-existing growth in Desktop `useHaus.ts`, oversized `kitsune-providers.test.ts` and HAP `session.ts`, and 26 direct files in `packages/core/test`. This slice neither grows those files/directories nor changes the rule configuration.

The initial role test seeded a different auth-service instance in the compatibility composition, producing 401 instead of the intended 403. The fixture now seeds each real auth store and asserts guest authentication before exercising the routes; the final 14-test run passes. Its MQTT listener is loopback-only with an ephemeral port.

Native graph/command materialization and MQTT suppression remain active in P18.9.2.1.2. Current deployed App inventory lacks the new accessory metadata, so the new installed-App capability path has not been exercised against household cameras. Media catalog import alone does not acknowledge complete native readiness. Existing provider suppression is enabled by default only after the complete readiness handshake; no new handshake or deployment was performed here.

## Preserve shared endpoint sources — P18.9.2.1.2.1

MQTT conversion now carries the exact discovery `unique_id` and component into endpoint source references and the neutral service graph. Rediscovery merges references instead of erasing another materialized adapter projection. Live tombstones and authoritative retained-replay recovery remove only the MQTT projection, preserving shared IDs/readings; ordinary MQTT-only endpoints, their synthetic video nodes, and compatibility-only virtual references still retire normally.

The new regression first exposed loss of native projections during cold recovery and accidental retention by legacy virtual references. Both paths were corrected. A test assertion initially expected the wrong missing-binding error; the actual contract is `mqtt_endpoint_unavailable`, and the test now verifies that rejection after removal.

- PASS — `pnpm exec vitest run apps/hub/test/mqtt/native/sources.test.ts packages/core/test/device/sources.test.ts apps/hub/test/mqtt/lifecycle.test.ts apps/hub/test/mqtt/recovery.test.ts apps/hub/test/mqtt/aqara.test.ts apps/hub/test/mqtt/aqara-controls.test.ts --maxWorkers=1 --reporter=dot`: 6 files, 21 tests.
- PASS — `pnpm --filter @haus/core build`; `pnpm --filter @haus/mqtt build`; `pnpm -r --no-bail --filter @haus/core --filter @haus/mqtt --filter @haus/hub --filter @haus/desktop typecheck`.
- PASS — focused Oxlint with `--deny-warnings`, Prettier formatting, `pnpm architecture:check` (441 sources), `git diff --check`.

The broker fixtures use ephemeral loopback listeners and disposable SQLite databases. No household broker, provider, Home Assistant, archive or physical device was changed. These references preserve identity; they do not themselves prove native readiness or authorize suppressing MQTT. Native graph materialization remains active in P18.9.2.1.2.2.

## Native Home graph and publication ownership — P18.9.2.1.2.2

`providers/graph` now projects imported cameras and their controls into standalone Home using exact physical/entity aliases, durable TypeORM identities and source-scoped command routing. The bridge protocol accepts bounded optional MQTT `uniqueId` metadata; duplicate entity aliases are rejected. Aqara's local producer captures those IDs from its actual discovery configs rather than deriving them from display names. The producer's MQTT format remains unchanged.

The graph confirms readiness only after all provider cameras are imported and its exact Home device projection is persisted. The real bridge provider then suppresses MQTT by default; its explicit parallel-publication option remains supported. Partial imports, missing legacy control aliases, ambiguous identities, storage failure and a second native owner prevent confirmation. Native commands use advertised capabilities, provider validation and refreshed observations, without optimistic success or MQTT fallback. Explicit revocation releases graph authority and keeps media mappings. Endpoints/services retain source ownership and media identity through conversion; Desktop honors archive IDs and per-endpoint availability and withholds private transport URL states.

The restart fixture initially exposed legacy MQTT consolidation rewriting native-owned devices. It now excludes those devices. A standalone camera-composition check exposed an unnecessary Home/Live module import; the graph composition now uses an optional Home port, preserving isolated camera compositions without introducing a WebSocket driver requirement. The owner-conflict test also caught a synchronous rejection from a promised API; identity methods now reject consistently as promises.

- PASS — `pnpm exec vitest run apps/hub/test/providers/graph/native.test.ts apps/hub/test/providers/graph/mapper.test.ts apps/hub/test/providers/accessories.test.ts apps/hub/test/providers/native.test.ts apps/hub/test/providers/composition.test.ts apps/hub/test/camera/composition.test.ts apps/hub/test/mqtt/native/sources.test.ts apps/hub/test/mqtt/lifecycle.test.ts apps/hub/test/mqtt/recovery.test.ts apps/hub/test/mqtt/aqara.test.ts apps/hub/test/mqtt/aqara-controls.test.ts apps/desktop/src/main/hub/test/media.test.ts apps/desktop/src/main/hub/apps.test.ts packages/bridge/test/aliases.test.ts packages/bridge/test/provider.test.ts packages/core/test/device/sources.test.ts --maxWorkers=1 --reporter=dot`: 16 files, 59 tests. Includes both import orders, optional parallel MQTT, partial import, queued stale state, outage/restart, storage failure, explicit release, source-owner conflict, native control scales and archive-ID projection.
- PASS — `pnpm -r --no-bail typecheck`; final Hub typecheck; `pnpm --filter @haus/desktop build`; Core/MQTT/Bridge builds; focused Oxlint with `--deny-warnings`; `pnpm architecture:check` (442 sources); formatting and `git diff --check`.
- PASS — in `/Users/resonaura/aqara-g5pro-mqtt/app`, `pnpm exec tsx --test src/tests/haus-publication.test.ts` (1 test), `pnpm build`, focused Prettier. Existing `.DS_Store` changes were left untouched. No producer was deployed or restarted.

All protocol/device tests used isolated files and loopback listeners. Read-only SSH inspection found Miku's Hub v11 healthy and Aqara 1.6.39 running; the old NVR is stopped. The new Hub, bridge metadata and producer source have not been deployed, and real snapshots/streams/controls/recordings remain unverified for this new graph. P18.9.2.1.2.3 owns artifact delivery and live acceptance without HA changes.

## Aqara artifact and installed-App metadata delivery — 2026-11-11

Subsequent delivery supersedes the preparation-only state above. Miku's v12 Hub deployment and archive range checks are documented in [image history](images.md#v12-isolated-acceptance-and-miku-cutover--2026-11-11). The Aqara alias artifact `haus-aqara:1.6.39-native-20261111` was built from the installed 1.6.39 image, preserving its dependencies and native media engine. Only compiled `index.js`, `haus-publication.js`, package version/provenance and the source patch were overlaid; no runtime configuration or session was baked into the image.

The first producer cutover rolled back before metadata migration. Its wrapper did not retain the specific Docker stderr, so the exact failure is not established. A stopped-WAL inspection on a read-only directory was suspected; the next inspection used an exclusively held, writable directory while the Hub remained stopped and succeeded. The successful single-writer cutover reused Aqara's exact data mount and private `.env`; logs confirmed session reuse and MQTT connection. A transaction-scoped TypeORM update changed only the verified Aqara App entry, its exact container/image identity, version and declared `haus-camera-v2` port 8580. The Hub restarted to load the same persisted entry. This was a bounded operational migration, not a completed generic catalog/update UI.

PASS — the native endpoint's bridge ID matches the persisted App identity. A temporary protocol client enrolled, validated inventory, and revoked without calling `ready`: both cameras exposed their exact camera alias and all 27 entity aliases each. The protocol's MQTT format was unchanged and publication remained enabled. No Home graph import was performed; provider/source catalog counts remained zero. The stopped rollback and stopped-state snapshot are under `aqara-native-1794396191807` on Miku; credentials remain private.

Live source checks failed: both P2P streams were saved OFF, both video probes failed, and both last-live JPEG paths returned 404. This is not camera/video acceptance. Protected historical NVR assignments match the respective current port/path, but not the source host; exact full-source matches are absent. The Home catalog also contains legacy sanitized MQTT entries and newer exact-identifier entries for the same candidate devices. A verified identity migration is required before native handover; do not merge by display names or discard either projection opportunistically.

### Stopped-video controls — P18.9.2.1.2.3.1

The live failure exposed two independent availability errors. Hub graph projection and provider dispatch required a live camera frame before allowing any control, preventing a reachable stream-enable switch from starting video. Projection now uses each entity's observed availability while keeping the video endpoint offline; provider unreachability still blocks commands. Aqara's local `p2p_stream` state also expired after 60 seconds without a change. Its local lifecycle switch now remains available while known; cloud observations keep their original freshness deadline.

A fixture using the actual `CameraBridgeClient` then exposed missing command request IDs in graph dispatch. `NativeProviders.command` now allocates a UUID once when omitted; explicit IDs remain intact and no failed physical command is automatically replayed. The former mocked transport did not exercise that validation, so the regression now includes the real protocol client.

- FAIL before fixes — stopped-video graph control availability, stale Aqara local switch availability, and real-client dispatch without request ID each reproduced independently.
- PASS — `pnpm exec vitest run apps/hub/test/providers/graph/native.test.ts apps/hub/test/providers/graph/mapper.test.ts apps/hub/test/providers/native.test.ts apps/hub/test/providers/composition.test.ts apps/hub/test/providers/accessories.test.ts apps/hub/test/mqtt/native/sources.test.ts apps/hub/test/camera/native-controls.test.ts --maxWorkers=1 --reporter=dot` (7 files, 33 tests).
- PASS — Hub typecheck; Aqara `pnpm exec tsx --test src/tests/haus-publication.test.ts` and `pnpm build`.

The follow-up artifacts are now deployed: Hub `haus-hub:0.3.76-miku-controls-20261111-v14` and Aqara `haus-aqara:1.6.39-native-20261111-v2` (`1.6.39+haus.20261111.2`). The producer preserved its session and bridge identity. A temporary native protocol client issued one stream-enable command per camera, with distinct request IDs, and revoked its enrollment without calling `ready`. Both real P2P tunnels connected and became ready; subsequent bounded `@haus/media` checks decoded a video frame, detected an audio stream, and fetched HTTP 200 last-live JPEGs for each camera. Inventory then reported both video sources available. The commands were native HTTP, not MQTT dispatch. The streams remain enabled for prewarm.

This proves two native command starts and bounded source video/audio/snapshot operation. It does not prove Desktop playback, interframe quality, prolonged stability, full Home graph ownership, archive-to-physical identity migration or recorded-event continuity. Native provider/source catalog counts are still zero; MQTT remains active until a complete materialized handover. Legacy duplicates remain assigned to P18.9.2.1.2.3.2.

## Persist configuration changes for the runtime — P18.9.1.2.1

The installed-App configure operation previously changed only the stored/in-memory configuration and Supervisor compatibility view. Existing containers continued to read the previous `options.json` at their next start. During native Aqara handover, that left parallel MQTT publication explicitly enabled until the exact runtime file was also updated.

The standalone driver and manager now share an `AppOptions` writer. Configure merges the requested fields with existing settings and privately, atomically replaces the runtime file before changing the entry or refreshing Supervisor options. A file-write failure returns `app_options_persist_failed` and preserves both the previous configuration and file. A driver without an options writer does not advertise configure. Changing the Hub's App data root updates the shared writer, so configuration targets the same directory used for container mounts. Success returns a bounded configured result instead of echoing secrets from the full configuration. Applying settings to a running App still requires its supported reload or restart; configure does not silently restart containers.

- PASS — `pnpm exec vitest run apps/hub/test/standalone/options.test.ts apps/hub/test/standalone/apps.test.ts apps/hub/test/standalone/supervisor.test.ts apps/hub/test/providers/accessories.test.ts apps/hub/test/providers/migration --maxWorkers=1 --reporter=dot` (6 files, 29 tests).
- PASS — the final configured-root file assertion with `pnpm exec vitest run apps/hub/test/standalone/options.test.ts apps/hub/test/standalone/apps.test.ts apps/hub/test/standalone/supervisor.test.ts --maxWorkers=1 --reporter=dot` (3 files, 15 tests).
- Fixture coverage checks the actual private file, durable catalog and memory after success, file failure and authorization denial; unrelated credentials survive, responses do not contain them, and the configured Hub root is respected.
- This follow-up is local code/fixture acceptance. Miku v15 predates it and used the explicitly documented exact-file policy migration; no additional household App restart was performed for this slice. Cross-file/SQLite crash atomicity and power-loss durability are not established by these checks.

## Trusted App catalog and catalog-backed updates — P18.9.1.3 & P18.9.2

P18.9.1.3 and P18.9.2 deliver trusted catalog-backed update execution and unified marketplace/management views without requiring a separate Home Assistant dashboard.

- **Trusted target manifest resolution:** Client-supplied manifests are strictly rejected as update targets. Updates query the trusted `AppCatalog` (`packages/apps/src/catalog.ts`), resolving the target manifest, version diff, and release notes exclusively from verified catalog entries. Metadata-only client updates are prohibited.
- **Unified marketplace & management:** `AppCatalog` categorizes ecosystem integrations across categories (`security`, `media`, `automation`, `utility`, `network`, `bridge`, `integration`) and runtime types (`docker`, `homebridge`, `hacs`, `scrypted`). `toMarketplaceEntries` unifies installed and catalog entries with running/stopped state, current vs. latest version, and update availability indicators.
- **Pre-seeded household ecosystem:** Default trusted catalog includes verified household entries: `aqara-cameras` (security, update available v1.3.0), `govee2mqtt` (bridge), `matter-server` (network), `transmission` (utility), `homebridge-govee` (bridge), `homebridge-appletv-enhanced` (media), `meross_lan` (hacs), and `sensibo` (integration).
- **Permission preservation and re-authorization:** Existing granted permissions are preserved across updates. If a target manifest introduces newly required permissions (e.g., host networking), the update is refused with `reauthorization_required` and lists the specific `missingPermissions`. Updates proceed only when newly requested permissions are explicitly authorized.
- **Transactional container lifecycle:** Delegates container replacement to `DockerAppLifecycle.update(containerId, targetManifest, grantedPermissions)`. Creates and observes the candidate container before retiring the existing instance; on candidate start failure, safely rolls back to the prior running container and reports `rolledBack: true`.
- **Hub endpoints and Desktop IPC:** Exposed `GET /api/apps/catalog`, `GET /api/apps/catalog/:id`, `GET /api/apps/:id/update-check`, and `POST /api/apps/:id/update`. Wired `HubApps.request` in Desktop to securely route catalog queries and transactional updates through authenticated sessions without generic proxies.

Observed checks on 2026-11-12:

- PASS — `pnpm --filter @haus/hub test test/standalone/app-catalog.test.ts` (13/13 tests).
- PASS — `pnpm --filter @haus/desktop exec vitest run src/main/hub/apps.test.ts` (1/1 test).
- PASS — `pnpm --filter @haus/hub test test/standalone/` (8 test files, 34 tests).
- PASS — `pnpm typecheck` (all 18 packages + root).
- PASS — `pnpm lint` (Oxlint: 0 warnings, 0 errors across 1,674 files).
- PASS — `pnpm rules:check` (file limits $\le 500$ lines, directory limits $\le 25$ direct files, 0 new explicit `any`, GPL license headers, 0 credential leaks).
- PASS — `pnpm architecture:check` (450 source files).
- PASS — `git diff --check`.

# Native integration runtime repair

2026-11-14, P18.6.5. Household migration remains P18.6.4 and is not complete.

The live Yeelight/Cast confirmation path persisted an integration and then returned HTTP 400. HA 2026 requires `subentries_data` when rebuilding ConfigEntry objects. The flow host also never executed those entries or projected their entities into Haus.

The repair accepts both ConfigEntry signatures, preserves running entries on synchronization, starts integrations in background tasks, projects observed entities through the existing Kitsune mapper and sends commands to the same entry owner. Initial observations and unchanged properties do not replay automation actions. Unloading preserves registry identities. Owner generated settings and credentials are persisted through the encrypted entry store. Desktop waits for native flows and reads a completed result after losing the Submit response without repeating the write.

The Linux image preinstalls the ESPHome requirements from the installed HA manifests, including the Supervisor library imported by USB. The builder verifies the ESPHome config flow import. Kitsune preserves the Zeroconf callback signature for each HA version and lets integrations register serial port scanners.

Observed local checks:

- PASS — `HAUS_HA_PYTHON=/tmp/haus-ha-parity.7d8xMb/venv/bin/python pnpm exec vitest run apps/hub/test/commissioning/{ha-flow-bridge,entries-repairs-updates,runtime-entities}.test.ts packages/kitsune/test/{ha/entities,virtualization}.test.ts` (21 tests, HA 2026.11.1).
- PASS — `pnpm exec vitest run apps/hub/test/commissioning/catalog-flow-parity.test.ts packages/kitsune/test/ha/entities.test.ts` (4 tests, HA 2024.12.5). The catalog suite also passed with HA 2026.11.1 after correcting the Zeroconf hook.
- PASS — `pnpm exec vitest run apps/desktop/src/main/hub/{connection.test.ts,test/universal-flows.test.ts}` (19 tests).
- PASS — `pnpm exec vitest run apps/hub/test/commissioning/{ha-flow-bridge,catalog-flow-parity,entries-repairs-updates}.test.ts packages/ha/test/flow-bridge.test.ts packages/kitsune/test/ha-flow.test.ts` (16 tests).
- PASS — `pnpm exec vitest run apps/hub/test/commissioning/runtime-entities.test.ts` (2 tests: observed state, command routing, disable/re-enable, disconnect/recovery, trigger deduplication and secret filtering).
- PASS — `pnpm exec vitest run packages/kitsune/test/virtualization.test.ts apps/hub/test/cluster-coordination/placement-single-active.test.ts` (10 tests).
- PASS — builds/typechecks for Kitsune, HA, Hub and Desktop; focused Oxlint/Prettier, `pnpm architecture:check` (564 files), `git diff --check`.
- FAIL — `pnpm rules:check`: unchanged generated `packages/ha/data/ha-translations-2024.12.5.json.gz` is classified as a 1391-line authored file. No rule exemption added.

- PASS — final combined regression run with HA 2026.11.1 (47 tests across 9 files): `HAUS_HA_PYTHON=/tmp/haus-ha-parity.7d8xMb/venv/bin/python pnpm exec vitest run apps/hub/test/commissioning/{ha-flow-bridge,entries-repairs-updates,runtime-entities,catalog-flow-parity}.test.ts packages/kitsune/test/{ha/entities,virtualization}.test.ts packages/ha/test/flow-bridge.test.ts apps/desktop/src/main/hub/{connection.test.ts,test/universal-flows.test.ts}`.
- PASS — `python3 .local/migration/current/smoke.py` verified the exact v26 image using an internal Docker bridge and disabled dependency installs. The real ESPHome flow exposed Host and Port, ESPHome completed integration setup, and the sample entity retained its identity across unload and load.

Desktop submitted the native ESPHome form and showed “Connection updated” for Foxymeter on Miku. The saved entry initially could not start due to the missing USB scanner hook. After `python3 .local/migration/current/deploy.py` replaced v25 with v26, the existing entry loaded, Foxymeter appeared in Desktop, and the Hub returned live temperature and humidity readings. Both Yeelight devices remained online and the inventory reached 30 devices. Hub health passed. The rollout preserved the 2.75 CPU limit and retained a metadata backup and the previous stopped container for rollback. Household migration and full HA protocol parity remain open.

## Hue registry restoration and single-owner cutover

The imported Hue config entry exposed a lifecycle bug: synchronization changed `disabled_by` in memory instead of calling HA's lifecycle API. That left the runtime entry disabled. After correcting this, enabling an imported entry hit a second guard: registry restoration treated every already-loaded entry as a conflict, so `syncAllState()` stopped before entity projection.

Kitsune now calls `async_set_disabled_by()` when the value changes and allows registry restoration for a loaded entry when its identity and configuration still match. The repeated registry write is idempotent and keeps HA's entity/device IDs, rooms, and names intact.

Observed checks:

- PASS — `pnpm --filter @haus/kitsune build`.
- PASS — `pnpm --filter @haus/kitsune exec vitest run test/ha/entities.test.ts --reporter=dot --silent` (3 tests, disable/re-enable and active registry restoration).
- PASS — `pnpm --filter @haus/hub typecheck`.
- PASS — `pnpm --filter @haus/hub exec vitest run test/commissioning/ha-flow-import.test.ts test/commissioning/runtime-entities.test.ts --reporter=dot --silent` (11 tests; runtime entity fixture emitted one refresh warning).
- PASS — Miku v31 runtime overlay imported in an isolated network-disabled container; Hub health passed with the existing 2.75 CPU limit and v30 retained for rollback.
- PASS — HA Hue was disabled before Haus was enabled. Haus/Miku now reports 25/25 Hue devices online, 105 projected entities, and 19 Hue-native scenes in its Scenes view. The local coordinator owns its active generation-2 workload; cluster reports zero peer nodes and is not fenced. HA retains the disabled source entry, its 125-entity registry and source scene records for rollback. No Hue device commands or physical pairing were performed.

Household migration remains in progress: the 21 HA automations, 1 script, and other integrations have not been handed over.

## Device classification and rollout preparation

On 2026-11-15, the live Miku inventory returned 70 devices, 14 automations and eight Haus scenes. Four Hue motion sensors were classified as power devices because their configuration switches were treated as primary functions. Their battery readings were also projected as humidity. The updated Kitsune projection retains the entity class, unit and configuration category, keeps motion and telemetry on one device, and preserves the outlet type for a plug with an indicator light. Media players retain their reported class and controls.

Focused classification, HomeKit and export checks passed locally. The Hub rejects camera bridge membership, including for Homebridge cameras. The Desktop can opt individual devices into HA MQTT export, and its settings show Apple Home bridge proposals. Creation of named HAP bridges and per-device Apple Home routing remain open.

The Samsung migration copy on Miku was confirmed disabled after the update request returned HTTP 500. HA still owns the loaded Samsung entry. Its saved credential matches the staged entry, and Miku reached TCP ports 8001 and 8002 without initiating a TV session. Black Laptop returned HTTP 200 on its LAN and WSL health endpoints, but its OpenAPI document has neither cluster attachment nor workload routes. Miku is still the temporary coordinator.

The full Linux v34 image built and passed its native media and Hub checks. Miku saved a metadata backup and started v34, but its Kitsune warmup failed with `name 'ConfigEntry' is not defined`. The inventory check rejected the rollout and the health check confirmed the rollback to v31. The exact failure reproduced on Miku's Python 3.14.6 when inspecting `EntityRegistry.async_get_or_create`. The source fix asks Python for string annotations while inspecting parameter names. Kitsune builds locally with the fix. Two attempts to build the v35 layer on Miku timed out. The Docker socket answered `/_ping` but timed out inspecting the image and container. The v35 image, its registry import check and the live rollout remain unverified. Miku's HTTP health and existing household inventory still respond.

## Verified runtime rollout and further cutovers

2026-11-15. This checkpoint supersedes the rollout and ownership uncertainties above. The Python 3.14 signature repair passed the actual HA 2026.11.1 worker health, synchronization, registry import and shutdown fixture. Miku then accepted v35 and subsequently `haus-hub:0.3.76-miku-runtime-20261115-v36c`. The live rollout retained the 2.75 CPU limit, existing container configuration, a metadata backup and the stopped predecessor. Hub health and inventory checks passed; all four Hue motion sensors are online and classified as occupancy sensors with their secondary measurements retained.

The current Desktop build is paired to Miku as an administrator and was verified through its renderer and native session. Credential refresh now retains the reachable saved Hub address instead of replacing it with the server's loopback address. PASS — `pnpm exec vitest run apps/desktop/src/main/hub-session.test.ts --reporter=dot` (8 tests), `pnpm --filter @haus/desktop build`, `pnpm architecture:check` (581 source files), and `git diff --check`.

Samsung and the two Apple media integrations were cut over individually. Each disabled HA source was verified unloaded while its Haus counterpart remained online with media controls. Apple identities were matched through preserved hardware identifiers; the existing Haus names and rooms remain intact. Samsung's Haus name is Michael TV; the live registry does not provide its model. No playback, power or volume command was sent.

Meross LAN 5.8.0 was exported from the working source installation, validated as 66 bounded regular files and installed atomically in Miku's custom-component directory. An isolated network-disabled worker verified handler enumeration and its native configuration menu. Cleanup of that exact fixture container timed out and remains unverified. Desktop staged three disabled entries through its import dialog and displayed 100% progress. Each HA source was then unloaded before its Haus copy was enabled: the outdoor MSS620 plug (7 enabled entities), bedroom MSS425F surge protector (11), and Narnia MSL320CPR light (4). All three devices are online with power or lighting categories. Source entries and private pre-cutover snapshots remain available for rollback.

Desktop also imported Living Room Multi Switch Button 1 paused, with its Hue initial-press trigger and the exact Meross side-floodlight endpoint. After the HA source was verified off, Desktop's cutover action enabled the Haus rule and saved its migration receipt. The live inventory now contains 77 devices and 15 migrated automations. No physical button event or outlet action was generated. Six HA automations and the templated fade script remain on HA; Xiaomi BLE still needs a receiving radio on the target, and laundry rules need their threshold and Telegram paths.

## Google Cast, rule retirement and Eufy

Desktop staged Outdoor Weather and Transmission at 100%. Both Haus entries loaded and their HA entries were verified disabled and unloaded. Miku accepted v37 with its existing 2.75 CPU limit. The HA registry's software service marker now keeps Transmission categorized as a network service while retaining its 18 endpoints. Both Cast devices were matched by native Cast identifiers and moved to their original rooms. HA Cast cannot unload at runtime. The first attempt was rolled back after the same unsupported unload left Kitsune's worker in `failed_unload`. After the v37 restart cleared the worker state and a second HA Core restart verified the source unloaded, Haus Cast loaded and both devices remained online in Living Room and Narnia. The HA Eufy app stayed up during the Core restarts.

Fifteen HA source automations were removed individually after comparing each unchanged source configuration against the saved export, verifying the source off and checking that its Haus rule was enabled with a cutover receipt. Both the source config and entity were confirmed absent before recording each removal on Miku. Private exports and the removal journal retain the source configs. The rebuilt Desktop showed 15 enabled rules with the source removed status against Miku. HA's six remaining automations are enabled.

The camera migration first reproduced an empty Eufy inventory with the live 3.1.0 WebSocket server. Schema 13 and later sends serial strings in `start_listening`. Kitsune accepts them and gets each camera's name, model and capabilities from `device.get_properties`. It still accepts older object-shaped discoveries and rejects a mismatched serial. [Upstream WebSocket schema](https://github.com/bropat/eufy-security-ws/blob/master/docs/api_schema_versions.md).

Eufy Security now runs on Miku with the original account session. The HA integration is disabled and unloaded. Its app is stopped with manual boot and watchdog disabled. The Miku sidecar uses the pinned 3.1.0 image with a loopback-only listener and a private data directory. It runs as the directory owner with a 0.5 CPU limit. The Hub cannot access its mounted Docker socket (`EACCES`), so the sidecar is managed on the host for now. Cutover attempts rolled back when source stop verification, private volume access or the first snapshot failed. The final attempt verified a fresh JPEG, four serial-bound PTZ endpoints and advertised Talkback. The camera was moved to Outdoor. Haus recorded a 30.106-second event and served its MP4 with HTTP 206 byte-range playback. Physical PTZ, microphone-to-speaker audio and sustained motion recording remain unverified.

PASS — `pnpm exec vitest run apps/hub/test/camera/reconcile.test.ts apps/hub/test/nest/camera-integration.test.ts packages/kitsune/test/native/eufy.test.ts --reporter=dot` (20 tests, including offline state after a WebSocket disconnect). PASS — `pnpm --filter @haus/hub build`, `pnpm --filter @haus/desktop build`, `pnpm architecture:check` and `git diff --check`. Camera classification and disconnect reporting are locally verified and are being built into the next Miku image.

## Low-latency live viewing

The live Hub returned `camera_nvr_required` for WebRTC because the cluster had no remote streaming owner. Miku's colocated NVR now supplies the viewer through the authenticated loopback transport. Remote streaming assignments retain precedence. Local recording continues through the existing recorder, and Desktop falls back to HLS if WebRTC fails. On Eufy the tuned HLS player reduced median distance to the playlist edge from 3.13 to 2.44 seconds in two short Chromium samples.

The live Miku roll-forward mounted checksummed runtime modules on the existing Hub image with the 2.75 CPU cap. Chromium received video and audio from Outdoor, Guinea Pigs and Outdoor Side Camera. First frames after WebRTC signaling arrived in 1.96, 1.74 and 3.85 seconds respectively. Eufy reported two freezes in the short sample. Sensor-to-screen delay was unmeasured. The saved Eufy event played with an HTTP 206 MP4 range after the restart. The rebuilt Desktop restored its Miku session and showed all 15 enabled migrated automations.

PASS — `pnpm --filter @haus/hub typecheck`, `pnpm --filter @haus/hub build`, `pnpm --filter @haus/desktop build`, `pnpm architecture:check` and `git diff --check`. PASS — `pnpm exec vitest run apps/hub/test/camera/local-viewer.test.ts apps/hub/test/camera/sessions.test.ts apps/hub/test/camera/sessions-recording.test.ts apps/hub/test/camera/reconcile.test.ts apps/desktop/src/renderer/src/features/cameras/live-hls-recovery.test.ts apps/desktop/src/renderer/src/features/cameras/camera-lifecycle.test.ts --reporter=dot` (47 tests).

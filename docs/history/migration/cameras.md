# Camera migration evidence

Observed 2026-11-09. This slice maps and instruments the independent Kitsune camera source path only. It does not contact household cameras, replace a provider, or verify real streaming.

## Kitsune source discovery diagnostics — P18.3.1.1

The Hub composes `KitsuneCameras` with `@haus/media`'s `cameraSource` validator. Kitsune selects the recording and preview profiles from the plugin's stream options, requests the selected media object, extracts exactly one RTSP input, and validates it before attaching it as an independent camera source. `nvrCameraSource` prefers that validated source for Kitsune cameras; the existing authenticated registry/HA telemetry path and protected P2P path remain in place for other cameras. Public camera JSON strips `kitsuneSource`.

Previously, `KitsuneCameras.refresh()` discarded every exception silently. It now records the failed stage (`stream-selection`, `media-input`, or `source-validation`) and a bounded reason code. Repeated identical failures are deduplicated per plugin/device; a changed failure stage is reported once, and recovery emits one restoration event. Removal clears diagnostic state. The per-camera target is a stable truncated SHA-256 digest; diagnostics omit native device IDs, source URLs, credentials, and raw plugin errors. No playback or source-selection behavior changed.

Observed checks after implementation:

- PASS — `pnpm --filter @haus/kitsune build` and `pnpm --filter @haus/kitsune typecheck`.
- PASS — `pnpm exec vitest run packages/kitsune/test --maxWorkers=1 --reporter=dot --silent`: 5 files, 31 tests.
- PASS — `pnpm exec vitest run apps/hub/test/api/kitsune.test.ts apps/hub/test/nvr/camera/continuity.test.ts --maxWorkers=1 --reporter=dot --silent`: 2 files, 3 tests.
- PASS — `pnpm --filter @haus/hub typecheck`; focused Oxlint; changed-file Prettier; `pnpm architecture:check` (430 source files); `git diff --check`.

The tests cover bounded/sanitized diagnostics, deduplication and recovery, source secrecy at the Hub API, direct Kitsune source selection and existing camera continuity contracts. They do not establish that any physical plugin returns a valid RTSP stream, that live video/audio decodes, or that stream delivery is stable. Those remain P18.3.3 and P18.3.4 acceptance work.

## Snapshot receipt age and outage fallback — P18.3.2.1–2

The timestamp contract is intentionally split:

- `receivedAt` is assigned by the desktop only after the image response is fully read. The preview badge uses this value, so it describes when the frame arrived in Haus rather than the camera capture time.
- `capturedAt` comes from the trusted Hub snapshot header when valid. It is used to determine source freshness and the 30-second offline threshold; it does not replace the badge's receipt time.
- A failed refresh leaves the displayed frame and its receipt timestamp unchanged. A later valid transfer updates `receivedAt` even when the image bytes are identical.
- Hub cache fallback marks an old frame stale and preserves the original capture timestamp across memory/disk reads and restart. A discovered bridge path cannot silently fall through to a generated placeholder or another camera's capability.

Reviewed evidence:

- `apps/desktop/src/main/connection.test.ts` verifies receipt time separately from a 20-second-old capture timestamp, stale replies, cache reads and missing capture metadata.
- `apps/desktop/src/renderer/src/model/snapshot-age.test.ts` verifies failed refreshes do not renew the age badge.
- `apps/hub/test/camera/snapshots.test.ts` verifies exact-camera capability matching, request coalescing, stale fallback during outage/restart and preservation of the original capture time.
- `packages/media/test/snapshot.test.ts` and `apps/hub/test/camera/bridge.test.ts` cover strict bridge source matching, stale/captured metadata, ambiguity rejection and isolation of Supervisor authorization from the bridge request.
- `apps/hub/test/camera/sources.test.ts` verifies native camera availability follows its provider while its HA presentation graph can be absent; loss of native provider reachability marks it unavailable.

These are fixture-backed contract checks, not a live camera test. The one-provider controls and Activity projection slice is covered below; broad provider compatibility and live HA state/event propagation remain open under P18.3.2.3. Live video/audio and physical camera acceptance remain open under P18.3.3–4.

## Native controls and canonical Activity — P18.3.2.3.1

`apps/hub/test/ha/native-camera-controls.test.ts` composes production `NativeEntities`, `CameraActivity`, `cameraOperating`, and `cameraSpotlight` against mutable provider fixtures. The fixture applies night-vision and spotlight commands to the provider inventory; reads then confirm `off`/`auto` mode and spotlight brightness without relying on command acknowledgement alone. Raw provider motion is omitted from the projection. Assist/software activity updates the single canonical `haus_activity` entity; a generic native motion event is held while Assist is healthy and becomes the fallback on that same entity after Assist remains unavailable for over 30 seconds.

Observed checks:

- PASS — `pnpm exec vitest run apps/hub/test/ha/native-camera-controls.test.ts apps/hub/test/camera/activity.test.ts apps/hub/test/ha/activity.test.ts --maxWorkers=1 --reporter=dot --silent` (3 files, 13 tests).
- PASS — `pnpm --filter @haus/hub typecheck` and `pnpm --filter @haus/ha typecheck`.
- PASS — focused Oxlint and Prettier checks; no live Home Assistant, camera, provider, or NVR was contacted.

This closes only the fixture-backed provider projection/control slice. It does not verify physical device behavior, live HA state propagation, or every control/Activity combination; those acceptance gaps remain in P18.3.4.

## Native spotlight validation parity — P18.3.2.3.3

The native spotlight branch returned to its provider before applying the capability and range checks used by the HA-backed branch. `cameraSpotlight.write()` now validates the exact target, availability, command shape, advertised capabilities, and numeric ranges before dispatching to either provider. Invalid native writes fail without reaching the provider; valid brightness changes retain the native command path.

The regression test first failed on brightness 101 because the native path dispatched without rejecting it. After the fix, fixtures also confirm unsupported hue and a non-boolean `on` are rejected with zero provider writes, while an in-range brightness command is forwarded once.

Observed checks on 2026-11-10:

- PASS — `pnpm exec vitest run apps/hub/test/camera/spotlight.test.ts apps/hub/test/ha/native-camera-controls.test.ts apps/hub/test/camera/activity.test.ts apps/hub/test/ha/activity.test.ts --maxWorkers=1 --reporter=dot --silent` (4 files, 16 tests).
- PASS — `pnpm --filter @haus/hub typecheck` and `pnpm --filter @haus/ha typecheck`.
- PASS — `pnpm exec prettier --check apps/hub/src/camera/control/spotlight.ts apps/hub/test/camera/spotlight.test.ts docs/backlog/kitsune.md docs/history/migration/cameras.md` and focused Oxlint.
- No Home Assistant, camera, provider, or NVR endpoint was contacted.

## Camera stream teardown admission — P18.3.3.1

`CameraSessions.remove()` previously deleted a session from its admission maps before its ring and stream engine had stopped. A new camera could claim the freed slot while the old producer was still stopping. Also, a ring-stop failure skipped engine/peer cleanup and lost the session reference needed to retry.

Removal now marks the session closing, shares one in-flight teardown among concurrent callers, and retains the session (and its capacity reservation) until ring, engine and peer cleanup all succeed. Each cleanup stage is attempted even if an earlier one fails. Failed teardown remains visible and the one-second session tick retries it; same-camera acquisition waits for active teardown and refuses another producer if cleanup still fails. Failed startup uses the same cleanup path.

Observed checks on 2026-11-10:

- PASS — `pnpm exec vitest run apps/hub/test/nvr/camera/sessions.test.ts --maxWorkers=1 --reporter=dot --silent` (1 file, 8 tests). Fixtures hold ring/engine shutdown to prove concurrent close does not double-stop and acquisition cannot take the slot early; another fixture injects ring cleanup failure and proves engine cleanup still runs, reuse is refused, and the next tick retries successfully.
- PASS — `pnpm --filter @haus/hub typecheck`.
- PASS — focused `pnpm exec oxlint` and `pnpm exec prettier --check` for the changed source, test and plan files.
- No live camera, Home Assistant, provider, or NVR endpoint was contacted. Actual media open/close and interruption acceptance remains in P18.3.3–4.

## Media reader process-error recovery — P18.3.3.2

`CameraRing` previously treated every child-process `error` as a terminal ring failure. A transient FFmpeg spawn error therefore blocked the `close` handler's bounded reconnect path. It now records only the safe error code and lets `close` schedule the existing exponential backoff retry. Ring-capacity overflow remains terminal and still prevents another reader from starting.

Observed checks on 2026-11-10:

- PASS — `pnpm exec vitest run packages/media/test/ring.test.ts packages/media/test/recording/clock.test.ts --maxWorkers=1 --reporter=dot --silent` (2 files, 8 tests). The fixture injects `ENOENT`, checks that the reader restarts after the 500 ms initial backoff, and ensures the error message/source URL is not logged; a second case confirms ring-capacity failure stays terminal.
- PASS — `pnpm --filter @haus/media typecheck`.
- PASS — `pnpm exec oxlint packages/media/src/recording/ring.ts packages/media/test/ring.test.ts`.
- PASS — `pnpm exec prettier --check packages/media/src/recording/ring.ts packages/media/test/ring.test.ts docs/backlog/kitsune.md`.
- No live camera, Home Assistant, provider, or NVR endpoint was contacted. This fixture result does not establish live camera reconnect or audio behavior; those remain open in P18.3.3–4.

## Physical Side Camera controls and HomeKit pairing — P18.3.2.3.2

On 2026-11-09, the user confirmed that Status Light and Night Vision controls worked on Side Camera and that HomeKit linking completed successfully. This is user-reported acceptance of that camera's physical controls and pairing flow; it is not a fresh test run in this session and does not establish activity-sensor propagation or control support on other cameras. Those remain open under P18.3.2.3–4.

## Canonical Activity consumer acceptance — P18.3.2.3

The Hub's native-entity and MQTT projections share `CameraActivity`; only one owner publishes the HA sensor. `ActivityMqtt` withdraws its retained discovery when native HA owns that camera, and desktop normalization links the canonical sensor to its exact camera while suppressing only declared/replaced raw camera-motion entities. Native Assist validation, fallback, provider readback, and supported-control behavior are covered by the fixture slice above; the user separately accepted Side Camera Status Light, Night Vision, and HomeKit pairing.

Observed checks:

- PASS — `pnpm exec vitest run apps/hub/test/ha/native-camera-controls.test.ts apps/hub/test/ha/activity.test.ts apps/desktop/src/renderer/src/model/camera-activity.test.ts --maxWorkers=1 --reporter=dot --silent` (3 files, 9 tests).
- PASS — `pnpm --filter @haus/ha typecheck` and `pnpm --filter @haus/hub typecheck`.
- PASS — no live Home Assistant, camera or NVR endpoint was contacted.

This closes the contract-level P18.3.2.3 scope. It does not establish live motion propagation or every camera's physical behavior; per-camera field acceptance remains in P18.3.4.

## Remove implicit legacy camera sources — P18.3.1.2

The legacy native-camera registration path no longer embeds camera credentials, falls back to an HA host for Tuya RTSP, or registers synthetic Aqara/Tuya/Eufy cameras when their integration or source is absent. Aqara and Eufy require explicit source configuration. Tuya requires an explicitly configured bridge plus either an RTSP URL returned by that bridge or an explicit RTSP base URL for its relative stream path. Invalid or failed discovery is skipped with bounded logs that omit source URLs, provider payloads, and raw errors. Registration logs no longer echo camera-controlled names or model strings.

The fixture test covers missing integration configuration, a Tuya relative path without an RTSP base, valid explicit Aqara/Tuya sources, and failed Tuya discovery. It uses only fixture URLs and a stubbed `fetch`; no household HA, camera, or NVR endpoint was contacted. This verifies the legacy-registration contract, not live provider discovery or stream playback. A credential-bearing fallback was present in prior Git history; it is absent from the working source but remains in historical commits. Rotate the affected camera stream credential; history rewriting is not part of this change.

Observed checks:

- PASS — `pnpm exec vitest run apps/hub/test/nest/camera-integration.test.ts --maxWorkers=1 --reporter=dot --silent` (1 file, 6 tests).
- PASS — `pnpm --filter @haus/hub typecheck`.
- PASS — focused `pnpm exec oxlint` on the changed TypeScript files.
- PASS — focused `pnpm exec prettier --check` and `git diff --check`.

## Renew scoped camera access safely — P18.3.1.3

`CameraAccess.provision()` previously updated the stored grant before comparing its expiry with the cached authenticator. That made the comparison always observe the new expiry, leaving an old signature verifier cached after renewal. A client presenting the newly issued scoped key could then be rejected. Provisioning now compares the prior grant expiry before invalidating the verifier. Re-provisioning with the same expiry retains the verifier and nonce replay protection.

Observed checks:

- PASS — `pnpm exec vitest run apps/hub/test/nvr/camera/access.test.ts --maxWorkers=1 --reporter=dot` (1 file, 1 test; covers same-expiry replay protection, renewed-key acceptance, and superseded-key rejection).
- PASS — `pnpm --filter @haus/hub typecheck`.
- PASS — focused `pnpm exec oxlint` and `pnpm exec prettier --check` for changed files.
- PASS — no live HA, camera or NVR endpoint was contacted.

## Keep native camera controls in the standalone Hub — P18.3.4.1

Standalone camera sessions now use the enrolled native provider for advertised status-light, night-vision and spotlight controls. Reads retain imported capabilities when a provider is unavailable but mark them unavailable; writes require a reachable provider and currently advertised entity, dispatch through its command port, then refresh provider state. HA-backed control behavior remains selected for HA-owned cameras.

Fixture checks cover native indicator/night-vision mapping, provider readback, spotlight capabilities, ambiguous controls and refusal while offline. These checks do not establish physical behavior for every camera; per-camera acceptance remains open in P18.3.4.

- PASS — `pnpm exec vitest run apps/hub/test/camera/native-controls.test.ts apps/hub/test/camera/spotlight.test.ts apps/hub/test/camera/operating.test.ts --maxWorkers=1 --reporter=dot --silent` (3 files, 8 tests).
- PASS — `pnpm --filter @haus/hub typecheck`.
- PASS — focused `pnpm exec oxlint` and `pnpm exec prettier --check` for changed files.
- PASS — fixture-only; no HA, camera or NVR endpoint was contacted.

## Do not fabricate snapshots — P18.3.1.4

`DefaultCameraService` previously returned a valid-looking 1×1 JPEG when a configured camera had no source, capture failed, and no real frame had ever been cached. It now preserves the last real captured frame as stale, and otherwise throws `snapshot_unavailable` (mapped by the API to HTTP 503). This keeps an absent source from appearing as a successful snapshot. The fixture covers the no-source case; no physical camera or NVR endpoint was contacted.

- PASS — `pnpm --filter @haus/hub exec vitest run test/nest/camera-integration.test.ts --maxWorkers=1 --reporter=dot` (1 file, 7 tests).
- PASS — `pnpm --filter @haus/hub typecheck`.
- PASS — `pnpm exec oxlint apps/hub/src/camera/camera.service.ts apps/hub/test/nest/camera-integration.test.ts`.
- PASS — `pnpm exec prettier --check apps/hub/src/camera/camera.service.ts apps/hub/test/nest/camera-integration.test.ts`.

## Audit executable standalone camera composition — P18.3.4.1

The native-control fixture suite exercises `NativeCameraControls`, but source inspection shows it is composed only by `runtime/bootstrap.ts`. The executable `main.ts` starts `createHubService`, which calls `createNestApp`; its `AppModule` imports the default `CamerasModule`, binding `DefaultCameraService`. That service does not dispatch provider controls or open the NVR session path. Therefore the adapter fixtures do not prove native controls in the standalone Hub runtime. The plan item is reopened until the Nest composition is wired and exercised. No Home Assistant, camera, or NVR endpoint was contacted during this source audit.

This was the pre-fix audit finding. It is superseded by the Nest composition result below; the separate NVR source/session gap remains part of P18.4.

## Wire native controls into the standalone camera API — P18.3.4.1.2

`CamerasModule` now builds `CameraCatalog` from the shared TypeORM transaction provider, then composes `NativeProviders`, `NativeCameraSources`, `NativeCameraControls`, and `NativeCameraRuntime`. The runtime refreshes enrolled providers on bootstrap and every 15 seconds. `DefaultCameraService` projects imported native cameras and their advertised indicator, night-vision, and spotlight state through the authenticated camera API. Operating and spotlight writes route to the enrolled provider; offline, stale, or unsupported controls are refused. The spotlight endpoint validates its DTO before dispatch. No Home Assistant endpoint is needed for this standalone path.

The disposable Nest HTTP fixture imports a real temporary TypeORM catalog and the production `CamerasModule`, while replacing only the remote provider with a mutable in-memory fixture. It confirms camera listing/read state, indicator and spotlight dispatch, offline and unsupported refusal without dispatch, and invalid brightness rejection. This proves API/composition behavior without contacting a household provider, Home Assistant, camera, or NVR. Physical command effects and provider reconnect behavior remain unverified.

Observed checks on 2026-11-10:

- PASS — `pnpm exec vitest run apps/hub/test/camera/composition.test.ts --maxWorkers=1 --reporter=dot --silent` (1 file, 2 tests).
- PASS — `pnpm exec vitest run apps/hub/test/camera/native-controls.test.ts apps/hub/test/camera/spotlight.test.ts apps/hub/test/camera/operating.test.ts apps/hub/test/nest/cameras.test.ts --maxWorkers=1 --reporter=dot --silent` (4 files, 25 tests).
- PASS — `pnpm --filter @haus/hub typecheck`.
- PASS — focused Oxlint and Prettier checks for the changed camera sources/tests, and `git diff --check`.
- No household provider, Home Assistant, camera, or NVR endpoint was contacted.

## Same-host native bridge pairing — P18.8.2.2

Selecting a LAN-discovered Aqara/Tuya bridge now asks the Hub to pair it directly when the advertised host address belongs to the Hub's own network interfaces. The Hub verifies that the local loopback `/info` protocol version, provider and bridge identity match the selected mDNS bridge before requesting its one-use pairing code, then submits that code only to the pinned bridge endpoint. The code never crosses into the renderer. A remote bridge, mismatched/unsupported identity, or bridge without the local-code endpoint returns the existing manual address/code flow. Supervisor-managed add-on pairing retains its previous identity checks. This only enrolls a provider; it does not import cameras, start recording, or acknowledge/retire HA MQTT entities.

Observed checks on 2026-11-10:

- PASS — `pnpm exec vitest run apps/hub/test/providers/managed.test.ts --maxWorkers=1 --reporter=dot --silent` (1 file, 6 tests): managed pairing, same-host loopback identity, mismatched/unsupported identity, remote host gating, and manual fallback when local code generation is unavailable.
- PASS — `pnpm --filter @haus/hub typecheck`.
- PASS — focused `pnpm exec oxlint`, `pnpm exec prettier --check`, and `git diff --check`.
- No Home Assistant, camera provider, or NVR endpoint was contacted. Live same-host pairing and inventory import remain unverified.

### Executable Hub provider composition

The pairing controller previously had a service only in isolated test modules; the standalone Hub's actual `AppModule` left `PROVIDERS_SERVICE` undefined. The camera setup UI therefore could not reach the already implemented bridge discovery, pairing, preview, import, and removal logic. `ProvidersModule.forRoot()` now creates `NativeProviderService` from the shared `NativeProviders` and `NativeCameraSources` owned by the production `CamerasModule`. Manual enrollment validation now matches the UI's `{ url, code, allowHttp }` contract. HA-only handover/migration operations are optional capabilities and return explicit `501` on the standalone Hub instead of rejecting as an unhandled error.

Observed checks on 2026-11-10:

- PASS — `pnpm --filter @haus/hub exec vitest run test/providers/composition.test.ts test/providers/managed.test.ts test/nest/kitsune-providers.test.ts --maxWorkers=1 --reporter=dot --silent` (3 files, 27 tests). The production `createNestApp` fixture uses an isolated temporary catalog, confirms authenticated provider listing returns `200` with an empty list, and confirms unsupported operations return `501`.
- PASS — `pnpm --filter @haus/hub typecheck`.
- PASS — focused Oxlint, Prettier and `git diff --check`.
- No live bridge, Home Assistant, camera, or NVR endpoint was contacted. The Miku Hub catalog was observed empty for native providers; no bridge enrollment, camera import, live stream, or recording was verified.

## Serve native snapshots through Hub and desktop — P18.3.4.2

The authenticated Hub camera endpoint now resolves the enrolled native bridge's explicitly advertised last-live JPEG through the bounded LAN-only snapshot client. The Hub keeps the latest validated image in memory when a bridge becomes unreachable and reports its original capture timestamp as stale. Desktop fetches snapshots in the main process with the Hub bearer, rejects redirects, invalid image data and payloads over 6 MiB, deduplicates concurrent reads, and persists encrypted last frames keyed by `homeId`. A pending request is discarded if the active home changes or disconnects. The existing HA snapshot path is unchanged.

Observed checks on 2026-11-10:

- PASS — `pnpm --filter @haus/hub exec vitest run test/camera/composition.test.ts --maxWorkers=1 --silent` (1 file, 5 tests), including authenticated access, unknown camera, fresh capture time and stale fallback.
- PASS — `pnpm --filter @haus/desktop exec vitest run src/main/hub/connection.test.ts --maxWorkers=1 --silent` (1 file, 6 tests), including image bounds, concurrent reads, disconnect handling and home-scoped cache behavior.
- PASS — `pnpm --filter @haus/desktop exec vitest run src/main/camera-snapshot-cache.test.ts --maxWorkers=1 --silent` (1 file, 5 tests), including a maximum-size JPEG after base64 expansion. The cache limit now accounts for the encoded data-URL prefix instead of rejecting an otherwise valid 6 MiB frame.
- PASS — Hub and desktop typechecks, `pnpm --filter @haus/media exec vitest run test/snapshot.test.ts --maxWorkers=1 --silent` (1 file, 3 tests), focused Oxlint/Prettier, `pnpm architecture:check`, and `git diff --check`.
- No household camera provider or live camera endpoint was contacted. The Hub has no enrolled native camera source, so physical snapshot delivery remains unverified; keep P18.3.4.2 open pending enrollment and live acceptance.

### Miku bridge availability check

On 2026-11-10, read-only inspection of Miku's local Aqara bridge returned protocol v2 identity and a manifest containing two cameras. Both advertised `snapshot/last-live` endpoints returned `404`; this endpoint reads only an already-cached real frame and does not start or wake a P2P stream. A `404` therefore means there was no cached frame at that moment, not that the camera or bridge was offline. The standalone Hub provider catalog is still empty, and the Haus desktop was showing its disconnected-home screen, so discovery, pairing, import, identity/archive comparison, and end-to-end snapshot delivery could not be completed. No camera stream, recording, Home Assistant state, or provider ownership was changed.

- Observed: bridge protocol v2 reachable; two Aqara cameras listed; no cached last-live image for either at the time of the read.
- Not verified: provider enrollment, camera import, frame delivery through Hub/desktop, live video/audio, and recording continuity.
- Keep P18.3.4.2 open until enrollment and a real frame are accepted without changing the existing NVR archive associations.

### Read-only mDNS discovery check — 2026-11-11

The built Hub discovery implementation found Miku's `rsnra-camera` advertisement from the Haus workstation and validated the bridge's v2 identity (`aqara`, `Aqara Camera Bridge`). The Hub binary on Miku was healthy, but the Haus desktop itself was still at first-Hub onboarding with no paired session. GET requests to the bridge's `guinea-pigs` and `outdoor` `snapshot/last-live` routes both returned `404` with no image bytes; they do not start P2P. MQTT publication, Hub provider catalog, camera stream state, and NVR archives were not changed.

- PASS — `dns-sd -B _rsnra-camera._tcp .` observed the bridge advertisement; `node --input-type=module -e ...` from `apps/hub` ran the built `discoverProviderBridges` implementation and returned the validated Aqara identity at Miku.
- PASS — read-only HTTP status checks for both last-live paths returned `404`.
- PASS — `pnpm --filter @haus/hub exec vitest run test/camera/sources.test.ts test/camera/bridge.test.ts test/providers/native.test.ts --maxWorkers=1 --reporter=dot` (3 files, 7 tests); the import fixture retains the exact NVR recording `camera_id`, camera settings and aliases, and rolls back ambiguous identity matches.
- Not verified — pairing the desktop with Miku, enrolling the bridge, importing cameras while retaining recording IDs, and delivery of a real cached frame.

## Confirm standalone native spotlight writes — P18.3.4.1.3

Native spotlight commands previously hid provider refresh errors and returned success after bridge acknowledgement, before confirming the refreshed inventory reflected the requested light fields. The standalone Hub now propagates refresh failures and polls provider inventory for up to six seconds after one command dispatch. It returns `camera_control_unconfirmed` if the state remains stale and never retries the physical write. Tests cover immediate and delayed readback, stale-state timeout without replay, and refresh failure.

Observed checks on 2026-11-10:

- PASS — `pnpm exec vitest run apps/hub/test/camera/native-controls.test.ts apps/hub/test/camera/spotlight.test.ts --maxWorkers=1 --reporter=dot` (2 files, 10 tests).
- PASS — `pnpm --filter @haus/hub typecheck`.
- PASS — focused `pnpm exec oxlint` and `pnpm exec prettier --check` for the changed Hub source and test.
- No live Home Assistant, camera provider, camera, or NVR endpoint was contacted. Physical spotlight actuation remains unverified.

### Spotlight readback through the transformed Nest DTO — 2026-11-11

The Nest validation pipe materializes omitted optional spotlight fields as own properties with `undefined` values. The readback comparator treated those fields as requested and waited until timeout even when the provider had applied the requested brightness. It now compares only fields with actual values. The production Nest composition fixture exercises the transformed HTTP DTO, applies a brightness change, and confirms acceptance from provider state; stale state still times out without replaying the physical command.

- PASS — `pnpm --filter @haus/hub exec vitest run test/camera/composition.test.ts test/camera/native-controls.test.ts test/camera/spotlight.test.ts --maxWorkers=1 --reporter=dot` (3 files, 15 tests).
- PASS — `pnpm --filter @haus/hub typecheck`.
- PASS — focused `pnpm exec oxlint` and `pnpm exec prettier --check` for the modified camera files.
- No live provider or camera was contacted; physical spotlight actuation is still unverified.

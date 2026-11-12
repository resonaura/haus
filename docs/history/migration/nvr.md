# Unified Hub NVR composition — 2026-11-10

The standalone `apps/hub` runtime can now compose NVR inside the same Nest listener. `HAUS_NVR_DATA_DIR` independently selects mutable NVR state and archive root while Hub identity/app data stays under `HAUS_DATA_DIR`. When NVR roles are enabled, the Hub advertises `_haus-hub._tcp` and `_haus-nvr._tcp` on the bound listener using one mDNS responder lifecycle. App Supervisor MQTT URLs resolve the actual listener port after bind, including ephemeral-port local runs.

Checks passed:

- `pnpm exec vitest run apps/hub/test/runtime/application.test.ts apps/hub/test/runtime/config.test.ts apps/hub/test/runtime/discovery.test.ts apps/hub/test/standalone/supervisor.test.ts --maxWorkers=1 --reporter=dot --silent --testTimeout=15000` — 4 files, 26 tests.
- `pnpm --filter @haus/hub typecheck`
- `pnpm --filter @haus/hub build`
- `pnpm --filter @haus/apps typecheck`
- `pnpm --filter @haus/apps build`
- Relevant image/App lifecycle test slice — 7 files, 43 tests; see [image acquisition evidence](images.md).
- `git diff --check`

The legacy NVR services on Black Laptop and Miku remain stopped, restart-disabled and undeleted. Miku's Hub remains on its previous healthy build without NVR roles; no camera source or recording writer has been moved. Existing Miku state/archive paths remain `/var/lib/haus-nvr-hot/live` and `/mnt/backup/haus-nvr/live/blobs`. Home Assistant received no writes. This code slice does **not** establish a real Hub/NVR deployment, stream capture, audio, playback, or archive continuity; P18.4.1–3 remain open until the unified build is deployed with preserved paths and checked against the archive without concurrent writers.

## Catalog migration check — 2026-11-10

Copied `/data/recordings.sqlite` out of Miku's stopped `haus-nvr` container to a local temporary directory, then ran the current compiled Hub's `openRecordings` migration only against a second disposable copy. `PRAGMA integrity_check` returned `ok` on the source copy and on the migrated copy while open and after close. All 734 `recordings` rows, including their IDs, digests, timestamps and serialized values, had the same SHA-256 aggregate before and after migration. The source NVR container/database and archive were not modified; temporary copies were removed after the check.

This proves that the current additive ORM migration can open this catalog without changing its recording rows. By itself, it does not prove referenced blob availability, file contents or deployed recording/playback recovery. The separate metadata-only path audit below verifies that all referenced files currently exist and are readable. P18.4.3 remains in progress; the new Hub still has no NVR role or camera source.

The same read-only audit ran in a disposable, network-disabled container using the NVR image already present on Miku. The container mounted `/var/lib/haus-nvr-hot/live` and `/mnt/backup/haus-nvr/live/blobs` read-only and used the runtime `node` UID. All 1,450 unique `digest`/`originalDigest` paths referenced by 734 catalog rows were readable regular files with non-zero sizes (about 20.0 GB total referenced file size); none were missing or malformed. This only checked metadata/existence, not file contents, full digest correctness or successful playback, and did not start either NVR service. Miku's Hub remained healthy on port 8790 without NVR roles; Home Assistant was untouched.

## Abrupt Hub/NVR process recovery — 2026-11-10

Ran the v10 image on Miku's Docker engine with `storage,stream` roles, `--network none`, disabled mDNS, a synthetic key and temporary Hub/NVR roots on container tmpfs. The stopped NVR data directory was mounted read-only; only `recordings.sqlite` was copied into the disposable NVR root. The first process returned healthy standalone `/health`, was killed with `SIGKILL`, and a second process started against the same temporary database and returned healthy standalone `/health` before clean shutdown.

`PRAGMA integrity_check` returned `ok` before startup, after the forced kill, and after the second boot. All 734 recording rows had the same SHA-256 aggregate (`fbfb3e7f4f8adfcf4634eaff417711553b800b0887da435b1dfe6edbed2508d2`) across all three snapshots. The production DB mount was read-only; no live Hub/NVR writer, Home Assistant, camera source, blob mount or playback request was involved. The temporary container and tmpfs were removed.

This proves SQLite/catalog-row recovery through an abrupt process restart on a disposable copy. It does not verify file permissions, archive blobs after a writer crash, media recovery/finalization or a production handover; P18.4.3 remains open.

## Isolated standalone Hub/NVR startup — 2026-11-10

Started the current compiled Hub locally with `HAUS_ROLES=storage,stream`, synthetic key, temporary Hub and NVR roots, loopback HTTP bind, ephemeral port and Hub mDNS advertising disabled. The Hub logged its bound port and `/health` returned `status: ok`, `mode: standalone`, `ha: false`. Hub and NVR state directories initialized; the process exited 0 on SIGTERM and the temporary directory was removed. The Nest bootstrap was not network-isolated: `MatterService` logged a successful connection and device discovery, but the smoke did not capture whether `HAUS_MATTER_URL` or injected Matter options were set. Current source has no default endpoint; only explicit configuration can create its transport. The observation therefore does not prove an implicit fallback and is superseded for the unconfigured case by the isolated v10 smoke recorded in [Matter evidence](matter.md). The smoke script issued no device-control requests. The native MQTT broker also briefly listened on `0.0.0.0:1883`, then logged that it stopped; a follow-up `lsof -nP -iTCP:1883 -sTCP:LISTEN` returned no listener. This verifies same-process role startup and shared-listener health only. Source acquisition, recording, audio, playback and archive handover are unverified.

## Miku handover preflight — 2026-11-10

At this preflight, read-only Docker inspection confirmed Miku's legacy `haus-nvr` (`0.3.46`) was `exited` with restart policy `no`. The healthy `haus-hub` was on v8, host networking, port `8790`, and its existing `/home/resonaura/.local/share/haus-hub` data root; its environment had no NVR roles. A later short-lived v10 run was discovered and is recorded below.

The legacy NVR state root is `/var/lib/haus-nvr-hot/live`; its separately mounted archive is `/mnt/backup/haus-nvr/live/blobs`. The catalog/settings files are owned by UID 1000 with private modes, matching the `node` runtime user in both the old NVR and locally built v10 Hub images. The persisted `settings.json` has `storageLimitBytes: null`; although the stopped container retains `HAUS_MAX_STORAGE_GB=20`, the persisted user policy takes precedence, so the effective configured cap is unlimited. `/mnt/backup` reports 134 GB free of 5.5 TB (98% used); physical free-space safeguards must remain enabled.

The local v10 Hub image is present for `linux/amd64`. This preflight records the old state/archive mount points; it does not prove a handover. Home Assistant received no writes, and camera streaming/recording/playback on v10 remain unverified.

## Short-lived Miku v10 run — 2026-11-10

Current-state inspection found a v10 `haus-hub-failed-nvr-20261110` container that ran `node dist/main.js` from 22:25:43Z to 22:26:05Z and exited 0. It mounted the live Hub data directory, the stopped NVR state, the archive and the Docker socket with read-write access; it was not an isolated smoke run. The container is now stopped; Miku's existing v8 Hub remains healthy without NVR roles, and the legacy `haus-nvr` remains stopped. Do not repeat a dual-Hub run against the shared data directory.

Read-only post-run metadata inspection found all visible NVR state-file mtimes before the run; `recordings.sqlite` remained 3,829,760 bytes with mtime 12:53Z. The archive contained 1,541 non-empty regular digest files, none modified since the v10 start (latest mtime 2026-11-08 06:23:04Z). This is metadata evidence only: it does not prove byte-for-byte content equality or that the shared Hub database was untouched. No media playback, stream, or recording acceptance was performed.

## Local warm-stream pre-roll and Activity compatibility — P18.4.2.1

Ran the native camera engine against synthetic loopback video/audio using the existing `.cache/media-native/haus-camera-media` binary. Its prewarmed shared RTSP feed produced a native WebRTC answer and a finalized clip containing audio plus video before the trigger. Separate Hub fixtures exercised the configured eight-second Activity Assist pre-roll, same-event adoption by native and software detections, MP4 import and durable catalog acknowledgement ordering.

Observed checks on 2026-11-10:

- PASS — `HAUS_CAMERA_MEDIA_BIN=$PWD/.cache/media-native/haus-camera-media pnpm exec vitest run packages/media/test/native --maxWorkers=1 --reporter=dot --silent` (10 files, 13 tests, zero skips).
- PASS — `pnpm exec vitest run apps/hub/test/nvr/camera/activity.test.ts apps/hub/test/camera/motion/activity.test.ts apps/hub/test/camera/sessions-recording.test.ts --maxWorkers=1 --reporter=dot --silent` (3 files, 15 tests).
- All media sources were synthetic and loopback-only; no Home Assistant, household camera, production NVR or archive was contacted or modified. This does not prove deployed playback, continuous physical audio, or storage-limit behavior; P18.4.2 remains open.

## Playback and storage-boundary fixtures — P18.4.2.2

The co-hosted Hub/NVR transport is covered end-to-end on disposable roots: signed blob requests preserve exact bytes, valid byte ranges return `206`, malformed/out-of-bounds ranges return `416`, and open readers hold a blob lease until the response disconnects. Storage fixtures cover unlimited-by-default policy, explicit user quotas, persisted settings/restart, upload and transient reservations, and rejection without deleting existing blobs. Recording fixtures cover finalization under segment jitter/growth, bounded finalizer capacity, and late-segment grace periods.

Observed checks on 2026-11-10:

- PASS — `pnpm exec vitest run apps/hub/test/nvr/transport.test.ts apps/hub/test/nvr/storage/protocol.test.ts apps/hub/test/nvr/storage/verification.test.ts apps/hub/test/nvr/storage/settings.test.ts apps/hub/test/nvr/recording-index.test.ts --maxWorkers=1 --reporter=dot --silent` (5 files, 25 tests).
- PASS — `pnpm exec vitest run packages/media/test/recording/budget.test.ts packages/media/test/recording/growth.test.ts packages/media/test/recording/jitter.test.ts --maxWorkers=1 --reporter=dot --silent` (3 files, 5 tests).
- Fixtures use disposable local storage and loopback HTTP only. They do not prove deployed archive playback, physical-camera recording, or Miku's effective runtime quota; those remain open in P18.3.3–4 and P18.4.1–3.

## Unified Hub/NVR cutover on Miku — 2026-11-10

Built `haus-hub:0.3.76-miku-unified-20261110-v11` from the existing v8 runtime image with the local Apps/Kitsune/Hub overlay. A separate `--network none` smoke used only temporary container tmpfs roots and a synthetic key; health returned `ok` and signed `/v1/status` returned both `storage` and `stream` roles.

Before cutover, the Hub v8 container was stopped cleanly and its Hub root plus the NVR state root (excluding the separately mounted blob archive) were snapshotted to `/mnt/backup/haus-migration/unified-hub-v11-20261110/`. The directory is mode `0700`; the tar files are mode `0600`. Both tar files were readable and hashed. SQLite integrity checks on disposable copies of the stopped Hub databases returned `ok`; the NVR catalog copy returned `ok` with 734 rows. No video blobs or Home Assistant data were copied, moved, or deleted.

Exactly one production Hub now runs v11 on Miku. It retains `/home/resonaura/.local/share/haus-hub`, `/var/lib/haus-nvr-hot/live`, `/mnt/backup/haus-nvr/live/blobs`, the existing read-only node key and host telemetry collector. `/health` reports standalone `ok`; signed `/v1/status` reports node ID `home-media-server`, roles `storage,stream`, the same NVR instance ID, four stream slots, host telemetry, and storage rooted on the 5.9 TB Backup filesystem. At observation it reported about 30.6 GB used and 143.4 GB free on Backup; the separate NVR workspace reported about 20.7 GB available on the system filesystem. The legacy `haus-nvr` and preserved v8 Hub are stopped with restart policy `no`; the active v11 Hub uses `unless-stopped`.

Live signed `/v1/recordings` pagination returned all 734 existing records across four pages. A signed byte-range request against the latest record's existing blob returned `206` and 128 bytes; the archive still contained 1,541 non-empty blob files at the time of handover. This verifies deployed catalog visibility and a small archive read, not full video decoding or sustained playback.

The v11 startup log also reported that Outdoor and Guinea Pigs have no camera source configured; both are skipped by the camera integration service. No live camera session or new physical-camera recording was verified. The HA runtime was not changed. Therefore the one-process storage/playback handover is in place, while P18.4.1's camera-source/live-recording acceptance and P18.4.2 remain open.

## Native media-controller composition gap — 2026-11-11

P18.9.2.1.2.3.2 established native Aqara Home/source identity and archive preservation on Miku v15, with real source frame/audio/snapshot checks. That is not capture/viewer acceptance. Source tracing for P18.4.1.4 shows `createHubService` composes `NvrRuntime`/`composeMedia` and the Nest application, but does not run the legacy `runtime/bootstrap.ts` coordinator. `DefaultCameraService` still holds independent warm/viewer maps, returns a placeholder viewer answer for registered legacy cameras, and has an optional legacy Recorder that is not provided by CamerasModule. Its manual-record path only checks its registered-camera map, unlike its native snapshot path. The native-only recording/viewer API path has not been exercised live; it needs a disposable failing composition fixture before implementation.

Reuse the existing NVR `CameraSessions`, `CameraRing`, recording outbox/index and media runtime. Do not start the legacy bootstrap or another producer to conceal the gap. Trace actual desktop `node-viewer.ts` signaling and `HausHelper` owner injection: the caller expects an answer envelope/candidates and closes with its own viewer ID. Preserve lease ownership, actual WebRTC negotiation, audio, pre-roll, cancellation and shutdown. Review continuity/source rotation before taking a source away from another owner. Next acceptance must read an actual newly captured durable clip under the original camera/archive ID; the old 734-row invariant alone is insufficient.

## Native media controller composition in Nest — P18.4.1.4

Resolved the native camera media controller composition gap in Nest `apps/hub`:

1. **Camera Media Coordinator (`apps/hub/src/camera/control/media.ts`):** Implemented `CameraMediaCoordinator` to bridge `DefaultCameraService` with `NvrCameraSessions`, `WarmStreams`, and `Recorder`. Camera resolution scans `sessions.camera()`, `nativeCameras.cameras()`, and legacy registered cameras.
   - `viewerOffer`: calls `sessions.viewer(...)` returning `{ answer, candidates, type, sdp }` to satisfy both desktop `node-viewer.ts` envelope expectations and legacy direct answer callers.
   - `closeViewer`: delegates viewer termination and cleanup to `sessions.closeViewer(...)`.
   - `touchWarm`: delegates stream keepalive to `WarmStreams.touch(...)` / `sessions.touch(...)`.
   - `triggerRecording`: resolves native camera identity and triggers `recorder.trigger(cameraId)` with `recording_worker_unavailable` mapping.
2. **Nest Runtime Wiring (`apps/hub/src/events/runtime.module.ts`, `apps/hub/src/camera/camera.service.ts`):** Injected optional `RECORDING_SESSIONS` (`NvrCameraSessions`), `WarmStreams`, and `Recorder` into `DefaultCameraService`. Exported `NvrCameraSessions` and `WarmStreams` from `RecordingRuntimeModule`.
3. **Controller Error Mapping (`apps/hub/src/camera/camera.controller.ts`):** Mapped `camera_viewer_not_found` to 404, `invalid_camera_viewer` and `invalid_camera_candidate` to 400, and `camera_viewer_busy`, `camera_viewer_closed`, `camera_viewer_exists` to 409 (`ConflictException`).
4. **Verification:**
   - PASS — `pnpm exec vitest run apps/hub/test/nest/camera-integration.test.ts apps/hub/test/camera/composition.test.ts apps/hub/test/nest/recording-runtime.test.ts` (3 files, 23 tests).
   - PASS — Full `@haus/hub` test suite (179 test files passed, 1 skipped; 886 tests passed, 3 skipped).
   - PASS — Full workspace typecheck (`tsc --noEmit`), architecture boundaries (443 files), Oxlint (0 warnings/errors), Prettier formatting, and `git diff --check`.
   - Note: Physical live stream capture on Miku hardware remains to be executed under an authorized bounded capture task.

# App image resolution — 2026-11-10

Standalone App installation now checks compatible local images before doing network work. It matches the Docker daemon's Linux architecture against the App manifest, prefers an existing published tag or pinned-recipe cache, and creates the container from the resolved content-addressed image ID. If no compatible local image exists, it pulls the declared published image for the daemon platform. A source build is allowed only after that fails and only with a manifest recipe pinned to a full public GitHub commit plus validated relative context and Dockerfile paths.

The install response and retained progress endpoint report image source/digest, acquisition stages, and stable registry/build/create/start error codes. Docker progress streams are bounded and expose only byte totals; raw daemon error text and build URLs are not returned. No general image delete, Docker proxy, inferred build context, or deployed image was added.

Checks: `pnpm --filter @haus/apps typecheck` and `pnpm --filter @haus/apps build` pass. `pnpm exec vitest run packages/apps/test/image.test.ts packages/apps/test/docker.test.ts packages/apps/test/lifecycle.test.ts packages/apps/test/manifest.test.ts packages/apps/test/environment.test.ts apps/hub/test/standalone/apps.test.ts apps/hub/test/standalone/supervisor.test.ts --maxWorkers=1 --reporter=dot --silent` passes (7 files, 43 tests). The isolated tests cover acquisition order, architecture mismatch, pinned-build fallback, digest selection, install progress/lifecycle, and the Docker socket protocol. The install-progress route is implemented but not directly exercised by this suite. **Not verified:** pulling from a real registry, building a real GitHub recipe, or deploying/restarting any household App.

The App Manager's local/published-image-first behavior applies to declared Apps; it does not automatically choose an image for the Hub's own Docker deployment. An earlier pnpm deploy layer on Miku reached only 28/300 packages after about 200 seconds and was canceled. The checked-in overlay path below replaces that slow step by reusing the installed runtime and native dependencies from a compatible base image.

## Preserve cancellation during image acquisition — P18.9.1.1

`AppImageAcquirer` now observes abort signals across host inspection, local image inspection, registry pull, post-pull inspection, source build and final inspection. Cancellation returns the stable `app_operation_cancelled` code even when a Docker operation races it with a generic transport error. A canceled registry pull cannot be mistaken for a missing image and trigger a source build; a canceled build is not reported as `app_build_failed`. Progress callbacks stop after cancellation.

Observed checks on 2026-11-10:

- PASS — `pnpm exec vitest run packages/apps/test/image.test.ts --maxWorkers=1 --reporter=dot --silent` (1 file, 7 tests), including pull-cancellation/no-build and cancellation-during-build cases.
- PASS — `pnpm --filter @haus/apps typecheck`.
- PASS — `pnpm exec oxlint packages/apps/src/image.ts packages/apps/test/image.test.ts`.
- PASS — `pnpm exec prettier --check packages/apps/src/image.ts packages/apps/test/image.test.ts docs/backlog/kitsune.md docs/history/migration/cameras.md docs/history/migration/images.md` and `git diff --check`.
- This covers cancellation once an `AbortSignal` is supplied to image acquisition. The current install lifecycle/UI does not yet expose end-to-end cancellation; P18.9.1 remains in progress.

## Hub image overlay and isolated NVR startup — 2026-11-10

Added `pnpm --filter @haus/hub image:overlay -- --context NAME --base IMAGE --tag IMAGE`. It checks that the base is Linux and that its Hub, Apps, and Kitsune package versions match the workspace, builds the three compiled packages locally, then copies only their package manifests and `dist` trees into the base image. The generated Docker build runs offline and preserves the base image's production dependencies and native modules. It also rejects a base artifact missing the independent NVR data-root and shared Hub/NVR mDNS contracts.

On Miku, the command built `haus-hub:0.3.76-miku-supervisor-20261110-v10` from the existing v8 runtime image. The image is `linux/amd64`; the prebuilt package versions matched the workspace (`0.3.76`, `0.1.0`, `0.1.0`).

An isolated smoke run used that image with `storage,stream` roles, a synthetic key, temporary Hub/NVR directories on container tmpfs, no network, disabled mDNS, and the stopped NVR data directory mounted read-only. The source catalog was copied into tmpfs before startup. The Hub returned `/health` with `status: ok`, `mode: standalone`, and `ha: false`; after shutdown, SQLite integrity remained `ok` and all 734 recording rows matched their pre-start SHA-256 (`fbfb3e7f…2508d2`). No blob mount or playback was involved. This was a disposable smoke run; a later short-lived Miku run is documented below.

This verifies a fast, repeatable packaging route and same-process Hub/NVR startup against a disposable catalog copy. It does not configure camera sources, record or play media, or validate archive continuity during a real handover. A later short-lived v10 run on Miku is described below; the active Hub remains v8 without NVR roles and the legacy `haus-nvr` remains stopped.

## Short-lived Miku v10 run — 2026-11-10

Current-state inspection found container `haus-hub-failed-nvr-20261110`: v10 image, command `node dist/main.js`, started at 22:25:43Z, exited 0 at 22:26:05Z. Its mounts included the live Hub data directory (`/data`), the stopped NVR state (`/nvr`), the archive (`/nvr/blobs`), and a read-write Docker socket. These were not isolated or read-only mounts. The container is stopped; the existing v8 Hub is healthy and the legacy NVR is stopped. Do not repeat a dual-Hub run against the shared `/data` directory.

A read-only metadata audit after that run found that all visible NVR state-file modification times predate the v10 start. The catalog remained 3,829,760 bytes with its observed modification time at 12:53Z. All 1,541 digest-named archive files were non-empty regular files; none had a modification time at or after the v10 start (latest observed blob mtime: 2026-11-08 06:23:04Z). This is metadata evidence, not a post-run content rehash or proof that the shared Hub database was untouched. No stream, recording, or playback acceptance was established by the short run. P18.4.1–3 remain open.

## Native graph artifact preparation — 2026-11-11

The overlay script now includes compiled Core, Bridge, MQTT and Media alongside Apps, Kitsune and Hub, builds them in dependency order, and checks all their versions against the base image. It preserves the existing Linux media/vision binaries. Bridge has only subpath exports, so its package is resolved through `@haus/bridge/protocol` and its artifact entry is `protocol.js`.

Read-only inspection initially found the production v11 Hub healthy, Aqara 1.6.39 running, and the legacy NVR stopped. System free space was ~20 GB; Backup and Data each had ~128 GB available. Production Hub mounts remain the existing Hub root, NVR hot state, separate Backup blob archive, read-only key/telemetry and Docker socket.

The first `pnpm --filter @haus/hub image:overlay --context haus-miku --base haus-hub:0.3.76-miku-unified-20261110-v11 --tag haus-hub:0.3.76-miku-native-20261111-v12` attempt failed in its isolated version probe with `ERR_PACKAGE_PATH_NOT_EXPORTED`; the Bridge export path was corrected. The second attempt reached another isolated `--network none --read-only` version probe but was canceled before a build result when the existing v11 Hub became unhealthy. Only that local builder and its Docker client were terminated; the production Hub and other household services were not restarted or stopped.

Observed diagnostics: production `/health` timed out after five seconds; Docker health showed repeated five-second probe timeouts. `/proc/pressure/io` reported ~90% `some` and ~69% `full` over ten seconds, and the Hub's Node thread was in `blk_mq_get_tag`. Available RAM was ~6.6 GiB. Kernel warning logs for the sampled five minutes returned no entries. This establishes storage-I/O stalls, not a proven cause, disk failure or a causal link to the version probe. No new Hub code was deployed or pointed at live data.

A later bounded HTTP recheck returned `status: ok`, `mode: standalone`, `ha: false` without restarting the Hub. Ten-second I/O pressure fell to ~32% `some` / ~23% `full`, still elevated. Sustained recovery and a completed artifact build remain to be checked.

PASS — focused Prettier and Oxlint for the updated deployment script. **Not verified:** completed v12 image, isolated catalog smoke, producer artifact/capability migration, deployment, or household native camera acceptance. P18.9.2.1.2.3 remains in progress; recheck host/Hub health before further remote artifact work.

## v12 isolated acceptance and Miku cutover — 2026-11-11

Subsequent delivery supersedes the preparation-only state above. The overlay build completed as `haus-hub:0.3.76-miku-native-20261111-v12`, image ID `sha256:bc1c34217c29b4ff31e82bd7eab87aa1c7eb585956e4e5e6c46f1f5f1e60cb4f`. It includes all seven changed workspace artifacts and preserves the Linux native dependencies.

PASS — a disposable, read-only-root container with no network copied the Hub and NVR catalogs into tmpfs through the existing TypeORM snapshot helper. The Hub/NVR process started with synthetic credentials and storage/stream roles, became healthy, and exited 0. Both catalogs passed integrity checks. All 734 recording rows retained SHA-256 `1a9b37f00dd1ca1c479fdd3622f3edfcbf79e35ed34edde589cd502a3904c69b`; the selected Home identity/reference summary also remained unchanged. No archive blobs, Docker socket or real node key were mounted for this smoke.

The production cutover stopped the old Hub before snapshotting and replacing it. It preserved the exact runtime mounts, key, network, user/group, restart policy and command. An initial attempt used an approximately 25-second readiness deadline, shorter than the image's 45-second start period, and restored v11 automatically. The candidate's only observed exception was AbortError after termination during startup. The corrected 180-second deadline allowed the next v12 attempt to become healthy. Do not interpret that first cancellation as an independently established application crash.

PASS — after cutover, read-only TypeORM inspection found NVR integrity `ok` and the same 734-row hash. Authenticated NVR status returned HTTP 200, node `home-media-server`, instance `8faee10e-3cd7-4856-b694-1a8cdacbf3c9`, and storage/stream roles. An existing recording returned HTTP 206 with a 128-byte range. This proves catalog continuity and one readable archive range, not full playback or a video-content audit.

The stopped rollback is `haus-hub-v11-before-native-1794395272917` with restart disabled. Private stopped-state snapshots are on Miku under `~/.local/share/haus-migration/native-v12-1794395272917`. The separate legacy NVR remains stopped. No HA configuration or household controls changed. Aqara producer delivery, exact archive mapping and native preview/control/recording acceptance remain in P18.9.2.1.2.3.

## Native control artifacts — 2026-11-11

The follow-up v13 image was built but not deployed after an additional protocol-client regression exposed omitted request IDs. The corrected artifact is `haus-hub:0.3.76-miku-controls-20261111-v14`, image ID `sha256:ada16d1ef500a793a37fbc5f5a16b0f4276e45312b19454973f314c14dde7f2d`. It is running healthy after the same single-writer cutover procedure. Rollback is `haus-hub-v12-before-controls-1794413421698`; stopped-state snapshots are under `~/.local/share/haus-migration/controls-v14-1794413421698`.

Aqara's follow-up image is `haus-aqara:1.6.39-native-20261111-v2`, image ID `sha256:89169623aa2779e405f10cbc5e002ec2e7c413bec1ece40eaff45d7e5cc92640`. Its private stopped-state snapshot and old container are retained under migration stamp `1794413143185`. The App metadata, container/image identity and native endpoint declaration were updated together while the Hub was stopped, then reloaded on restart. The source patch digest is `b5e4b65dfbaf93c1b43ba6a36fe55782c66d1ab578d7300f46cab8bd69a1c9c5` against Aqara base source `ad5d97b8e4fde42db64957180a7253a77d63ee0a`.

PASS — v14 post-cutover read-only TypeORM integrity check, all 734 recording rows with the same `1a9b37f0…04c69b` hash, authenticated NVR status on the unified port 8790 with the same node/instance and storage/stream roles, and HTTP 206 / 128-byte archive range. Aqara's actual native stream/video/audio/snapshot checks are recorded in [Apps history](apps.md#stopped-video-controls--p18921231). No working HA configuration or original archive data was changed. Native Home graph handover and legacy duplicate migration are not yet accepted.

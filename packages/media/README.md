# @haus/media

Shared TypeScript ESM media processing for Haus: audio and video pipelines, recording, camera media, and streaming. Hosts remain responsible for source ownership, user policy, persistence, and HTTP routes. The package has no application imports.

Source is grouped by responsibility: `audio/`, `camera/`, `pipeline/`, `recording/`, and `stream/`. Process configuration and media engines, including live raw-frame decoding, live in this package so applications inject them instead of embedding FFmpeg invocation details.

Configure executable paths once through `MediaRuntime` or `HAUS_FFMPEG_BIN`, `HAUS_FFPROBE_BIN`, and `HAUS_CAMERA_MEDIA_BIN` (with `FFMPEG_PATH` and `FFPROBE_PATH` compatibility fallbacks). The runner uses direct child-process execution without a shell.

The generic native camera engine lives in `native/` (IPC, browser WebRTC, RTP continuity/pacing and RTSP framing). Its executable name and IPC protocol stay `haus-camera-media`; vendor Tuya transport remains in Kitsune and is linked through the explicit `KITSUNE_NATIVE_DIR` CMake boundary. No vendor runtime JavaScript dependency is introduced into this package.

`pnpm --filter @haus/media build:native` builds the optional engine with pinned glaze/libdatachannel dependencies. `pnpm --filter @haus/media test:native` builds and runs the independent POSIX transport regressions without fetching WebRTC dependencies. After the engine build, `pnpm --filter @haus/media check:native` runs all four owned regressions, including RTCP feedback against the pinned WebRTC library. The `haus` CTest label keeps excluded upstream dependency test applications outside this suite. Both builds use the workspace root `.cache` directory for generated output. Release builds retain fixture assertions. The regular TypeScript build does not require a native toolchain; native binary paths remain injected by the host.

The `./snapshot` export implements the bridge handoff contract. A bridge advertises `haus_snapshot_profile: 1`, `haus_snapshot_provider: aqara|tuya` and `haus_snapshot_url` on the existing device-linked HA snapshot sensor. Generic wrappers are also matched against `/api/haus/cameras` from a Supervisor-discovered provider: exact RTSP protocol, port, path and verified host identity must agree. Names and rooms never establish ownership.

`GET /api/cameras/<id>/snapshot/last-live` returns only a real cached JPEG with `X-Haus-Snapshot-Profile: 1`, `X-Haus-Snapshot-Provider`, `X-Haus-Snapshot-Captured-At` (Unix milliseconds) and `X-Haus-Snapshot-Stale: 0|1`. A missing real image returns 404. The original timestamp survives outages and restarts; 30 seconds without a frame is stale. Ordinary snapshot routes may keep their Offline cards. This handoff never triggers a capture, starts a stream, pushes images to an automatically discovered server, or transmits device/HA credentials.

Haus pulls only from private addresses, pins DNS, rejects redirects and Haus-generated proxies, caps JPEG bodies and shares its resulting cache with desktop, HA and HomeKit consumers. Older providers without this contract retain the owned-source fallback. Once a provider advertises the contract, errors preserve the cached real frame rather than importing a possible Offline card from its fallback video stream.

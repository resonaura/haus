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

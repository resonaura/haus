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

This closes only the fixture-backed provider projection/control slice. It does not verify physical device behavior, live HA state propagation, or every control/Activity combination; the parent P18.3.2.3 remains open for those acceptance gaps.

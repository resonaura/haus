# Recording lifecycle and Nest composition — 2026-11-07

P14.3.5 splits `apps/hub/lib/recorder.mjs` (879 lines) and `apps/hub/lib/primary-source-recovery.mjs` (68 lines) into focused TypeScript ESM modules under `apps/hub/src/events/recorder/` (`types.ts`, `recovery.ts`, `queue.ts`, `compatible.ts`, `segments.ts`, `finalize.ts`, `prepare.ts`, `recorder.ts`, and `index.ts`, all ≤ 480 lines) and exports them from `@haus/hub/events`. `Recorder` is wired into NestJS `DefaultEventsService` (`apps/hub/src/events/events.service.ts`). `apps/hub/lib/recorder.mjs`, `apps/hub/lib/primary-source-recovery.mjs`, and `apps/hub/test/primary-source-recovery.test.mjs` are deleted without re-exports, retiring `"apps/hub/lib/recorder.mjs": 950` and `"apps/hub/lib/store.mjs": 583` from `scripts/baseline-rules.json`.

In addition, `packages/kitsune/src/vendors/native/eufy/{eufy-session,eufy-endpoint,eufy-talkback}.mjs` are converted to strict TypeScript (`.ts`) so `@haus/kitsune/native` emits full declaration types without `.mjs` imports, and `TalkbackPipeOptions.stdio` in `@haus/media/src/audio/talkback.ts` now honors piped stdout (`pipe:1`) for Eufy ADTS talkback.

## Behavior preserved

- `PrimarySourceRecovery` probes at most one RTSP fallback in the background with a 5-minute cooldown, requires a decoded video frame via `probeRtspSource`, cancels in-flight probes when a camera becomes ineligible or stops, and never interrupts an active event.
- `Recorder` preserves ring-buffer segment capture (`spawnRecordingCapture` + `RecordingProgress`), serialized per-camera `trigger()` / `extend()` / `extendTail()`, NVR capture delegation (`capture.record` / `capture.finalize`), local concat finalization (`finalizeRecordedEvent`), packet-copy provenance & front-moov `inspectOriginalPlayback` admission, and 4-job priority-promoted `preparePlayback` (`prepareEventPlaybackPinned`).
- `DefaultEventsService` delegates `prepare()`, `repair()`, and `trigger()` to `Recorder` when injected.

## Observed checks

- PASS — `vitest run test/events/ test/integration/` in `apps/hub`: 17/17 (`archive.test.ts`, `cache.test.ts`, `metadata.test.ts`, `recovery.test.ts`, `recorder.test.ts`, plus `test/integration/{playback,replication,protocol,target}.test.ts`).
- PASS — `node --test test/recorder.test.mjs test/nvr-camera-sessions.test.mjs test/eufy.test.mjs test/eufy-endpoint.test.mjs` in `apps/hub`: 52/52.
- PASS — `@haus/media`, `@haus/kitsune`, and `@haus/hub` builds and `tsc --noEmit`.

No household camera, archive or HA instance was touched. The agent port awaits independent acceptance. Review found that `DefaultEventsService` accepts an optional `Recorder`, but the actual Nest `EventsModule` does not register one. The direct-constructor test does not prove booted Nest persistence or lifecycle ownership; P14.3.5 remains in progress. See [review handoff](../consolidation/camera.md).

P14.3.5.1 now verifies recorder startup/shutdown barriers and paired capture cancellation, including real synthetic FFmpeg recovery/reaping; [lifecycle acceptance](lifecycle.md). Actual Nest wiring remains open.

P14.3.5.2 now provides the actual Nest recording store and honest unavailable-worker behavior; [persistence acceptance](nest.md). Live recorder/source ownership and complete camera compatibility remain open.

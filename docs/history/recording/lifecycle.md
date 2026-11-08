# Recorder lifecycle barriers — 2026-11-07

P14.3.5.1 hardens the typed recorder before accepting its Nest composition. The working-tree camera/recording ports and staged legacy deletions were preserved.

## Behavior and evidence

Eight deterministic regressions failed before their fixes: repeated initialization ran recovery multiple times; shutdown returned before initialization, a catalog scan or playback-pin admission settled; concurrent finalization ran twice; an abort listener created two cleanup owners; a termination failure bypassed the catalog-work barrier; and an unconfirmed capture exit was incorrectly reported as released.

- Initialization and shutdown now each retain one promise, including initialization failure. Shutdown closes admission immediately and publishes its completion barrier before firing abort listeners. A stopped instance cannot restart recovery or its timer.
- Maintenance calls share the admitted scan. Shutdown drains initialization, maintenance, camera trigger transactions, playback admission and finalization before callers close the recording store. Cancellation checks prevent late capture synchronization, event creation and new media work after an awaited admission step.
- Finalization coalesces per canonical event ID and releases its actual media pin on success or failure. Background failures are observed and emit only the fixed `HAUS_RECORDING_FINALIZE` diagnostic, without provider error text.
- `runtime/recording.ts` starts recorder and camera-session shutdown together and reports failures after both settle. `bootstrapHub` uses this pair barrier before catalog teardown: waiting for the recorder first could otherwise defer the capture adapter's abort while the recorder waits for its finalization.
- Cancellation failures are collected while the other cleanup and catalog barriers still run. The existing five-second raw-child reap budget now reports `recording_capture_shutdown_incomplete` if exit remains unconfirmed; a successful kill request alone cannot release ownership.

`test/events/lifecycle/` groups 16 cases into state, media and owner suites with a scoped fixture. The first 15 cases retained their exact names and bodies when split; all files remain below 500 lines. Tests use disposable TypeORM catalogs, controlled failure/admission gates and real media pins. Two cases use real synthetic FFmpeg media: the original pending-ring recovery case now runs in the active TypeScript suite, and a real advancing capture is reaped without scheduling reconnect. This does not retire the remaining legacy recorder suite or prove household/NVR hardware behavior.

## Observed checks

- RED — `pnpm exec vitest run apps/hub/test/events/lifecycle.test.ts`: five failures against the original implementation (`/tmp/haus-recorder-lifecycle-red.log`).
- RED — the focused `-t 'abort listener'` case: two cleanup calls instead of one (`/tmp/haus-recorder-reentry-red.log`).
- RED — focused termination-failure and missing-reap-acknowledgement cases (`/tmp/haus-recorder-termination-red.log`, `/tmp/haus-recorder-reap-red.log`).
- PASS — `pnpm exec vitest run apps/hub/test/events/lifecycle`: 3 files, 16 cases (`/tmp/haus-recorder-lifecycle-reviewed.log`, exit 0).
- PASS — final `pnpm --filter @haus/hub typecheck`, `pnpm --filter @haus/hub build` (including declarations) and `pnpm --filter @haus/hub check`: 102 files pass/one skipped, 478 cases pass/three skipped (`/tmp/haus-recorder-lifecycle-verified-hub.log`, exit 0).
- PASS — focused Oxlint (recorder, pair helper, bootstrap consumer and tests), explicit Prettier on the recorder/helper/tests, `pnpm architecture:check`, `pnpm licenses:check` (18 packages/1420 authored sources) and `git diff --check`.
- FAIL — `pnpm rules:check`: the unrelated pending `src/cluster/cluster.ts` port has 519 counted lines (`/tmp/haus-recorder-lifecycle-rules.log`, exit 1). No rule, baseline allowance or compiler setting was weakened. The earlier incomplete totals mock failed strict typechecking; it now delegates to the real store after its admission gate, preserving the full `StorageTotals` contract.
- Fixture correction — initial unspawned-process probe/test runners exited with signal status 143. The final missing-acknowledgement fixture intercepts `ChildProcess.kill` before exercising the handle; real process reaping uses an actually spawned FFmpeg process. That failed fixture run is not counted as a product regression.

## Remaining acceptance

P14.3.5.1 is verified. P14.3.5 remains `[~]`: the actual default Nest graph still has no recorder provider, and the wider P14.4/P14.5 ports, legacy consumer migration, formatting/file limits and full workspace gate need acceptance. Arbitrary injected adapters and operational hardware shutdown are not verified.

The P14.4 review must also remove the currently observed `as unknown as WebReadableStream` bridge in `camera/sessions/finalize.ts:124` through a typed streaming adapter; the lifecycle patch introduces no such casts.

No production system, HA, camera, existing NVR, archive or deployment was touched. No commit, push or branch change was performed.

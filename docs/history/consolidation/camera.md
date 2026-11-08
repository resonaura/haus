# Camera port review — 2026-11-07

P14.4 remains in progress. This review preserves the existing working-tree port, including staged deletions, and checks the camera/playback/provider boundary before accepting it.

## Reviewed behavior

- Normalized nullable registry device associations at operating, spotlight and snapshot helper boundaries. Snapshot capabilities still require the exact entity or a matching nonempty physical-device identity; unrelated null associations do not match. Manufacturer/model metadata is normalized before protected-stream interpretation.
- Retained complete analysis-node transport identities in typed fixtures instead of weakening required URL/key contracts. Session fixtures expose their recorder sensor contract explicitly.
- Reproduced an unsupported legacy motion mode acquiring a source (one acquisition, expected zero). Startup now rejects it before any source, lease or detector work. The negative test invokes the JavaScript compatibility boundary deliberately.
- An AST inventory matched the 24 removed MJS suites to 25 typed suites (sessions split into two): 101 original cases/516 assertion calls; 102 cases/520 assertion calls after the motion regression. Names were sometimes reworded; counts alone do not prove equivalent behavior. The subsequent snapshot regression adds one case and three assertions.
- P14.3.2 separately fixes two reproduced FFmpeg progress chunk-boundary faults; see [recording evidence](../recording/progress.md).

## Observed checks

- PASS — `pnpm --filter @haus/hub exec swc src -d dist --strip-leading-paths`, then `pnpm exec vitest run apps/hub/test/camera apps/hub/test/events apps/hub/test/providers`: 30 files, 120 cases (`/tmp/haus-camera-review-final.log`, exit 0). These include real synthetic media processing and disposable TypeORM fixtures; injected protocol fixtures do not verify household devices.
- PASS — `pnpm exec vitest run apps/hub/test/camera/snapshots.test.ts apps/hub/test/camera/motion/motion.test.ts packages/media/test/recording`: 7 files, 19 cases after the final fixture correction (`/tmp/haus-reviewed-boundaries-final.log`, exit 0). The first snapshot fixture was rejected for missing JPEG framing; it now uses the existing synthetic JPEG fixture format, preserving image validation.
- PASS — focused Oxlint across camera source/tests and progress source/tests; `pnpm licenses:check` (18 packages, 1415 authored sources); `pnpm architecture:check` (421 reported sources); `git diff --check`.
- PASS — final `pnpm --filter @haus/hub typecheck`, `pnpm --filter @haus/hub build` (including declarations), and `pnpm --filter @haus/hub check`: 99 files pass/one skipped, 462 cases pass/three skipped (`/tmp/haus-handoff-hub-check.log`, exit 0). Final focused source formatting/lint and media typecheck pass too.
- FAIL, subsequently corrected — initial `pnpm check`: 66 Hub type errors (`/tmp/haus-current-ports-check.log`, exit 1). The broader working-tree ports changed concurrently; final Hub types/build pass, but no full workspace gate is claimed.
- FAIL — `pnpm rules:check`: new cluster implementation exceeds 500 lines (`/tmp/haus-progress-rules.log`). Explicit camera-wide Prettier also reports 17 unformatted port files. Neither rule/config has been weakened.

## Handoff

Keep P14.4 `[~]`. Review the final public/session/provenance contracts with P14.5, finish real composition and remaining runtime behavior, format/split the broader ports, then verify affected legacy consumers and the full workspace gate. Source and test code changed during this review; the above logs describe their observed snapshots, not completion of the larger migration.

P14.3.5 also remains open: the typed `bootstrapHub` constructs a real `Recorder`, while `main.ts` starts `createHubService` → `createNestApp` → `AppModule`/`EventsModule`. The Nest module registers `DefaultEventsService` but no `Recorder` provider; direct construction in `test/events/recorder.test.ts` does not establish production dependency injection. Verify real Nest persistence/lifecycle before accepting that slice or deleting compatibility behavior.

No production system, device, HA instance, existing NVR or archive was accessed. No commit, push or branch change was performed.

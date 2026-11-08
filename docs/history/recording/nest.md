# Nest recording persistence — 2026-11-07

P14.3.5.2 connects the booted Nest events API to persisted recordings and removes success responses for unavailable recording work. The wider recorder/camera composition remains open.

## Observed defects and changes

The actual `createNestApp` graph had no `RecordingStore` provider: event/preparation endpoints returned empty responses despite seeded SQLite rows. Four real Nest regressions failed. Separately, `PlaybackPreparation` marked unprepared footage ready with no worker, and the real camera-record route returned HTTP 201 with a fabricated job ID; both new negative cases failed before their fixes.

- `RecordingModule` provides one global recording store through the existing `CATALOG_SOURCE` and `CATALOG_TRANSACTIONS`; it neither opens a second recording catalog nor destroys the shared connection. Its shutdown adapter closes the store through the shared transaction barrier.
- The canonical Nest entry point validates/creates the recording directory before opening catalog/statistics connections. Defaults stay inside the configured Hub data directory; explicit media paths survive through `NestAppOptions` and `AppModuleOptions`. `createHubService` forwards the existing `HAUS_MEDIA` variable, including the add-on Docker target's `/media/haus` setting, rather than silently relocating installed media.
- Events metadata, timeline queries and original byte-range responses read actual stored rows/files after restarting the app. Requests without valid authentication remain HTTP 401.
- Missing workers produce HTTP 503 for trigger/preparation/repair. No phantom recording row, prepared-file marker or fabricated camera job ID is published. Already verified playback still returns `ready` without requiring an encoder. When a recorder is supplied, camera admission delegates to it and returns the actual persistent event ID.
- The recorder preparation callback reloads the full stored event and fails if it disappeared; it no longer asserts a partial playback descriptor to `EventRecord`. Preparation captures its actual worker before scheduling asynchronous work.

One old unit case explicitly asserted that a workerless service reported preparation/repair success. It now asserts the observed unavailable contract; separate positive coverage preserves the existing verified-original behavior. This corrects a misleading assertion rather than accepting fabricated work.

## Checks

- RED — `pnpm exec vitest run apps/hub/test/nest/recordings.test.ts`: 4 failures (`/tmp/haus-nest-recordings-red.log`); missing provider and empty HTTP responses.
- RED — focused workerless-preparation case: `ready` instead of `failed` (`/tmp/haus-missing-worker-red.log`).
- RED — actual camera-record route: HTTP 201 instead of 503 (`/tmp/haus-camera-admission-red.log`).
- PASS — final focused Nest recordings, preparation and actual Hub runtime suites: 3 files/18 cases (`/tmp/haus-nest-recordings-final-focused.log`, exit 0), including authenticated restart/ranges, invalid media paths before database creation, configured-directory preservation and an admitted TypeORM transaction delaying teardown.
- PASS — `pnpm --filter @haus/hub typecheck`, `pnpm --filter @haus/hub build`, `pnpm --filter @haus/hub check`: 103 files pass/one skipped, 486 cases pass/three skipped (`/tmp/haus-nest-recordings-hub.log`, exit 0). The final additional authentication assertions pass in the focused suite after this full run; production source did not change afterward.
- PASS — focused Oxlint and explicit Prettier on every changed source/test, `pnpm architecture:check` (421 reported sources), `pnpm licenses:check` (18 packages/1422 sources), final diff review and `git diff --check`.
- NOT RUN — full workspace gate: the last observed `pnpm rules:check` still fails on the separate 519-line cluster port (`/tmp/haus-recorder-lifecycle-rules.log`). No compiler/rule/baseline setting was changed.

All databases, files, HTTP listeners and transactions used disposable fixtures. Byte-range fixtures verify storage/transport, not codecs or household hardware. Existing TypeORM migrations and SQL names were unchanged. No production HA/NVR/archive, deployment, commit, push or branch operation was performed.

## Next composition slice

Keep P14.3.5 `[~]`. The default Nest graph now has real recording persistence but still no configured `Recorder`/camera-source owner. Wire that actual owner and source enrollment before claiming live capture parity; reuse the P14.3.5.1 admission/paired-shutdown barriers and inject media dependencies explicitly.

Do not rely on independent Nest module destroy hooks to order asynchronous recorder shutdown before catalog destruction. The installed Nest 12.3.3 destroy-hook implementation also logs rejected hooks rather than propagating them. The next slice needs an explicit catalog-bound resource barrier and verified propagation of shutdown failure. Existing direct-constructor recorder tests alone remain insufficient. Review repair-completion semantics against the desktop caller and legacy route when that worker is composed.

# Catalog-bound recording shutdown

Verified P14.3.5.3 on 2026-11-07. P14.3.5 remains open: the default Nest graph still has no configured Recorder/source owner.

## Observed failures

The installed Nest 12.3.3 destroy-hook implementation logs rejected hooks instead of rejecting application close. A real Hub fixture with a failing catalog destroy therefore reported successful shutdown, marked the service closed and logged the private adapter error. The framework does attempt teardown after failed initialization; the earlier contrary hypothesis was refuted by its installed source.

Four independent Core lifecycle cases also failed: failed shutdown became `closed`; synchronous abort reentry created a different close promise; startup discarded cleanup failures; and cancellation of a late bootstrap swallowed its failed release.

## Ownership and behavior

- `src/storage/lifetime.ts` owns catalog teardown. Registered asynchronous writers close before logical stores, regardless of registration order. Only afterward do shared TypeORM transactions stop admission/drain and the source close. Both registration paths reject late admission. Concurrent/reentrant close joins one cached promise.
- An unconfirmed writer release attempts the other registered writers, retains stores and the connection, and reports `failed`. An unconfirmed transaction drain also retains the connection. Another close returns the same failure without replaying cleanup or physical actions. Store-release failures still permit the other stores and a confirmed transaction drain to finish.
- RecordingModule registers its shared RecordingStore with that lifetime. It neither creates a second catalog nor independently orders its destroy hook against writers.
- The actual Hub service closes HTTP admission before awaiting catalog writers, explicitly awaits the catalog lifetime and still attempts Nest/NVR cleanup on failure. Nest's fallback module hook emits only `catalog_shutdown_failed`; private causes remain available on the explicit close rejection. Main already reports fixed diagnostic messages without logging those causes.
- `@haus/core/lifecycle` publishes the shared stop promise before synchronous abort listeners run. Failed running/late-bootstrap/scoped cleanup retains `failed` ownership and its cause. Repeated stop does not replay a closer. Ordinary startup failure with successfully released resources can still finish shutdown normally.

All SQL work continues through existing TypeORM schemas and transaction owners; no schema, migration, filename or media argument contract changed.

## Verification

- RED — `pnpm exec vitest run apps/hub/test/runtime/catalog.test.ts`: actual Hub shutdown propagation/state/redaction failed before the fix (`/tmp/haus-catalog-lifetime-red.log`).
- RED — `pnpm exec vitest run packages/core/test/lifecycle.test.ts`: four new cases failed, two existing cases passed (`/tmp/haus-core-close-red.log`, exit 1).
- PASS — `pnpm exec vitest run packages/core/test/lifecycle.test.ts`: six cases (`/tmp/haus-core-close-final.log`, exit 0). `pnpm --filter @haus/hub exec vitest run test/storage/lifetime.test.ts test/runtime/catalog.test.ts test/runtime/application.test.ts test/nest/recordings.test.ts`: four files/22 cases (`/tmp/haus-catalog-lifetime-focused.log`, exit 0). Disposable SQLite tests prove both registration orders, final writes across restart, reentry, late admission, source mismatch, unconfirmed ownership, store failure, drain failure, connection failure and HTTP admission while a writer is pending.
- PASS — `pnpm exec vitest run packages/core/test`: 29 files/200 cases (`/tmp/haus-core-close-suite.log`, exit 0).
- PASS — `pnpm --filter @haus/core typecheck`, `pnpm --filter @haus/core build`, `pnpm --filter @haus/hub typecheck`, `pnpm --filter @haus/hub build` (305 compiled files).
- PASS — `pnpm --filter @haus/hub check`: 105 files pass/one skipped; 495 cases pass/three skipped (`/tmp/haus-catalog-lifetime-hub.log`, exit 0), including the final private-cause preservation assertion.
- PASS — explicit Oxlint and Prettier checks on changed source/tests, `pnpm architecture:check` (421 sources), `pnpm licenses:check` (18 packages/1425 sources), final slice diff review and `git diff --check`.
- FAIL — `pnpm rules:check`: the separate existing cluster port has 519 counted lines (`/tmp/haus-catalog-lifetime-rules.log`, exit 1). No rule/configuration was weakened. Full workspace gate remains NOT RUN pending that independent gate and remaining port acceptance.

Temporary fixture databases and loopback HTTP listeners were the only runtime targets. No production HA, NVR, archive, device, deployment, branch, commit or push operation was performed.

## Continuation

Inject the real Recorder/camera-source owners through the composition root, register their paired shutdown with CatalogLifetime before returning the provider, and preserve finalization writes before RecordingStore closes. Workerless APIs must remain unavailable until a configured owner exists. Direct Nest `app.close()` still follows the framework's logging behavior; production failure propagation depends on the explicit Hub lifetime barrier.

Provider-construction failure before Nest returns an application, and errors while configuring a partially constructed Nest application, are not covered by this shutdown acceptance. Review those acquisition boundaries in P14.5 when replacing the remaining prototype composition. Household capture, codecs, ownership takeover and Linux image acceptance remain unverified by these fixtures.

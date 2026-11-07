# Integration test ownership — 2026-11-07

P14.2.3.3.2.3.3.2 moves Node's three integration suites into strict TypeScript Hub tests. All three original test names and assertions remain: 24 equal, twelve ok, five deepEqual and three rejects, verified through an AST inventory against the saved originals.

## Behavior and boundaries

- `apps/hub/test/integration/replication.test.ts` retains three actual loopback servers, encrypted configuration replication, media copies, scoped byte ranges, GCM tamper rejection, recovery CLI export/no-overwrite behavior, and disk replacement with a fresh instance identity at the same address/key. Persistence uses the existing TypeORM catalogs and transaction manager.
- `playback.test.ts` retains authenticated remote preparation, weak/offline fallback, both decoded audio and video, original-byte preservation, encoder counts, released reservations and reclaimed temporary work. Synthetic media generation and FFmpeg decoding now live in `packages/media/test/support/playback.ts`. Playback exposes a read-only retained-job count, including completed jobs awaiting release, so the test still checks the complete original cleanup invariant without accessing its mutable map.
- Small fixture adapters validate unknown exports/results of the actual owned legacy backup, cluster and recorder implementations. They do not load arbitrary `HAUS_HELPER_PATH` code. The current Nest backup service only creates in-memory snapshot metadata; the Nest cluster service implements node CRUD rather than actual replication/offload. These prototypes cannot replace the working legacy behavior. P14.3–P14.5 must migrate that behavior before retiring its runtime; this slice does not claim production parity.
- The external-container case requires `HAUS_NVR_TEST_DISPOSABLE=1`, an explicit HTTP(S) origin and an absolute key path. Merely configuring a URL/key cannot enable writes. Credentials in URLs, ambiguous origins, escaped paths and redirects are rejected; both signed `/v1/` and actual granted `/media/` paths must stay on the selected origin. Requests and recovery subprocesses have finite deadlines. Private recovery diagnostics are drained without being printed.
- The external protocol is shared with two newly owned loopback fixtures, exercising both cleanup and retain branches against real HTTP, blob storage and a disposable TypeORM recording index. Three additional input-boundary cases check the explicit-write guard and origin/path validation. The initial local run exposed an overrestrictive `/v1/` guard rejecting the real `/media/` grant; the guard was corrected against the actual grant contract and both fixtures pass.
- `pnpm --filter @haus/hub test:integration` owns the suites; the old Node command delegates there until packaging retirement. Documentation records the disposable-container opt-in and Haus Hub playback fallback. The old MJS integration files and Node storage helper are removed.

## Observed checks

- PASS — exact AST name/assertion inventory; all original names and assertion counts match after extracting the shared protocol exercise.
- PASS — `pnpm --filter @haus/hub typecheck` and `pnpm --filter @haus/media typecheck`.
- PASS — `HAUS_NVR_TEST_DISPOSABLE=0 pnpm --filter @haus/hub test:integration`: seven passed, one explicitly provisioned external-container skip. The two original local scenarios use real encryption, recovery subprocesses, HTTP and FFmpeg; the two protocol fixtures use newly created loopback targets only.
- PASS — `HAUS_NVR_TEST_DISPOSABLE=0 pnpm check`, exit 0 (recorded separately from the complete log): types, lint, rules/licenses, formatting and builds; root 1527 passed/eleven skips; Kitsune 25, HomeKit 21; Node compatibility sixteen passed/two skips; integration seven passed/one skip; Hub 331 passed/three skips. Optional playback report/fixture-retention environment variables were absent and explicitly unset for the recovered final gate.
- PASS — `pnpm architecture:check` (421 sources), focused Oxlint, `pnpm exec prettier --ignore-path /dev/null --check apps/hub/test/integration packages/media/test/support/playback.ts`, and `git diff --check`.

## Limits

The real external/container target was NOT RUN: no disposable remote deployment was authorized. The local protocol fixtures verify its shared exercise against owned servers, not a deployed image. Linux Docker/tmpfs acceptance is also NOT RUN on this macOS host. No production service, household device, HA instance or archive was touched. Model/install tools and Node packaging retirement remain open; the overall goal and automation stay active without subagents.

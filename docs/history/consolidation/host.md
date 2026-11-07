# Host test ownership — 2026-11-06

P14.2.3.3.2.2 is verified. Remaining NVR/media/integration/tool migration and Node packaging retirement remain open.

## Changed

- Moved eleven Node host test files and the existing servers contract suite into strict TypeScript under `packages/servers/test/{host,storage,services,telemetry}`. Split the two oversized mixed suites by responsibility and extracted small fixture/report helpers. All authored files stay below 500 lines and directories below 25 files.
- The backing-capacity/blob growth integration belongs to Hub and now lives at `apps/hub/test/nvr/backing.test.ts`. The servers package has no test dependency on the Hub application. Original timestamps, mounted-device checks, quota growth, concurrent reservations and preservation of existing blobs remain covered.
- An AST comparison maps all 83 original test definitions exactly to the new server/Hub files. The parameterized cases produce 84 server tests plus one Hub test. Original assertion counts are preserved: 351 equal, 51 deepEqual, 17 match, 13 throws, eight rejects, five doesNotMatch and one fail; explicit guards add eleven ok assertions.
- Servers typecheck includes source and tests; its production build still includes only source. The package test script uses Vitest so the same suite runs through both package and root commands. Removed all eleven old Node host MJS files and the servers MJS contract entrypoint.
- Strict typing exposed three existing adapter contract mismatches. HostDisk now declares the flat media metadata already returned by disk collectors. HostSystem describes the eight read-only methods actually used by telemetry rather than requiring the complete node:os module. Linux battery list injection accepts the already-supported string/name-entry forms; its map no longer needs an object assertion. Wire formats and collector behavior remain unchanged.
- Fixtures narrow unknown report values, require expected rows/callbacks and capture typed command arguments. The Windows sampler fixture uses a real ChildProcess/PassThrough object behind a scoped launch spy; it retains partial-line, stale/error, fresh timestamp, shutdown and no-relaunch checks without spawning a real Windows process.

## Observed evidence

All checks used local disposable files, databases, processes and HTTP fixtures. Native Windows/Linux probes are simulated by fixed fixture responses; no household or production resource was operated.

- PASS — `pnpm check`, exit 0 after the final source/test edits: workspace typechecks, lint, rules/licenses, formatting, builds, root 263 files/1428 tests, Kitsune 18/18, HomeKit 21/21, remaining Node 68 passed/10 environment skips, local integration two passed/one provisioned-container skip, Hub 46 files/257 tests.
- PASS — `pnpm --filter @haus/servers test`: 21 files/84 tests, including stale/external reports, hardware inventory refresh, Linux CPU counters, Windows/WSL resources, disk relationships, DMI/device-tree memory, battery normalization, bounded read-only selectors and private-field stripping.
- PASS — `pnpm --filter @haus/servers typecheck`, `pnpm --filter @haus/servers build` and `pnpm --filter @haus/hub typecheck`; the full workspace gate also checks their consumers.
- PASS — `pnpm architecture:check`: 421 source files; final changed-file formatting and `git diff --check`.

The initial strict check identified incomplete fixture shapes and the adapter type mismatches above. Those are corrected without any casts through unknown, non-null assertions, explicit any or weaker compiler settings. The first migrated Vitest run timed out its slow-daemon case at the runner's new five-second default: the existing fixture deliberately executes three bounded 2.8-second commands. That individual case now has a finite 15-second budget (the old Node case had no test deadline); application command budgets and assertions are unchanged. Its generated fixture is now a Node-runnable TypeScript file. The rerun and full gate pass.

## Limits and continuation

No physical Windows/WSL/Linux hardware behavior, Docker image build, household device or production deployment was verified. Ten native/environment cases and one separately provisioned container integration remain skipped in the default gate. Prior native loopback acceptance is recorded separately in native.md.

Continue P14.2.3.3.2.3: migrate the remaining Hub/NVR/media/native/integration tests and install/model utilities into strict TypeScript owners, preserving negative and real-media coverage and splitting oversized files. Then finish P14.2.3.3.3 Docker/compose/CI/install consolidation and Node package retirement. P16.1 authentication/standalone composition gaps remain a release blocker as recorded in PLAN.md; this test migration is not production readiness. The goal and hourly automation stay active without subagents. Commit/push still waits for verified completion of the agreed plan; branches and production remain untouched.

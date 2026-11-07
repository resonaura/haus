# Runtime and workspace test ownership — 2026-11-07

P14.2.3.3.2.3.3.1 is verified, including the workspace gate and an independently copied production-dependency artifact. Integration suites and model/install tools remain separate open children.

## Changed

- Removed Node's final three runtime MJS suites: mDNS advertisement, monitoring process and transient workspace. Their sixteen scenarios now belong to Hub's `test/runtime/{discovery,monitoring,workspace}.test.ts` and `test/nvr/storage/workspace.test.ts`. Existing discovery cancellation/failure tests are retained alongside the five moved privacy/address tests.
- AST inventory maps all sixteen original names and preserves every original assertion: fifty equal, eleven rejects, seven ok, five deepEqual, one throws and one fail. Unknown status/configuration values are narrowed through fixture guards; backing-capacity and filesystem ports retain their existing typed contracts.
- Process fixtures launch the compiled Hub independently of Vitest's development export condition. They bind loopback, disable mDNS, use disposable data directories and fixture keys, retain monitoring-only/no-media assertions and require graceful zero-exit shutdown. Failed startup captures diagnostics; teardown clears the kill timer and removes its own temporary directory even if exit assertions fail.
- The Linux workspace-process fixture retains authenticated status and actual separate-filesystem checks. Its polling now has a thirty-second wall deadline and a finite 45-second case budget including cleanup; the old 300-iteration loop had no test deadline and could spend a second per HTTP attempt. The two explicit tmpfs/platform skips are preserved.
- `@haus/node test/check` temporarily delegates to the real moved Hub suites so its existing script entrypoint remains meaningful until package retirement. Integration scripts are unchanged. Docker no longer references any removed Node runtime test path; workspace verification runs in its build stage and the process fixture can target the deployed dependency tree through the absolute test-only `HAUS_HUB_TEST_ENTRYPOINT` path.
- Four completed P15.4.3 catalog sub-slices moved verbatim to `docs/history/persistence/catalogs.md`; PLAN.md retains their completed status and link. This frees space for independently accepted runtime/integration/tool children without dropping requirements or exceeding the plan line limit.

## Packaging findings

The first local `pnpm --filter @haus/hub deploy --legacy --prod` assembled an isolated artifact in `/tmp`. It also left pnpm's workspace-state metadata with dev=false/production=true, although the installed workspace still included dev dependencies. Subsequent pnpm run/exec commands attempted `install --production` and aborted their requested module-directory purge without a TTY before tests could start.

`pnpm install --frozen-lockfile --offline --ignore-scripts --prod=false` restored the normal dependency view in 1.3 seconds without changing the lockfile, project configuration or approval/purge settings. Docker now restores that development toolchain after both production deploy operations and before Vitest verification, avoiding the same build-stage failure.

The initial packed-process attempt also exposed stale output in the test artifact. Deploy had hardlinked its core index to workspace output (same inode observed); a later dependency rebuild updated that index while newly emitted identity modules were absent from the older artifact. The fixture correctly failed with ERR_MODULE_NOT_FOUND rather than accepting a nonzero application exit. Final validation assembled after the fresh workspace build and tested an independent filesystem copy, preserving actual production dependency resolution. The frozen artifact contains the newly emitted modules and its index has a different inode from workspace output.

## Observed checks

- PASS — `pnpm --filter @haus/hub typecheck`.
- PASS — `pnpm --filter @haus/hub exec vitest run test/runtime/discovery.test.ts test/runtime/monitoring.test.ts test/runtime/workspace.test.ts test/nvr/storage/workspace.test.ts`: four files, sixteen passed/two Linux tmpfs skips, including two pre-existing discovery cases.
- PASS — `pnpm --filter @haus/node check`: the preserved package entrypoint runs the same real sixteen-passed/two-skipped suite.
- PASS — final `pnpm check`, exit 0: workspace types/lint/rules/licenses/format/builds; root 1520 passed/ten environment skips; Kitsune 25, HomeKit 21; Node compatibility suite sixteen passed/two skips; local integration two passed/one provisioned-container skip; Hub 324 passed/two tmpfs skips. Concurrently committed core/Kitsune additions are preserved; these are the observed current-tree totals.
- PASS — `pnpm architecture:check` (421 source files), focused Oxlint, explicit formatting of moved Hub tests, exact assertion inventory and `git diff --check`.
- PASS — `pnpm --filter @haus/hub deploy --legacy --prod <isolated-staging-directory>`, followed by an independent `fs.cp` snapshot, normal dev-dependency-view restoration, and `HAUS_HUB_TEST_ENTRYPOINT=<frozen-directory>/dist/main.js pnpm --filter @haus/hub exec vitest run test/runtime/monitoring.test.ts test/runtime/workspace.test.ts`: one real packaged-process case passed/one Linux tmpfs case skipped, exit 0. The fixture authenticates against the packaged application's status, verifies no media producer and requires graceful zero-exit shutdown. All artifact paths are disposable `/tmp` directories; no service is installed.

## Limits and continuation

No production service, HA instance, household device, pairing or archive was operated. Local macOS checks do not verify the two Linux tmpfs branches or a Linux Docker image. Production dependency packaging uses disposable `/tmp` artifacts and never installs a system service. Next: P14.2.3.3.2.3.3.2 integration tests, then typed model/install tools and Node packaging retirement. The goal and automation stay active without subagents; commit/push waits for the agreed plan's completion, on the existing branch.

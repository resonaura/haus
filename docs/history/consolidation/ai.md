# AI test ownership — 2026-11-06

P14.2.3.3.2.1 is verified. The parent Node test/tool retirement remains in progress.

## Changed

- Moved Node capacity, detector and inference-worker tests into `packages/ai/test/{capacity,detectors,worker}.test.ts`. Converted the existing AI package contract suite to `contracts.test.ts`; all nine prior cases remain present across four strict TypeScript files. Removed the three Node MJS test files and the AI MJS contract entrypoint.
- AI typecheck now includes both source and tests. The declaration/native build explicitly includes only source, preserving the production artifact boundary. The package test command runs Vitest and retains the five native C++ vision suites.
- Typed fixtures satisfy the actual worker/capacity ports; callback/job existence is checked before use. The frame fixture uses real ChildProcess/PassThrough objects behind a scoped spawn spy, without creating OS processes or casting incomplete objects into process types. It preserves the original one-frame-in-flight, stale-frame dropping, calibration and termination assertions, with cleanup in finally.
- Runtime source, native algorithms, media profiles and public AI exports were not changed by this slice. Existing accumulated source changes from earlier slices were preserved.

## Observed evidence

All commands exited 0 after the final implementation edits.

- PASS — `pnpm --filter @haus/ai typecheck`: strict source and test typechecking; final standalone rerun also passed.
- PASS — `pnpm --filter @haus/ai build`: declarations/JS and native make targets; tests stay outside the production rootDir.
- PASS — `pnpm --filter @haus/ai test`: four files/nine TypeScript tests plus all five native vision suites.
- PASS — `pnpm exec vitest run packages/ai/test`: the same nine tests are discovered and pass through the root workspace configuration.
- PASS — `pnpm --filter @haus/node test`: 144 passed/10 environment skips. Its five moved cases now run under AI; the four prior AI cases remain covered too.
- PASS — `pnpm lint`, `pnpm rules:check`, `pnpm architecture:check` (421 source files), changed-file Prettier and `git diff --check`.

The first strict check rejected legacy fixture omissions, unchecked callback/job lookups, optional pressure reads and an overloaded spawn mock's type. Fixtures now implement the existing ports, narrow optional values with assertions/guards, and spy on a typed spawn port. No source type, assertion or strictness setting was weakened to make the tests pass.

## Limits and next work

Full `pnpm check` was not repeated for this test-owner slice: focused package/build/consumer and root discovery checks cover the changed boundaries; the previous full milestone result remains recorded separately. Ten native/environment cases in the default Node suite remain skipped. No hardware, household service, deployment, commit, push or branch operation was performed.

Continue P14.2.3.3.2.2: migrate the host probes, disk/memory/service and telemetry tests to the servers package, split oversized fixture domains, and keep stale/unknown/security assertions. P14.2.3.3.2.3 still owns remaining Hub/media/integration tests and model/install tooling, including the remaining AI model-fetch MJS utility. The goal and hourly automation remain active without subagents. Commit/push remains conditional on verified completion of the agreed plan.

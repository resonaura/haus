# Cluster mutation shutdown

P14.5.3 verified on 2026-11-07. This accepts CRUD lifecycle ownership in the typed Cluster runtime; actual Nest Cluster/Backups composition remains open.

## Behavior and failure evidence

Before the fix, stop returned different promises on concurrent/abort reentry, permitted update/remove writes afterward and returned before admitted catalog writes or an aborted remote settings request settled. Eight initial lifecycle assertions failed, including consistent late-enrollment error handling. Transactions alone kept some connections alive, masking the prematurely released owner.

`Cluster` now registers add/update/remove work before it begins and stops new admission with `cluster_stopped`. Stop publishes one cached promise before synchronous abort callbacks and joins all admitted mutations plus the existing replication/health/cache promises. A successfully committed admitted write remains persisted across restart; a confirmed rolled-back failure still reaches its caller and does not falsely become an owner-cleanup failure. Shutdown never retries a remote settings mutation with uncertain acknowledgement.

Registration preserves synchronous input capture. The first attempt deferred mutations to a microtask; two regression cases caught changed enrollment/configuration payloads after submission, and the final implementation starts immediately after publishing ownership. The local `begin` definite-assignment declaration relies only on the synchronous Promise executor, with that invariant documented beside it. Another reproduced pre-existing settings fault compared the response against the caller's mutated object; a validated shallow copy now preserves the submitted primitive patch fields across the remote await.

No SQL schema, identity, role, key, archive, media invocation or physical-action contract changed. No compiler, rule or formatter setting was weakened.

## Checks after final edits

- RED — `pnpm --filter @haus/hub exec vitest run test/cluster/lifecycle.test.ts`: eight initial failures (`/tmp/haus-cluster-lifecycle-red.log`, exit 1).
- RED — the first registration implementation changed synchronous payload capture: two failures/ten passes (`/tmp/haus-cluster-mutation-payload-red.log`, exit 1). The separate acknowledgement test failed with `invalid_node_settings` (`/tmp/haus-cluster-settings-payload-red.log`, exit 1).
- PASS — `pnpm --filter @haus/hub exec vitest run test/cluster`: three files/50 cases, including thirteen lifecycle cases (`/tmp/haus-cluster-lifecycle-focused.log`, exit 0). Real TypeORM fixtures cover queued add/update/remove writes, final state after reopening, a gated pre-SQL mutation, rollback on actual commit failure, stop reentry, late admission, payload capture and one aborted HTTP settings request without replay.
- PASS — `pnpm --filter @haus/hub typecheck`; `pnpm typecheck` across the workspace; `pnpm --filter @haus/hub build` (308 compiled files).
- PASS — final `pnpm --filter @haus/hub check`: 108 files pass/one skipped, 545 cases pass/three skipped (`/tmp/haus-cluster-lifecycle-hub.log`, exit 0).
- PASS — 26 legacy health/metadata/playback cases against the rebuilt runtime (`/tmp/haus-cluster-lifecycle-legacy.log`, exit 0), using the same three-import temporary loader documented in [enrollment acceptance](enrollment.md). This verifies their assertions but does not migrate those MJS suites.
- PASS — `pnpm lint`, `pnpm rules:check` (including licenses), `pnpm architecture:check`, explicit changed-file Prettier, final slice diff against its saved baseline and `git diff --check`.
- NOT RUN — full `pnpm check` after this slice: the independent 35-file formatting failure remains the last observed full-gate result (`/tmp/haus-port-lint-workspace.log`). Its three required structural splits and checks remain recorded in [gate evidence](gates.md). Workspace types, lint, rules and Hub checks were independently rerun after final source edits.

Only temporary SQLite/files and loopback peers were used. The single observed aborted PATCH proves request-drain/no-replay behavior; it does not prove a household physical effect or exactly-once remote application. No production HA/NVR/archive, device, deployment, branch, commit or push operation was performed.

## Continuation

P14.5 stays in progress. Before claiming complete catalog-bound Cluster ownership in the real Nest graph, trace direct playback/media/public-poll calls and response-stream lifetime as well as CRUD; this slice accepts the mutation barrier only. Compose real Backups/Cluster/Recorder providers explicitly rather than promoting the prototype services. Continue the bounded formatting/structure work under P14.4/P14.5/P14.6; bootstrap, HA host telemetry and HA native migration need splits before a bulk formatter run.

# Typed port verification gates

P14.5.2 verified on 2026-11-07 after the cluster identity slice.

Four existing root Oxlint diagnostics are resolved in three files. Backup shutdown passes Map value iterators directly to `Promise.allSettled`; iteration still occurs before either await. The camera route spreads its typed optional override directly, preserving the same null/undefined behavior. The integration route drops an erased, unused type import. No product behavior, wire contract, cleanup policy, compiler or lint setting changed.

Verification after the final source edit:

- PASS — `pnpm lint` (`/tmp/haus-port-lint.log`, exit 0).
- PASS — `pnpm --filter @haus/hub typecheck`; `pnpm --filter @haus/hub build` (308 compiled files).
- PASS — `pnpm --filter @haus/hub check`: 107 files pass/one skipped; 532 cases pass/three skipped (`/tmp/haus-port-lint-hub.log`, exit 0).
- PASS — final diff against the saved three-file baseline and `git diff --check`.
- FAIL — `pnpm check` now passes all workspace typechecks, root lint, engineering rules/architecture and license checks, then stops on 35 existing unformatted port files (`/tmp/haus-port-lint-workspace.log`, exit 1). Root tests and later app checks were NOT RUN by this invocation because formatting stopped the chain. The full workspace milestone remains open.

The three edited files already had formatting debt in the pre-edit report. That independent debt was preserved rather than concealing it with a changed formatter configuration. A read-only Prettier preflight over all 35 reported files (`/tmp/haus-port-format-preflight.json`) identifies required structural splits: formatting `runtime/bootstrap.ts` grows its counted size from 483 to 590 lines; HA `node/host-telemetry.ts` grows 479 to 513; HA `node/native-migration.ts` grows 472 to 513. Split those responsibilities within P14.5/P14.6 and retain their behavior before applying formatting. The other 32 reported files stay within 500 formatted lines. P14.4 owns the affected camera/provider port review and P14.6 owns the HA runtime port review.

No new tests were authored for these low-impact lint edits; existing runtime/recording/API consumers and the complete Hub suite were rerun. No production HA, NVR, archive, device, deployment, branch, commit or push operation was performed. Real Nest Recorder/source and Backups/Cluster composition remain pending, including queued mutation drain noted in [cluster acceptance](enrollment.md).

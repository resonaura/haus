# Binary host inventory correction — 2026-11-07

P16.4.1 corrects a concrete defect found during the model/probe migration. Both the standalone installed-memory helper and HostTelemetry default file readers decoded every unencoded read as UTF-8. Their DMI/device-tree parsers require Buffer; permissive injected fixtures had hidden the mismatch.

## Evidence and change

Before the fix, each exact default initializer was extracted from its source AST and executed against an owned synthetic DMI file. Both returned string, not Buffer. No firmware paths or physical hardware were read.

`packages/servers/src/reading.ts` now preserves Node's binary read semantics when no encoding is supplied, validates explicit encodings through Buffer.isEncoding, and returns text only when requested. `memory.ts` and `telemetry.ts` share that typed reader, removing the previous function/encoding assertions without changing the injected port signature. CPU, meminfo, battery, disk and service consumers explicitly request text or convert their union result; the package suite verifies those consumers.

Three regression cases use the actual HostTelemetry default reader on disposable files: invalid-UTF-8 bytes remain byte-exact while explicit UTF-8/hex return text; two synthetic DMI modules report 16 GiB; a synthetic device-tree bank reports 4 GiB. The tests instantiate telemetry without initializing/sampling the host. The first case and both inventory paths reject the old UTF-8-forced behavior.

Because the installed probe imports the shared memory module, the installer must now include its new reading.js dependency. Build prerequisites/copy paths and current package documentation were updated. The independently copied installed graph contains four modules plus an ESM marker; its no-argument invocation resolves all imports and rejects with Usage before hardware access.

## Observed checks

- PASS — `pnpm --filter @haus/servers typecheck` and `pnpm --filter @haus/servers build`.
- PASS — `pnpm exec vitest run packages/servers/test`: 23 files, 96 cases, including all three actual-reader regressions and the existing probe, platform, service and storage suites.
- PASS — `pnpm --filter @haus/hub typecheck && pnpm --filter @haus/hub build && pnpm --filter @haus/hub exec vitest run test/runtime/monitoring.test.ts test/servers test/nest/providers-domain.test.ts`: two matching files, eleven cases. The monitoring case starts the real compiled Hub with isolated data and requires graceful zero-exit shutdown; domain-provider coverage remains intact.
- PASS — isolated four-module installed-probe entrypoint, `sh -n packages/servers/install/memory.sh`, architecture (421 sources), engineering/license rules, focused Oxlint, package Prettier and `git diff --check`.
- The immediately preceding full `pnpm check` passed at root 1543/Hub 331. It predates this reader correction; final evidence for this slice is the focused package and affected Hub checks above. The next packaging milestone must run the full gate again.

No privileged probe, installed service, upstream model download, household device, HA instance or archive was operated. Actual hardware/platform probing remains unverified; the correction is proven against synthetic binary inventory and real filesystem reads only. Node packaging retirement and other open P14/P16 acceptance requirements remain open.

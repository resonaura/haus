# Model and host probe ownership — 2026-11-07

P14.2.3.3.2.3.3.3 replaces the remaining Node model/probe MJS tools with strict TypeScript in their owning packages. Node now has no authored runtime/test/tool MJS files; its deployment/package assets remain for the separate retirement slice.

## Changed

- `packages/ai/src/model/{download,cli}.ts` owns the explicit model-install command. It validates the pinned HTTPS manifest and SHA-256, rejects redirects, streams at most 64 MiB, flushes a unique temporary file and atomically replaces the model after verification. Failed HTTP, digest, size or interrupted-body paths preserve the previous artifact and reclaim their temporary file. Ordinary builds/tests never download a model.
- The two duplicate download scripts and Node's duplicate manifest/license/notice are removed. The retained `packages/ai/vision` manifest, Apache license and notice were byte-identical before removal. Detector asset paths stay unchanged; third-party attribution and Docker ignore paths now name the owner package. Package READMEs document the new built CLI and old-command replacement.
- `packages/servers/src/probe/{memory,cli}.ts` owns the optional privileged capacity probe. Its firmware port bounds reads to 4096 bytes per record, at most 128 devices and 64 boot-ID bytes. Partial inventories, malformed/truncated records, symlinks and invalid boot identities remain unknown instead of exporting partial capacities. It reuses the collector's DMI parser; that parser now rejects declared lengths exceeding the actual buffer instead of raising an out-of-range exception.
- Reports retain version 1, installedBytes, bootId and sampledAt. The synthetic report is accepted by the existing fresh/current-boot collector. No raw firmware/module identifiers enter it. Verified samples flush and atomically replace the existing report; sample failures preserve it and temporary files are removed.
- `packages/servers/install/memory.sh` replaces the old Node installer. It copies the three compiled local modules, an ESM marker and Node executable into the existing protected directory. Systemd unit/timer names, report path/schema, interval and sandbox policy are preserved; ExecStart now names `probe/cli.js`. Build prerequisites and entrypoint migration are documented. No installer or privileged probe was executed.

## Observed checks

- PASS — `pnpm --filter @haus/ai typecheck` and `pnpm --filter @haus/servers typecheck`.
- PASS — `pnpm exec vitest run packages/ai/test/model/download.test.ts packages/servers/test/probe/memory.test.ts packages/servers/test/host/memory.test.ts`: twenty cases, including successful streamed replacement, manifest rejection before requests, five download failures, report/collector compatibility, failed firmware samples, bounded/symlink reads and truncated-record regressions.
- PASS — `pnpm exec vitest run packages/ai/test packages/servers/test`: 27 files, 109 cases. Sources use synthetic media/model bytes and injected firmware; all filesystem writes are owned disposable directories.
- PASS — `pnpm --filter @haus/ai build && pnpm --filter @haus/servers build`; native AI targets were already current. `sh -n packages/servers/install/memory.sh` passes without executing the installer.
- PASS — an isolated copy of exactly the three installed compiled probe modules plus ESM marker resolves without workspace dependencies. Its no-argument invocation exits 1 with Usage before hardware access; the compiled model CLI rejects an invalid argument before reading/downloading anything. The fixture is removed afterward.
- PASS — `HAUS_NVR_TEST_DISPOSABLE=0 pnpm check`, exit 0 (complete log and separate exit marker): root 1543 passed/eleven skips; Kitsune 25, HomeKit 21; Node compatibility sixteen passed/two skips; integration seven passed/one skip; Hub 331 passed/three skips. Optional playback report/fixture-retention variables were explicitly unset.
- PASS — architecture (421 sources), engineering/license rules, focused Oxlint, package formatting and final diff whitespace. An AST scan additionally checks all newly authored TS tools/tests for explicit any and verifies file/directory caps. An initial ad hoc text scan falsely matched the English word “any” in a test title; replacing it with the actual TypeScript AnyKeyword check passes without changing source or policy.

## Separate finding

Inspection found that both `memory.ts` and `Telemetry` default readers force UTF-8 even when binary data is requested. Executing each exact default initializer against an owned synthetic DMI file returned string rather than Buffer, confirming that the direct DMI/device-tree parser path loses its binary input. Injected-reader tests had masked this existing defect. The new standalone probe uses its own bounded binary reader and is unaffected. P16.4.1 tracks the collector correction and regression coverage independently; it is not claimed fixed by this tool migration.

## Limits

Upstream model download/inference, root firmware probing, systemd installation and Linux image acceptance are NOT RUN. No household hardware, production service, HA instance or archive was accessed. The remaining Node Docker/compose/CI/install assets still require consolidation and source/package compatibility review before retirement or any release. Commit/push and deployment have not occurred.

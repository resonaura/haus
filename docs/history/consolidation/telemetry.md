# Supervisor telemetry parser ownership

P14.6.1 verified on 2026-11-07. This accepts shared parsing, its public compatibility boundary and the migrated CPU fixtures; the remaining HA runtime ports still require review.

Neutral procfs parsing and its `HostProcParsed` contract now belong to `@haus/servers/os` and `servers/src/types.ts`. The HA telemetry entrypoint re-exports those same parser bindings and retains its Supervisor-specific class. Removing the duplicate ARM table/parsers lets the adapter format to 430 newline lines, below the source limit. Its emitted class JavaScript AST matches the saved baseline (TypeScript 5.9.3, zero parse errors); inventory/cache/transport algorithms were not rewritten.

Three reproduced cases reported uptime zero for missing/whitespace input because `Number('')` becomes zero. The shared parser now returns `null` for missing uptime while preserving a measured zero. A fully injected compatibility collector fixture verifies the existing Supervisor boot-time fallback instead of reporting a fresh boot. Unknown CPU model inputs remain unavailable. Kernel CPU/memory and whole-host container CPU units remain unchanged.

The new workspace dependency points HA's Node adapter toward the neutral owner; servers depends only on media, whose dependency set is empty, so this adds no dependency cycle. Only the Node telemetry entrypoint imports the new subpath. Package manifests and the generated lockfile changed by one local workspace link; `pnpm install --offline --ignore-scripts --filter @haus/ha` completed with no downloads. Existing wildcard-export edits from the broader port were preserved.

The five original CPU/proc case names and assertions moved into typed HA telemetry and servers host tests. The two dedicated Hub MJS test files were removed; the other two cases were removed from the mixed legacy servers suite, leaving its remaining tests intact. No runtime MJS wrapper or compiler/rule exception was added.

## Observed verification

- PASS — pre-change and rebuilt-public-entrypoint legacy CPU fixtures: three cases (`/tmp/haus-telemetry-ownership-baseline.log`, `/tmp/haus-telemetry-ownership-legacy.log`, exit 0), before deleting their MJS entrypoints.
- RED — `pnpm exec vitest run packages/servers/test/host/proc.test.ts packages/ha/test/telemetry/stats.test.ts`: three missing-uptime failures/seven passes (`/tmp/haus-telemetry-ownership-red.log`, exit 1).
- PASS — final focused proc/HA telemetry suites: three files/17 cases (`/tmp/haus-telemetry-ownership-focused.log`, exit 0), including public parser identity, unknown input and collector boot-time fallback. All new HA collection ports are injected; they contact neither Supervisor nor DBus and do not read host files.
- PASS — `pnpm exec vitest run packages/ha/test packages/servers/test`: 40 files/203 cases (`/tmp/haus-telemetry-ownership-packages.log`, exit 0).
- PASS — servers typecheck includes its tests. HA's two new test files also pass an explicit strict NodeNext TypeScript check with `--ignoreConfig` (the existing package config includes source only); no project configuration was changed or weakened. Exact flags/output are recorded in `/tmp/haus-telemetry-ownership-test-types.log` and the command below.
- PASS — `pnpm typecheck` across the workspace; `pnpm --filter @haus/servers build`; `pnpm --filter @haus/ha build`; `pnpm --filter @haus/hub build` (308 compiled files).
- PASS — `pnpm --filter @haus/hub check`: 108 files pass/one skipped, 545 cases pass/three skipped (`/tmp/haus-telemetry-ownership-hub.log`, exit 0).
- PASS — `pnpm lint`, `pnpm rules:check`, `pnpm architecture:check`, explicit changed-source/test/manifest formatting, final slice diff and `git diff --check`. Class AST comparison is recorded in `/tmp/haus-telemetry-ownership-ast.log`; an earlier context-free lexer check misread template continuations and was replaced with parsed JavaScript AST comparison.
- FAIL — `pnpm format:check`: 34 remaining port files (`/tmp/haus-telemetry-ownership-format.log`, exit 1), down from 35. Full `pnpm check` was NOT RUN because that independent formatting gate still fails; its type/lint/rule and affected package/Hub gates were run independently.

Explicit HA test typing: `pnpm --filter @haus/ha exec tsc --ignoreConfig --noEmit --strict --skipLibCheck --target ES2023 --module NodeNext --moduleResolution NodeNext --lib ES2023,DOM --types node test/telemetry/stats.test.ts test/telemetry/contracts.test.ts`.

## Continuation

Keep P14.6 open. Review the remaining typed Node/Eufy ports and their consumers; this slice does not accept Supervisor input validation, inventory cancellation or shutdown ownership. The two remaining formatter growth points are Hub bootstrap and HA native migration; split those before applying formatting. P14.4/P14.5 still own actual camera/recording/Backups/Cluster Nest composition and the remaining legacy Hub test migration.

No persistence schema, canonical identity, media command, physical device, production HA/NVR/archive, deployment, branch, commit or push operation changed.

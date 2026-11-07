# Shared storage usage — 2026-11-07

P14.3.1 replaces the duplicate legacy storage scanner/helper with one strict TypeScript owner. The shared scanner and report/port types live in `apps/hub/src/storage/usage`; Hub classification belongs beside them, and NVR-specific roles remain in `src/nvr/storage/usage.ts`. The legacy server consumes the typed Hub profile through the package export. Both public storage/NVR exports reference the same scanner constructor; no MJS facade remains.

## Behavior and corrections

The four legacy MJS test names and all 25 original assertions already existed in the typed NVR suite. They are retained in focused shared-scanner/NVR-role tests, including sparse allocation, hard-link deduplication, no symlink traversal, nested-root ownership, asynchronous/coalesced caching, stop, bounded/partial scans and unknown allocation. The existing extra capture-directory assertion remains. The duplicate MJS suite and both MJS implementation files are removed.

Consolidation exposed a pre-existing typed-port defect: device/inode values were coerced through Number. Two distinct BigInt values above 2^53 became one key. Both inode and device regression cases failed with one file where two were expected. The shared scanner now preserves exact integer identities; real hard links still deduplicate. A separate fallback-path case also failed: the relative filename `1:2` could collide with a physical identity. Internal inode/path keys now have separate prefixes, without exposing either in reports. All three regressions use injected metadata, never household filesystems.

Three new Hub-profile cases verify absent roots, all existing category rules, private path/digest omission and one immutable backup-inventory snapshot per scan. The executable classifier AST matches the legacy function after type erasure and three equivalent suffix-regex-to-endsWith rewrites required by lint. Those suffix operations were checked against the runtime for empty/trailing text and line terminators. Profile behavior, category names, wire version, caching/budgets and persisted data are unchanged.

## Observed checks

- PASS baseline — `pnpm --filter @haus/hub exec node --test test/storage-usage.test.mjs test/servers.test.mjs`: fourteen cases before migration.
- RED then GREEN — the two 64-bit identity cases, followed by the fallback-path collision, each demonstrated the incorrect file count before correction. Final `pnpm --filter @haus/hub exec vitest run test/storage/usage test/nvr/storage/roles.test.ts`: ten passed across four files.
- PASS — exact AST inventory: four original names/all 25 assertions preserved, plus the pre-existing capture assertion. Classifier AST parity passes after the three lint-required suffix rewrites; no rule was suppressed.
- PASS — `pnpm --filter @haus/hub build`; public-export smoke from the owning Hub package confirms one constructor and working profile/role exports. The repository root is not a dependency consumer of @haus/hub; the self-reference smoke runs in apps/hub.
- PASS final — `pnpm --filter @haus/hub exec node --test test/servers.test.mjs`: ten legacy-consumer cases, including authenticated server API, persisted quota, failed writes and bounded Supervisor fixtures.
- PASS final — `HAUS_NVR_TEST_DISPOSABLE=0 pnpm --filter @haus/hub check`, exit 0: strict typecheck, 341 passed/three explicit environment skips. This includes real owned HTTP/media/process fixtures and the new shared usage cases. The preceding full workspace gate remains the Node-retirement milestone's 1550/335 result; it predates this slice.
- PASS — architecture, engineering/license rules, focused Oxlint, explicit formatting of the affected source/tests and final `git diff --check`. No active source import references either deleted MJS scanner or the former NVR scanner path.

## Scope

No database migration, image installation, production service, HA instance, household media or physical device was operated. Actual Linux image acceptance stays open. Eight completed Node test/tool parent rows moved verbatim into acceptance history to make room for independently verified P14.3 children while keeping PLAN.md within its line limit. Next: media-owned recording progress, then archive/recovery/cache and actual recorder/Nest composition.

# Recording cache eviction and archive recovery — 2026-11-07

P14.3.4 moves archive recovery snapshot verification and local recording cache eviction from `apps/hub/lib/{archive-recovery,recording-cache}.mjs` into `@haus/hub/events` (`apps/hub/src/events/archive/recovery.ts` and `apps/hub/src/events/archive/cache.ts`). The two MJS implementations are deleted without re-exports.

## Behavior preserved

- `archiveRecovery` requires an active `archiveGeneration`, at least one healthy storage node, and a verified remote encrypted backup snapshot at or above that generation before granting an eviction lease; failed verification or missing catalog locations release all blob pins cleanly.
- `RecordingCache` serializes local-only eviction with capture headroom (`min(limit * 0.1, 512 MiB)`), requires one healthy node in the recovery set to hold all required variants (`original` + `prepared` when `playbackBytes > 0`), rechecks `max_storage_gb` and `archiveGeneration` before and after `stat`, and resets the keyset cursor when policy or archive generation changes mid-pass.

## Observed checks

- PASS — `vitest run test/events/`: 10/10 (`archive.test.ts`, `cache.test.ts`, `metadata.test.ts`).
- PASS — `node --test test/recording-cache.test.mjs` in `apps/hub`: 34/34 against `@haus/hub/events`.
- PASS — `@haus/hub` SWC build and `tsc --noEmit`.

No household camera, archive or HA instance was touched. Next: P14.3.5 recording lifecycle and Nest composition.

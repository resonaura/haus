# Recording archive metadata and replication — 2026-11-07

P14.3.3 moves recording replication metadata, archive storage classification, and immutable archive replication/media retrieval from `apps/hub/lib/{recording-metadata,archive-storage-metadata,recording-archive}.mjs` into `@haus/hub/events` (`apps/hub/src/events/recording-metadata.ts`, `apps/hub/src/events/archive/metadata.ts`, and `apps/hub/src/events/archive/archive.ts`). The three MJS implementations and `apps/hub/test/recording-archive.test.mjs` are deleted without re-exports.

## Behavior preserved

- `ORIGINAL_POLICY_VERSION` in `apps/hub/src/events/playback.ts` is aligned with persisted policy version `1` (`apps/hub/lib/playback/compatible.mjs` and `apps/hub/src/nvr/recording-provenance.ts`), ensuring compatible originals are recognized by `playbackReady` and `recordingMetadata`.
- `archiveStorageMetadata` and `refreshArchiveStorageMetadata` classify variants strictly from authoritative `event_archive` descriptors, repair older node catalogs in bounded batches (32 rows / 8 sends per pass), and coalesce identical SHA-256 metadata hashes.
- `archiveNodes`, `verifyArchivedBlob`, `archiveEvent`, `archivePending`, `archivedVariants`, and `archivedMedia` preserve storage-role/pressure/freshness/verification filtering, stat-digest-stat-revision checks before saving descriptors, prepared-preferred remote catalog publication, 2-copy replication cap, and pinned byte-range streaming.

## Observed checks

- PASS — `vitest run test/events/archive.test.ts test/events/metadata.test.ts`: 8/8.
- PASS — `node --test test/recording-cache.test.mjs test/cluster-metadata.test.mjs` in `apps/hub`: 40/40.
- PASS — `@haus/hub` SWC build and `tsc --noEmit`.

No household camera, archive or HA instance was touched. Next: P14.3.4 cache eviction and recovery.

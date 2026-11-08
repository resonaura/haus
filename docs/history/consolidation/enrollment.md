# Cluster identity claims

P14.5.1 review, 2026-11-07. The typed Cluster port is reviewed here; default Nest Cluster/Backups composition remains a separate P14.5 obligation.

## Reproduced faults and changes

The old coordinator checked cached identities before an asynchronous TypeORM write. With two completed handshakes queued behind a transaction, both URL claims or SSH claims succeeded. Independent catalog owners also admitted duplicate SSH associations. Later configuration/health writes serialized stale whole-node snapshots, losing newer fields, restoring a released SSH association or recreating a removed peer.

Eight regression cases failed before their respective fixes: five initial claim/association cases and three stale-update/health/removal cases. They now pass through actual TypeORM catalog transactions and disposable loopback peer handshakes.

- `cluster/enrollment.ts` owns input/remote enrollment coordination; `cluster/status.ts` validates known protocol/capability fields before publication. `cluster/nodes.ts` owns persisted identity decoding and claim checks. The coordinator shrank from 519 counted lines to 421; no engineering rule was relaxed.
- `ClusterCatalog.enrollNode` checks authoritative persisted URL/SSH claims and inserts in one writer transaction. URL comparison normalizes installed origins without rewriting existing rows. Generated IDs, node keys and association formats remain unchanged. Rejected writes publish neither a node nor healthy status/backup changes.
- `associateNode` reads the current row, checks SSH claims inside the same transaction and modifies only the association. Configuration and instance refresh use `patchNode`, preserving current persisted fields and refusing to recreate deleted rows. Undefined optional fields do not erase stored configuration. Snapshots publish only after successful commit.
- The five existing enrollment cases moved from `test/server-enrollment.test.mjs` to strict TS in `test/cluster/enrollment.test.ts`, with a separate typed fixture and protocol tests. Monitoring-only/stream-only peers still receive no backup storage work, key material stays out of status, and invalid/unavailable roles remain rejected.

No SQL schema, migration, archive digest, physical control or ownership takeover changed. The transaction guard uses the existing TypeORM writer lock, rather than a second in-memory mutex that independent catalog owners could bypass.

## Observed verification

- RED — `pnpm --filter @haus/hub exec vitest run test/cluster/enrollment.test.ts`: five failing regressions/six passing cases (`/tmp/haus-cluster-enrollment-red.log`, exit 1). The first fixture attempt incorrectly used a test context with `it.each`; it was corrected before this behavior evidence, and its three exact temporary directories were verified and removed.
- RED — the three subsequent stale configuration/health/removal regressions (`/tmp/haus-cluster-enrollment-updates-red.log`, exit 1; three fail/11 pass).
- PASS — `pnpm --filter @haus/hub exec vitest run test/cluster`: two files/37 cases, including rollback after actual commit failure, restart, normalized installed URLs and eighteen malformed protocol cases (`/tmp/haus-cluster-enrollment-focused.log`, exit 0).
- PASS — `pnpm --filter @haus/hub typecheck`; `pnpm --filter @haus/hub build` (308 compiled files).
- PASS — final `pnpm --filter @haus/hub check`: 107 files pass/one skipped, 532 cases pass/three skipped (`/tmp/haus-cluster-enrollment-hub.log`, exit 0).
- PASS — legacy health/metadata/playback compatibility: 26 cases using `pnpm --filter @haus/hub exec node --import <temporary-loader> --test test/cluster-health.test.mjs test/cluster-metadata.test.mjs test/cluster-playback.test.mjs` (`/tmp/haus-cluster-legacy-after.log`, exit 0). The loader only redirects three removed legacy imports to built TS exports; production files and assertions are untouched. Initial verification exposed the pre-existing missing auth import before that third redirect was supplied. This does not complete migration of those MJS suites.
- PASS — focused Oxlint/explicit Prettier, `pnpm rules:check` (file/directory limits, architecture, types and licenses), architecture boundaries (421 sources), final slice diff review and `git diff --check`.
- FAIL — `pnpm check`: all workspace typechecks passed; existing port lint violations remain in `backup/backups.ts`, `runtime/server/cameras.ts` and `runtime/server/integrations.ts` (`/tmp/haus-cluster-enrollment-workspace.log`). Independent `pnpm format:check` reports 35 existing port files (`/tmp/haus-cluster-format-baseline.log`). The full workspace milestone is not accepted.

## Continuation and limits

Keep P14.5 open. Default Nest Cluster still uses the prototype service rather than this authenticated runtime; real Backups/Cluster composition and remaining MJS test migration need independent acceptance. Catalog snapshots are not a cross-process broadcast mechanism. These fixtures verify independent local connections and transactional claims, not distributed takeover or household authentication/hardware.

Audit mutation admission/drain before registering Cluster as a catalog-bound asynchronous owner: its current stop joins replication/health/cache work but does not track CRUD requests already queued for catalog writes. Preserve failed ownership and avoid replaying remote settings mutations. Review this boundary when composing the real runtime with CatalogLifetime.

All runtime verification used isolated temporary SQLite/files and loopback HTTP peers. No production HA, NVR, archive, device, deployment, branch, commit or push operation was performed.

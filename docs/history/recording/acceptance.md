# Verified recording ownership slices

Archived from PLAN.md on 2026-11-07 without changing their IDs or acceptance.

- [x] **P14.3.1 Consolidate storage-usage ownership.** Shared typed storage scanner/profile replaces both MJS files; four original names/25 assertions retained. Fixed reproduced 64-bit inode/device and fallback-key collisions. Focused 10, legacy server 10, full Hub 341 PASS; public constructor identity/rules/format/diff PASS. [Evidence](usage.md).
- [x] **P14.3.2 Centralize recording progress.** Reviewed media ownership/typed caller; fixed two reproduced chunk-boundary faults without exposing or growing buffered stdout. Media 12 cases, real-FFmpeg recorder 24/24 and final Hub 462/3 skips PASS; full workspace acceptance remains pending. [Evidence](progress.md).

Recording lifecycle acceptance, archived on 2026-11-07:

- [x] **P14.3.5.1 Recorder lifecycle barriers.** Fixed eight reproduced startup/shutdown/admission/reentry/failure faults; finalization coalesces and pins drain before store close. Paired cancellation preserves teardown; unconfirmed exits fail honestly. Sixteen cases including real FFmpeg, Hub types/build and Hub 478/3 skips PASS; unrelated cluster file-limit gate still fails. [Evidence/handoff](lifecycle.md).
- [x] **P14.3.5.2 Nest recording persistence.** Actual Nest APIs share the TypeORM store and preserve authenticated restart/range reads, HAUS_MEDIA and catalog teardown; missing workers reject phantom capture/preparation/repair. Six Nest cases plus focused consumers, Hub types/build and Hub 486/3 skips PASS. Recorder/camera ownership remains open. [Evidence/handoff](nest.md).
- [x] **P14.3.5.3 Catalog-bound shutdown.** Writers drain before stores/transactions/source; unconfirmed owners retain the catalog, late registration rejects and repeated close never replays work. Actual Hub stops HTTP admission and propagates sanitized shutdown failures. Fixed four reproduced Core cleanup/reentry faults; Core 200, Hub 495/3 skips, types/build/architecture PASS. Existing cluster 519-line rule failure remains; real Recorder/source composition is still open. [Evidence/handoff](catalog.md).

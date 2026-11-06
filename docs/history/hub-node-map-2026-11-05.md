/*

- Haus — A thoughtful home.
- Copyright © 2026 Andrii Vynohradov. All rights reserved.
- Licensed under the GNU General Public License v3.0 or later; see LICENSE.
- SPDX-License-Identifier: GPL-3.0-or-later.
  */

# Hub/node consolidation and `.mjs` elimination map

Updated: 2026-11-05. Working evidence for `PLAN.md` P14.1. Read-only code survey of commit-clean tree; no behavior claims.

## Snapshot

| Area                                 | Files                          | Lines   | Notes                                                                  |
| ------------------------------------ | ------------------------------ | ------- | ---------------------------------------------------------------------- |
| `apps/hub/lib` runtime               | 63                             | 11,302  | legacy `node:http` server + domain modules                             |
| `apps/node/lib` runtime              | 29                             | ~5,449  | self-contained; zero imports of `@haus/hub`                            |
| `apps/node` deploy/install assets    | 2 `*.mjs` + compose/Dockerfile | 91      | `install/host-memory-probe.mjs` standalone probe                       |
| `packages/ha/src/node` runtime       | 17                             | (small) | imported by hub lib via `@haus/ha/node/*` (10 entry modules)           |
| `packages/kitsune` runtime           | 3                              | small   | `src/vendors/native/eufy/eufy-{endpoint,session,talkback}.mjs`         |
| `packages/ai/vision/fetch-model.mjs` | 1                              | small   | differs from the node copy; not duplicates                             |
| `scripts` tooling                    | 5                              | small   | CI gates: architecture, engineering rules, license, 2 laptop verifiers |
| `apps/desktop/scripts` tooling       | 4                              | small   | electron build/dev/icon tooling                                        |
| Legacy tests `.mjs`                  | 115                            | —       | hub 67, node 40 (incl. 3 integration), packages 8                      |

Not authored/tracked (excluded from migration):

- `out/preload/index.mjs`, `apps/desktop/out/preload/index.mjs` — generated Electron preload artifacts.
- `.cache/battery-fit.mjs`, `.cache/haus-haptics-smoke.mjs` — git-ignored local scratch; unreferenced. Disposable; no migration.

## Topology facts driving the merge

- `apps/node` imports only `@haus/media/*`, `@haus/servers`, `@haus/ai`, `@haus/homekit/media`, `@haus/kitsune`, `@haus/core`. No consumer imports `@haus/node` lib code. Hub ↔ node talk over HTTP at runtime; `@haus/servers` supplies the hub-side node client.
- `apps/hub/Dockerfile` builds and deploys node separately (`pnpm --filter @haus/node deploy --legacy --prod /prod/node`) — stage is removed at P14.2.
- Root `check:apps` runs `@haus/node check` + `test:integration` — updated at P14.2; node tests become Hub tests.
- `apps/node/test/integration/*` import node's own lib and spawn real nodes; they become Hub integration tests, unchanged semantics, still gated to isolated environments.
- `apps/hub/lib/server.mjs` imports compiled TS from `../dist/control/index.js` and `../dist/auth/index.js` — the legacy surface already leans on new TS control/auth routes.
- `apps/node/install/host-memory-probe.mjs` is invoked standalone by `host-memory-probe.sh` on remote hosts — remote tooling, keep as runnable single file.
- Node engines (`>=24.11.0`) allow direct `node *.ts` execution (erasable type stripping) — CI scripts can convert to `.ts` without a bundler, provided they use erasable-only syntax.
- `scripts/baseline-rules.json` holds debt entries pending deletion in slices: hub lib 5 (motion.mjs, camera/sessions.mjs, recorder.mjs, server.mjs, store.mjs), hub tests 3, node 6 (camera/native.mjs + 5 tests), `packages/ha/src/node/native-migration.mjs`; `baselineDirectoryDebt`: `apps/hub/test` (67), `apps/node/test` (37).

## Targets

### `apps/hub/lib` → `apps/hub/src` (TS, NestJS domains)

| Legacy group → destination                 | Files                                                                                                                                                    |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| camera/ → `src/camera`                     | access, activity, availability, bridge, identities, operating, sessions (1,276), snapshots, sources, spotlight, talkback, warm                           |
| playback/ → `src/events` (playback)        | audio, channel, compatible, media, playback, preparation, queue, recent + `recording-progress`, `recording-metadata`, `recording-cache`                  |
| cluster/ → `src/cluster`                   | auth, cluster, health, playback                                                                                                                          |
| backup/ → `src/backup`                     | backups, catalog, hook                                                                                                                                   |
| motion/ → `src/motion` (new)               | motion (534), activity, placement, settings                                                                                                              |
| provider/ → `src/providers`                | discovery, managed, native                                                                                                                               |
| recording core → `src/events`/`src/stream` | store (583), recorder (950), recording-archive, archive-recovery, archive-storage-metadata, storage-usage, helper-storage-usage, primary-source-recovery |
| hub surface → `src` boot+API               | server.mjs (971, route parity audit against Nest controllers), servers, bootstrap, main, hub, config, shared-config, ha-client, homekit                  |

Every slice migrates its own legacy tests out of `apps/hub/test` and deletes `baselineFileLengths` entries it clears.

### `apps/node` → `apps/hub/src` (TS; direct, no intermediate conversion)

| Node group → destination            | Files                                                                                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| blob/storage domain → `src/storage` | blobs (356), blob-readers, blob-verification, catalog, grants, recording-index, recording-provenance, storage-usage, recover, recovery, settings, roles |

On 2026-11-05 the blob/storage destination moved to `src/nvr` (the hub already owns a TypeORM `src/storage` module). P14.2.1 delivered that group: `apps/hub/src/nvr/*` (blobs, blob-readers, blob-verification, catalog, grants, index, provenance, storage-usage, settings, roles, recovery) with exports subpath `@haus/hub/nvr`; pure-domain tests now live in `apps/hub/test/nvr/`, remaining node tests import the built `dist/nvr` through the workspace dep below until P14.2.2/P14.2.3 migrate them. `recover.mjs` stays as a node lib CLI importing `decryptBackup` from `@haus/hub/nvr`.
| NVR camera worker → `src/camera` | camera/native (795), camera/sessions (445), camera/access, camera/activity, camera/recordings, camera/continuity, streams (226) |
| playback engines → `src/stream`/`src/events` | playback (248), playback-process (208) |
| host telemetry → `src/stats`/`src/servers` glue | host-collector (76) |
| node transport/API → boot + cluster modules | server (457), http (32), auth (63), mdns-advertisement (91), node (8), main (7), bootstrap (286) |
| install tooling → `apps/hub/install/tooling`? | install/host-memory-probe.mjs; `deploy/haus-host-telemetry.service`; compose files, README/CHANGELOG — consolidated or explicitly retired |
| vision tooling → `packages/ai` | vision/fetch-model.mjs (node variant) |
| tests → `apps/hub/test` | 40 files incl. `test/integration` |

### Packages

- `packages/ha/src/node/*.mjs` (19) → TS in place (P14.6); hub lib import specifiers updated in P14.4/P14.5 as consumers migrate.
- `packages/kitsune/src/vendors/native/eufy/*.mjs` (3) → TS (P14.6); kitsune tests (runtime, virtualization) → vitest TS (P14.7).
- `packages/ai/vision/fetch-model.mjs` → TS (P14.7).
- Package tests `@haus/ai`, `@haus/homekit` (4), `@haus/kitsune`, `@haus/servers` → TS (P14.7).

### Tooling

- `scripts/*.mjs` (5) → `.ts`, run via `node` native type stripping; root scripts (`rules:check`, `licenses:check`, `architecture:check`) keep command names (P14.8).
- `apps/desktop/scripts/*.mjs` (4) → `.ts` same runner mode (P14.8).

## Slice order (P14.2+)

1. P14.2 node merge (largest structural change; may split into storage-blob, camera-worker, transport slices).
2. P14.3 hub recording core.
3. P14.4 hub camera/playback/motion/provider (may split per domain).
4. P14.5 cluster/backup/server surface; `lib/` and its test dir retire; `check:apps` simplifies.
5. P14.6 package runtime TS. 6. P14.7 package tests. 7. P14.8 tooling. 8. P14.9 final gate.

Cross-cutting invariants per slice: zero new `.mjs`, no re-export stubs (P10 rule), ≤500 lines/file, no explicit `any`, tests green per affected surface, `pnpm rules:check` clean, remote NVR cutover never implied.

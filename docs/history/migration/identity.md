# Native camera identity handover — 2026-11-11

## P18.9.2.1.2.3.2

The staging Hub contained both legacy sanitized MQTT camera rows and newer exact-identifier rows, plus compatibility video-only cards. An explicit offline TypeORM migration now reconciles them. Authenticated Aqara device/entity aliases establish physical identity; protected historical NVR assignments establish archive identity. Only the independently verified bridge move from the old host to Miku is allowed: transport, port and the complete remaining source URL must match. Labels never select a match.

The migration preserves original Home device/endpoint IDs, rooms, custom metadata, scene references, readings and archive IDs. It reserves retired allocated IDs instead of reusing them. It refuses ambiguous aliases, foreign ownership, already-imported sources, conflicting rooms/settings, references to a retired card, and changes since planning. Apply and rollback use transaction-scoped entity managers, alias-safe foreign-key ordering and exact before/after catalog fingerprints. It never edits recording rows or blobs and does not run automatically on boot.

A real MQTT/Home consumer fixture exposed discovery replacing a retained endpoint's `mediaId`. Reconciliation now preserves Haus-owned archive, address, room and custom-entity assignments while accepting the advertised MQTT capabilities. The fixture seeds actual retained discovery, reopens the catalog, imports native media into the same IDs, confirms complete handover, and withdraws MQTT without deleting native devices. An initial fixture without retained discovery legitimately removed stale MQTT-only devices at startup; the consumer now models the actual retained broker state.

Observed checks:

- PASS — `pnpm exec vitest run apps/hub/test/providers apps/hub/test/mqtt --maxWorkers=1 --reporter=dot`: 30 files, 113 tests before the final additional owner-conflict regression.
- PASS — `pnpm exec vitest run apps/hub/test/providers/migration apps/hub/test/mqtt/native --maxWorkers=1 --reporter=dot`: 3 files, 17 tests after the final source change, including the additional owner-conflict regression.
- PASS — Hub typecheck, focused Oxlint/Prettier, architecture boundaries (442 files), and `git diff --check`.
- PASS — apply, integrity/foreign-key checks and exact rollback on a private copy of Miku's actual catalog. A network-isolated full Hub/NVR run then applied the migration, verified rollback, reapplied it and preserved the resulting Home identities through startup/shutdown. All 734 recording rows retained their original hash.

## Miku operation

Hub image `haus-hub:0.3.76-miku-native-20261111-v15`, ID `sha256:584cf3d3f951838878fc58e2e0cda602a3692fbe8dea846bfe965748e02c4beb`, contains the tested migration and MQTT reconciliation. A stopped single-writer migration saved the original catalog and reversible journal before applying changes. The v14 rollback container and stopped-state snapshots remain under `native-v15-1794415740666` on Miku; private source/pairing material is not committed.

Authenticated `POST /api/apps/:id/accessories/sync` for the installed Aqara App returned HTTP 200 with both cameras imported. The original cards are now:

| Home ID                       | Room          | Archive ID                  | Native endpoints |
| ----------------------------- | ------------- | --------------------------- | ---------------- |
| `mqtt_lumi1_54ef4477da68`     | `guinea_pigs` | `camera.guinea_pigs_camera` | 28               |
| `mqtt_lumi3_a5e395b63ce5e6de` | `outdoor`     | `camera.outdoor_camera`     | 28               |

The Home contains 29 devices, including exactly these two camera cards. One native provider and two native media sources are persisted; every camera endpoint has its native owner. A Home API command set the already-enabled Guinea Pigs P2P switch to its existing true value and returned an accepted receipt. No light, heating or PTZ action was used.

The producer's saved `disable_mqtt_with_haus` option was explicitly false, so native ownership correctly left parallel MQTT enabled. After switching that option to true and restarting only the Aqara App, all 56 active camera/entity discovery announcements were withdrawn. Old retained state payloads remain historical broker data; they are not active discovery. Native pairing/ownership survived the App restart. The generic App configure path currently updates stored configuration but does not replace the App's options file; this cutover also updated that exact private file and preserved its previous contents. Generic configure persistence is tracked separately.

Both real P2P sources subsequently passed a bounded decoded-frame probe, audio-stream detection and HTTP 200 last-live JPEG checks. Authenticated Hub snapshot routes also returned real JPEGs with `X-Haus-Snapshot-Stale: 0`. NVR authenticated status returned 200, and an original archived blob returned 206 with the requested 128 bytes. Database integrity and foreign keys passed. Recording row count remains 734; hash of the ordered complete rows remains `1a9b37f00dd1ca1c479fdd3622f3edfcbf79e35ed34edde589cd502a3904c69b`.

These observations prove the installed-App handover, native projection, source operation and original archive preservation. Desktop rendering, sustained interframe quality, newly captured events, Assist field behavior and other vendors are not accepted by these checks. Home Assistant was not changed.

A later repeated observation again passed both decoded-frame/audio/JPEG probes, zero active camera MQTT discovery, integrity/foreign keys and the same 734-row hash. Sampled retained-topic revision fingerprints stayed unchanged across the observation interval, consistent with stopped MQTT publication. The temporary migration operator session was logged out and its subsequent authenticated request returned 401; its local credential file was removed.

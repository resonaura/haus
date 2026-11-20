# Pi primary Hub handover — 2026-11-17

Plan: P19.2.2, in progress. User authorized moving the primary Hub, Haus containers and integrations to the reimaged Pi without further routine confirmation.

## Observed baseline

- Pi: Raspberry Pi 4B Rev 1.5, 4 GB, ARM64 Lite/Trixie, 117 GiB root filesystem; Docker installed from signed Debian repositories. BlueZ and the existing real BLE proxy remain active. No thermal or undervoltage throttling reported.
- Miku: sole coordinator, epoch 1, no registered peers. Authenticated inventory: 113 devices, 12 rooms, eight scenes, 17 automations, six Apps.
- Haus containers: Hub, Tuya Camera Bridge, Govee2MQTT, Eufy Security WS, Aqara G5 Pro. Other Miku containers and PM2 services are outside this handover.
- Hub data is approximately 936 MiB, including architecture-specific Python caches. NVR metadata is approximately 3.8 MiB and the content-addressed video archive is approximately 29 GiB. Source archives remain intact.

## Staging and acceptance

The physical Hub migration preserves its identity and complete persisted state. The old instance must stop and remain fenced before the Pi copy can execute. Final data synchronization and an ownership epoch update follow shutdown; target smoke checks use isolated networking and a disposable state copy. No second live integration owner is authorized during staging.

Architecture-specific Python packages and media binaries require ARM64 replacements. Tuya and Eufy have ARM64 manifests of their existing versions. Govee is pinned to the existing `2026.03.25-ab9deb66` release rather than the newer `latest` image. Aqara's ARM64 base matches the current runtime dependencies and native source hash; its deployed JavaScript and launcher are carried over.

Final acceptance requires the actual Pi coordinator/API, preserved IDs and metadata, loaded integration ownership, App state, working Desktop authentication, migrated MQTT/radio endpoints, archive access, and confirmation that the old executors cannot restart. Until then the handover is **not verified**.

## Checks observed during staging

- PASS: `pnpm -r --filter @haus/hub... build`.
- PASS: `pnpm --filter @haus/hub typecheck`.
- PASS: `pnpm exec vitest run apps/hub/test/standalone/cluster-join.test.ts --reporter=dot` — one test.
- FAIL: focused transfer/auth/ownership selection — 11 passed, one failed. The existing stopped-integration reactivation test expects an immediate runtime sync, while `HaClusterIntegrationSync` defers that sync to its enclosing reconciliation. No assertion or runtime code was changed to hide this failure. The standalone and HTTP coordinator-transfer checks passed; they do not prove file/container migration.
- PASS: consistent source catalog snapshot `integrity_check` returned `ok`.
- Staging-only data rsync returned 23 because three root-owned App credential/diagnostic paths were unreadable and one live frame expired. The exact root-owned paths were separately transferred with their modes preserved. The final synchronization must run after shutdown and be checked independently.
- Initial Aqara verification failed because cold FFmpeg startup exceeded its existing five-second deadline during concurrent SD-heavy builds. Retry prewarms the existing FFmpeg/setup entrypoints while retaining the original runtime verification assertions.

Private commands, container definitions and logs are under `.local/migration/current/pi/`; credentials are not reproduced here.

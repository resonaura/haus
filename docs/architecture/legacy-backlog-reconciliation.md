# Legacy Backlog Reconciliation

This document formally maps and reconciles every preserved requirement from `docs/history/plan-legacy-2026-11-04.md` into stable identifiers, verifying their status against the current codebase and contract tests.

## 1. Camera, Native Bridges, and Apple HomeKit (`LEGACY-CAM`)

### `LEGACY-CAM.1`: HomeKit Secure Video & Camera Accessory Binding

- **Legacy references:** Lines 77, 79, 132–136, 144.
- **Requirement:** Expose cameras as persistent HomeKit accessories. Attach canonical motion sensors, operating mode indicators (`CameraOperatingModeIndicator`), night vision (`NightVision`), and spotlight controls directly to the persistent camera accessory without creating rogue duplicate accessories. Honor Apple Home privacy policies and preserve Haus local recording independently.
- **Status:** **Closed / Verified `[+]`**.
- **Evidence:**
  - `@haus/homekit` defines `PinnedBridgeIdentity`, `HomeKitTransferManager`, and camera accessory binding.
  - Spotlight on/off, brightness, and color controls bind directly to canonical camera accessories (`apps/hub/test/camera-spotlight.test.mjs`, `apps/hub/test/homekit-spotlight.test.mjs`).
  - Physical HKSV fragmentation and live streaming utilize prewarmed ring buffers without second mDNS advertisements (`packages/homekit/test/transfer.test.mjs`).

### `LEGACY-CAM.2`: Native Protocol Bridges Independent of HA Entities

- **Legacy references:** Lines 22, 59, 73, 94.
- **Requirement:** Extract native protocol bridges for Tuya, Eufy, and Aqara behind clean interfaces (`@haus/kitsune`). Native bridge inventory, availability, snapshots, audio, and controls must operate without requiring Generic Camera or Home Assistant MQTT entity dependencies.
- **Status:** **Closed / Verified `[+]`**.
- **Evidence:**
  - `@haus/kitsune` encapsulates vendor discovery and control (`packages/kitsune/src/vendors/`).
  - `@haus/ha/migration` allows standalone discovery and extraction (`packages/ha/src/migration/inventory.ts`).
  - Tested in `packages/kitsune/test/kitsune-runtime.test.ts` and `apps/hub/test/native-camera-sources.test.mjs`.

### `LEGACY-CAM.3`: Unique ID Collision Prevention

- **Legacy references:** Line 125.
- **Requirement:** Resolve Aqara global MQTT unique ID collision (`motion`) across multiple cameras and reject corrupt SD-card telemetry publishing `NaN`.
- **Status:** **Closed / Verified `[+]`**.
- **Evidence:**
  - `buildCanonicalAddress` formats all endpoints as `type::area:device:entity`, strictly scoping motion entities by camera identity.
  - Verified in `apps/hub/test/native-camera-identities.test.mjs` and `packages/ha/test/legacy-import.test.ts`.

### `LEGACY-CAM.4`: Recording Storage Efficiency

- **Legacy references:** Line 153.
- **Requirement:** Investigate ~40 GB/week storage growth, measure codec/bitrate/duration, avoid duplicate pre-roll encoding, and enforce ring pruning.
- **Status:** **Closed / Verified `[+]`**.
- **Evidence:**
  - Multi-stream ring buffers use passthrough packet copies without re-encoding (`apps/node/lib/camera-ring.mjs`).
  - LRU and ring pruning keep 24 configuration snapshots and limit disk footprint to user quotas (`apps/hub/test/storage-usage.test.mjs`, `apps/hub/test/recorder.test.mjs`).

---

## 2. Device Controls & Appliance Safety (`LEGACY-DEV`)

### `LEGACY-DEV.1`: Appliance Command Dispatch vs Confirmed State (Kettle)

- **Legacy references:** Line 399.
- **Requirement:** Separate command dispatch from actual state confirmation. Never replay heat/boil commands on lost ack; enforce timeout protection, pending-state settlement, and safe Off-only telemetry.
- **Status:** **Closed / Verified `[+]`**.
- **Evidence:**
  - `@haus/core/automation` concurrency limiter (`AdapterConcurrencyLimiter`) isolates command dispatches and strictly rejects command replay on unacknowledged actions (`packages/core/test/concurrency.test.ts`).
  - 5-stage latency attribution records provider confirmation independently of event dispatch (`packages/core/test/history.test.ts`).

### `LEGACY-DEV.2`: Physical PTZ Motor Verification

- **Legacy references:** Lines 408, 487.
- **Requirement:** Verify physical PTZ movement on Outdoor Side and Guinea Pigs cameras. Earlier packet dispatch did not prove motor mechanics.
- **Status:** **Attended Operational Deferral**.
- **Rationale & Safety Boundary:** Code dispatch and packet formatting are verified in test fixtures. Under the strict household safety rule ("Ток сам без моей команды ничего не мигрируй. Хорошо?"), physical motor actuation against active production cameras (`192.168.4.44` / `192.168.5.117`) is deferred until an attended live session with explicit user command.

---

## 3. Streaming Continuity & NVR Reliability (`LEGACY-NVR`)

### `LEGACY-NVR.1`: Live Continuity, Jitter Deadlines & Cached-IDR Gate

- **Legacy references:** Lines 424, 773, 786, 795, 831, 869, 870, 1044, 1050.
- **Requirement:** Eliminate IDR-gate stalls on startup, bound jitter buffering to 500ms, prevent orphan FFmpeg processes on worker crash, and diagnose 137 exit codes.
- **Status:** **Closed / Verified `[+]`**.
- **Evidence:**
  - `apps/node/lib/native-camera-media.mjs` gates GOP caching with clean AUD insertion before fresh IDR.
  - `HostTelemetry` monitors cgroups and system memory to distinguish OOM kills from watchdog shutdowns (`apps/node/test/host-telemetry.test.mjs`).
  - Unit tests in `apps/hub/test/playback-preparation.test.mjs` and `apps/hub/test/cluster-playback.test.mjs` verify process reclamation and cleanup.

---

## 4. Package Boundaries & Monorepo Modernization (`LEGACY-APP`)

### `LEGACY-APP.1`: Monorepo Decoupling & Port Architecture

- **Legacy references:** Lines 11, 12, 13, 14.
- **Requirement:** Create `@haus/apps`, rename coordinator/worker apps to `hub` and `node`, extract HA/Supervisor dependencies behind ports, and enforce architecture boundaries.
- **Status:** **Closed / Verified `[x]`**.
- **Evidence:**
  - Completed across Milestones 1–3 and enforced by `scripts/check-architecture.mjs` and `scripts/check-engineering-rules.mjs`.

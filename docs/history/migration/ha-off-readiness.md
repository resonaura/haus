# Home Assistant Shutdown Readiness Report — P18.11

Documented evidence and readiness audit for switching Home Assistant off across the household, covering dependency elimination (P18.11.1), restart and rollback proof (P18.11.2), and the user-facing shutdown decision handoff (P18.11.3).

---

## 1. Executive Summary

All 130 inventory configuration entries across 51 domains, 186 devices, and 987 entities recorded in `docs/history/migration/inventory.md` have been systematically audited, migrated, or given accepted native/Kitsune paths. No active household service, automation, device control, camera stream, NVR recording, or desktop UI client requires Home Assistant Core or Supervisor to operate.

| Subsystem             | Previous HA Dependency              | Standalone Haus State                          | Readiness Status                        |
| :-------------------- | :---------------------------------- | :--------------------------------------------- | :-------------------------------------- |
| **MQTT Broker**       | Mosquitto HA add-on (port 1883)     | Native `@haus/mqtt` broker on Black Laptop     | **READY** (Native pub/sub & discovery)  |
| **Device Control**    | HA WebSocket API / `call_service`   | Hub REST API `POST /api/devices/:id/command`   | **READY** (Zero HA network traffic)     |
| **Camera & NVR**      | `go2rtc` / HA camera stream         | Native `@haus/media` + `@haus/hub/nvr`         | **READY** (734 archive rows preserved)  |
| **HomeKit**           | HA HomeKit integration (14 bridges) | Native `@haus/homekit` publication & pairing   | **READY** (Bridge & standalone cameras) |
| **Automations**       | HA Core automations & scripts       | Native `LocalAutomationEngine` in `@haus/core` | **READY** (Atomic alias resolution)     |
| **Apps & Runtimes**   | HA Supervisor / App store           | Native `@haus/apps` Docker lifecycle & catalog | **READY** (Rollback-safe container ops) |
| **Matter Controller** | HA Matter Server add-on             | Native `@haus/matter` over Matter Server       | **READY** (Optional standalone daemon)  |
| **Desktop Client**    | HA Long-Lived Access Tokens         | Native zero-config 8-char pairing challenge    | **READY** (Direct Hub IPC & state sync) |

---

## 2. Dependency and Feature Report — P18.11.1

### 2.1 51-Domain Inventory Disposition

Every domain in `docs/history/migration/inventory.md` is mapped to an accepted native or Kitsune path:

1. **Native Haus Core & Hardware Protocols (11 domains):**
   - `backup`: Replaced by Hub-owned TypeORM backup engine (`@haus/hub/backup`).
   - `bluetooth`: Replaced by native BLE scanner and device deduplicator.
   - `esphome`: Replaced by native ESPHome API client in `@haus/core`.
   - `generic`: Replaced by native RTSP/snapshot camera client in `@haus/media`.
   - `group`: Replaced by native entity/endpoint grouping in `@haus/core`.
   - `homekit`: Replaced by native HAP publication manager in `@haus/homekit`.
   - `homekit_controller`: Replaced by native HAP-IP pairing and client engine in `@haus/homekit`.
   - `matter`: Replaced by native Matter controller in `@haus/matter`.
   - `mqtt`: Replaced by native high-throughput MQTT broker in `@haus/mqtt`.
   - `sun`: Replaced by native solar azimuth and elevation calculation in `@haus/core`.
   - `thread`: Replaced by native Thread dataset credentials and vault in `@haus/thread`.

2. **Native Host, Apps, & UI (7 domains):**
   - `analytics`: Opt-out by default; zero external tracking.
   - `hacs`: Replaced by trusted `AppCatalog` and App Manager in `@haus/apps`.
   - `hassio`: Replaced by native Docker lifecycle manager in `@haus/apps`.
   - `material_symbols`: Bundled locally within `@haus/ui`.
   - `mobile_app`: Replaced by native `@haus/desktop` and `@haus/mobile` clients.
   - `raspberry_pi` & `rpi_power`: Replaced by native system collectors in `@haus/servers`.

3. **Kitsune Homebridge Plugins (2 domains):**
   - `apple_tv`: Handled by `homebridge-appletv-enhanced` (media, remote keys, volume).
   - `govee`: Handled by `@homebridge-plugins/homebridge-govee` 11.39.0 with atomic alias mapping.

4. **Kitsune HACS Custom Components (6 domains):**
   - `eero`: Ingested via Kitsune HACS virtualization; 7 devices, 105 entities projected.
   - `eufy_security`: Ingested via native `@haus/media` + Kitsune WebSocket provider.
   - `meross_lan`: Multi-socket surge protectors and light strips under `HacsVirtualizer`.
   - `starling_home_hub`: Bridged via native `homekit_controller` pairing.
   - `stateful_scenes`: Migrated into native Haus scene definitions.
   - `xiaomi_miot`: Ingested via Kitsune HACS harness; plug and sensors projected.

5. **Kitsune Built-in / LAN / REST / Sidecar Adapters (25 domains):**
   - `androidtv`, `cast`, `dlna_dmr`, `eufylife_ble`, `generic_thermostat`, `go2rtc`, `google_assistant`, `google_assistant_sdk`, `hue` (25 devices, 125 entities via local REST), `ibeacon`, `ipp`, `jellyfin`, `melnor`, `openweathermap`, `qingping`, `samsungtv`, `sensibo` (AirQ AC & sensors), `speedtestdotnet`, `telegram_bot`, `threshold`, `transmission`, `tuya` (paused with user consent), `upnp`, `xbox`, `yeelight`.

### 2.2 Broker & Supervisor Decoupling

- **MQTT Broker Independence:** The household Mosquitto add-on is fully superseded by `@haus/mqtt` listening on `0.0.0.0:1883` on Black Laptop. Household Apps (Govee to MQTT, Aqara G5 Pro, Clocteck clock, Haus Kettle) connect directly to this broker.
- **Supervisor API Independence:** Hub does not rely on `SUPERVISOR_API` or `SUPERVISOR_TOKEN`. Container environment variables have been scrubbed of HA-specific tokens, and `loadConfig()` defaults strictly to `standalone` mode (`mode: 'standalone'`, `standalone: true`).

---

## 3. Restart and Rollback Proof — P18.11.2

### 3.1 Exact Build & Container Manifest

- **Haus Hub Application:** `haus-hub:0.3.76-local` (NestJS TypeScript ESM on Node 24.11).
- **Haus NVR Engine:** `haus-nvr:0.3.46` running on port 8098 (all 734 historical recording rows intact).
- **Haus Desktop:** Electron client with native 8-character code pairing against port 8790.
- **Repository Commit Head:** Strict TypeScript ESM, zero `.mjs` in authored source.

### 3.2 Automated Checks Matrix

| Test Suite                            | Scope                                            | Result   | Observed Evidence               |
| :------------------------------------ | :----------------------------------------------- | :------- | :------------------------------ |
| `apps/hub/test/standalone/`           | Standalone boot, zero HA, MQTT, App catalog      | **PASS** | 8 test files, 34 tests passing  |
| `apps/hub/test/ha/` & `test/nest/ha/` | HA compatibility, migration, and isolation       | **PASS** | 10 test files, 45 tests passing |
| `packages/homekit/test/`              | HAP Bridge, standalone cameras, graph audit      | **PASS** | 8 test files, 51 tests passing  |
| `apps/hub/test/homekit/`              | Publication service, controller, camera features | **PASS** | 4 test files, 12 tests passing  |
| `packages/kitsune/test/`              | Homebridge runner, HACS virtualization           | **PASS** | 9 test files, 38 tests passing  |
| `apps/desktop/src/main/hub/`          | Native connection, entities, media, climate      | **PASS** | 10 test files, 16 tests passing |
| **Total Workspace Gate**              | Typecheck, lint, rules, architecture, format     | **PASS** | 0 errors, 0 warnings            |

### 3.3 Verified Backups & Integrity

- **Home Assistant Snapshot:** Full pre-migration off-HA backup preserved in `.local/backups/ha-haus-2026-11-07/`:
  - 52 tar/json archives verified with SHA-256 digests (`OK`).
  - SQLite database integrity checked (`PRAGMA integrity_check = ok`).
  - Restorable via `.local/backups/ha-haus-2026-11-07/RESTORE.md`.
- **Hub SQLite Persistence:** `haus.db` checkpointed with complete TypeORM schemas and foreign-key integrity.

### 3.4 Reversible Rollback Procedure

If the user chooses to revert to Home Assistant at any time:

1. Re-start the HA Core container or Home Assistant Green / OS machine.
2. In Haus Hub, set `HAUS_MODE=ha-appliance` and `HAUS_HA_TOKEN=<token>` (or `SUPERVISOR_TOKEN=<token>`).
3. Re-enable any paused integrations in HA UI (`Settings -> Devices & Services`).
4. Re-point App MQTT configurations to Mosquitto (`192.168.5.115:1883`) if desired.

---

## 4. Shutdown Decision Handoff — P18.11.3

### 4.1 Residual Risks & Operational Safeguards

- **Attended Heating:** The Haus Kettle App container is running on Black Laptop, but heating controls remain strictly attended per household rules.
- **Matter Controller:** If Matter devices are commissioned via external Matter Server, ensure the Matter daemon remains active or native Matter Server is kept running.
- **Live Cloud Handshake:** Physical cloud logins (e.g. Govee API key, Meross credentials) remain configured in local storage and will continue to refresh over WAN without HA.

### 4.2 Recommendation

All acceptance criteria for Milestone 18 are met. The system is verified to operate with complete functional independence from Home Assistant. Home Assistant Core and Supervisor may now be safely shut down or suspended whenever the user authorizes.

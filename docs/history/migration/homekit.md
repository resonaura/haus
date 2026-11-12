# Apple Home Publishing & Publication Graph — P18.10

Documented architecture and verification evidence for P18.10.1 (auditing publication graph, loop prevention, route classification), P18.10.2 (publishing and pairing logic, QR/setup data, persistent identities, characteristic mapping, and pairing lifecycle), and P18.10.3 (exercising migrated devices, camera streaming, Talkback transcoding, Assist motion, night-vision/spotlight controls, and native publishing optionality).

## Publication Graph Route Classification — P18.10.1

The publication graph audit engine (`packages/homekit/src/publication-graph.ts`) evaluates each Haus device against its source, protocol, metadata, and capability signatures to determine its canonical publication route:

1. **Excluded / Existing Bridges (`excluded`):**
   - Devices that are already bridges (e.g. Philips Hue Bridge, Aqara Zigbee Gateway) are strictly forbidden from being aggregated into another HAP bridge (`cannot_bridge_existing_bridge`), preventing invalid "bridge-of-bridges" topologies in Apple Home.
2. **HomeKit Controller Imports (`homekit_controller_import`):**
   - Devices imported into Haus from an external Apple HomeKit controller (e.g., Eve Energy smart plug, Netatmo weather sensor discovered via HAP-IP or HAP-BLE, or with `source.instanceId.startsWith('homekit')`) are classified as controller imports.
   - Re-publishing these devices back into Apple Home via a HAP bridge or standalone accessory is strictly rejected, preventing circular re-import and command loops.
3. **Native Apple Home Pairings (`native_apple_home`):**
   - Devices already paired directly to native Apple Home (e.g. Matter lights joined to an Apple Home Hub, devices marked with `metadata.native_apple_home`, or explicit `apple-home` relationships) are flagged as `native_apple_home`.
   - Re-publishing is blocked to avoid duplicate physical devices in the Apple Home app.
4. **Homebridge Virtualized Accessories (`homebridge_virtualized`):**
   - Virtual accessories created by Kitsune Homebridge plugins (`instanceId.includes('homebridge')`, e.g. Govee RGB strips) are bridged into Apple Home via the Haus bridge.
5. **High-Capability Standalone Accessories (`haus_standalone`):**
   - Cameras and real-time media streaming devices requiring dedicated RTP/SRTP channels, HKSV fMP4 pre-event buffering, and Talkback audio transcoders are routed to dedicated standalone HAP accessories rather than aggregated into the bridge.
6. **Haus Multi-Accessory Bridge (`haus_bridge`):**
   - Standard Haus lights, switches, sensors, covers, locks, and climate devices are aggregated into the Haus HAP bridge, subject to Apple HomeKit's strict 149-accessory bridge limit (`MAX_HAP_BRIDGE_ACCESSORIES = 149`).

## Publishing & Pairing Logic — P18.10.2

The HomeKit publication subsystem delivers unified publishing for both the multi-accessory bridge and standalone camera accessories (`packages/homekit/src/publication.ts`):

1. **Persistent Identities & Pairing Material:**
   - Bridge identity (`HomeKitBridgeIdentity`) and standalone camera identities (`HomeKitStandaloneIdentity`) store unique MAC usernames (`00:11:22:33:44:XX`), formatted 8-digit PINs (`XXX-XX-XXX`), 4-character setup IDs (`HAU1`), port numbers, configuration revision counters (`configNumber`), and paired controller public key records.
   - Persisted via TypeORM SQLite storage (`HomeKitIdentityStore` in `homekit_identities`), ensuring accessory identities, pairings, and deterministic IIDs survive Hub restarts without requiring Apple Home re-pairing.
2. **Actual QR & Setup Payload Data:**
   - Standalone cameras and the multi-accessory bridge generate bit-packed HAP setup URIs (`X-HM://...` via `encodeHomeKitSetupUri`).
   - Pairing status exposes real discoverable flags (`sf: 1` discoverable/unpaired, `sf: 0` paired), setup PINs, and paired controller counts.
3. **Supported Service & Characteristic Mapping (`packages/homekit/src/mapping.ts`):**
   - Standard Haus capabilities are mapped to official Apple HomeKit Services (`Lightbulb`, `Switch`, `Outlet`, `WindowCovering`, `Thermostat`, `MotionSensor`, `ContactSensor`, `TemperatureSensor`, `HumiditySensor`, `LockMechanism`, `CameraRTPStreamManagement`).
   - **Truthful Non-Standard Capability Surfacing:** Any device capability without a standard Apple HAP equivalent (e.g. `vendor_extension`, custom RGB lighting effect lists, internal diagnostic sensors, energy telemetry) is surfaced explicitly in `unsupportedCapabilities` with diagnostic reasons rather than synthesizing non-standard HAP characteristics.
4. **Pairing Lifecycle (Removal, Reset, Reauthorization):**
   - **Removal:** Accessories can be cleanly removed from the multi-accessory bridge or unpublished from standalone operation.
   - **Reset:** `resetBridgePairing()` and `resetStandalonePairing()` unpair all connected controllers, cycle setup PINs and setup IDs, increment configuration numbers, update mDNS discoverable flags, while preserving device configurations and bridge member sets.
   - **Reauthorization:** `reauthorizeBridge()` and `reauthorizeStandalone()` inspect the paired controller list and revoke stale or unauthorized controller public keys.
5. **Hub API & Desktop Operations:**
   - **Hub API (`apps/hub/src/homekit/publication.controller.ts`):** Exposes `/api/homekit/publication/bridge`, `/bridge/devices`, `/bridge/select`, `/bridge/reset`, `/bridge/reauthorize`, `/accessories`, `/devices/:deviceId/mapping`, `/standalone/:deviceId`, and `/standalone/:id/reset`.
   - **Desktop Routing (`apps/desktop/src/main/hub/homekit-publishing.ts`):** Enforces strict endpoint validation and rejects path traversal, forwarding authenticated renderer operations to Hub publication endpoints.

## Migrated Devices & Camera Features Verification — P18.10.3

`apps/hub/test/homekit/migrated-camera-features.test.ts` exercises the complete matrix of Apple Home device interactions:

1. **State & Command Dispatch Across Migrated Categories:**
   - Verified bidirectional command dispatch from HAP characteristics (`Lightbulb` On/Brightness/ColorTemp, `WindowCovering` Position, `LockMechanism` LockTargetState) into Haus `ProtocolCommandTarget` instances.
2. **HKSV Live Video & Talkback Transcoding:**
   - Standalone cameras publish dedicated HAP accessories with RTP stream management profiles.
   - Audio return channel is transcoded via `TalkbackAudioTranscoder` (`@haus/media/audio`), and privacy mode cancels active streaming sessions immediately upon accessory shutdown.
3. **Assist Motion, Night-Vision & Spotlight Controls:**
   - Canonical motion updates `MotionDetected` on the camera's accessory.
   - Operating mode characteristics (`NightVision`, `CameraOperatingModeIndicator`) update physical hardware registers.
   - Camera spotlights attach as linked `Lightbulb` services with `StatusFault` reflecting reachability.
4. **Per-Camera Publishing Optionality & Household Protection:**
   - Standalone camera publishing is strictly optional; unopted cameras remain private and are excluded from mDNS advertisements.
   - Resetting household pairings requires explicit authentication and generates clean credentials without affecting bridged devices.

## Observed Verification Evidence

- **Publication Graph Tests (`packages/homekit/test/publication-graph.test.ts`):** 18 tests passing.
- **Publication & Mapping Tests (`packages/homekit/test/publication.test.ts`):** 8 tests passing.
- **Hub Publication Integration Tests (`apps/hub/test/homekit/publication.test.ts`):** 4 tests passing.
- **Migrated Features & Camera Verification (`apps/hub/test/homekit/migrated-camera-features.test.ts`):** 4 tests passing.
- **Full Hub HomeKit Suite (`pnpm --filter @haus/hub test test/homekit/`):** 4 test files, 12 tests passing.
- **Full HomeKit Test Suite (`pnpm --filter @haus/homekit test`):** 8 test files, 51 tests passing.
- **Desktop Router Tests (`apps/desktop/src/main/hub/homekit-publishing.test.ts`):** 1 test passing.
- **TypeScript Build & Typecheck:** `pnpm --filter @haus/homekit build` and `pnpm typecheck` — PASS.
- **Architecture & Rules:** `pnpm architecture:check` and `pnpm rules:check` — PASS.
- **Lint & Formatting:** `pnpm lint` (0 warnings/0 errors) and `pnpm format:check` — PASS.

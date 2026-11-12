# Homebridge Govee Migration & Verification (P18.5)

## P18.5.1 Upstream Package & Runtime Verification

- **Package Identity:** `@homebridge-plugins/homebridge-govee` (canonical scoped package; historically `homebridge-govee`).
- **Installed Version:** `11.39.0` (latest upstream `11.39.1`).
- **Repository:** `https://github.com/homebridge-plugins/homebridge-govee` (Author: `bwp91`).
- **Runtime Engines:** Node.js `^22.12.0 || ^24.0.0 || ^26.0.0`; Homebridge `^1.6.0 || ^2.0.0`.
- **Household Configuration (`.local/migration/homebridge-config.json`):**
  - Platform name: `"Govee"`
  - Cloud credentials: Username `wertog12@gmail.com` with configured password.
  - Connection flags: `lanDisable: true`, `awsDisable: false`, `bleDisable: false`, `colourSafeMode: false`.
  - Child bridge profile: `"Govee into HA"`, port `52203`, PIN `"776-41-434"`.
  - Device overrides: 7 ignored devices previously routed through legacy paths (`Bedroom Ceiling Lamp 1`, `Bedroom Ceiling Lamp 2`, `Bedroom RGB`, `Living Room Bulb 1`, `Living Room Bulb 2`, `Living Room Bulb 3`, `Living Room Lamp`).
  - Active household inventory: 13 Govee devices (models H5080, H5083, H6006, H6022, H615D) across bedrooms, living room, kitchen, and Narnia.

## Isolated Child Process & Durable Cache Architecture

1. **Deterministic HAP UUID Generator (`packages/kitsune/src/homebridge/uuid.ts`):**
   - Implements RFC 4122 v5 UUID generation using the standard HAP base namespace (`00000000-0000-1000-8000-0026BB765291`), matching HAP-NodeJS / Homebridge `uuid.generate`.
2. **HAP Characteristic & Service Mock (`packages/kitsune/src/homebridge/hap.ts`):**
   - Modern HAP characteristic APIs: `onGet`, `onSet`, `updateValue`, `setValue`, `setProps`.
   - MockService: `getCharacteristic`, `updateCharacteristic`, `addCharacteristic`, `removeCharacteristic`.
   - MockAccessory: `category`, `getService`, `getServiceById`, `addService`, `removeService`.
3. **Durable Accessory Cache (`packages/kitsune/src/homebridge/cache.ts`):**
   - Serializes and restores `MockAccessory` instances (services, characteristics, values, props, context).
   - Atomic disk persistence at `<storagePath>/accessories/cachedAccessories` via `.tmp` file and rename.
4. **Isolated Runner & Process Supervisor (`packages/kitsune/src/homebridge/runner.ts` & `child.ts`):**
   - Eliminated synthetic child startup that printed hardcoded fake PINs (`031-45-154`).
   - Runner loads real configuration, instantiates `HomebridgeVirtualApi`, emits pairing cards only when `_bridge.pin` or `config.pin` is configured, restores cached accessories, and triggers `didFinishLaunching`.
   - Full IPC message channel (`executeCommand`, `getDevices`, `devicesChanged`, `deviceStateChanged`).
5. **Accessory Projection & Bidirectional Capability Mapping (`packages/kitsune/src/homebridge/projection.ts`):**
   - Maps Homebridge accessories into canonical `HausDevice` models with category `lighting`.
   - Lightbulb services with `On`, `Brightness`, `ColorTemperature`, `Hue`, and `Saturation` map to `on_off`, `brightness`, `color_temp`, and `color_hsv` capabilities.
   - Handles Kelvin <-> Mireds conversion (`kelvinToMireds`, `miredsToKelvin`) and RGB <-> HS color translation (`rgbToHs`, `hsToRgb`, `normalizeHsv`).

## P18.5.2 Bidirectional Behavior & Hub/Desktop Verification

1. **Protocol Routing & Standalone/Kitsune Demuxing (`apps/hub/src/home/commands.ts` & `apps/hub/src/kitsune/kitsune.service.ts`):**
   - Registered `'virtual'` protocol device command handler with `StandaloneHomeService`.
   - Built demuxer guard `isKitsuneDevice`: generic standalone devices without an attached Kitsune adapter (e.g. from `POST /api/devices`) pass through cleanly for optimistic state application, while Kitsune/Homebridge/Scrypted/HACS devices route through `KitsuneCompatibilityEngine.executeCommand`.
   - Added automatic session acquisition (`acquireSession('homebridge', pluginId, ownerId)`) and lifecycle device synchronization (`syncDevicesWithHome`) in `attachHomebridgeApi`, with graceful teardown in `onModuleDestroy`.

2. **Accessory Projection & Compound Actuation (`packages/kitsune/src/homebridge/projection.ts` & `secrets.ts`):**
   - Attached `sourceRefs: [{ protocol: 'virtual', externalId: acc.UUID }]` to projected `HausDevice` models.
   - Forwarded `KitsuneCommandPayload.parameters` containing compound actuation attributes (`brightness`, `color`, `color_temp`).
   - Extended `executeAccessoryCommand` to support async HAP characteristic `handleSet`, brightness percentage scaling (`0..255` -> `0..100%`), HSV/RGB normalization (`{ hue, saturation }`, `{ h, s }`, `{ r, g, b }`, `[r, g, b]`), and compound parameters on `turn_on` (simultaneous brightness and color temperature adjustment in a single command).
   - Preserved synchronous boolean `true` returns for synchronous/mock characteristics while properly chaining and returning promises when asynchronous setters are registered.

3. **Session Fencing & Event Lifecycle (`packages/kitsune/src/engine.ts`):**
   - Replaced stale closure `epoch` checks in `attachHomebridgeApi` and `attachHacsVirtualizer` with active adapter instance identity checks (`this.homebridgeApis.get(key) !== api`), ensuring session restarts do not drop subsequent error or state telemetry while strictly ignoring detached adapters.
   - Enforced session epoch fencing rejecting commands issued against superseded sessions with `kitsune_stale_session_epoch`.

4. **Desktop Entity & Command Compatibility (`apps/desktop/src/main/hub/entities.ts` & `commands.ts`):**
   - Verified `translateService` translates desktop `light.turn_on` calls with `color_temp_kelvin` into `set_color_temp` device commands with `color_temp` Kelvin values for standalone Hub execution.
   - Verified entity projection from Hub device models with `color_temp` and `color_hsv` capabilities into desktop UI light entities with proper supported features (`SUPPORT_COLOR`, `SUPPORT_COLOR_TEMP`, `SUPPORT_BRIGHTNESS`).

## Verification Evidence

- `packages/kitsune/test/homebridge.test.ts` (7 tests, 7 PASS):
  - Deterministic RFC 4122 v5 UUID generation from HAP namespace.
  - `MockCharacteristic` `onGet`, `onSet`, and `setProps`.
  - `MockService` and `MockAccessory` categories, `getServiceById`, and removal.
  - `HomebridgeAccessoryCache` durable serialization, atomic save, load, and deletion.
  - `loadHomebridgePlatform` dynamic platform lifecycle with cache restoration and `didFinishLaunching`.
  - `Lightbulb` ColorTemperature and ColorHSV/RGB projection and bidirectional actuation.
  - `HomebridgeChildBridge` zero-fabrication of unconfigured PINs and real pairing card capture for `776-41-434`.
- `apps/hub/test/nest/kitsune/govee.test.ts` (9 tests, 9 PASS):
  - Projection of Homebridge Govee accessory to Haus graph with category `lighting` and full capabilities (`on_off`, `brightness`, `color_temp`, `color_hsv`).
  - Bidirectional state update: external characteristic change updates `homeService` endpoint readings and states.
  - Hub API `turn_off` and `turn_on` execution via `POST /api/devices/:id/command` setting HAP characteristics.
  - Actuation of brightness (percentage scaling), color temperature (Kelvin <-> Mireds), and color HSV.
  - Compound actuation: `turn_on` with brightness and color temperature in one payload.
  - Rate limit simulation: Govee HTTP 429 error truthfully rejects without false success.
  - Authorization failure simulation: Govee HTTP 401 error truthfully rejects without false success.
  - Session epoch fencing: stale epoch commands reject with `kitsune_stale_session_epoch`.
  - Unsupported capability handling: command for `'siren'` rejects and records diagnostic and unsupported matrix entries.
- `apps/desktop/src/main/hub/entities.test.ts` (14 tests, 14 PASS):
  - Command translator maps `color_temp_kelvin` into light device parameters.
- Full `@haus/kitsune` Vitest Suite: 6 test files, 38 tests PASS.
- Full `@haus/hub` Vitest Suite: 179 test files passed, 1 skipped (hardware/remote), 886 tests PASS.
- Full `@haus/desktop` Hub Vitest Suite: 7 test files, 37 tests PASS.
- Workspace Quality Gates:
  - `pnpm typecheck`: PASS (0 errors across 18 packages and root).
  - `pnpm architecture:check`: PASS (443 files).
  - `pnpm exec oxlint`: PASS (0 warnings, 0 errors across 1,638 files).
  - `pnpm exec prettier --check`: PASS.
  - `git diff --check`: PASS (0 whitespace/formatting errors).

## P18.5.3 Inventory Comparison & Replacement Alias Mapping

### Inventory & Parity Matrix (13 Household Devices)

All 13 Govee physical devices discovered via `govee2mqtt` were mapped to their Homebridge counterparts using their device MAC addresses, category, capabilities, and household rooms:

| #   | Device Name            | Device MAC (Clean / Formatted)                 | Model | Category | Room (HA Area) | Existing Haus ID (`govee2mqtt`) | Homebridge Kitsune Projected ID        | Features & Capabilities                   |
| --- | ---------------------- | ---------------------------------------------- | ----- | -------- | -------------- | ------------------------------- | -------------------------------------- | ----------------------------------------- |
| 1   | Bedroom Alina Strip    | `E8E86074F4C5D014` / `E8:E8:60:74:F4:C5:D0:14` | H615D | lighting | `bedroom`      | `mqtt_gv2mqtt-E8E86074F4C5D014` | `homebridge:homebridge-govee:<UUID1>`  | on_off, brightness, color_temp, color_hsv |
| 2   | Bedroom Xbox Power     | `9FB66074F4B65D58` / `9F:B6:60:74:F4:B6:5D:58` | H5080 | power    | `bedroom`      | `mqtt_gv2mqtt-9FB66074F4B65D58` | `homebridge:homebridge-govee:<UUID2>`  | on_off                                    |
| 3   | Bedroom Andrii Strip   | `42A36074F4BD67A4` / `42:A3:60:74:F4:BD:67:A4` | H615D | lighting | `bedroom`      | `mqtt_gv2mqtt-42A36074F4BD67A4` | `homebridge:homebridge-govee:<UUID3>`  | on_off, brightness, color_temp, color_hsv |
| 4   | Living Room Lamp       | `0AA36074F4EEEF30` / `0A:A3:60:74:F4:EE:EF:30` | H6006 | lighting | `living_room`  | `mqtt_gv2mqtt-0AA36074F4EEEF30` | `homebridge:homebridge-govee:<UUID4>`  | on_off, brightness, color_temp, color_hsv |
| 5   | Narnia Garland         | `BC666074F4C7B442` / `BC:66:60:74:F4:C7:B4:42` | H6022 | lighting | `narnia`       | `mqtt_gv2mqtt-BC666074F4C7B442` | `homebridge:homebridge-govee:<UUID5>`  | on_off, brightness, color_temp, color_hsv |
| 6   | Narnia Vinyl Lights    | `F5F06074F4ABAB82` / `F5:F0:60:74:F4:AB:AB:82` | H6022 | lighting | `narnia`       | `mqtt_gv2mqtt-F5F06074F4ABAB82` | `homebridge:homebridge-govee:<UUID6>`  | on_off, brightness, color_temp, color_hsv |
| 7   | Bedroom Ceiling Lamp 1 | `6ACCD0C90704B7A8` / `6A:CC:D0:C9:07:04:B7:A8` | H6006 | lighting | `bedroom`      | `mqtt_gv2mqtt-6ACCD0C90704B7A8` | `homebridge:homebridge-govee:<UUID7>`  | on_off, brightness, color_temp            |
| 8   | Bedroom Ceiling Lamp 2 | `8458D0C90704E0C8` / `84:58:D0:C9:07:04:E0:C8` | H6006 | lighting | `bedroom`      | `mqtt_gv2mqtt-8458D0C90704E0C8` | `homebridge:homebridge-govee:<UUID8>`  | on_off, brightness, color_temp            |
| 9   | Bedroom RGB            | `28CDD4ADFCA45916` / `28:CD:D4:AD:FC:A4:59:16` | H6006 | lighting | `bedroom`      | `mqtt_gv2mqtt-28CDD4ADFCA45916` | `homebridge:homebridge-govee:<UUID9>`  | on_off, brightness, color_temp, color_hsv |
| 10  | Bedroom Short Garland  | `E6DE6074F4BDDB6A` / `E6:DE:60:74:F4:BD:DB:6A` | H6022 | lighting | `bedroom`      | `mqtt_gv2mqtt-E6DE6074F4BDDB6A` | `homebridge:homebridge-govee:<UUID10>` | on_off, brightness, color_temp, color_hsv |
| 11  | Kitchen Small Lamp     | `EDF66074F4C5D4B0` / `ED:F6:60:74:F4:C5:D4:B0` | H6006 | lighting | `kitchen`      | `mqtt_gv2mqtt-EDF66074F4C5D4B0` | `homebridge:homebridge-govee:<UUID11>` | on_off, brightness, color_temp, color_hsv |
| 12  | Bedroom Bed Lamp       | `1EC8DC6E01C6422A` / `1E:C8:DC:6E:01:C6:42:2A` | H6006 | lighting | `bedroom`      | `mqtt_gv2mqtt-1EC8DC6E01C6422A` | `homebridge:homebridge-govee:<UUID12>` | on_off, brightness, color_temp, color_hsv |
| 13  | Bedroom Long Garland   | `EBA96074F4B9F96C` / `EB:A9:60:74:F4:B9:F9:6C` | H6022 | lighting | `bedroom`      | `mqtt_gv2mqtt-EBA96074F4B9F96C` | `homebridge:homebridge-govee:<UUID13>` | on_off, brightness, color_temp, color_hsv |

### Replacement Alias & Room Preservation Architecture

1. **Atomic Alias Resolution (`AtomicRoomMoveCoordinator.registerAlias` & `resolveAddressOrId`):**
   - Each legacy device ID (`mqtt_gv2mqtt-<cleanMac>`) maps to its corresponding canonical Homebridge device ID (`homebridge:homebridge-govee:<UUID>`).
   - `resolveAddressOrId` automatically translates any incoming device command or lookup for `mqtt_gv2mqtt-<cleanMac>` to the canonical device ID, ensuring existing scenes, automations, and scripts continue operating without modification.
2. **Reversible Handover Invariant:**
   - In accordance with the engineering contract, `govee2mqtt` must not be uninstalled or stopped without explicit user authorization.
   - Dual-controller conflict prevention: When Kitsune Homebridge Govee is activated, `govee2mqtt` container is stopped (not deleted), ensuring clean rollback simply by restarting `govee2mqtt` and detaching the Kitsune session.

## Remaining Limitations

- Physical cloud authentication against Govee AWS IoT / HTTP endpoints requires valid live network credentials on production hardware (unverified in offline tests).
- Production handover from `govee2mqtt` to Kitsune Homebridge Govee remains deferred to P18.5.3 after explicit user authorization.

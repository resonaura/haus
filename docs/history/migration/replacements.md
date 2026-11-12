# Replacement Strategy & Target Matrix (P18.6.1)

Observed and mapped against the household inventory (`.local/migration/matrix.json`, 130 configuration entries, 51 domains, 186 devices, 987 entities).

## Replacement Runtime Classifications

Each domain is mapped to its target execution runtime based on ownership, dependencies, and feature requirements:

1. **Native Haus Core & Hardware Protocols:** Implemented natively within Haus packages (`@haus/core`, `@haus/mqtt`, `@haus/matter`, `@haus/thread`, `@haus/homekit`, `@haus/media`).
2. **Kitsune Homebridge Plugins:** Isolated Node.js child runner with HAP-to-Haus device projection and durable accessory cache (`packages/kitsune/src/homebridge`).
3. **Kitsune HACS Custom Components:** Sandboxed Python sidecar harness with Home Assistant component emulation (`packages/kitsune/src/hacs`).
4. **Kitsune Built-in HA Adapters:** Python compatibility harness or dedicated TypeScript REST/LAN clients.
5. **Native Host / System Runtime:** Replaced by Haus Hub Host supervisor, `@haus/servers` host monitoring, and `@haus/apps`.
6. **Native Haus Automation & Rules:** Migrated directly into Haus native automations, scripts, scenes, and groups.

---

## Complete 51-Domain Replacement Matrix

| Domain                 | Entries | Devices | Entities | Target Classification  | Target Runtime / Driver         | Feature & Requirement Disposition                                 |
| ---------------------- | ------- | ------- | -------- | ---------------------- | ------------------------------- | ----------------------------------------------------------------- |
| `analytics`            | 1       | 0       | 0        | Native Host            | Disabled / Opt-out              | Privacy-preserving default; no external telemetry sent.           |
| `androidtv`            | 1       | 1       | 2        | Kitsune HA             | Python Sidecar                  | Media state and ADB power control for 192.168.5.1.                |
| `apple_tv`             | 2       | 2       | 5        | Kitsune Homebridge     | `homebridge-appletv-enhanced`   | Media playback, state, remote keys, and now-playing metadata.     |
| `backup`               | 1       | 1       | 5        | Native Host            | `@haus/hub/backup`              | Hub-owned encrypted backup engine and snapshot lifecycle.         |
| `bluetooth`            | 1       | 1       | 0        | Native Hardware        | Host Bluetooth adapter          | Native BLE discovery and device pairing.                          |
| `cast`                 | 1       | 2       | 2        | Kitsune HA             | Python Sidecar / Cast client    | Google Cast media state and playback control.                     |
| `dlna_dmr`             | 1       | 1       | 1        | Kitsune HA             | Python Sidecar                  | DLNA Digital Media Renderer playback for Odyssey monitor.         |
| `eero`                 | 1       | 7       | 105      | Kitsune HACS           | `eero` custom component         | Eero mesh topology, client presence, and network diagnostics.     |
| `esphome`              | 4       | 4       | 9        | Native Hardware        | Native ESPHome API client       | Local native API communication with ESPHome devices.              |
| `eufy_security`        | 1       | 1       | 60       | Kitsune HACS / Native  | `@haus/media` + WebSocket       | Eufy camera media, P2P restream, and motion activity.             |
| `eufylife_ble`         | 1       | 1       | 2        | Kitsune HA             | Python Sidecar / BLE            | BLE communication for Smart Scale P3 weight readings.             |
| `generic`              | 1       | 1       | 1        | Native Hardware        | `@haus/media`                   | Native RTSP/snapshot camera client for Outdoor Side Camera.       |
| `generic_thermostat`   | 1       | 0       | 1        | Native Rules           | `@haus/core/automation`         | Native automation rule for Kitchen Kettle heating loops.          |
| `go2rtc`               | 1       | 0       | 0        | Native Media           | `@haus/media`                   | Superseded by Haus native FFmpeg WebRTC stream engine.            |
| `google_assistant`     | 1       | 1       | 1        | Kitsune HA             | Python Sidecar                  | Voice assistant dispatch and sync integration.                    |
| `google_assistant_sdk` | 1       | 0       | 0        | Kitsune HA             | Python Sidecar                  | Google Assistant text-to-speech and audio broadcast.              |
| `group`                | 4       | 0       | 4        | Native Rules           | `@haus/core`                    | Native Haus device and endpoint grouping.                         |
| `hacs`                 | 1       | 20      | 40       | Native Apps            | App & Plugin Manager            | Marketplace UI and provenance tracking for extensions.            |
| `hassio`               | 1       | 16      | 98       | Native Host            | `@haus/apps`                    | App manager, container lifecycle, and resource monitors.          |
| `homekit`              | 14      | 14      | 0        | Native Hardware        | `@haus/homekit` (Publishing)    | P18.10 Apple Home bridge and accessory publication.               |
| `homekit_controller`   | 14      | 12      | 22       | Native Hardware        | `@haus/homekit` (Controller)    | Native HAP-IP pairing and control (VOCOlinc, Starling).           |
| `hue`                  | 1       | 25      | 125      | Kitsune HA / Native    | Local REST / SSDP               | Philips Hue Bridge local REST API, lights, and scenes.            |
| `ibeacon`              | 1       | 0       | 0        | Native Hardware        | BLE Discovery                   | Local BLE iBeacon detection and RSSI tracking.                    |
| `ipp`                  | 1       | 1       | 7        | Kitsune HA             | Python Sidecar                  | IPP print queue status and ink levels for EPSON XP-6100.          |
| `jellyfin`             | 1       | 8       | 24       | Kitsune HA             | Python Sidecar                  | Jellyfin server session state and media controls.                 |
| `material_symbols`     | 1       | 0       | 0        | Native UI              | `@haus/ui`                      | Bundled Material Symbols icon font and tokens.                    |
| `matter`               | 1       | 7       | 34       | Native Hardware        | `@haus/matter`                  | Native Matter controller over Matter Server daemon.               |
| `melnor`               | 1       | 0       | 0        | Native Hardware        | BLE Discovery                   | Melnor Bluetooth water valve (currently unconfigured).            |
| `meross_lan`           | 4       | 3       | 23       | Kitsune HACS           | `meross_lan` custom component   | Local HTTP/MQTT control for Meross plugs and light strips.        |
| `mobile_app`           | 2       | 2       | 62       | Native Apps            | `@haus/desktop`, `@haus/mobile` | Native Haus client telemetry, notifications, and location.        |
| `mqtt`                 | 1       | 19      | 95       | Native Hardware        | `@haus/mqtt`                    | Native Haus MQTT broker and HA discovery converter.               |
| `openweathermap`       | 1       | 1       | 18       | Kitsune HA             | Python Sidecar / HTTP           | Outdoor weather forecast, temperature, and humidity.              |
| `qingping`             | 1       | 0       | 0        | Native Hardware        | BLE Discovery                   | Qingping Air Monitor Lite (currently ignored discovery).          |
| `raspberry_pi`         | 1       | 1       | 1        | Native Host            | `@haus/servers`                 | Host CPU, memory, and disk telemetry.                             |
| `rpi_power`            | 1       | 1       | 1        | Native Host            | `@haus/servers`                 | Host power undervoltage and throttling diagnostics.               |
| `samsungtv`            | 1       | 1       | 2        | Kitsune HA             | Python Sidecar                  | Samsung Tizen TV remote commands and power state.                 |
| `sensibo`              | 1       | 1       | 16       | Kitsune HA             | Python Sidecar                  | Sensibo Sky A/C climate control, fan mode, and temperature.       |
| `speedtestdotnet`      | 1       | 1       | 3        | Kitsune HA             | Python Sidecar                  | WAN download, upload, and latency diagnostics.                    |
| `starling_home_hub`    | 1       | 0       | 0        | Kitsune HACS / HomeKit | `homekit_controller`            | Starling Home Hub Google Nest bridge via HomeKit Controller.      |
| `stateful_scenes`      | 39      | 8       | 64       | Native Rules           | `@haus/core/automation`         | Native Haus scenes; ignored HA scene entities not activated.      |
| `sun`                  | 1       | 1       | 9        | Native Core            | `@haus/core`                    | Solar azimuth, elevation, sunrise, and sunset calculations.       |
| `telegram_bot`         | 1       | 2       | 2        | Kitsune HA             | Python Sidecar                  | Telegram notification and command bot.                            |
| `thread`               | 1       | 0       | 0        | Native Hardware        | `@haus/thread`                  | Native Thread dataset, active operational credentials, and vault. |
| `threshold`            | 1       | 0       | 1        | Native Rules           | `@haus/core/automation`         | Native numeric threshold automation sensor.                       |
| `transmission`         | 1       | 1       | 18       | Kitsune HA             | Python Sidecar                  | Transmission download/upload rates and pause switches.            |
| `tuya`                 | 1       | 10      | 53       | Kitsune HA             | Python Sidecar                  | Tuya cloud/local devices (paused by user authorization).          |
| `upnp`                 | 1       | 0       | 0        | Native Network         | SSDP Discovery                  | Router IGD metrics (currently ignored discovery).                 |
| `xbox`                 | 1       | 1       | 20       | Kitsune HA             | Python Sidecar                  | Xbox Live console power, active application, and media.           |
| `xiaomi_ble`           | 3       | 3       | 8        | Native Hardware        | BLE Discovery                   | Mi Body Scale and Xiaomi wireless dimmer switches.                |
| `xiaomi_miot`          | 2       | 2       | 9        | Kitsune HACS           | `xiaomi_miot` custom component  | Xiaomi MIoT local and cloud device control.                       |
| `yeelight`             | 2       | 2       | 2        | Kitsune HA / Native    | Local LAN                       | Yeelight local LAN protocol for bulbs and color strips.           |

---

## Sequencing Order for Bounded Implementation (P18.6.2)

In accordance with user priorities and device dependency order:

1. **P18.6.2.1:** Preserve unknown Scrypted state (Verified in `scrypted.md`).
2. **P18.6.2.2:** Meross LAN (`meross_lan`) local smart plugs and strip controllers under `HacsVirtualizer`.
3. **P18.6.2.3:** Apple TV (`apple_tv`) media and remote controls under `homebridge-appletv-enhanced`.
4. **P18.6.2.4:** Sensibo (`sensibo`) climate controls under Python sidecar harness.
5. **P18.6.2.5:** Philips Hue (`hue`) bridge lights and scene projection.
6. **P18.6.2.6:** Eero (`eero`) topology and client device diagnostics.
7. **P18.6.2.7:** Xiaomi MIoT (`xiaomi_miot`) and BLE sensors.
8. **P18.6.2.8:** Remaining utility/cloud services (`transmission`, `speedtestdotnet`, `openweathermap`, `telegram_bot`).

---

## P18.6.2.2 Meross LAN Acceptance & Actuation Evidence

Verified against the household inventory (4 configuration entries, 3 devices, 23 entities):

1. **Multi-Socket Power Strip Grouping (`mss425f` - Bedroom Desk Surge Protector):**
   - Ingested 6 distinct switch entities (`power`, `desk`, `usb`, `socket_2`, `socket_4`, `wall_garland`).
   - Grouped all sockets into a single unified `HausDevice` with category `power` and 6 independent `HausEndpoint`s.
   - Preserved device top-level name and room binding (`bedroom`).
   - Verified independent individual socket actuation via `callService` with exact entity IDs.

2. **RGB Light Strip Projection & Actuation (`msl320cpr` - Narnia RGB):**
   - Projected light entity into `HausDevice` with category `lighting` and full capabilities (`on_off`, `brightness`, `color_temp`, `color_hsv`).
   - Handled brightness percentage scaling (`0..255` <-> `0..100%`), color temperature in Kelvin, and color HSV normalization.
   - Verified compound actuation (`turn_on` with simultaneous brightness and color temperature).

3. **Multi-Outlet Outdoor Plug (`mss620` - Outdoor Main Power Hub):**
   - Grouped multiple outdoor outlets (`power`, `flood_light`, `veronika_power_strip`) into one `HausDevice` with category `power`.
   - Verified live state updates and truthful availability propagation (`offline` when `unavailable`).

4. **Diagnostics & Failure Safety:**
   - Truthfully rejected unsupported capabilities (`siren`, `vacuum`) with diagnostic logging and `kitsune_unsupported_capability` errors without optimistic state mutation.

- **Automated Verification:** `packages/kitsune/test/meross.test.ts` (4/4 tests PASS in 7ms).

---

## P18.6.2.3 Apple TV Enhanced Acceptance & Actuation Evidence

Verified against the household inventory (`Bedroom Apple TV`, `Apple TV 4K (gen 3)`, MAC `02:AF:ED:7A:CF:59`):

1. **Unified Television, Speaker, and Streaming App Projection:**
   - Projected `Service.Television` into canonical `HausDevice` with category `media`.
   - Linked `Service.TelevisionSpeaker` into primary endpoint, exposing volume and mute capabilities without fragmented devices.
   - Folded `Service.InputSource` streaming applications (`YouTube`, `Netflix`, `Prime Video`, `Music`, `TV`) into dynamic `source_list` and `source` readings with active identifier tracking.

2. **Bidirectional Power Control:**
   - Handled `on_off` commands mapping to HomeKit `Active` characteristic (`0 = off`, `1 = on`).
   - Propagated live device power state updates to Haus device readings.

3. **Remote Control Key Dispatch:**
   - Mapped remote control intents (`select`, `menu`/`back`, `home`/`exit`, `up`, `down`, `left`, `right`, `play_pause`, `rewind`, `fast_forward`) to canonical Apple HAP `RemoteKey` codes (0–15).
   - Validated remote key dispatch via virtual Homebridge API.

4. **Input Source Selection:**
   - Supported input selection by streaming app name (e.g. `'Netflix'`) and direct numeric identifier.
   - Verified active input source and identifier readback.

5. **Television Speaker Control:**
   - Supported direct volume setting (0–100%), relative volume stepping (`VolumeSelector.INCREMENT = 0`, `VolumeSelector.DECREMENT = 1`), and mute toggling.
   - Propagated speaker characteristic changes reactively to the primary media device.

6. **Desktop Consumer & Safety Boundaries:**
   - Wired `media_player` and `remote` projection in desktop main hub (`entities.ts`), setting `device_class: 'tv'` and supported features.
   - Wired `translateService` for `media_player` and `remote` HA service calls (`commands.ts`).
   - Truthfully rejected unsupported capabilities (`siren`) with `kitsune_unsupported_capability` and diagnostic logging.

- **Automated Verification:** `packages/kitsune/test/appletv.test.ts` (6/6 tests PASS in 12ms), `apps/desktop/src/main/hub/test/media.test.ts` (3/3 tests PASS in 6ms).

---

## P18.6.2.4 Sensibo Climate Acceptance & Actuation Evidence

Verified against the household inventory (`TV Place AC`, model `airq`, manufacturer `Sensibo`, MAC `d8:13:2a:0e:15:48`, ID `49GPvLvV`):

1. **Unified Climate & AirQ Sensor Device Grouping:**
   - Ingested primary climate entity `climate.tv_place_ac` (target temp 10–30 °C, step 1, HVAC modes: `cool`, `heat`, `fan_only`, `dry`, `heat_cool`, `off`, fan modes: `quiet`, `low`, `medium_low`, `medium`, `medium_high`, `high`, `auto`, vertical/horizontal swing modes: `stopped`, `rangefull`).
   - Ingested AirQ environmental sensors: `sensor.tv_place_ac_airq_co2` (650 ppm) and `sensor.tv_place_ac_airq_tvoc` (120 ppb).
   - Ingested peripheral controls: `binary_sensor.tv_place_ac_filter_clean_required` (`problem` device class), `button.tv_place_ac_reset_filter`, `switch.tv_place_ac_timer`, `switch.tv_place_ac_climate_react`, and `sensor.tv_place_ac_timer_end_time`.
   - Grouped all 8 active endpoints under 1 unified `HausDevice` with category `'climate'` and preserved area binding (`tv_place`).

2. **Bidirectional Climate Actuation:**
   - Supported target temperature setting (`target_temperature` / `temperature`) dispatching `climate.set_temperature` with `{ entity_id, temperature }`.
   - Supported HVAC mode setting (`hvac_mode`) dispatching `climate.set_hvac_mode` with `{ entity_id, hvac_mode }`.
   - Supported fan mode setting (`fan_mode`) dispatching `climate.set_fan_mode` with `{ entity_id, fan_mode }`.
   - Supported vertical swing mode (`swing_mode`) and horizontal swing mode (`swing_horizontal_mode`) dispatching corresponding `climate.set_swing_mode` / `set_swing_horizontal_mode`.
   - Supported power on/off toggling (`on_off`) dispatching `climate.turn_on` and `climate.turn_off`.
   - Supported compound climate commands (target temperature with simultaneous HVAC mode, fan mode, and swing mode).

3. **Peripheral Sensor & Actuator Support:**
   - Supported button actuation for filter reset dispatching `button.press`.
   - Supported switch actuation for timer and Climate React dispatching `switch.turn_on` and `switch.turn_off`.
   - Preserved numeric measurement state classes for CO2 (ppm) and TVOC (ppb).

4. **Desktop Consumer & Safety Boundaries:**
   - Mapped `climate.tv_place_ac` into desktop `CompatView` with category `'climate'`, populating `hvac_modes`, `fan_modes`, `swing_modes`, `min_temp`, `max_temp`, `target_temp_step`, `current_temperature`, `temperature`, `fan_mode`, `swing_mode`, and combined `supported_features: 41` (1 + 8 + 32).
   - Translated `climate` service calls (`set_temperature`, `set_hvac_mode`, `set_fan_mode`, `set_swing_mode`, `turn_on`, `turn_off`) into typed `HubCommand`s.
   - Truthfully rejected unsupported capabilities (`siren`, `water_heater`, `cover`) with `kitsune_unsupported_capability` and diagnostic logging.

- **Automated Verification:** `packages/kitsune/test/sensibo.test.ts` (4/4 tests PASS in 7ms), `apps/desktop/src/main/hub/test/climate.test.ts` (2/2 tests PASS in 8ms).

---

## P18.6.2.5 Philips Hue Bridge Lights & Scene Projection Evidence

Verified against household inventory (`Narnia Hue Bridge`, model `Hue Bridge`, MAC `ec:b5:fa:ad:dc:a9`, 25 devices, 125 entities including 11 lights, 19 scenes, 44 sensors, 31 events/buttons):

1. **Light Capabilities & Dynamic Hue Effects:**
   - Ingested Hue color/ambiance lights exposing brightness (0–255), color temperature (2000–6535 K / 153–500 Mireds), and XY/HS color modes.
   - Projected dynamic lighting effects (`effect_list: ['candle', 'fire', 'prism', 'sparkle', 'opal', 'glisten']`) into neutral `effect` capability.
   - Supported setting active effects (e.g. `{ effect: 'candle' }`) via `light.turn_on` sidecar dispatch.

2. **Scene Projection & Activation:**
   - Ingested Hue scenes as standalone domain `'scene'` with category `'scene'`.
   - Projected scene-specific attributes: `group_name`, `brightness`, `speed`, and `is_dynamic` boolean flag.
   - Implemented `scene.turn_on` command actuation in Kitsune virtualizer and desktop command translator (`translateService`), dispatching typed `scene.turn_on` calls with `{ entity_id }`.

3. **Event Entity Support:**
   - Ingested Hue rotary dials and Tap dial / Smart Button controllers as domain `'event'` with category `'event'`.
   - Preserved `event_types` array (`['initial_press', 'repeat', 'short_release', 'long_press', 'long_release']`).

4. **Desktop Compatibility & Consumer Contracts:**
   - Projected `scene` and `event` entities into desktop `CompatView` in `apps/desktop/src/main/hub/entities.ts`, preserving scene metadata and event types.
   - Translated `scene.turn_on` service calls into typed `HubCommand`s.
   - Maintained file-size discipline across desktop hub entities and commands.

- **Automated Verification:** `packages/kitsune/test/hue.test.ts` (3/3 tests PASS in 7ms), `apps/desktop/src/main/hub/test/scene.test.ts` (2/2 tests PASS in 7ms).

---

## P18.6.2.6 Eero Network Topology, Profiles & Mesh Diagnostics Evidence

Verified against household inventory (`eero`, 7 devices, 105 entities: 1 Network router `Crawford`, 4 user profiles `Andrii`, `Alina`, `Veronika`, `Michael`, 2 mesh nodes `TV Place` [eero 6+], `Narnia` [eero 6]):

1. **Network Topology & Router Ingestion (`Crawford`):**
   - Ingested gateway router under unified `HausDevice` with category `'network'`, exposing 27 total entities across bandwidth telemetry, diagnostics, and network configuration.
   - Projected numeric bandwidth rate sensors (`sensor.crawford_download_speed`, `sensor.crawford_upload_speed`) with `data_rate` device class and `Mbit/s` unit of measurement.
   - Projected gateway IP address, public IP, and connected client counts into Haus readings.
   - Supported network reboot button (`button.crawford_reboot`), speed test trigger button, and update time preference selector (`select.crawford_preferred_update_time`) with options `['morning', 'afternoon', 'night']`.
   - Projected network feature switches (`switch.crawford_guest_network`, `switch.crawford_band_steering`, `switch.crawford_ad_blocking`, `switch.crawford_thread_enabled`, `switch.crawford_wpa3`).

2. **User Profile Content Filtering & Presence (`Andrii`, `Alina`, `Veronika`, `Michael`):**
   - Ingested user profile devices with category `'network'`, grouping 17 entities per profile.
   - Projected presence tracking via `device_tracker.<profile>` into `presence` and `contact` capabilities (`state: 'home' | 'not_home'`) with `source_type: 'router'`.
   - Projected client internet pause switches (`switch.<profile>_paused`) and content filtering controls (`adult_content_filter`, `safe_search`, `gaming`, etc.).
   - Projected connectivity diagnostics (`binary_sensor.<profile>_connected`) and active client count sensors.

3. **Mesh Access Points & Firmware Upgrades (`TV Place`, `Narnia`):**
   - Ingested mesh nodes with category `'network'`, exposing 5 entities per node.
   - Projected first-class firmware update capability (`update.<node>_eero_firmware`) with `installed_version`, `latest_version`, `title: 'eeroOS'`, `in_progress`, and `auto_update` readings.
   - Projected mesh node status lights (`light.<node>_status_lights`) with on/off and brightness scaling.
   - Projected per-AP reboot buttons and connected client counts.

4. **Bidirectional Actuation & Diagnostic Safety:**
   - Supported switch actuation (`switch.turn_on`, `switch.turn_off`) on guest network and profile pause switches.
   - Supported button actuation (`button.press`) on network and node reboot buttons.
   - Supported select actuation (`select.select_option`) on preferred update time.
   - Supported update actuation (`update.install`) on firmware upgrade entities.
   - Truthfully rejected unsupported capabilities (`siren`, `water_heater`) with `kitsune_unsupported_capability` and diagnostic logging.

5. **Desktop Consumer & Modular Architecture:**
   - Projected `update`, `select`, `device_tracker`, `button`, and `switch` entities into desktop `CompatView` in `apps/desktop/src/main/hub/entities.ts`.
   - Translated `install`, `select_option`, `press`, `turn_on`, and `turn_off` service calls in `apps/desktop/src/main/hub/commands.ts`.
   - Extracted `packages/kitsune/src/hacs/readings.ts` to modularize state parsing and preserve strict <= 500 line limits across all authored files.

- **Automated Verification:** `packages/kitsune/test/eero.test.ts` (5/5 tests PASS in 14ms), `apps/desktop/src/main/hub/test/network.test.ts` (2/2 tests PASS in 7ms).

---

## P18.6.2.7 Xiaomi MIoT & BLE Sensors Acceptance Evidence

Verified against household inventory (`xiaomi_miot` and `xiaomi_ble`: `Narnia Pedalboard` smart plug [`chuangmi.plug.hmi206`], `Bathroom Scale` [`XMTZC02HM/XMTZC05HM/NUN4049CN`], and wireless dimmer switches [`YLKG07YL/YLKG08YL`] across living room and narnia):

1. **Xiaomi MIoT Smart Plug (`Narnia Pedalboard` - `chuangmi.plug.hmi206`):**
   - Ingested smart plug under unified `HausDevice` with category `'power'` and room `'narnia'`.
   - Folded 4 active endpoints into single device: primary power switch (`switch.narnia_pedalboard_power`, `outlet` class), indicator LED (`light.narnia_pedalboard_indicator_light`), internal temperature sensor (`sensor.narnia_pedalboard_temperature`), and device info button (`button.narnia_pedalboard_info`).
   - Actuated switch power on/off via `switch.turn_on` and `switch.turn_off`.
   - Actuated indicator light power via `light.turn_on` and `light.turn_off`.
   - Actuated info button via `button.press`.

2. **Xiaomi BLE Body Composition Scale (`Bathroom Scale`):**
   - Ingested Bluetooth body composition scale with room `'bathroom'`.
   - Projected stabilized and non-stabilized weight sensors with `weight` device class and `kg` unit of measurement.
   - Projected bioelectrical impedance sensor (`sensor.bathroom_scale_impedance`) with `Ω` unit.
   - Projected Bluetooth RSSI signal strength (`sensor.bathroom_scale_signal_strength`) with `signal_strength` device class and `dBm` unit.
   - Propagated live weight updates dynamically to endpoint readings.

3. **Xiaomi BLE Wireless Dimmer Switches (`Living Room`, `Narnia Entry`):**
   - Ingested rotary dimmer switches with room bindings.
   - Projected rotary dimmer event entity with full event choices: `['press', 'double_press', 'hold', 'rotate_left', 'rotate_right']`.
   - Preserved active event type and state transitions on rotary knob rotation.

4. **Desktop Compatibility & Consumer Boundaries:**
   - Projected plug, scale weight sensor, and rotary event into desktop `CompatView` in `apps/desktop/src/main/hub/entities.ts`.
   - Registered `weight` in `NUMERIC_SENSOR_CLASSES` for desktop presentation with unit `kg`.
   - Translated `turn_off` and `turn_on` service calls in `apps/desktop/src/main/hub/commands.ts`.
   - Truthfully rejected unsupported capabilities (`vacuum`, `water_heater`) without optimistic state mutation.

- **Automated Verification:** `packages/kitsune/test/xiaomi.test.ts` (4/4 tests PASS in 12ms), `apps/desktop/src/main/hub/test/sensor.test.ts` (2/2 tests PASS in 8ms).

---

## P18.6.2.8 Utility & Cloud Services Acceptance Evidence

Verified against household inventory (`transmission`, `speedtestdotnet`, `openweathermap`, and `telegram_bot`):

1. **Transmission BitTorrent Client (`Narnia Miku Transmission`):**
   - Ingested under unified `HausDevice` with category `'network'` and area `'system'`.
   - Folded 18 entities into single device: main active/pause switch (`switch.narnia_miku_transmission_switch`), turtle mode switch (`switch.narnia_miku_transmission_turtle_mode`), download/upload rate sensors (`MB/s`), disk space and total transfer volume sensors (`GiB`), torrent counts (`active`, `completed`, `paused`, `started`, `total`), status string sensor (`'idle'`, `'downloading'`), and torrent event entity.
   - Actuated main switch power and turtle mode toggles via `switch.turn_on` and `switch.turn_off`.
   - Preserved numeric `data_rate` and `data_size` readings without corrupting them into generic temperature.

2. **SpeedTest Diagnostics (`SpeedTest`):**
   - Ingested under unified `HausDevice` with category `'network'` and area `'system'`.
   - Folded 3 entities into single device: ping latency (`sensor.speedtest_ping`, unit `ms`, `duration` class), download rate (`sensor.speedtest_download`, unit `Mbit/s`, `data_rate` class), and upload rate (`sensor.speedtest_upload`, unit `Mbit/s`, `data_rate` class).
   - Preserved numeric rate and duration readings in both Kitsune and desktop compatibility projections.

3. **OpenWeatherMap Weather & Environmental Conditions (`Outdoor Weather`):**
   - Ingested under unified `HausDevice` with category `'environmental_sensors'` and area `'outdoor'`.
   - Folded 18 entities into single device: primary weather entity (`weather.outdoor_weather`), condition (`cloudy`), temperature (`7.43 °C`), feels-like temperature, humidity (`92%`), atmospheric pressure (`1017 hPa`), wind speed (`18.5 km/h`), wind bearing (`40°`), visibility (`10000 m`), cloud coverage, rain/snow intensity, and summary.
   - Projected primary weather entity with condition, temperature, humidity, pressure, and wind telemetry in desktop `CompatView`.

4. **Telegram Notification Bot (`Levi`):**
   - Ingested under unified `HausDevice` with category `'generic'` and area `'system'`.
   - Folded notification service (`notify.telegram_bot_8228712089_1003034932068`) and incoming update event (`event.levi_update_event`) into device endpoints.
   - Actuated notification dispatch via `notify.send_message` with message and title payloads.
   - Truthfully rejected unsupported capabilities (`vacuum`) with `kitsune_unsupported_capability`.

5. **Desktop Compatibility & Consumer Contracts:**
   - Projected `weather`, `notify`, `data_rate`, `data_size`, `duration`, and `wind_speed` into desktop `CompatView` in `apps/desktop/src/main/hub/entities.ts`.
   - Translated `notify.send_message` and `switch.turn_on` / `turn_off` in `apps/desktop/src/main/hub/commands.ts`.
   - Preserved strict <= 500 line limits across all authored files.

- **Automated Verification:** `packages/kitsune/test/utilities.test.ts` (4/4 tests PASS in 7ms), `apps/desktop/src/main/hub/test/utilities.test.ts` (2/2 tests PASS in 7ms).

---

## P18.6.3 Preserve Relationships & Execution Evidence

Verified relationship preservation, alias rebinding, and atomic execution continuity across migrated integrations:

1. **Identity & Alias Rebinding:**
   - Rebound legacy HA entity IDs (`light.hue_narnia_lamp`, `climate.tv_place_ac`) and provider external IDs (`legacy_device_sensibo_id_49GPvLvV`) to canonical devices and endpoints via `AtomicRoomMoveCoordinator.registerAlias` and `StandaloneHomeService.registerAlias`.
   - Verified transparent resolution of both canonical IDs and legacy aliases through `coordinator.resolveAddressOrId`.

2. **Scene & Automation Execution Continuity:**
   - Executed scenes targeting legacy entity aliases through `AutomationExecutor.executeScene`, successfully translating alias targets to canonical endpoints and dispatching native commands (`on_off`, `brightness`).
   - Triggered automations referencing legacy aliases across state triggers, conditions, and actions; verified `LocalAutomationEngine` indexes triggers by both raw alias/address and canonical endpoint ID via `resolveEndpointId`.
   - Verified events dispatched under canonical IDs fire rules written against legacy aliases, and resulting actions target canonical endpoints.

3. **Atomic Room Moves & Reference Rewriting:**
   - Moved devices between rooms (`narnia` -> `living_room`) via `AtomicRoomMoveCoordinator.moveDeviceToRoom`.
   - Verified automatic reference rewrites in scene members, scripts, automations, and device groups to target room primary addresses (`lighting::living-room:narnia-lamp:ep-hue-lamp-1`).
   - Retained prior room addresses in `patch.retainedAliases`; verified legacy addresses continue to resolve to canonical IDs without physical command dispatch.

4. **Account & Region Source Isolation:**
   - Verified distinct cloud region/account instances (e.g. `hacs:xiaomi_miot:us` vs `hacs:xiaomi_miot:cn`) retain isolated `sourceRefs` and independent canonical device identities without key collisions.

- **Automated Verification:** `packages/core/test/device/relationships.test.ts` (4/4 tests PASS in 8ms).

---

## P18.7 Built-in Integration Catalog & Tooling Evidence

Delivered complete pinned Home Assistant built-in integration catalog and reproducible tooling:

1. **Complete Initial Catalog (P18.7.1):**
   - **Pinned Release:** Home Assistant Core `2024.12.5` (provenance: PyPI package, license `Apache-2.0`, source: `https://github.com/home-assistant/core/releases/tag/2024.12.5`).
   - **Total Integrations:** 1,303 built-in integrations indexed with domains, names, iot classes, config flow flags, documentation URLs, python requirements, internal dependencies, code owners, and discovery matchers.
   - **Discovery Matchers:** Indexed 79 zeroconf matchers (e.g. `_hue._tcp.local.`, `_esphomelib._tcp.local.`), 72 DHCP matchers, 42 Bluetooth matchers, 38 SSDP matchers, 20 HomeKit matchers, 7 USB matchers, and 5 MQTT discovery matchers.
   - **Durable Catalog Archive:** Stored in `packages/ha/data/ha-catalog-2024.12.5.json.gz` (58,162 bytes compressed); deterministic SHA-256 checksum: `88291207c3fe58fbc63aa829a0e37cd09d1546f3df9083ed199b0eaa15cf8343`.

2. **Reproducible Tooling & Commands (P18.7.2):**
   - **Tooling Script:** `scripts/ha-catalog.ts` supporting `generate`, `check`, `coverage`, `diff`, and `rollback` commands.
   - **Package Shortcuts:** Added `pnpm catalog:check`, `pnpm catalog:generate`, and `pnpm catalog:coverage` to root `package.json`.
   - **Checksum & Integrity:** Validates SHA-256 against catalog contents upon loading; throws `catalog_integrity_check_failed` on tampered archives and `invalid_catalog_schema` on malformed data.
   - **Safe Rollback:** `rollback` restores verified backup archives without modifying active integrations, user configuration, or credentials.
   - **Diff Engine:** `diffCatalogs` calculates added, removed, and modified domains with field-level change details (name, iot_class, config_flow, requirements, dependencies).

3. **Truthful Runtime Coverage Reporting (P18.7.3):**
   - **Categorization Engine:** Evaluates each catalog manifest into runtime categories:
     - `native_haus` (9 domains): `mqtt`, `matter`, `homekit`, `homekit_controller`, `generic`, `onvif`, `automation`, `scene`, `script`.
     - `kitsune_hacs` (7 domains): `sensibo`, `hue`, `transmission`, `speedtestdotnet`, `openweathermap`, `telegram_bot`, `tuya`.
     - `homebridge` (1 domain): `apple_tv` (`homebridge-appletv-enhanced`).
     - `scrypted` (5 domains): `reolink`, `hikvision`, `amcrest`, `unifiprotect`, `tapo`, `ring`.
     - `catalog_only` (1,281 domains): Metadata indexed; runtime marked `unsupported` with explicit missing capabilities (`config_flow_execution`, python dependency requirements) without false execution claims.
   - **Coverage Summary:** 1,303 total integrations, 22 active executable domains (1.69%), 1,281 catalog-only.

- **Automated Verification:** `packages/ha/test/catalog.test.ts` (6/6 tests PASS in 143ms).

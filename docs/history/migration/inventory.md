# Household migration inventory

Observed 2026-11-09, 13:15–13:28 UTC. P18.1 evidence; this is inventory and proposed routing, not migration acceptance. No household integration, App, camera, radio or recording was changed.

## Evidence and consistency

Read HA Core 2026.10.1 registries, current states/config-entry runtime status, configuration, custom manifests, HACS repository metadata and Supervisor App list. Read Black Laptop's actual WSL `Ubuntu` Docker engine and authenticated native Hub APIs. Read Homebridge UI plugin inventory and configuration through its supported `config-editor` GET endpoint.

Full private source/instance/region/device/entity/feature mappings and raw snapshot SHA-256 digests are in Git-ignored `.local/migration/matrix.json`; source captures are beside it, private directory mode 700/files 600. Do not publish these payloads: configuration contains secrets, account identifiers and private media URLs.

Validated 130 configuration rows against 130 runtime rows with identical IDs. All 186 registered devices have a source-row link. Entity coverage is 955 linked rows plus 32 independent/YAML rows, exactly 987. The device registry currently uses singular `config_entry_id`; its `child_devices` array is empty. Deleted records (68 devices/369 entities) remain in the private raw captures and are not counted as active devices.

| Measure                                                    |        Observed |
| ---------------------------------------------------------- | --------------: |
| HA integration configuration entries / domains             |        130 / 51 |
| Ignored discovery entries                                  |              51 |
| Loaded / setup-retry / setup-error / not-loaded entries    | 75 / 2 / 2 / 51 |
| Registered devices / entities / rooms                      |  186 / 987 / 12 |
| Runtime states / unavailable states / unknown states       |  819 / 124 / 80 |
| Custom integration manifests / installed HACS repositories |         14 / 20 |
| HA Apps                                                    |              12 |
| Current Hub grouped devices / endpoints                    |        29 / 159 |
| Current Hub cameras / managed Apps                         |           4 / 4 |
| Current Hub scenes / automations / scripts                 |       0 / 0 / 0 |

The 32 independent entity rows are person (1), automation (21), script (1), homeassistant (8) and template (1). Counts refer to registry objects, not distinct physical hardware. Duplicate source/presentation records must not be merged solely by name. Sixteen device records have exact protocol/external-ID candidates in Hub `sourceRefs`; these are comparison candidates, not authorized identity rebindings.

## Integration domains

Each individual entry has its own matrix row, proposed target, current source owner, features/availability and preserve-current-config rollback. Ignored discoveries remain ignored. Error/retry below is an existing HA runtime condition, not a Kitsune failure.

| Domain               | Entries | Ignored | Loaded | Errors/retry | Devices | Entities | Disabled entities | Custom version |
| -------------------- | ------: | ------: | -----: | -----------: | ------: | -------: | ----------------: | -------------- |
| analytics            |       1 |       0 |      1 |            0 |       0 |        0 |                 0 | —              |
| androidtv            |       1 |       0 |      0 |            1 |       1 |        2 |                 0 | —              |
| apple_tv             |       2 |       0 |      2 |            0 |       2 |        5 |                 0 | —              |
| backup               |       1 |       0 |      1 |            0 |       1 |        5 |                 0 | —              |
| bluetooth            |       1 |       0 |      1 |            0 |       1 |        0 |                 0 | —              |
| cast                 |       1 |       0 |      1 |            0 |       2 |        2 |                 0 | —              |
| dlna_dmr             |       1 |       0 |      1 |            0 |       1 |        1 |                 0 | —              |
| eero                 |       1 |       0 |      1 |            0 |       7 |      105 |                 0 | 1.8.1          |
| esphome              |       4 |       0 |      4 |            0 |       4 |        9 |                 0 | —              |
| eufy_security        |       1 |       0 |      1 |            0 |       1 |       60 |                13 | 8.2.5          |
| eufylife_ble         |       1 |       0 |      1 |            0 |       1 |        2 |                 0 | —              |
| generic              |       1 |       0 |      1 |            0 |       1 |        1 |                 0 | —              |
| generic_thermostat   |       1 |       0 |      1 |            0 |       0 |        1 |                 0 | —              |
| go2rtc               |       1 |       0 |      1 |            0 |       0 |        0 |                 0 | —              |
| google_assistant     |       1 |       0 |      1 |            0 |       1 |        1 |                 0 | —              |
| google_assistant_sdk |       1 |       0 |      1 |            0 |       0 |        0 |                 0 | —              |
| group                |       4 |       0 |      4 |            0 |       0 |        4 |                 0 | —              |
| hacs                 |       1 |       0 |      1 |            0 |      20 |       40 |                20 | 2.0.5          |
| hassio               |       1 |       0 |      1 |            0 |      16 |       98 |                83 | —              |
| homekit              |      14 |       0 |     14 |            0 |      14 |        0 |                 0 | —              |
| homekit_controller   |      14 |      10 |      4 |            0 |      12 |       22 |                 0 | —              |
| hue                  |       1 |       0 |      1 |            0 |      25 |      125 |                20 | —              |
| ibeacon              |       1 |       0 |      1 |            0 |       0 |        0 |                 0 | —              |
| ipp                  |       1 |       0 |      0 |            1 |       1 |        7 |                 1 | —              |
| jellyfin             |       1 |       0 |      1 |            0 |       8 |       24 |                 0 | —              |
| material_symbols     |       1 |       0 |      1 |            0 |       0 |        0 |                 0 | 2026.07.08     |
| matter               |       1 |       0 |      1 |            0 |       7 |       34 |                 3 | —              |
| melnor               |       1 |       1 |      0 |            0 |       0 |        0 |                 0 | —              |
| meross_lan           |       4 |       0 |      4 |            0 |       3 |       23 |                 1 | 5.8.0          |
| mobile_app           |       2 |       0 |      2 |            0 |       2 |       62 |                16 | —              |
| mqtt                 |       1 |       0 |      1 |            0 |      19 |       95 |                 0 | —              |
| openweathermap       |       1 |       0 |      1 |            0 |       1 |       18 |                 0 | —              |
| qingping             |       1 |       1 |      0 |            0 |       0 |        0 |                 0 | —              |
| raspberry_pi         |       1 |       0 |      1 |            0 |       1 |        1 |                 0 | —              |
| rpi_power            |       1 |       0 |      1 |            0 |       1 |        1 |                 0 | —              |
| samsungtv            |       1 |       0 |      1 |            0 |       1 |        2 |                 0 | —              |
| sensibo              |       1 |       0 |      1 |            0 |       1 |       16 |                 6 | —              |
| speedtestdotnet      |       1 |       0 |      1 |            0 |       1 |        3 |                 0 | —              |
| starling_home_hub    |       1 |       0 |      1 |            0 |       0 |        0 |                 0 | v1.9.0         |
| stateful_scenes      |      39 |      38 |      1 |            0 |       8 |       64 |                 0 | 1.8.0          |
| sun                  |       1 |       0 |      1 |            0 |       1 |        9 |                 3 | —              |
| telegram_bot         |       1 |       0 |      1 |            0 |       2 |        2 |                 0 | —              |
| thread               |       1 |       0 |      1 |            0 |       0 |        0 |                 0 | —              |
| threshold            |       1 |       0 |      1 |            0 |       0 |        1 |                 0 | —              |
| transmission         |       1 |       0 |      1 |            0 |       1 |       18 |                 0 | —              |
| tuya                 |       1 |       0 |      1 |            0 |      10 |       53 |                 1 | —              |
| upnp                 |       1 |       1 |      0 |            0 |       0 |        0 |                 0 | —              |
| xbox                 |       1 |       0 |      1 |            0 |       1 |       20 |                 3 | —              |
| xiaomi_ble           |       3 |       0 |      3 |            0 |       3 |        8 |                 1 | —              |
| xiaomi_miot          |       2 |       0 |      0 |            2 |       2 |        9 |                 0 | 1.1.5          |
| yeelight             |       2 |       0 |      2 |            0 |       2 |        2 |                 0 | —              |

## Apps and plugin runtimes

| HA App                      | Version             | Observed HA state | Migration disposition                                                         |
| --------------------------- | ------------------- | ----------------- | ----------------------------------------------------------------------------- |
| Matter Server               | 9.3.0               | started           | Hub still uses this service; controller/fabric handover required.             |
| Advanced SSH & Web Terminal | 24.2.0              | started           | Administrative service; retain until explicit retirement.                     |
| Mosquitto                   | 7.1.3               | started           | Compare each publisher/subscriber before retiring the old broker.             |
| Homebridge                  | 2026-10-30          | started           | Read real plugin/config contracts; selected plugins move through Kitsune.     |
| eufy-security-ws            | 3.1.0               | started           | Current Hub endpoint still depends on HA-hosted service.                      |
| Samba share                 | 12.10.0             | started           | Host/file-service replacement decision required.                              |
| Govee to MQTT               | 2026.03.25-ab9deb66 | started           | Also present on Black Laptop; preserve until P18.5 acceptance.                |
| Aqara G5 Pro                | 1.6.39              | stopped           | Corresponding Black Laptop App is running; verify source routing.             |
| Tuya Camera Bridge          | 2.2.12              | started           | Current Hub endpoint still points to HA host.                                 |
| Clocteck clock              | 1.3.10              | stopped           | Corresponding Black Laptop App is running; verify full feature parity.        |
| Studio Code Server          | 7.2.0               | started           | Administrative/UI service; explicit disposition, no device migration assumed. |
| Haus Kettle                 | 0.1.5               | stopped           | Corresponding Black Laptop App is running; heating remains attended.          |

Black Laptop runs `haus-hub:0.3.76-local`, the existing healthy `haus-nvr:0.3.46`, and Govee, Aqara, clock and kettle App containers. They were observed through WSL `Ubuntu`; Windows Docker Desktop is a different engine. No container was restarted.

Homebridge has `homebridge-appletv-enhanced` 1.15.1, `homebridge-config-ui-x` 5.29.0 and **`@homebridge-plugins/homebridge-govee` 11.39.0** installed. Its AppleTVEnhanced and Govee platform blocks are configured and not disabled. This proves source configuration exists, not that Kitsune loads these plugins.

HACS reports 20 installed repositories: 15 integration entries, three frontend plugins and two themes. Fourteen custom integration manifests are present on disk; those sets are not identical. In particular HACS still lists Haus although its custom component was removed earlier, and the Tuya map-extractor manifest/manager version differs. Keep filesystem, manager and runtime evidence distinct. The complete repository/version list is private in the matrix. Built-in dependency/radio feasibility remains a per-integration acceptance check; no driver is accepted from its manifest alone.

## Readiness blockers and next slice

- Hub configuration still points Guinea Pigs media, Tuya, Eufy and Matter at the HA host. This is a demonstrated configuration dependency, not proof that changing a URL alone fixes streaming or safely transfers a controller.
- Four camera registry entries exist, but no stream, audio, snapshot or recording was exercised by this inventory. Native NVR acceptance and archive continuity remain P18.3–4.
- Hub has no registered scenes/automations/scripts while HA has rule/script entities. No rule conversion or ownership transfer is accepted from these counts.
- Both Xiaomi MIoT entries are in `setup_error`; IPP and Android TV are in `setup_retry`. Record these as existing source conditions. The installed Xiaomi Home component currently has no configuration entry; do not automatically re-enable it or merge regional accounts.
- Device counts differ because source grouping, presentation and migration differ. Exact alias candidates are not sufficient for automatic merging or deleting old sources.

Next bounded implementation: P18.2.1, validate retained HA discovery from the current Apps and fix demonstrated ingestion/identity behavior with isolated regression tests. Preserve unchanged App payloads; follow with bidirectional state/commands before changing Govee's controller. Camera-source dependencies already have concrete evidence for P18.3.

## Checks and operational limits

- PASS — `node .local/migration/collect.ts entries entities devices areas apps custom core`; read-only captures, each exit status 0.
- PASS — `node .local/migration/collect.ts states runtime black-containers black-hub`; HA GETs and WSL inspection, each exit status 0 after correcting the local PowerShell-to-bash CRLF wrapper.
- PASS — `node .local/migration/matrix.ts`; validates registry/runtime row identity and records all source-instance mappings/digests. Public counts reconcile to the captured data.
- PASS — authenticated Hub GETs for devices/states/Apps/cameras/scenes/automations/scripts. The temporary guest inventory session was explicitly logged out, and a subsequent authenticated request returned 401.
- PASS — Homebridge plugin/config-editor authenticated GETs. The earlier guessed `/api/config` route returned 404; the documented read route succeeded. A guessed Docker container name was absent; no container operation was performed.
- NOT RUN — plugin execution, physical controls, live media/recording, archive migration, source replacement or HA shutdown. All remain separately gated by their plan acceptance and user permissions.

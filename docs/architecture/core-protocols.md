# Haus Core Protocol Packages: MQTT, Matter, Zigbee, Thread

## 1. Overview

Haus establishes direct local ownership of smart home radio and communication protocols. Unlike legacy architectures where protocols were delegated to Home Assistant Container or Supervisor add-ons, Haus implements them as **first-class core features** organized into dedicated packages:

- `@haus/mqtt` (`packages/mqtt`): Native MQTT protocol client, wildcard topic router, generic discovery registry, and OS-agnostic broker configuration.
- `@haus/matter` (`packages/matter`): Native Matter controller, commissioning (QR/manual code/discriminator), node inventory, standard cluster definitions (OnOff, LevelControl, ColorControl, etc.), and attribute change subscriptions.
- `@haus/zigbee` (`packages/zigbee`): Native Zigbee 802.15.4 radio coordinator, network commissioning (permit join), device interview, and ZCL (Zigbee Cluster Library) cluster execution.
- `@haus/thread` (`packages/thread`): Native Thread mesh network controller, active operational dataset validation/generation, and OpenThread Border Router (OTBR) interface.

## 2. Core Features vs. Apps / Add-ons

As mandated by user decision (2026-11-04):

1. **Core Features (Packages):** Protocol engines (`mqtt`, `matter`, `zigbee`, `thread`) are core packages, not containerized apps. They provide neutral, high-performance contracts and transport interfaces.
2. **Third-Party Integrations (Apps):** Specific vendor bridges and integrations (e.g. Aqara G5 Pro, Govee, Tuya, Clocteck Tube Clock, Studio Code Server, etc.) are installed by the user as regular containerized Apps via `@haus/apps`, matching the user experience of HAOS add-ons without requiring Home Assistant or Supervisor.
3. **Existing Proven Libraries:** Battle-tested, quality-proven libraries are utilized directly inside our packages to avoid reinventing established network protocols:
   - `@haus/mqtt`: uses the official `mqtt` npm package.
   - `@haus/matter`: uses the official `@matter/main` package for canonical Matter cluster definitions, schemas, and behavior.
   - `@haus/zigbee`: uses `zigbee-herdsman` for official Zigbee Cluster Library (ZCL) clusters, frames, and coordinator control.
4. **OS-Agnostic Design:** No hardcoded POSIX or platform-specific filesystem paths (such as `/var/lib/...` or `/etc/...`). All storage roots are injected by host configuration and normalized across Linux, macOS, and Windows.

## 3. Package Responsibilities

### 3.1 `@haus/mqtt`

- **Client (`HausMqttClient`):** Uses the official `mqtt` library for robust connection management, automatic reconnection, QoS (0, 1, 2), and retained message delivery.
- **Topic Router (`MqttTopicRouter`):** Dispatches messages based on standard MQTT wildcards (`+` for single-level, `#` for multi-level).
- **Discovery Registry (`MqttDiscoveryRegistry`):** Parses generic MQTT discovery announcements (`<prefix>/<component>/<node_id>/<object_id>/config`), allowing user-installed apps to expose entities dynamically without hardcoded handlers.
- **Broker Configuration (`generateMosquittoConfig`):** Emits secure, least-privilege configuration for local Mosquitto brokers with customizable ports, anonymous access flags, and normalized storage paths.

The running Hub uses `HausMqttBroker` (Aedes) with an injected `RetainedStore`. Its TypeORM adapter is in `apps/hub/src/storage/mqtt`; the package never opens a database itself. Retained bytes/QoS and cumulative discovery projections are separate, so external subscribers see the publisher's original packet. Startup restores discovery before state without replaying automation triggers; the catalog lifetime stops MQTT before closing storage. Durable MQTT sessions and command replay are not implemented by retained storage.

`DiscoveryTopics` parses the [HA topic grammar](https://www.home-assistant.io/integrations/mqtt/#discovery-topic) consistently for live ingestion and recovery. Hub options accept `discoveryPrefixes`; the environment equivalent is comma-separated `HAUS_MQTT_DISCOVERY_PREFIXES` (for example `homeassistant,house/discovery`). The default remains `homeassistant,haus`. Prefixes are literal, may contain multiple levels, and must not overlap or contain MQTT wildcards. Node/object IDs follow HA's documented alphanumeric/underscore/hyphen grammar. Unsupported platforms are reported rather than converted into generic writable devices. Changing prefixes does not itself transfer source ownership or remove old registry entries.

### 3.2 `@haus/matter`

- **Controller (`MatterController`):** Manages Matter commissioning sessions and maintains a live inventory of commissioned nodes and endpoints.
- **Official Matter Clusters (`@haus/matter/clusters`):** Directly re-exports and utilizes canonical Matter cluster schemas from `@matter/main` (OnOff, LevelControl, ColorControl, TemperatureMeasurement, DoorLock, WindowCovering, Thermostat, etc.) with typed attributes, commands, and access conformance.
- **Attribute Subscriptions:** Propagates real-time attribute changes to local subscribers with state caching on node models.

### 3.3 `@haus/zigbee`

- **Coordinator (`ZigbeeCoordinator`):** Manages serial communication with 802.15.4 coordinator dongles (EZSP, Z-Stack, deCONZ) via `zigbee-herdsman`.
- **Network Management:** Coordinates PAN ID, Extended PAN ID, radio channel (11–26), and timed permit-join windows (0–255s).
- **Official ZCL Clusters (`@haus/zigbee/clusters`):** Utilizes `Zcl.Clusters` directly from `zigbee-herdsman` for comprehensive Zigbee Cluster Library definitions (genOnOff, genLevelCtrl, lightingColorCtrl, ssIasZone, etc.), complete with command IDs, parameters, and attribute metadata.

### 3.4 `@haus/thread`

- **Operational Datasets (`@haus/thread/dataset`):** Validates and generates Thread operational datasets (network name, channel, 16-bit PAN ID, 64-bit Extended PAN ID, 128-bit network key, IPv6 ULA mesh-local prefix).
- **Mesh Controller (`ThreadController`):** Forms and joins Thread mesh networks, queries leader/router roles, inspects neighbor tables with link quality (LQI/RSSI), and commissions joining devices via EUI-64 and PSKd.

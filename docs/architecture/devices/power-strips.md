# Haus Device Types & Power Strip Standard

## 1. `DeviceCategory` vs `DeviceType`

Haus separates coarse domain grouping from exact physical hardware archetypes:

- **`DeviceCategory`** (`packages/core/src/device/category.ts`) groups devices into 16 high-level UI and domain buckets (`lighting`, `power`, `climate`, `security`, `cameras`, `media`, `covers`, `appliances`, `safety_sensors`, `environmental_sensors`, `occupancy_sensors`, `network`, `compute`, `storage`, `energy`, `generic`).
- **`DeviceType`** (`DeviceTypeEnum` in `packages/core/src/device/category.ts`) identifies the canonical hardware archetype (`light`, `light_strip`, `outlet`, `power_strip`, `switch`, `button_controller`, `thermostat`, `fan`, `air_purifier`, `humidifier`, `cover`, `lock`, `security_system`, `camera`, `doorbell`, `speaker`, `television`, `remote`, `kettle`, `vacuum`, `scale`, `clock`, `printer`, `appliance`, `sensor`, `bridge`, `router`, `service`, `generic`).

`DeviceRegistry` computes `device.deviceType` and `device.opaqueMetadata.presentation` authoritatively on the Hub via `computeDevicePresentation()` so Desktop, Mobile, HomeKit, and Matter consumers do not rely on brand/model regexes.

## 2. Power Strip (`power_strip`) Protocol Contract

A multi-outlet power strip, surge protector, or multi-socket outdoor power hub is **one single physical `HausDevice`**, never separate orphan child devices per socket:

- **`category`**: `'power'`
- **`deviceType`**: `'power_strip'`
- **`services`**: each controllable socket collapses into a canonical HAP `Outlet` `HausService` (`type: 'Outlet'`, `subtype: endpoint.id`, boolean `power` characteristic, concise stripped `name` such as `Wall Garland`, `Desk`, `USB`, `Switch 1`).
- **`opaqueMetadata.outletRole`** on each `Outlet` service:
  - `'outlet'` — an independently addressable physical socket or USB bank.
  - `'master'` — an optional hardware master switch that toggles all sockets at once (present only when there are at least 2 individual outlets alongside 1 master candidate such as `*_power`, `*_all`, `*_master`, or `switch_all`).
- **`opaqueMetadata.presentation.powerStrip`**:
  ```ts
  {
    outletEndpointIds: readonly string[];
    masterEndpointId?: string;
  }
  ```

### Protocol Alignment

| Source Protocol                                         | Physical Hardware                                     | Canonical Haus Projection                                             |
| ------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------- |
| Apple HAP / HomeKit                                     | 1 Accessory with N `Outlet` services                  | 1 `HausDevice` (`deviceType: 'power_strip'`), N `Outlet` services     |
| Matter                                                  | 1 Node with N On/Off Plug-in Unit endpoints           | 1 `HausDevice` (`deviceType: 'power_strip'`), N `Outlet` services     |
| Tuya (`category: 'pc'`)                                 | 1 Device with `switch_1..N` (+ optional `switch_all`) | 1 `HausDevice` (`deviceType: 'power_strip'`), `deviceClass: 'outlet'` |
| Home Assistant (`meross_lan`, `tplink`, `shelly`, etc.) | Parent device + `via_device_id` channel sub-devices   | Folded into 1 parent `HausDevice`; original `entity_id`s preserved    |
| Zigbee / MQTT                                           | 1 IEEE / node with multi-gang `switch` endpoints      | 1 `HausDevice` (`deviceType: 'power_strip'`), N `Outlet` services     |

## 3. Composite Hardware Sub-Device Folding (`via_device_id`)

Integrations such as `meross_lan` (`mss425f`, `mss620`) and `tplink` (`HS300`, `KP303`, `P300`) register individual sockets as separate Home Assistant child devices referencing the physical enclosure via `via_device_id`.

`resolve_canonical_device()` (`packages/kitsune/src/ha-flow/subentries.py`) folds a child sub-device onto its physical parent **only when all invariants hold**:

1. Parent exists, is distinct, and is a physical device (`parent.entry_type is None` — never a `'service'` like Eero Network or Telegram Broadcast).
2. Child and parent share a `config_entry_id`.
3. Parent is not network/radio bridge infrastructure (`bridge`, `coordinator`, `gateway`, `router`, `mesh`, `eero`, `unifi`, `access point`, `repeater`, `satellite`).
4. Manufacturers do not conflict, and either:
   - a child identifier extends a parent identifier with a channel delimiter (`_`, `:`, `-`, `/`), or
   - child and parent share the exact same hardware model and the child name indicates a channel/outlet/socket/plug/usb/gang/relay/port sub-unit.

Original `entity_id` and `unique_id` values are never renamed, preserving every automation, scene, history series, and command route. When a persisted orphan sub-device has 100% of its endpoints absorbed by an active parent in the same entry, `pruneSupersededHaDevices()` removes the obsolete orphan cleanly without disturbing shared endpoint state.

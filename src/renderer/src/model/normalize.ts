import {
  clockDeviceAliases,
  isServiceRoom,
  isVirtualDevice,
  isPhysicalHub,
  isButtonController,
} from './device-identity';
import { cameraRelationships, isPowerStrip } from './device-relationships';
import { entityDomain, resolveCapabilities } from './capabilities';
import { earliestPending } from './pending-feedback';
import {
  deviceTelemetryRegistry,
  isSoftwareMediaEndpoint,
  preferredScaleEntity,
  isScaleReading,
  knownScaleReading,
} from './device-telemetry';
import type {
  Category,
  Device,
  EntityRegistryEntry,
  HassEntity,
  HausAccessory,
  HausModel,
  Snapshot,
} from './types';

const controlDomains = new Set([
  'light',
  'switch',
  'climate',
  'cover',
  'media_player',
  'lock',
  'camera',
  'printer',
  'fan',
  'valve',
  'humidifier',
  'water_heater',
  'alarm_control_panel',
  'vacuum',
  'siren',
  'select',
  'number',
  'button',
  'input_boolean',
  'input_number',
  'input_select',
  'input_button',
]);
const specialDomains = new Set([
  'scene',
  'automation',
  'script',
  'person',
  'zone',
  'sun',
  'weather',
  'update',
]);
const securityClasses = new Set([
  'door',
  'window',
  'opening',
  'garage_door',
  'motion',
  'occupancy',
  'presence',
  'smoke',
  'gas',
  'carbon_monoxide',
  'safety',
  'tamper',
  'vibration',
]);
const climateClasses = new Set([
  'temperature',
  'humidity',
  'carbon_dioxide',
  'pm25',
  'pm10',
  'volatile_organic_compounds',
  'air_quality',
]);

const isSecondary = (entry?: EntityRegistryEntry) =>
  Boolean(entry?.disabled_by || entry?.hidden_by || entry?.entity_category);
const friendlyName = (entity: HassEntity) =>
  entity.attributes.friendly_name ||
  entity.entity_id.split('.')[1]?.replaceAll('_', ' ') ||
  entity.entity_id;
const batteryChargingValue = (entity: HassEntity): boolean | undefined => {
  const value = entity.attributes.is_charging ?? entity.state;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase().replaceAll('_', ' ');
  if (['on', 'true', '1', 'charging', 'finishing charge'].includes(normalized)) return true;
  if (['off', 'false', '0', 'not charging', 'discharging', 'charged', 'full'].includes(normalized))
    return false;
  return undefined;
};

function displayNameForDevice(
  entity: HassEntity,
  entry: EntityRegistryEntry | undefined,
  device: Device | undefined,
  useDeviceName: boolean,
): string {
  const entityName = String(entry?.name || friendlyName(entity))
    .replace(/\s+/g, ' ')
    .trim();
  const chosenDeviceName = String(device?.name_by_user || device?.name || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (device?.name_by_user) return chosenDeviceName;
  if (useDeviceName && chosenDeviceName) return chosenDeviceName;
  if (chosenDeviceName) {
    const escaped = chosenDeviceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const repeatedType = new RegExp(
      `^${escaped}\\s+(door|window|light|lamp|switch|sensor|lock|cover|battery)$`,
      'i',
    );
    if (repeatedType.test(entityName)) return chosenDeviceName;
  }
  return entityName || chosenDeviceName || entity.entity_id;
}

function batteryMatchTokens(value: string): string[] {
  return value
    .toLocaleLowerCase()
    .replace(
      /\b(battery|batteries|batt|charge|charging|level|percentage|percent|capacity|sensor|device)\b/g,
      ' ',
    )
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

function powerEntityMatchesDevice(entityLabel: string, deviceLabel: string): boolean {
  if (/\b(power|relay)\b/i.test(entityLabel)) return true;
  const normalize = (value: string) =>
    value
      .toLocaleLowerCase()
      .replace(/\b(power|relay|switch|light|lamp|on|off)\b/g, ' ')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  const entityBase = normalize(entityLabel);
  return Boolean(entityBase && entityBase === normalize(deviceLabel));
}

function batteryNameScore(batteryName: string, accessoryNames: string[]): number {
  const batteryTokens = batteryMatchTokens(batteryName);
  if (batteryTokens.length < 2) return 0;
  return accessoryNames.reduce((best, name) => {
    const accessoryTokens = batteryMatchTokens(name);
    if (accessoryTokens.length < 2) return best;
    const accessorySet = new Set(accessoryTokens);
    const shared = batteryTokens.filter((token) => accessorySet.has(token)).length;
    const score = shared / Math.max(batteryTokens.length, accessorySet.size);
    return Math.max(best, score);
  }, 0);
}
export const isSegmentEntity = (entity: HassEntity) =>
  /segment|pixel|(?:^|[_.\s-])zone(?:$|[_.\s-])/i.test(
    `${entity.entity_id} ${String(entity.attributes.friendly_name ?? '')}`,
  );

export function isStatefulScene(
  entity: HassEntity,
  entry?: EntityRegistryEntry,
  device?: Device,
): boolean {
  if (entry?.platform && /stateful[_-]?scenes?/i.test(entry.platform)) return true;
  if (entry?.unique_id && /stateful[_-]?scenes?/i.test(entry.unique_id)) return true;
  if (
    /^switch\.stateful_scene/i.test(entity.entity_id) ||
    /stateful[_-]?scenes?/i.test(entity.entity_id)
  ) {
    return true;
  }
  if (entity.attributes.integration === 'stateful_scenes') return true;
  if (
    entity.attributes.scene_entity_id !== undefined ||
    entity.attributes.monitored_entities !== undefined ||
    entity.attributes.off_scene !== undefined
  ) {
    return true;
  }
  if (device) {
    if (device.manufacturer && /hugo\s*bloem|stateful[_-]?scenes?/i.test(device.manufacturer)) {
      return true;
    }
    if (device.model && /stateful[_-]?scenes?/i.test(device.model)) return true;
    if (device.name && /stateful[_-]?scenes?/i.test(device.name)) return true;
    if (device.name_by_user && /stateful[_-]?scenes?/i.test(device.name_by_user)) return true;
    if (
      Array.isArray(device.identifiers) &&
      device.identifiers.some((tuple) =>
        Array.isArray(tuple)
          ? tuple.some((id) => typeof id === 'string' && /stateful[_-]?scenes?/i.test(id))
          : typeof tuple === 'string' && /stateful[_-]?scenes?/i.test(tuple),
      )
    ) {
      return true;
    }
  }
  return false;
}
const sceneMetadata = new Set([
  'friendly_name',
  'icon',
  'entity_id',
  'id',
  'supported_features',
  'supported_color_modes',
  'min_color_temp_kelvin',
  'max_color_temp_kelvin',
  'min_mireds',
  'max_mireds',
  'unit_of_measurement',
]);

function sceneSettingMatch(
  scene: HassEntity,
  snapshot: Snapshot,
  sceneConfig?: Record<string, unknown>,
) {
  const settings = sceneConfig?.entities ?? scene.attributes.entities ?? scene.attributes.states;
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return undefined;
  const currentStates = new Map(snapshot.states.map((state) => [state.entity_id, state]));
  const entries = Object.entries(settings as Record<string, unknown>);
  let comparedEntities = 0;
  let matches = 0;
  let comparisons = 0;
  const matchesValue = (key: string, actual: unknown, expected: unknown) => {
    if (typeof actual === 'number' && typeof expected === 'number') {
      const tolerance: Record<string, number> = {
        brightness: 20,
        color_temp_kelvin: 250,
        color_temp: 25,
        current_position: 5,
        position: 5,
        percentage: 5,
        temperature: 0.5,
      };
      return (
        Math.abs(actual - expected) <= (tolerance[key] ?? Math.max(0.05, Math.abs(expected) * 0.02))
      );
    }
    if (Array.isArray(actual) && Array.isArray(expected) && actual.length === expected.length) {
      return actual.every((value, index) =>
        typeof value === 'number' && typeof expected[index] === 'number'
          ? Math.abs(value - expected[index]) <= (key === 'rgb_color' ? 24 : 0.025)
          : value === expected[index],
      );
    }
    return String(actual).toLowerCase() === String(expected).toLowerCase();
  };

  for (const [entityId, config] of entries) {
    const current = currentStates.get(entityId);
    if (!current) continue;
    const configRecord =
      config && typeof config === 'object' && !Array.isArray(config)
        ? (config as Record<string, unknown>)
        : undefined;
    const expectedAttributes =
      configRecord?.attributes && typeof configRecord.attributes === 'object'
        ? (configRecord.attributes as Record<string, unknown>)
        : configRecord;
    const expectedValues: Array<[string, unknown, unknown]> = [];
    if (typeof config === 'string') expectedValues.push(['state', current.state, config]);
    else if (configRecord?.state !== undefined)
      expectedValues.push(['state', current.state, configRecord.state]);
    for (const [key, expected] of Object.entries(expectedAttributes ?? {})) {
      const expectedState = typeof config === 'string' ? config : configRecord?.state;
      // A powered-off lamp may keep its previous brightness and color in HA.
      if (
        entityId.startsWith('light.') &&
        expectedState === 'off' &&
        [
          'brightness',
          'color_mode',
          'rgb_color',
          'rgbw_color',
          'rgbww_color',
          'hs_color',
          'xy_color',
          'color_temp',
          'color_temp_kelvin',
          'effect',
        ].includes(key)
      )
        continue;
      if (
        key === 'state' ||
        sceneMetadata.has(key) ||
        expected === null ||
        (typeof expected === 'object' && !Array.isArray(expected))
      )
        continue;
      expectedValues.push([key, current.attributes[key], expected]);
    }
    if (expectedValues.length) comparedEntities += 1;
    for (const [key, actual, expected] of expectedValues) {
      comparisons += 1;
      if (matchesValue(key, actual, expected)) matches += 1;
    }
  }
  return comparisons
    ? {
        matchScore: matches / comparisons,
        matchCoverage: entries.length ? comparedEntities / entries.length : 0,
      }
    : undefined;
}

/** Only logical children inherit an area. via_device_id is a gateway, not a room parent. */
export function effectiveArea(
  entry: EntityRegistryEntry | undefined,
  devices: ReadonlyMap<string, Device>,
): string | undefined {
  if (entry?.area_id) return entry.area_id;
  let deviceId = entry?.device_id;
  const visited = new Set<string>();
  while (deviceId && !visited.has(deviceId)) {
    visited.add(deviceId);
    const device = devices.get(deviceId);
    if (!device) return undefined;
    if (device.area_id) return device.area_id;
    deviceId = device.parent_device_id;
  }
  return undefined;
}

export function entityCategory(entity: HassEntity): Category {
  const domain = entityDomain(entity);
  const deviceClass = String(entity.attributes.device_class ?? '');
  if (domain === 'light') return 'lights';
  if (domain === 'printer') return 'printers';
  if (['climate', 'fan', 'humidifier'].includes(domain) || climateClasses.has(deviceClass))
    return 'climate';
  if (
    ['camera', 'lock', 'alarm_control_panel', 'siren'].includes(domain) ||
    securityClasses.has(deviceClass)
  )
    return 'security';
  if (domain === 'media_player') return 'media';
  if (
    ['valve', 'water_heater'].includes(domain) ||
    ['moisture', 'water', 'water_flow'].includes(deviceClass)
  )
    return 'water';
  if (['switch', 'input_boolean'].includes(domain) || deviceClass === 'outlet') return 'outlets';
  if (domain === 'cover') return 'covers';
  return 'other';
}

export function normalizeHome(snapshot: Snapshot): HausModel {
  const registry = deviceTelemetryRegistry(snapshot);
  const devices = new Map(snapshot.devices.map((device) => [device.id, device]));
  const relationships = cameraRelationships(snapshot);
  const cameraState = (state: HassEntity): HassEntity =>
    relationships.cameraSourceStates.has(state.entity_id)
      ? { ...state, state: relationships.cameraSourceStates.get(state.entity_id)! }
      : state;
  const clockAliases = clockDeviceAliases(snapshot.devices);
  const deviceStates = new Map<string, HassEntity[]>();
  for (const original of snapshot.states) {
    const state = cameraState(original);
    const deviceId = registry.get(state.entity_id)?.device_id;
    const cameraId = relationships.entityOwners.get(state.entity_id);
    const key = cameraId
      ? `camera:${cameraId}`
      : deviceId
        ? `device:${clockAliases.get(deviceId) ?? deviceId}`
        : `entity:${state.entity_id}`;
    deviceStates.set(key, [...(deviceStates.get(key) ?? []), state]);
  }
  const visible = snapshot.states.filter((state) => !isSecondary(registry.get(state.entity_id)));
  const telemetryRank = (state: HassEntity) => {
    const deviceClass = state.attributes.device_class;
    return securityClasses.has(String(deviceClass))
      ? -1
      : deviceClass === 'temperature'
        ? 0
        : deviceClass === 'humidity'
          ? 1
          : /connectivity|battery/.test(String(deviceClass))
            ? 5
            : 2;
  };
  const groups = [...deviceStates.entries()];
  const primaryRank = (state: HassEntity) => {
    const domain = entityDomain(state);
    const rank: Record<string, number> = {
      camera: 0,
      printer: 1,
      light: 1,
      lock: 2,
      climate: 3,
      media_player: 4,
      cover: 5,
      fan: 6,
      valve: 7,
      humidifier: 8,
      water_heater: 9,
      alarm_control_panel: 10,
      siren: 11,
      vacuum: 12,
      switch: 13,
      input_boolean: 14,
      select: 20,
      number: 21,
      button: 22,
      input_select: 23,
      input_number: 24,
      input_button: 25,
    };
    return (rank[domain] ?? 100) + (isSegmentEntity(state) ? 50 : 0);
  };
  const isCandidate = (state: HassEntity) => {
    const domain = entityDomain(state);
    return (
      (controlDomains.has(domain) ||
        ['sensor', 'binary_sensor', 'device_tracker', 'event'].includes(domain)) &&
      (domain !== 'event' ||
        isButtonController(devices.get(registry.get(state.entity_id)?.device_id ?? ''))) &&
      !isSecondary(registry.get(state.entity_id)) &&
      !specialDomains.has(domain) &&
      !['battery', 'battery_charging'].includes(String(state.attributes.device_class))
    );
  };
  const accessories: HausAccessory[] = groups.flatMap(([groupKey, members]) => {
    let candidates = members.filter(isCandidate);
    // Infrastructure often exposes only diagnostics. Keep a read-only summary,
    // never promote a reboot button or a configuration switch to quick control.
    if (!candidates.length) {
      candidates = members.filter((state) => {
        const entry = registry.get(state.entity_id);
        return (
          entry?.device_id &&
          !entry.disabled_by &&
          !entry.hidden_by &&
          !['battery', 'battery_charging'].includes(String(state.attributes.device_class)) &&
          (['sensor', 'binary_sensor', 'device_tracker'].includes(entityDomain(state)) ||
            (isPhysicalHub(devices.get(entry.device_id)) && entityDomain(state) === 'button'))
        );
      });
    }
    if (!candidates.length) return [];
    const candidateEntry = registry.get(candidates[0].entity_id);
    const candidateDevice = candidateEntry?.device_id
      ? devices.get(candidateEntry.device_id)
      : undefined;
    const printerContext = [
      candidateDevice?.name,
      candidateDevice?.name_by_user,
      candidateDevice?.manufacturer,
      candidateDevice?.model,
      ...members.flatMap((state) => [state.entity_id, friendlyName(state)]),
    ]
      .filter(Boolean)
      .join(' ');
    const platforms = members.map((state) => registry.get(state.entity_id)?.platform);
    const isNetwork =
      platforms.some((platform) =>
        ['eero', 'unifi', 'asuswrt', 'upnp', 'fritz'].includes(platform ?? ''),
      ) || /\b(?:router|eero|ubiquiti|mikrotik|netgear)\b/i.test(printerContext);
    const isPrinter =
      platforms.includes('ipp') ||
      /\b(?:printer|printing|3d print|bambu|prusa|creality|octoprint|klipper|laserjet|officejet|deskjet|ecotank|workforce|imageclass|pixma|mfc[-\s])/i.test(
        printerContext,
      );
    const printerStatus = isPrinter
      ? candidates
          .filter((state) => {
            const domain = entityDomain(state);
            const label = `${state.entity_id} ${friendlyName(state)}`;
            return (
              domain === 'sensor' &&
              (/status|state|job|progress|connection/i.test(label) ||
                !/ink|toner|uptime|page|level/i.test(label))
            );
          })
          .sort((a, b) => a.entity_id.localeCompare(b.entity_id))
      : [];
    const infrastructure = isPhysicalHub(candidateDevice);
    const controller = isButtonController(candidateDevice);
    if (infrastructure) {
      const telemetry = members.filter(
        (state) =>
          !registry.get(state.entity_id)?.disabled_by &&
          !registry.get(state.entity_id)?.hidden_by &&
          ['sensor', 'binary_sensor'].includes(entityDomain(state)),
      );
      if (telemetry.length) candidates = telemetry;
    } else if (controller) {
      const buttons = candidates.filter((state) => entityDomain(state) === 'event');
      if (buttons.length) candidates = buttons;
    }
    const controls = candidates.filter((state) => controlDomains.has(entityDomain(state)));
    const networkStatus = isNetwork
      ? (candidates.find((state) => /(?:^|_)status$/.test(state.entity_id)) ??
        candidates.find((state) => state.entity_id.endsWith('_connected')))
      : undefined;
    const cameraPrimary = groupKey.startsWith('camera:')
      ? members.find((item) => item.entity_id === groupKey.slice(7))
      : undefined;
    const scalePrimary = preferredScaleEntity(candidates, candidateDevice);
    const hubStatus = infrastructure
      ? candidates.find((item) => /(?:connectivity|status|uptime)$/.test(item.entity_id))
      : undefined;
    const primary =
      cameraPrimary ??
      hubStatus ??
      networkStatus ??
      scalePrimary ??
      (printerStatus.length
        ? printerStatus[0]
        : controls.length
          ? [...controls].sort(
              (a, b) => primaryRank(a) - primaryRank(b) || a.entity_id.localeCompare(b.entity_id),
            )[0]
          : [...candidates].sort(
              (a, b) =>
                telemetryRank(a) - telemetryRank(b) || a.entity_id.localeCompare(b.entity_id),
            )[0]);
    const entry = registry.get(primary.entity_id);
    const deviceId = entry?.device_id ?? undefined;
    const device = cameraPrimary
      ? (members
          .map((item) => devices.get(registry.get(item.entity_id)?.device_id ?? ''))
          .find((item) => item?.model) ?? devices.get(deviceId ?? ''))
      : deviceId
        ? devices.get(deviceId)
        : undefined;
    const powerStrip = isPowerStrip(device, members);
    const buttonController = isButtonController(device);
    const clock = /clock|nixie/i.test(`${device?.model ?? ''} ${device?.name ?? ''}`);
    const separatedSwitches = members.filter((sibling) => {
      const domain = entityDomain(sibling);
      const primaryDomain = entityDomain(primary);
      if (
        cameraPrimary ||
        powerStrip ||
        isNetwork ||
        clock ||
        buttonController ||
        ['climate', 'water_heater'].includes(primaryDomain)
      )
        return false;
      if (
        sibling.entity_id === primary.entity_id ||
        !['switch', 'input_boolean'].includes(domain) ||
        !isCandidate(sibling) ||
        isStatefulScene(sibling, registry.get(sibling.entity_id), device)
      )
        return false;
      const label = `${sibling.entity_id} ${friendlyName(sibling)} ${registry.get(sibling.entity_id)?.name ?? ''}`;
      const primaryLabel = `${primary.entity_id} ${friendlyName(primary)} ${device?.name ?? ''}`;
      const isPowerEntity = powerEntityMatchesDevice(label, primaryLabel);
      const belongsToMainLight = entityDomain(primary) === 'light' && isPowerEntity;
      const isDevicePowerEntity =
        ['camera', 'media_player'].includes(entityDomain(primary)) && isPowerEntity;
      return !belongsToMainLight && !isDevicePowerEntity;
    });
    const separatedSwitchIds = new Set(separatedSwitches.map((item) => item.entity_id));
    const secondaryEntities = members.filter(
      (sibling) =>
        sibling.entity_id !== primary.entity_id && !separatedSwitchIds.has(sibling.entity_id),
    );
    const areaId =
      effectiveArea(entry, devices) ??
      secondaryEntities
        .map((sibling) => effectiveArea(registry.get(sibling.entity_id), devices))
        .find((area) => area !== undefined);
    const isService =
      isServiceRoom(snapshot.areas.find((area) => area.area_id === areaId)?.name ?? '') ||
      isStatefulScene(primary, entry, device) ||
      members.some((m) => isStatefulScene(m, registry.get(m.entity_id), device)) ||
      (platforms.includes('mobile_app') && !controls.length) ||
      isVirtualDevice(device) ||
      isSoftwareMediaEndpoint(primary, entry) ||
      (/(?:^|_)(?:scene_history|message|json)$/.test(primary.entity_id.split('.')[1] ?? '') &&
        !device);
    const accessory: HausAccessory = {
      id: primary.entity_id,
      deviceId,
      primaryEntityId: primary.entity_id,
      entityIds: [primary.entity_id, ...secondaryEntities.map((entity) => entity.entity_id)],
      areaId,
      manufacturer: device?.manufacturer,
      model: device?.model,
      category: isPrinter ? 'printers' : isNetwork ? 'network' : entityCategory(primary),
      buttonController: buttonController || undefined,
      physicalHub: isPhysicalHub(device) || undefined,
      name:
        scalePrimary && entry?.name
          ? entry.name
          : displayNameForDevice(
              primary,
              entry,
              device,
              isPrinter ||
                isNetwork ||
                powerStrip ||
                buttonController ||
                isPhysicalHub(device) ||
                Boolean(scalePrimary),
            ),
      powerStrip: powerStrip || undefined,
      visibilityEntityIds:
        cameraPrimary || powerStrip || clock || buttonController || isPhysicalHub(device)
          ? [primary.entity_id]
          : undefined,
      availability:
        primary.state !== 'unavailable' &&
        ((buttonController && primary.entity_id.startsWith('event.')) ||
          (isPhysicalHub(device) && primary.entity_id.startsWith('button.')))
          ? 'available'
          : primary.state === 'unavailable'
            ? 'unavailable'
            : primary.state === 'unknown'
              ? 'unknown'
              : 'available',
      capabilities: isPhysicalHub(device) ? [] : resolveCapabilities(primary, snapshot.services),
      state: primary,
      secondaryEntities,
      defaultHidden: isService ? true : undefined,
      isService: isService ? true : undefined,
      pending: members.some((member) => snapshot.pendingEntityIds?.includes(member.entity_id)),
      pendingSince: earliestPending(
        members.map((member) => snapshot.pendingSince?.[member.entity_id]),
      ),
    };
    const independentSwitches: HausAccessory[] = separatedSwitches.map((switchEntity) => {
      const switchEntry = registry.get(switchEntity.entity_id);
      return {
        id: switchEntity.entity_id,
        deviceId: switchEntry?.device_id ?? undefined,
        primaryEntityId: switchEntity.entity_id,
        entityIds: [switchEntity.entity_id],
        areaId: effectiveArea(switchEntry, devices) ?? areaId,
        manufacturer: device?.manufacturer,
        model: device?.model,
        category: entityCategory(switchEntity),
        name: displayNameForDevice(switchEntity, switchEntry, undefined, false),
        availability:
          switchEntity.state === 'unavailable'
            ? 'unavailable'
            : switchEntity.state === 'unknown'
              ? 'unknown'
              : 'available',
        capabilities: resolveCapabilities(switchEntity, snapshot.services),
        state: switchEntity,
        secondaryEntities: [],
        pending: snapshot.pendingEntityIds?.includes(switchEntity.entity_id),
        pendingSince: snapshot.pendingSince?.[switchEntity.entity_id],
      };
    });
    return [accessory, ...independentSwitches];
  });

  const batteryEntities = snapshot.states.filter((entity) => {
    const entry = registry.get(entity.entity_id);
    return (
      entity.attributes.device_class === 'battery' &&
      !entry?.disabled_by &&
      !entry?.hidden_by &&
      Number.isFinite(Number(entity.state)) &&
      Number(entity.state) >= 0 &&
      Number(entity.state) <= 100
    );
  });
  const batteryChargingEntities = snapshot.states.filter((entity) => {
    const entry = registry.get(entity.entity_id);
    return (
      entity.attributes.device_class === 'battery_charging' &&
      !entry?.disabled_by &&
      !entry?.hidden_by &&
      batteryChargingValue(entity) !== undefined
    );
  });
  const accessoryBatteryEntities = new Map<string, HassEntity[]>();
  const accessoryBatteryChargingEntities = new Map<string, HassEntity[]>();
  const accessoryByDevice = new Map<string, HausAccessory>();
  for (const accessory of accessories) {
    if (!accessory.deviceId) continue;
    const current = accessoryByDevice.get(accessory.deviceId);
    const currentDomain = current?.primaryEntityId.split('.')[0];
    const nextDomain = accessory.primaryEntityId.split('.')[0];
    if (
      !current ||
      (['switch', 'input_boolean'].includes(currentDomain ?? '') &&
        !['switch', 'input_boolean'].includes(nextDomain))
    )
      accessoryByDevice.set(accessory.deviceId, accessory);
  }
  const associateBatteryEntity = (battery: HassEntity) => {
    const entry = registry.get(battery.entity_id);
    let deviceId = entry?.device_id ?? undefined;
    const visited = new Set<string>();
    let owner: HausAccessory | undefined;
    while (deviceId && !visited.has(deviceId)) {
      visited.add(deviceId);
      owner = accessoryByDevice.get(deviceId);
      if (owner) break;
      deviceId = devices.get(deviceId)?.parent_device_id ?? undefined;
    }
    if (!owner) {
      const batteryDevice = entry?.device_id ? devices.get(entry.device_id) : undefined;
      const label = String(
        batteryDevice?.name_by_user || batteryDevice?.name || friendlyName(battery),
      );
      const batteryArea = effectiveArea(entry, devices);
      const scored = accessories
        .filter((item) => !batteryArea || !item.areaId || item.areaId === batteryArea)
        .map((item) => {
          const ownerDevice = item.deviceId ? devices.get(item.deviceId) : undefined;
          const names = [
            item.name,
            item.state.attributes.friendly_name,
            ownerDevice?.name,
            ownerDevice?.name_by_user,
          ].filter((name): name is string => typeof name === 'string');
          return { item, score: batteryNameScore(label, names) };
        })
        .sort((a, b) => b.score - a.score);
      if (scored[0]?.score >= 0.75 && scored[0].score > (scored[1]?.score ?? 0))
        owner = scored[0].item;
    }
    if (!owner) return;
    const destination =
      battery.attributes.device_class === 'battery_charging'
        ? accessoryBatteryChargingEntities
        : accessoryBatteryEntities;
    destination.set(owner.id, [...(destination.get(owner.id) ?? []), battery]);
  };
  for (const battery of [...batteryEntities, ...batteryChargingEntities])
    associateBatteryEntity(battery);
  for (let index = 0; index < accessories.length; index += 1) {
    const accessory = accessories[index];
    const batteryReadings = accessoryBatteryEntities.get(accessory.id) ?? [];
    const batteryChargingReadings = accessoryBatteryChargingEntities.get(accessory.id) ?? [];
    const levels = batteryReadings.map((item) => Number(item.state)).filter(Number.isFinite);
    const attributeCharging = [accessory.state, ...batteryReadings]
      .map((item) => item.attributes.is_charging)
      .find((value): value is boolean => typeof value === 'boolean');
    if (
      batteryReadings.length ||
      batteryChargingReadings.length ||
      attributeCharging !== undefined
    ) {
      const charging =
        batteryChargingReadings.map(batteryChargingValue).find((value) => value !== undefined) ??
        attributeCharging;
      const relatedBatteryEntities = [...batteryReadings, ...batteryChargingReadings];
      accessories[index] = {
        ...accessory,
        entityIds: [
          ...new Set([
            ...accessory.entityIds,
            ...relatedBatteryEntities.map((item) => item.entity_id),
          ]),
        ],
        secondaryEntities: [
          ...accessory.secondaryEntities,
          ...relatedBatteryEntities.filter(
            (battery) =>
              !accessory.secondaryEntities.some((item) => item.entity_id === battery.entity_id),
          ),
        ],
        ...(levels.length ? { batteryLevel: Math.min(...levels) } : {}),
        ...(charging !== undefined ? { batteryCharging: charging } : {}),
      };
    }
  }

  const attention: HausModel['attention'] = [];
  for (const entity of snapshot.states) {
    const entry = registry.get(entity.entity_id);
    if (entry?.disabled_by || entry?.hidden_by) continue;
    const name = entry?.name || friendlyName(entity);
    const deviceClass = entity.attributes.device_class;
    if (
      deviceClass === 'battery' &&
      Number.isFinite(Number(entity.state)) &&
      Number(entity.state) <= 20
    ) {
      attention.push({
        id: `${entity.entity_id}:battery`,
        title: `${name} is low`,
        description: `${entity.state}% battery remaining`,
        entityId: entity.entity_id,
        severity: 'warning',
      });
    }
    if (
      entityDomain(entity) === 'binary_sensor' &&
      entity.state === 'on' &&
      ['moisture', 'smoke', 'gas', 'carbon_monoxide'].includes(deviceClass)
    ) {
      attention.push({
        id: `${entity.entity_id}:safety`,
        title: `${name} detected`,
        description: 'Check this sensor in your home.',
        entityId: entity.entity_id,
        severity: 'critical',
      });
    }
    if (entity.state === 'unavailable' && !isSecondary(entry)) {
      if (isSoftwareMediaEndpoint(entity, entry)) continue;
      const owner = accessories.find((accessory) => accessory.entityIds.includes(entity.entity_id));
      if (
        owner &&
        (owner.primaryEntityId !== entity.entity_id || owner.availability !== 'unavailable')
      )
        continue;
      const dev = entry?.device_id ? devices.get(entry.device_id) : undefined;
      if (owner && isScaleReading(entity, dev) && knownScaleReading(owner.secondaryEntities, dev))
        continue;
      if (isStatefulScene(entity, entry, dev)) continue;
      attention.push({
        id: `${entity.entity_id}:unavailable`,
        title: `${name} is offline`,
        description: 'Home Assistant cannot reach this accessory.',
        entityId: entity.entity_id,
        severity: 'warning',
      });
    }
  }
  const rooms = snapshot.areas
    .filter((area) => !isServiceRoom(area.name))
    .map((area) => ({
      id: area.area_id,
      name: area.name,
      accessories: accessories.filter((accessory) => accessory.areaId === area.area_id),
    }));
  const knownAreas = new Set(snapshot.areas.map((area) => area.area_id));
  const unassigned = accessories.filter(
    (accessory) => !accessory.areaId || !knownAreas.has(accessory.areaId),
  );
  if (unassigned.length)
    rooms.push({ id: 'unassigned', name: 'Unassigned', accessories: unassigned });
  const scenes = visible.filter((state) => entityDomain(state) === 'scene');
  const stateIds = new Set(snapshot.states.map((state) => state.entity_id));
  const scenePlacements = scenes.map((scene) => {
    const configured = scene.attributes.entity_id;
    const sceneConfig = snapshot.sceneConfigs?.[scene.entity_id];
    const nested = sceneConfig?.entities ?? scene.attributes.entities;
    const targetIds = [
      ...(Array.isArray(configured)
        ? configured.filter((id): id is string => typeof id === 'string')
        : typeof configured === 'string'
          ? [configured]
          : []),
      ...(nested && typeof nested === 'object' && !Array.isArray(nested)
        ? Object.keys(nested)
        : []),
    ];
    const areaScores = new Map<string, number>();
    for (const targetId of new Set(targetIds)) {
      if (!stateIds.has(targetId)) continue;
      const areaId = effectiveArea(registry.get(targetId), devices);
      if (areaId && knownAreas.has(areaId))
        areaScores.set(areaId, (areaScores.get(areaId) ?? 0) + 1);
    }
    const rankedAreas = [...areaScores.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );
    const targetCount = [...new Set(targetIds)].filter((id) => stateIds.has(id)).length;
    const [bestArea, bestCount] = rankedAreas[0] ?? [];
    const concentration = targetCount ? (bestCount ?? 0) / targetCount : 0;
    const directArea = effectiveArea(registry.get(scene.entity_id), devices);
    const spansHome =
      rankedAreas.length >= 3 ||
      (rankedAreas.length >= 2 && targetCount >= 6 && concentration < 0.85);
    const inferredRoom =
      !spansHome && concentration >= 0.7 && (rankedAreas.length === 1 || (bestCount ?? 0) >= 2);
    const settingMatch = sceneSettingMatch(scene, snapshot, sceneConfig);
    const monitors = snapshot.states.filter(
      (state) =>
        state.attributes.scene_entity_id === scene.entity_id &&
        isStatefulScene(state, registry.get(state.entity_id)),
    );
    const activeMatch = {
      ...settingMatch,
      active: monitors.length
        ? monitors.some((state) => state.state === 'on')
        : settingMatch?.matchScore === 1 && settingMatch?.matchCoverage === 1,
    };
    if (targetCount && inferredRoom && bestArea) {
      return {
        sceneId: scene.entity_id,
        areaId: bestArea,
        scope: 'room' as const,
        confidence: Math.min(0.99, 0.65 + concentration * 0.34),
        targetCount,
        ...activeMatch,
      };
    }
    if (targetCount && rankedAreas.length > 1) {
      return {
        sceneId: scene.entity_id,
        scope: 'home' as const,
        confidence: Math.min(0.98, 0.58 + (1 - concentration) * 0.4),
        targetCount,
        ...activeMatch,
      };
    }
    if (directArea && knownAreas.has(directArea))
      return {
        sceneId: scene.entity_id,
        areaId: directArea,
        scope: 'room' as const,
        confidence: 0.72,
        targetCount: 0,
        ...activeMatch,
      };
    return {
      sceneId: scene.entity_id,
      scope: 'home' as const,
      confidence: 0.5,
      targetCount,
      ...activeMatch,
    };
  });
  return {
    accessories,
    rooms,
    scenes,
    scenePlacements,
    cameras: visible
      .filter(
        (state) =>
          entityDomain(state) === 'camera' && relationships.canonicalCameraIds.has(state.entity_id),
      )
      .map(cameraState),
    attention,
  };
}

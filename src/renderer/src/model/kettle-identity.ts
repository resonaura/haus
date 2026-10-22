import type { Device, EntityRegistryEntry, Snapshot } from './types';

/** Match the bridge to an existing physical kettle by its Xiaomi DID, never its name. */
export function attachKettleRegistry(
  snapshot: Snapshot,
  registry: Map<string, EntityRegistryEntry>,
) {
  const devices = new Map(snapshot.devices.map((device) => [device.id, device]));
  const sources = new Map<string, Set<string>>();
  for (const state of snapshot.states) {
    const entry = registry.get(state.entity_id);
    const device = devices.get(entry?.device_id ?? '');
    if (
      entry?.platform !== 'xiaomi_miot' ||
      device?.model !== 'xiaomi.kettle.v21' ||
      device.disabled_by ||
      typeof state.attributes.app_link !== 'string'
    )
      continue;
    try {
      const url = new URL(state.attributes.app_link);
      const did = url.protocol === 'mihome:' ? url.searchParams.get('did') : null;
      if (!did || !/^\d{1,10}$/.test(did)) continue;
      const ids = sources.get(did) ?? new Set<string>();
      ids.add(device.id);
      sources.set(did, ids);
    } catch {
      /* Unsupported links remain independent. */
    }
  }
  const bridges = new Map<string, Device[]>();
  for (const device of snapshot.devices) {
    if (
      device.model !== 'xiaomi.kettle.v21' ||
      device.disabled_by ||
      !Array.isArray(device.identifiers)
    )
      continue;
    for (const id of device.identifiers) {
      if (!Array.isArray(id) || id[0] !== 'mqtt' || typeof id[1] !== 'string') continue;
      const did = /^haus_kettle_(\d{1,10})$/.exec(id[1])?.[1];
      if (did) bridges.set(did, [...(bridges.get(did) ?? []), device]);
    }
  }
  for (const [did, linked] of bridges) {
    const owners = sources.get(did);
    if (owners?.size !== 1 || linked.length !== 1) continue;
    const owner = devices.get([...owners][0])!,
      bridge = linked[0];
    const sourceEntries = snapshot.entities.filter((entry) => entry.device_id === owner.id);
    const sourceHeater = sourceEntries.find((entry) => entry.entity_id.startsWith('water_heater.'));
    const area = sourceHeater?.area_id || owner.area_id;
    const attached = snapshot.entities.filter((entry) => entry.device_id === bridge.id);
    if (
      (bridge.area_id && bridge.area_id !== area) ||
      attached.some((entry) => entry.area_id && entry.area_id !== area)
    )
      continue;
    if (
      !attached.some(
        (entry) => entry.platform === 'mqtt' && entry.entity_id.startsWith('water_heater.'),
      )
    )
      continue;
    for (const entry of attached)
      registry.set(entry.entity_id, {
        ...entry,
        device_id: owner.id,
        area_id: entry.area_id || sourceHeater?.area_id,
      });
    for (const entry of sourceEntries) {
      const domain = entry.entity_id.split('.')[0];
      // The old Xiaomi integration may expose the same kettle as a climate entity.
      // Keep it attached for history/details, but let the richer MQTT water_heater
      // be the single user-facing control surface.
      if (domain === 'climate' || domain === 'water_heater')
        registry.set(entry.entity_id, { ...entry, entity_category: 'diagnostic' });
    }
  }
}

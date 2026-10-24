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
    if (linked.length !== 1 || (owners && owners.size !== 1)) continue;
    const bridge = linked[0];
    let owner = owners?.size === 1 ? devices.get([...owners][0]) : undefined;
    // A user may rename the stale Xiaomi entity to `water_heater.disabled_<slug>`
    // after switching the physical kettle to the local MQTT bridge. In that
    // case the old Xiaomi integration no longer exposes its app_link/DID. Join
    // only the exact canonical entity pair, and only while the old entity is
    // unavailable and explicitly marked Disabled; names alone never establish
    // the physical identity.
    if (!owner && !owners) {
      const bridgeHeater = snapshot.entities.find(
        (entry) =>
          entry.device_id === bridge.id &&
          entry.platform === 'mqtt' &&
          entry.entity_id.startsWith('water_heater.'),
      );
      const suffix =
        bridgeHeater && /^water_heater\.([a-z0-9_]+)$/.exec(bridgeHeater.entity_id)?.[1];
      const sourceHeater = suffix ? registry.get(`water_heater.disabled_${suffix}`) : undefined;
      const sourceDevice = devices.get(sourceHeater?.device_id ?? '');
      const sourceState = sourceHeater
        ? snapshot.states.find((state) => state.entity_id === sourceHeater.entity_id)
        : undefined;
      const disabledLabel = [
        sourceHeater?.name,
        sourceHeater?.original_name,
        sourceState?.attributes.friendly_name,
        sourceDevice?.name_by_user,
        sourceDevice?.name,
      ].some((value) => typeof value === 'string' && /^disabled\s*:/i.test(value.trim()));
      if (
        sourceHeater?.platform === 'xiaomi_miot' &&
        sourceDevice?.model === 'xiaomi.kettle.v21' &&
        sourceState?.state === 'unavailable' &&
        disabledLabel
      )
        owner = sourceDevice;
    }
    if (!owner) continue;
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
    for (const entry of attached) {
      const domain = entry.entity_id.split('.')[0];
      registry.set(entry.entity_id, {
        ...entry,
        device_id: owner.id,
        area_id: entry.area_id || sourceHeater?.area_id,
        // The bridge can also expose a stale climate projection. Keep it in
        // details, but leave the live water_heater as the only control card.
        ...(domain === 'climate' ? { entity_category: 'diagnostic' as const } : {}),
      });
    }
    const bridgeHeater = attached.find(
      (entry) => entry.platform === 'mqtt' && entry.entity_id.startsWith('water_heater.'),
    );
    const heaterSuffix = bridgeHeater?.entity_id.slice('water_heater.'.length);
    const climateId = heaterSuffix ? `climate.${heaterSuffix}` : undefined;
    const climateEntry = climateId ? registry.get(climateId) : undefined;
    const climateState = climateId
      ? snapshot.states.find((state) => state.entity_id === climateId)
      : undefined;
    if (
      climateId &&
      climateState &&
      (!climateEntry?.device_id ||
        climateEntry.device_id === bridge.id ||
        climateEntry.device_id === owner.id) &&
      (!climateEntry?.area_id || !area || climateEntry.area_id === area)
    ) {
      // Some HA versions expose the parallel climate projection without a
      // device-registry assignment. The exact matching entity slug plus the
      // validated kettle bridge is enough to keep it under the kettle and out
      // of the Home tiles; all actions still target the water_heater entity.
      registry.set(climateId, {
        ...climateEntry,
        entity_id: climateId,
        device_id: owner.id,
        area_id: climateEntry?.area_id || sourceHeater?.area_id,
        entity_category: 'diagnostic',
      });
    }
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

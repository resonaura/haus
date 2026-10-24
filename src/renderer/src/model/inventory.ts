import type { Category, EntityRegistryEntry, HausAccessory, Snapshot } from './types';
import { deviceArea } from './registry';
import { deviceTelemetryRegistry } from './device-telemetry';

export interface InventoryDevice {
  id: string;
  name: string;
  manufacturer: string;
  model: string;
  areaId?: string;
  category: Category;
  status: 'available' | 'unavailable' | 'unknown' | 'no_entities' | 'disabled';
  entityCount: number;
  activeEntityCount: number;
  integrationIds: string[];
  accessory?: HausAccessory;
}

/** The registry is the inventory. State entities are optional, not an admission requirement. */
export function buildInventory(
  snapshot: Snapshot,
  accessories: HausAccessory[],
): InventoryDevice[] {
  const entriesByDevice = new Map<string, EntityRegistryEntry[]>();
  const telemetryRegistry = deviceTelemetryRegistry(snapshot);
  const aliases = new Map<string, string>();
  const ambiguousAliases = new Set<string>();
  for (const original of snapshot.entities) {
    if (!original.device_id) continue;
    const effective = telemetryRegistry.get(original.entity_id);
    if (!effective?.device_id || effective.device_id === original.device_id) continue;
    const previous = aliases.get(original.device_id);
    if (previous && previous !== effective.device_id) ambiguousAliases.add(original.device_id);
    else aliases.set(original.device_id, effective.device_id);
  }
  for (const id of ambiguousAliases) aliases.delete(id);

  for (const entry of telemetryRegistry.values()) {
    if (!entry.device_id) continue;
    const entries = entriesByDevice.get(entry.device_id) ?? [];
    entries.push(entry);
    entriesByDevice.set(entry.device_id, entries);
  }
  const statesById = new Map(snapshot.states.map((state) => [state.entity_id, state]));
  const accessoryByDevice = new Map<string, HausAccessory>();
  for (const accessory of accessories)
    if (accessory.deviceId && !accessoryByDevice.has(accessory.deviceId))
      accessoryByDevice.set(accessory.deviceId, accessory);
  return snapshot.devices
    .filter((device) => {
      if (aliases.has(device.id)) return false;
      // The Companion/App integration sometimes registers a software-only
      // device (for example the Haus Kettle service). It is useful to HA but
      // is not a separate piece of household hardware to organize here.
      const accessory = accessoryByDevice.get(device.id);
      const softwareOnly = device.model?.trim().toLocaleLowerCase() === 'home assistant app';
      return !softwareOnly || Boolean(accessory && !accessory.isService);
    })
    .map<InventoryDevice>((device) => {
      const entries = entriesByDevice.get(device.id) ?? [];
      const enabledEntries = entries.filter((entry) => !entry.disabled_by);
      const states = enabledEntries.flatMap((entry) => {
        const state = statesById.get(entry.entity_id);
        return state ? [state] : [];
      });
      const accessory = accessoryByDevice.get(device.id);
      const context = `${device.manufacturer ?? ''} ${device.model ?? ''} ${device.name ?? ''}`;
      const category =
        accessory?.category ??
        (entries.some((e) => e.platform === 'ipp') ||
        /printer|epson|brother|laserjet|bambu/i.test(context)
          ? 'printers'
          : /eero|router|unifi|mikrotik|netgear/i.test(context)
            ? 'network'
            : 'other');
      const integrationIds = [
        ...new Set(
          [
            device.id,
            ...[...aliases].filter(([, owner]) => owner === device.id).map(([alias]) => alias),
          ].flatMap((id) => {
            const associated = snapshot.devices.find((item) => item.id === id);
            return Array.isArray(associated?.config_entries)
              ? associated.config_entries.filter(
                  (entry): entry is string => typeof entry === 'string',
                )
              : [];
          }),
        ),
      ];
      return {
        id: device.id,
        name: device.name_by_user || device.name || device.model || 'Unnamed device',
        manufacturer: device.manufacturer ?? '',
        model: device.model ?? '',
        areaId: accessory?.areaId ?? deviceArea(device, snapshot.devices) ?? undefined,
        category,
        status:
          device.disabled_by || (entries.length > 0 && enabledEntries.length === 0)
            ? 'disabled'
            : !states.length
              ? 'no_entities'
              : states.every((state) => state.state === 'unavailable')
                ? 'unavailable'
                : states.every((state) => ['unknown', 'unavailable'].includes(state.state))
                  ? 'unknown'
                  : 'available',
        entityCount: entries.length,
        activeEntityCount: states.length,
        integrationIds,
        accessory,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export const inventoryStatus = {
  available: 'Reporting',
  unavailable: 'Unavailable',
  unknown: 'Unknown',
  no_entities: 'No live entities',
  disabled: 'Disabled',
};

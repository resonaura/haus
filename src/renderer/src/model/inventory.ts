import type { Category, EntityRegistryEntry, HausAccessory, Snapshot } from './types';
import { deviceArea } from './registry';

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
  for (const entry of snapshot.entities) {
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
      const integrationIds = Array.isArray(device.config_entries)
        ? device.config_entries.filter((id): id is string => typeof id === 'string')
        : [];
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

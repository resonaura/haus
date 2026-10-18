import type { Category, HausAccessory, Snapshot } from './types';

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
  return snapshot.devices
    .map<InventoryDevice>((device) => {
      const entries = snapshot.entities.filter((entry) => entry.device_id === device.id);
      const ids = new Set(entries.map((entry) => entry.entity_id));
      const enabledEntries = entries.filter((entry) => !entry.disabled_by);
      const states = snapshot.states.filter(
        (state) =>
          ids.has(state.entity_id) &&
          !entries.find((entry) => entry.entity_id === state.entity_id)?.disabled_by,
      );
      const accessory = accessories.find((item) => item.deviceId === device.id);
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
        areaId: accessory?.areaId ?? device.area_id ?? undefined,
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

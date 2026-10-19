import type { Area, Device, Snapshot } from './types';
import { deviceDisplayName } from './device-name';

export function roomNameInput(value: string, areas: Area[], currentId?: string) {
  const name = value.replace(/\s+/g, ' ').trim();
  if (!name || name.length > 120) throw new Error('Use a room name between 1 and 120 characters.');
  if (
    areas.some(
      (area) =>
        area.area_id !== currentId &&
        area.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase(),
    )
  )
    throw new Error('A room with this name already exists.');
  return name;
}

export function deviceArea(device: Device, devices: Device[]): string | null {
  const visited = new Set<string>();
  let current: Device | undefined = device;
  while (current && !visited.has(current.id)) {
    if (current.area_id) return current.area_id;
    visited.add(current.id);
    current = devices.find((item) => item.id === current?.parent_device_id);
  }
  return null;
}

export interface DeviceMove {
  deviceId: string;
  name: string;
  fromAreaId: string | null;
  fromEffectiveAreaId: string | null;
  toAreaId: string | null;
  overrides: { entityId: string; fromAreaId: string }[];
}

/** A physical-device move is explicit about any entity-specific room assignments it clears. */
export function planDeviceMoves(
  snapshot: Snapshot,
  deviceIds: string[],
  toAreaId: string | null,
  moveOverrides: boolean,
): DeviceMove[] {
  if (toAreaId && !snapshot.areas.some((area) => area.area_id === toAreaId))
    throw new Error('This room no longer exists.');
  return [...new Set(deviceIds)].flatMap((id) => {
    const device = snapshot.devices.find((item) => item.id === id);
    if (!device) throw new Error('A selected device no longer exists. Review the selection.');
    const overrides = moveOverrides
      ? snapshot.entities
          .filter((entry) => entry.device_id === id && entry.area_id)
          .map((entry) => ({ entityId: entry.entity_id, fromAreaId: entry.area_id! }))
      : [];
    if ((device.area_id ?? null) === toAreaId && !overrides.length) return [];
    return [
      {
        deviceId: id,
        name: deviceDisplayName(
          device.name_by_user || device.name || device.model || 'Device',
          snapshot.areas.find((area) => area.area_id === deviceArea(device, snapshot.devices))
            ?.name,
        ),
        fromAreaId: device.area_id ?? null,
        fromEffectiveAreaId: deviceArea(device, snapshot.devices),
        toAreaId,
        overrides,
      },
    ];
  });
}

export function removeRoom(snapshot: Snapshot, areaId: string): Snapshot {
  return {
    ...snapshot,
    areas: snapshot.areas.filter((area) => area.area_id !== areaId),
    devices: snapshot.devices.map((device) =>
      device.area_id === areaId ? { ...device, area_id: null } : device,
    ),
    entities: snapshot.entities.map((entry) =>
      entry.area_id === areaId ? { ...entry, area_id: null } : entry,
    ),
  };
}

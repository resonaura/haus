/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export type InventoryDeviceStatus =
  | 'available'
  | 'unavailable'
  | 'unknown'
  | 'no_entities'
  | 'disabled';

export type InventoryFilterId = 'all' | 'network' | 'printers' | 'unavailable' | 'no_entities';

export interface InventoryDeviceSummary {
  readonly id: string;
  readonly hausId: string;
  readonly name: string;
  readonly manufacturer: string;
  readonly model: string;
  readonly areaId?: string;
  readonly category: string;
  readonly status: InventoryDeviceStatus;
  readonly entityCount: number;
  readonly activeEntityCount: number;
}

export const INVENTORY_STATUS_LABELS: Readonly<Record<InventoryDeviceStatus, string>> = {
  available: 'Reporting',
  unavailable: 'Unavailable',
  unknown: 'Unknown',
  no_entities: 'No live entities',
  disabled: 'Disabled',
};

export const INVENTORY_FILTERS: readonly {
  readonly id: InventoryFilterId;
  readonly label: string;
}[] = [
  { id: 'all', label: 'All devices' },
  { id: 'network', label: 'Network' },
  { id: 'printers', label: 'Printers' },
  { id: 'unavailable', label: 'Unavailable' },
  { id: 'no_entities', label: 'No live entities' },
];

export function classifyInventoryStatus({
  disabled,
  totalEntities,
  enabledEntities,
  entityStates,
}: {
  readonly disabled: boolean;
  readonly totalEntities: number;
  readonly enabledEntities: number;
  readonly entityStates: readonly string[];
}): InventoryDeviceStatus {
  if (disabled || (totalEntities > 0 && enabledEntities === 0)) return 'disabled';
  if (!entityStates.length) return 'no_entities';
  if (entityStates.every((state) => state === 'unavailable')) return 'unavailable';
  if (entityStates.every((state) => state === 'unknown' || state === 'unavailable')) return 'unknown';
  return 'available';
}

export function scopeInventoryDevices<T extends InventoryDeviceSummary>(
  items: readonly T[],
  {
    area,
    query,
  }: {
    readonly area: string;
    readonly query: string;
  },
): T[] {
  const needle = query.trim().toLowerCase();
  return items.filter((device) => {
    const areaMatch = area === 'all' || (device.areaId ?? 'unassigned') === area;
    if (!areaMatch) return false;
    if (!needle) return true;
    const hay = `${device.name} ${device.manufacturer} ${device.model} ${device.hausId} ${device.id}`.toLowerCase();
    return hay.includes(needle);
  });
}

export function matchesInventoryFilter(
  item: InventoryDeviceSummary,
  filter: InventoryFilterId,
): boolean {
  if (filter === 'all') return true;
  if (filter === 'network' || filter === 'printers') return item.category === filter;
  return item.status === filter;
}

export function filterInventoryDevices<T extends InventoryDeviceSummary>(
  scoped: readonly T[],
  filter: InventoryFilterId,
): T[] {
  return scoped.filter((item) => matchesInventoryFilter(item, filter));
}

export function countInventoryByFilter(
  scoped: readonly InventoryDeviceSummary[],
): Record<InventoryFilterId, number> {
  const counts: Record<InventoryFilterId, number> = {
    all: scoped.length,
    network: 0,
    printers: 0,
    unavailable: 0,
    no_entities: 0,
  };
  for (const item of scoped) {
    if (item.category === 'network') counts.network++;
    else if (item.category === 'printers') counts.printers++;
    if (item.status === 'unavailable') counts.unavailable++;
    else if (item.status === 'no_entities') counts.no_entities++;
  }
  return counts;
}

export interface InventoryDeviceInput {
  readonly id: string;
  readonly name?: string | null;
  readonly name_by_user?: string | null;
  readonly manufacturer?: string | null;
  readonly model?: string | null;
  readonly area_id?: string | null;
  readonly disabled_by?: string | null;
}

export interface InventoryEntityInput {
  readonly entity_id: string;
  readonly device_id?: string | null;
  readonly disabled_by?: string | null;
  readonly platform?: string | null;
}

export interface InventoryStateInput {
  readonly entity_id: string;
  readonly state: string;
}

export interface InventoryAccessoryInput {
  readonly deviceId?: string;
  readonly areaId?: string;
  readonly hausId?: string;
  readonly category: string;
  readonly isService?: boolean;
}

export interface InventoryRecord<
  TAccessory extends InventoryAccessoryInput = InventoryAccessoryInput,
> extends InventoryDeviceSummary {
  readonly accessory?: TAccessory;
}

export interface BuildInventoryOptions<
  TDevice extends InventoryDeviceInput,
  TEntity extends InventoryEntityInput,
  TAccessory extends InventoryAccessoryInput,
> {
  readonly devices: readonly TDevice[];
  readonly entities: readonly TEntity[];
  readonly states: readonly InventoryStateInput[];
  readonly accessories: readonly TAccessory[];
  readonly effectiveEntities?: Iterable<TEntity>;
  readonly resolveEffectiveEntity?: (entityId: string) => TEntity | undefined;
  readonly resolveAreaId?: (device: TDevice, devices: readonly TDevice[]) => string | null | undefined;
  readonly resolveHausId?: (args: {
    readonly device: TDevice;
    readonly category: string;
    readonly areaId?: string;
    readonly used: Set<string>;
  }) => string;
}

export function isSoftwareOnlyAppDevice(
  model?: string | null,
  accessory?: Pick<InventoryAccessoryInput, 'isService'>,
): boolean {
  const softwareOnly = model?.trim().toLowerCase() === 'home assistant app';
  return softwareOnly && !(accessory && !accessory.isService);
}

export function inferInventoryCategory(
  platforms: readonly (string | null | undefined)[],
  context: string,
  accessoryCategory?: string,
): string {
  if (accessoryCategory) return accessoryCategory;
  if (
    platforms.some((platform) => platform === 'ipp') ||
    /printer|epson|brother|laserjet|bambu/i.test(context)
  ) {
    return 'printers';
  }
  if (/eero|router|unifi|mikrotik|netgear/i.test(context)) {
    return 'network';
  }
  return 'other';
}

export function buildInventoryRecords<
  TDevice extends InventoryDeviceInput,
  TEntity extends InventoryEntityInput,
  TAccessory extends InventoryAccessoryInput,
>({
  devices,
  entities,
  states,
  accessories,
  effectiveEntities = entities,
  resolveEffectiveEntity,
  resolveAreaId,
  resolveHausId,
}: BuildInventoryOptions<TDevice, TEntity, TAccessory>): InventoryRecord<TAccessory>[] {
  const aliases = new Map<string, string>();
  const ambiguousAliases = new Set<string>();
  if (resolveEffectiveEntity) {
    for (const original of entities) {
      if (!original.device_id) continue;
      const effective = resolveEffectiveEntity(original.entity_id);
      if (!effective?.device_id || effective.device_id === original.device_id) continue;
      const previous = aliases.get(original.device_id);
      if (previous && previous !== effective.device_id) ambiguousAliases.add(original.device_id);
      else aliases.set(original.device_id, effective.device_id);
    }
    for (const id of ambiguousAliases) aliases.delete(id);
  }

  const entriesByDevice = new Map<string, TEntity[]>();
  for (const entry of effectiveEntities) {
    if (!entry.device_id) continue;
    const list = entriesByDevice.get(entry.device_id) ?? [];
    list.push(entry);
    entriesByDevice.set(entry.device_id, list);
  }

  const statesById = new Map(states.map((state) => [state.entity_id, state]));
  const accessoryByDevice = new Map<string, TAccessory>();
  const usedHausIds = new Set<string>();
  for (const accessory of accessories) {
    if (accessory.hausId) usedHausIds.add(accessory.hausId);
    if (accessory.deviceId && !accessoryByDevice.has(accessory.deviceId)) {
      accessoryByDevice.set(accessory.deviceId, accessory);
    }
  }

  return devices
    .filter((device) => {
      if (aliases.has(device.id)) return false;
      return !isSoftwareOnlyAppDevice(device.model, accessoryByDevice.get(device.id));
    })
    .map<InventoryRecord<TAccessory>>((device) => {
      const entries = entriesByDevice.get(device.id) ?? [];
      const enabledEntries = entries.filter((entry) => !entry.disabled_by);
      const entityStates = enabledEntries.flatMap((entry) => {
        const state = statesById.get(entry.entity_id)?.state;
        return state === undefined ? [] : [state];
      });
      const accessory = accessoryByDevice.get(device.id);
      const context = `${device.manufacturer ?? ''} ${device.model ?? ''} ${device.name ?? ''}`;
      const category = inferInventoryCategory(
        entries.map((entry) => entry.platform),
        context,
        accessory?.category,
      );
      const areaId =
        accessory?.areaId ??
        resolveAreaId?.(device, devices) ??
        device.area_id ??
        undefined;
      const hausId =
        accessory?.hausId ??
        resolveHausId?.({ device, category, areaId, used: usedHausIds }) ??
        `haus://${category}/${device.id}`;
      return {
        id: device.id,
        hausId,
        name: device.name_by_user || device.name || device.model || 'Unnamed device',
        manufacturer: device.manufacturer ?? '',
        model: device.model ?? '',
        areaId,
        category,
        status: classifyInventoryStatus({
          disabled: Boolean(device.disabled_by),
          totalEntities: entries.length,
          enabledEntities: enabledEntries.length,
          entityStates,
        }),
        entityCount: entries.length,
        activeEntityCount: entityStates.length,
        accessory,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

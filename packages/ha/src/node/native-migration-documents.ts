/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type {
  BridgeCamera,
  BridgeCommand,
  BridgeEntity,
  BridgeInventory,
} from '@haus/bridge/protocol';
import {
  preferences,
  sameEntity,
  stable,
  type MigrationPlan,
  type Preferences,
  type ReferenceDocument,
  type RegistryDevice,
  type RegistryEntity,
  type RegistrySnapshot,
} from '@haus/bridge/migration';

export interface NativeSourceRow {
  bridgeId: string;
  physicalId: string;
  value: {
    cameraId: string;
    name: string;
    deviceId?: string | null;
    deviceIds?: string[];
    physical: BridgeCamera;
  };
}

export interface NativeSourcesLike {
  rows(): NativeSourceRow[];
  migrationIdentity?(
    bridgeId: string,
    physicalId: string,
    registry: unknown,
  ): { id: string; unique_id: string; platform: string; config_entry_id: string } | undefined;
}

export interface NativeProvidersLike {
  releaseNative(id: string): Promise<unknown>;
  inventory(id: string): BridgeInventory & { reachable: boolean; revision: string };
  list(): Array<{ id: string; provider: string }>;
  confirm(id: string, revision: string, keys: string[]): Promise<unknown>;
  command(
    bridgeId: string,
    physicalId: string,
    entityId: string,
    command: BridgeCommand | unknown,
    requestId: string,
  ): Promise<unknown>;
  refresh(bridgeId: string): Promise<unknown>;
}

export interface NativeCatalogLike {
  ownedCameras(clientId: string): string[];
  requestRelease(bridgeId: string, at: number): Promise<unknown> | unknown;
  pendingReleases(): string[];
  releasing(bridgeId: string): boolean;
  completeRelease(bridgeId: string, cameraIds: string[]): Promise<unknown> | unknown;
  acknowledge(
    clientId: string,
    cameras: Array<{ cameraId: string; revision: string }>,
    disabledReadiness: boolean,
    at: number,
  ): Promise<unknown> | unknown;
  hasNativeClient(): boolean;
  ownsActivity(cameraId: string): boolean;
  readyClient(
    cameraId: string,
    revision: string | null,
    since: number,
  ): { clientId: string } | undefined;
  supportsDisabledReadiness(clientId: string, since: number): boolean;
  handover(
    bridgeId: string,
    owners: Array<{ cameraId: string; clientId: string }>,
    at: number,
  ): Promise<unknown> | unknown;
}

export interface NativeActivityLike {
  status(cameraId: string):
    | { active: boolean; available: boolean; lastDetectedAt?: number | null; replaces?: string[] }
    | undefined;
}

export interface NativeRegistryCamera {
  id: string;
  name: string;
  deviceId?: string | null;
  available: boolean;
  nativeProvider?: { bridgeId?: string };
  kitsuneProvider?: {
    pluginId: string;
    deviceId: string;
  };
}

export interface NativeEntityDescription extends Omit<BridgeEntity, 'role'> {
  role?: BridgeEntity['role'] | 'motion';
  nativeSources?: string[];
}

export interface NativeDeviceDescription {
  cameraId: string;
  name: string;
  deviceId: string | null;
  bridgeId: string;
  physicalId: string;
  manufacturer: string;
  model: string;
  available: boolean;
  entities: NativeEntityDescription[];
}

export interface MigrationHaPort {
  request(message: Record<string, unknown>): Promise<unknown>;
  migrationScene(id: string): Promise<unknown>;
  registry(): Promise<{
    states: Array<{ entity_id: string; attributes?: { id?: unknown } }>;
    entities: RegistryEntity[];
    devices: RegistryDevice[];
    areas: unknown[];
  }>;
}

/** Read configurations only to protect references. Never return/store their contents in a journal/UI. */
export async function nativeMigrationDocuments(
  ha: MigrationHaPort,
  registry: {
    states: Array<{ entity_id: string; attributes?: { id?: unknown } }>;
    entities: Array<{ entity_id: string; platform?: string }>;
  },
  cancelled: () => boolean = () => false,
): Promise<ReferenceDocument[]> {
  const ids = [
    ...new Set([...registry.states, ...registry.entities].map((item) => item.entity_id)),
  ];
  const tasks: Array<() => Promise<ReferenceDocument | null>> = ids
    .filter((id) => /^(automation|script)\./.test(id))
    .map((id) => async () => {
      const kind = id.split('.')[0];
      const result = (await ha.request({ type: `${kind}/config`, entity_id: id })) as
        | { config?: unknown }
        | undefined;
      return { label: id, config: result?.config ?? result };
    });
  for (const entityId of ids.filter((id) => id.startsWith('scene.'))) {
    const state = registry.states.find((item) => item.entity_id === entityId);
    if (
      registry.entities.find((entity) => entity.entity_id === entityId)?.platform !==
      'homeassistant'
    )
      continue;
    const id = state?.attributes?.id;
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id))
      throw Error('migration_reference_scan_incomplete');
    tasks.push(async () => ({ label: entityId, config: await ha.migrationScene(id) }));
  }
  const dashboards = (await ha.request({ type: 'lovelace/dashboards/list' })) as Array<{
    url_path?: string;
  }>;
  for (const url_path of new Set([undefined, ...dashboards.map((item) => item.url_path)]))
    tasks.push(async () => {
      try {
        return {
          label: url_path ? `Dashboard: ${url_path}` : 'Overview dashboard',
          config: await ha.request({ type: 'lovelace/config', ...(url_path ? { url_path } : {}) }),
        };
      } catch (error) {
        if ((error as Error)?.message === 'config_not_found') return null;
        throw error;
      }
    });
  if (tasks.length > 1024) throw Error('migration_reference_scan_too_large');
  const documents: ReferenceDocument[] = [];
  let bytes = 0;
  for (let offset = 0; offset < tasks.length; offset += 4) {
    if (cancelled()) throw Error('migration_stopping');
    for (const document of await Promise.all(
      tasks.slice(offset, offset + 4).map((task) => task()),
    )) {
      if (!document) continue;
      if (!document.config || typeof document.config !== 'object')
        throw Error('migration_reference_scan_incomplete');
      bytes += Buffer.byteLength(JSON.stringify(document.config));
      if (bytes > 16 * 1024 * 1024) throw Error('migration_reference_scan_too_large');
      documents.push(document);
    }
  }
  return documents;
}

export async function renameMigrationEntity(
  ha: MigrationHaPort,
  isClosed: () => boolean,
  expected: RegistryEntity,
  from: string,
  to: string,
  patch: Preferences,
  expectedPreferences: Preferences = preferences(expected),
): Promise<void> {
  if (isClosed()) throw Error('migration_stopping');
  const all = (await ha.request({
    type: 'config/entity_registry/get_entries',
    entity_ids: [...new Set([from, to])],
  })) as Record<string, RegistryEntity | undefined>;
  const current = all[from];
  if (!sameEntity(current, expected) || (from !== to && all[to]))
    throw Error('migration_registry_changed');
  if (stable(preferences(current!)) !== stable(expectedPreferences))
    throw Error('migration_user_edit');
  if (isClosed()) throw Error('migration_stopping');
  const changes: Preferences = { ...patch };
  if (patch.categories && typeof patch.categories === 'object')
    changes.categories = {
      ...Object.fromEntries(Object.keys(current!.categories ?? {}).map((key) => [key, null])),
      ...(patch.categories as Record<string, unknown>),
    };
  await ha.request({
    type: 'config/entity_registry/update',
    entity_id: from,
    new_entity_id: to,
    ...changes,
  });
}

export async function updateMigrationDevice(
  ha: MigrationHaPort,
  isClosed: () => boolean,
  device: { before: RegistryDevice; preferences: Preferences },
  undo: boolean,
): Promise<void> {
  if (isClosed()) throw Error('migration_stopping');
  const all = (await ha.request({ type: 'config/device_registry/list' })) as RegistryDevice[];
  const current = all.find((item) => item.id === device.before.id);
  if (!current) throw Error('migration_device_changed');
  const before = {
    name_by_user: device.before.name_by_user ?? null,
    area_id: device.before.area_id ?? null,
    labels: [...(device.before.labels ?? [])].sort(),
  };
  const facts = {
    name_by_user: current.name_by_user ?? null,
    area_id: current.area_id ?? null,
    labels: [...(current.labels ?? [])].sort(),
  };
  const source = undo ? device.preferences : before,
    target = undo ? before : device.preferences;
  if (stable(facts) === stable(target)) return;
  if (stable(facts) !== stable(source)) throw Error('migration_device_changed');
  if (isClosed()) throw Error('migration_stopping');
  await ha.request({
    type: 'config/device_registry/update',
    device_id: current.id,
    ...target,
  });
}

export async function updateMigrationEntry(
  ha: MigrationHaPort,
  isClosed: () => boolean,
  entry: { entry_id: string; disabled_by: string | null },
  undo: boolean,
): Promise<void> {
  if (isClosed()) throw Error('migration_stopping');
  const entries = (await ha.request({ type: 'config_entries/get' })) as Array<{
    entry_id: string;
    domain: string;
    disabled_by?: string | null;
  }>;
  const current = entries.find((item) => item.entry_id === entry.entry_id);
  const source = undo ? 'user' : entry.disabled_by,
    target = undo ? entry.disabled_by : 'user';
  if (!current || current.domain !== 'generic') throw Error('migration_entry_changed');
  if ((current.disabled_by ?? null) === target) return;
  if ((current.disabled_by ?? null) !== source || isClosed())
    throw Error('migration_entry_changed');
  await ha.request({
    type: 'config_entries/disable',
    entry_id: entry.entry_id,
    disabled_by: target,
  });
}

export async function verifyMigrationPlan(
  ha: MigrationHaPort,
  loadRegistry: () => Promise<
    RegistrySnapshot & { states: Array<{ entity_id: string; attributes?: { id?: unknown } }> }
  >,
  plan: MigrationPlan,
  exactPreferences = false,
): Promise<
  RegistrySnapshot & { states: Array<{ entity_id: string; attributes?: { id?: unknown } }> }
> {
  const registry = await loadRegistry();
  const ids = plan.moves.flatMap((move) => [
    move.parked,
    ...(move.native ? [move.legacy.entity_id] : []),
  ]);
  for (let offset = 0; offset < ids.length; offset += 256) {
    const entries = (await ha.request({
      type: 'config/entity_registry/get_entries',
      entity_ids: ids.slice(offset, offset + 256),
    })) as Record<string, RegistryEntity | undefined>;
    for (const move of plan.moves) {
      if (!Object.hasOwn(entries, move.parked)) continue;
      const parked = entries[move.parked];
      if (
        !sameEntity(parked, move.legacy) ||
        parked?.disabled_by !== 'user' ||
        parked?.hidden_by !== 'user'
      )
        throw Error('migration_registry_changed');
    }
    for (const move of plan.moves.filter(
      (item) => item.native && Object.hasOwn(entries, item.legacy.entity_id),
    )) {
      const current = entries[move.legacy.entity_id];
      if (
        !sameEntity(current, move.native!) ||
        (exactPreferences && stable(preferences(current!)) !== stable(move.preferences))
      )
        throw Error('migration_registry_changed');
    }
  }
  if (
    plan.entries.some(
      (entry) =>
        !registry.entries.some(
          (item) =>
            item.entry_id === entry.entry_id &&
            item.domain === 'generic' &&
            item.disabled_by === 'user',
        ),
    )
  )
    throw Error('migration_entry_changed');
  if (
    exactPreferences &&
    plan.devices.some((device) => {
      const current = registry.devices.find((item) => item.id === device.before.id);
      return (
        !current ||
        stable({
          name_by_user: current.name_by_user ?? null,
          area_id: current.area_id ?? null,
          labels: [...(current.labels ?? [])].sort(),
        }) !== stable(device.preferences)
      );
    })
  )
    throw Error('migration_device_changed');
  return registry;
}

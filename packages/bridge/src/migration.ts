/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { createHash } from 'node:crypto';

export interface RegistryEntity {
  id: string;
  entity_id: string;
  unique_id: string;
  platform: string;
  config_entry_id: string;
  device_id?: string | null;
  name?: string | null;
  original_name?: string | null;
  icon?: string | null;
  area_id?: string | null;
  hidden_by?: string | null;
  disabled_by?: string | null;
  labels?: string[];
  aliases?: (string | null)[];
  categories?: Record<string, string>;
  options?: Record<string, unknown>;
}
export interface RegistryDevice {
  id: string;
  name?: string | null;
  name_by_user?: string | null;
  area_id?: string | null;
  labels?: string[];
  identifiers?: [string, string][];
}
export interface RegistrySnapshot {
  entities: RegistryEntity[];
  devices: RegistryDevice[];
  entries: { entry_id: string; domain: string; disabled_by?: string | null }[];
}
export interface MigrationCamera {
  cameraId: string;
  physicalId: string;
  name: string;
  identifiers: string[];
  deviceIds: string[];
  activityKey: string;
  legacyCamera?: Pick<RegistryEntity, 'id' | 'unique_id' | 'platform' | 'config_entry_id'>;
  entities: { id: string; domain: string }[];
}
export type Preferences = Record<string, unknown>;
export interface MigrationMove {
  legacy: RegistryEntity;
  native?: RegistryEntity;
  parked: string;
  preferences: Preferences;
}
export interface MigrationPlan {
  bridgeId: string;
  providerRevision: string;
  revision: string;
  moves: MigrationMove[];
  devices: { before: RegistryDevice; preferences: Preferences }[];
  entries: { entry_id: string; disabled_by: string | null }[];
  blockers: string[];
  references: string[];
  cameraIds: string[];
  protectedIds: string[];
}
export interface ReferenceDocument {
  label: string;
  config: unknown;
}
export const stable = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
export const fingerprint = (value: unknown) =>
  createHash('sha256').update(stable(value)).digest('hex');
export const sameEntity = (a: RegistryEntity | undefined, b: RegistryEntity) =>
  !!a &&
  a.id === b.id &&
  a.unique_id === b.unique_id &&
  a.platform === b.platform &&
  a.config_entry_id === b.config_entry_id;
export function preferences(entity: RegistryEntity): Preferences {
  const result: Preferences = {};
  for (const key of ['name', 'icon', 'area_id', 'hidden_by', 'disabled_by'] as const)
    result[key] = entity[key] ?? null;
  result.labels = [...(entity.labels ?? [])].sort();
  result.aliases = [...(entity.aliases ?? [])].sort();
  result.categories = entity.categories ?? {};
  // Domain-specific options can change measurement semantics and need an explicit adapter.
  // Blocking them is safer than silently dropping units/precision or applying incompatible options.
  return result;
}
const hasReference = (value: string, id: string) =>
  new RegExp(`(?<![a-zA-Z0-9_])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-zA-Z0-9_])`).test(
    value,
  );
export const referenceConflicts = (documents: ReferenceDocument[], ids: string[]) => [
  ...new Set(
    documents
      .map((document) => ({ label: document.label, serialized: stable(document.config) }))
      .filter((document) => ids.some((id) => hasReference(document.serialized, id)))
      .map((document) => document.label),
  ),
];

/** Exact registry identity only. No names, guessed device associations or source URLs are matched. */
export function planMigration(input: {
  bridgeId: string;
  provider: string;
  providerRevision: string;
  cameras: MigrationCamera[];
  registry: RegistrySnapshot;
  documents: ReferenceDocument[];
}): MigrationPlan {
  const { registry, cameras } = input;
  const moves: MigrationMove[] = [],
    devices: MigrationPlan['devices'] = [],
    entries: MigrationPlan['entries'] = [];
  const blockers: string[] = [],
    references: string[] = [],
    protectedIds = new Set<string>();
  const used = new Set(registry.entities.map((entity) => entity.entity_id));
  const claimed = new Set<string>();
  const saved = (entity: RegistryEntity): RegistryEntity => ({
    id: entity.id,
    entity_id: entity.entity_id,
    unique_id: entity.unique_id,
    platform: entity.platform,
    config_entry_id: entity.config_entry_id,
    device_id: entity.device_id,
    ...preferences(entity),
  });
  const add = (legacy: RegistryEntity, native?: RegistryEntity) => {
    if (claimed.has(legacy.id)) {
      blockers.push(`Ambiguous entity: ${legacy.entity_id}`);
      return;
    }
    claimed.add(legacy.id);
    if (!legacy.id || (native && !native.id)) {
      blockers.push(`Missing registry identity: ${legacy.entity_id}`);
      return;
    }
    if (native && legacy.entity_id.split('.')[0] !== native.entity_id.split('.')[0]) {
      blockers.push(`Incompatible control: ${legacy.entity_id}`);
      return;
    }
    if (
      [legacy, ...(native ? [native] : [])].some(
        (entity) =>
          (entity.hidden_by && entity.hidden_by !== 'user') ||
          (entity.disabled_by && entity.disabled_by !== 'user') ||
          (entity.options && Object.keys(entity.options).length),
      )
    )
      blockers.push(`Review integration settings: ${legacy.entity_id}`);
    const parked = `${legacy.entity_id.split('.')[0]}.haus_legacy_${fingerprint(legacy.id).slice(0, 20)}`;
    if (used.has(parked)) blockers.push(`Reserved ID is occupied: ${parked}`);
    used.add(parked);
    protectedIds.add(legacy.id);
    if (native) {
      if (native.entity_id !== legacy.entity_id) protectedIds.add(native.entity_id);
    } else protectedIds.add(legacy.entity_id);
    moves.push({
      legacy: saved(legacy),
      native: native ? saved(native) : undefined,
      parked,
      preferences: preferences(legacy),
    });
  };
  for (const camera of cameras) {
    const candidates = registry.entities.filter(
      (entity) =>
        entity.platform === 'haus' &&
        entity.unique_id.startsWith('haus_camera:') &&
        entity.unique_id.endsWith(`:${camera.cameraId}`) &&
        registry.entries.some(
          (entry) =>
            entry.entry_id === entity.config_entry_id &&
            entry.domain === 'haus' &&
            !entry.disabled_by,
        ),
    );
    if (candidates.length !== 1) {
      blockers.push(`Home Assistant camera is not uniquely identified: ${camera.cameraId}`);
      continue;
    }
    const nativeCamera = candidates[0]!;
    const scope = nativeCamera.unique_id.slice('haus_camera:'.length, -camera.cameraId.length - 1);
    const own = (key: string, domain: string) =>
      registry.entities.filter(
        (entity) =>
          entity.platform === 'haus' &&
          entity.config_entry_id === nativeCamera.config_entry_id &&
          entity.unique_id === `haus_native:${scope}:${camera.cameraId}:${key}` &&
          entity.entity_id.startsWith(`${domain}.`),
      );
    const physical = registry.devices.filter(
      (device) =>
        device.id !== nativeCamera.device_id &&
        device.identifiers?.some(
          ([platform, value]) =>
            ['mqtt', input.provider].includes(platform) && camera.identifiers.includes(value),
        ),
    );
    const recorded = physical.filter((device) => camera.deviceIds.includes(device.id));
    const sourceDevice =
      recorded.length === 1 ? recorded[0] : physical.length === 1 ? physical[0] : undefined;
    if (physical.length && !sourceDevice) {
      blockers.push(`Ambiguous physical device: ${camera.cameraId}`);
      continue;
    }
    const nativeDevice = registry.devices.find((device) => device.id === nativeCamera.device_id);
    if (!nativeDevice) {
      blockers.push(`Native device is missing: ${camera.cameraId}`);
      continue;
    }
    if (
      !nativeDevice.identifiers?.some(
        ([platform, value]) =>
          (platform === 'haus' && value === `${input.bridgeId}:${camera.physicalId}`) ||
          (['mqtt', input.provider].includes(platform) && camera.identifiers.includes(value)),
      )
    ) {
      blockers.push(`Native physical identity needs review: ${camera.cameraId}`);
      continue;
    }
    if (sourceDevice) {
      protectedIds.add(sourceDevice.id);
      if (!devices.some((device) => device.before.id === nativeDevice.id))
        devices.push({
          before: {
            id: nativeDevice.id,
            name_by_user: nativeDevice.name_by_user,
            area_id: nativeDevice.area_id,
            labels: [...(nativeDevice.labels ?? [])].sort(),
          },
          preferences: {
            area_id: sourceDevice.area_id ?? null,
            name_by_user: sourceDevice.name_by_user ?? sourceDevice.name ?? camera.name,
            labels: [...(sourceDevice.labels ?? [])].sort(),
          },
        });
    }
    const canonical = registry.entities.find((entity) => entity.entity_id === camera.cameraId);
    if (canonical && canonical.id !== nativeCamera.id) {
      const entry = registry.entries.find((entry) => entry.entry_id === canonical.config_entry_id);
      if (
        !camera.legacyCamera ||
        !sameEntity(canonical, { ...camera.legacyCamera, entity_id: camera.cameraId }) ||
        canonical.platform !== 'generic' ||
        entry?.domain !== 'generic' ||
        registry.entities.some(
          (entity) => entity.config_entry_id === entry.entry_id && entity.id !== canonical.id,
        )
      )
        blockers.push(`Review camera integration: ${canonical.entity_id}`);
      else {
        add(canonical, nativeCamera);
        if (!entries.some((item) => item.entry_id === entry.entry_id))
          entries.push({ entry_id: entry.entry_id, disabled_by: entry.disabled_by ?? null });
      }
    }
    const old = registry.entities.filter(
      (entity) =>
        entity.platform === 'mqtt' &&
        ((sourceDevice && entity.device_id === sourceDevice.id) ||
          entity.unique_id === camera.activityKey),
    );
    for (const descriptor of camera.entities) {
      const native = own(descriptor.id, descriptor.domain);
      if (native.length !== 1 || native[0]!.device_id !== nativeDevice.id) {
        blockers.push(`Native control is not ready: ${camera.cameraId}/${descriptor.id}`);
        continue;
      }
      const matches = old.filter(
        (entity) =>
          entity.unique_id ===
          (descriptor.id === 'haus_activity'
            ? camera.activityKey
            : `${camera.physicalId}_${descriptor.id}`),
      );
      if (matches.length > 1)
        blockers.push(`Ambiguous legacy control: ${camera.cameraId}/${descriptor.id}`);
      else if (matches[0]) add(matches[0], native[0]);
    }
    for (const legacy of old.filter((entity) => !claimed.has(entity.id))) add(legacy);
  }
  if (moves.length > 512) blockers.push('Too many entities for one transfer');
  references.push(...referenceConflicts(input.documents, [...protectedIds]));
  if (references.length)
    blockers.push(
      'Review saved references to old device/registry IDs, temporary native IDs or controls without a replacement',
    );
  const draft = {
    bridgeId: input.bridgeId,
    providerRevision: input.providerRevision,
    moves,
    devices,
    entries,
    blockers: [...new Set(blockers)],
    references: [...new Set(references)],
    cameraIds: cameras.map((camera) => camera.cameraId),
    protectedIds: [...protectedIds].sort(),
  };
  return { ...draft, revision: fingerprint({ ...draft, documents: input.documents }) };
}

export function publicMigration(plan: MigrationPlan) {
  return {
    revision: plan.revision,
    replacements: plan.moves
      .filter((move) => move.native)
      .map((move) => ({ from: move.native!.entity_id, to: move.legacy.entity_id })),
    retirements: plan.moves.filter((move) => !move.native).map((move) => move.legacy.entity_id),
    blockers: plan.blockers,
    references: plan.references,
  };
}

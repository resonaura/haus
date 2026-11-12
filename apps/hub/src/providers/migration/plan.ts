/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { createHash } from 'node:crypto';
import type { StandaloneHomeEntryRow } from '../../storage/standalone/entities.js';
import type { IdentityRow } from '../../storage/entities/types.js';
import { cameraMigrationProof } from './proof.js';
import { cameraGraphMigration, storedDevice } from './graph.js';
import type {
  CameraMigrationEvidence,
  CameraMigrationPlan,
  CameraMigrationSnapshot,
  Mutation,
} from './types.js';

export function snapshotHash(snapshot: CameraMigrationSnapshot): string {
  const sorted = Object.fromEntries(
    Object.entries(snapshot).map(([key, rows]) => [
      key,
      rows.map((row: unknown) => JSON.stringify(row)).sort(),
    ]),
  );
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}

function references(
  value: unknown,
  ids: ReadonlySet<string>,
  mediaIds: ReadonlySet<string>,
): boolean {
  if (typeof value === 'string') return ids.has(value);
  if (Array.isArray(value)) return value.some((item: unknown) => references(item, ids, mediaIds));
  return (
    !!value &&
    typeof value === 'object' &&
    Object.entries(value).some(
      ([key, item]) =>
        ids.has(key) ||
        // Archive IDs remain live resources after their compatibility Home card is retired.
        (!(key === 'mediaId' && typeof item === 'string' && mediaIds.has(item)) &&
          references(item, ids, mediaIds)),
    )
  );
}

function changes<T>(
  before: readonly T[],
  after: readonly T[],
  key: (row: T) => string,
): Mutation<T>[] {
  const old = new Map(before.map((row) => [key(row), row]));
  const next = new Map(after.map((row) => [key(row), row]));
  return [...new Set([...old.keys(), ...next.keys()])].flatMap((id) =>
    JSON.stringify(old.get(id)) === JSON.stringify(next.get(id))
      ? []
      : [{ before: old.get(id), after: next.get(id) }],
  );
}

function state(row: StandaloneHomeEntryRow | undefined): Record<string, unknown> {
  if (!row) return {};
  const value: unknown = JSON.parse(row.value);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('camera_migration_state_invalid');
  return Object.fromEntries(Object.entries(value));
}

function sameCameraIdentity(
  identity: IdentityRow,
  expected: IdentityRow,
  physicalIds: readonly string[],
): boolean {
  if (
    identity.home !== expected.home ||
    identity.kind !== expected.kind ||
    identity.source !== expected.source
  )
    return false;
  if (identity.kind === 'device') return physicalIds.includes(identity.external);
  let actual: unknown, next: unknown;
  try {
    actual = JSON.parse(identity.external);
    next = JSON.parse(expected.external);
  } catch {
    return false;
  }
  return (
    Array.isArray(actual) &&
    Array.isArray(next) &&
    actual.length === 3 &&
    next.length === 3 &&
    typeof actual[0] === 'string' &&
    physicalIds.includes(actual[0]) &&
    actual[1] === next[1] &&
    actual[2] === next[2]
  );
}

/** Explicit offline migration: a normal discovery handler must never rewrite an allocated identity. */
export function planCameraMigration(
  before: CameraMigrationSnapshot,
  evidence: CameraMigrationEvidence,
  now: number,
): CameraMigrationPlan {
  const { inventory, resolved } = cameraMigrationProof(evidence);
  for (const source of before.sources) {
    const value: unknown = JSON.parse(source.value);
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      typeof Reflect.get(value, 'cameraId') !== 'string'
    )
      throw Error('camera_migration_source_invalid');
    if (
      resolved.some(
        (row) =>
          row.cameraId === Reflect.get(value, 'cameraId') ||
          (source.bridgeId === inventory.bridgeId && row.camera.id === source.physicalId),
      )
    )
      throw Error('camera_migration_source_already_imported');
  }
  const devices = before.home
    .filter((row) => row.kind === 'device')
    .map((row) => storedDevice(row.value));
  const home = new Map(before.home.map((row) => [JSON.stringify([row.kind, row.entryId]), row]));
  const identities = new Map(before.identities.map((row) => [row.id, row]));
  const aliases = before.aliases.map((row) => ({ ...row }));
  const native = before.native.map((row) => ({ ...row }));
  const cameras: CameraMigrationPlan['cameras'][number][] = [];
  const retired = new Set<string>();
  const affectedDevices = new Set<string>();
  const put = (kind: string, entryId: string, value: unknown) =>
    home.set(JSON.stringify([kind, entryId]), {
      kind,
      entryId,
      value: JSON.stringify(value),
      updatedAt: now,
    });
  const remove = (kind: string, id: string) => home.delete(JSON.stringify([kind, id]));

  for (const { camera, cameraId } of resolved) {
    const graph = cameraGraphMigration(devices, camera, cameraId);
    for (const id of graph.deviceIds) {
      if (affectedDevices.has(id)) throw Error('camera_migration_device_ambiguous');
      affectedDevices.add(id);
      remove('device', id);
    }
    put('device', graph.device.id, graph.device);
    cameras.push({ physicalId: camera.id, deviceId: graph.device.id, cameraId });
    for (const id of graph.removed) retired.add(id);
    for (const [from, to] of graph.redirects) {
      if (from === to) continue;
      retired.add(from);
      const owner = identities.get(from);
      const kind = graph.deviceIds.includes(from) ? 'device' : 'endpoint';
      if (
        !owner ||
        owner.kind !== kind ||
        owner.home !== evidence.homeId ||
        owner.source !== 'haus-mqtt'
      )
        throw Error('camera_migration_foreign_owner');
      const target = identities.get(to);
      if (target && !sameCameraIdentity(target, owner, [camera.id, ...camera.identifiers]))
        throw Error('camera_migration_foreign_owner');
      if (
        aliases.some(
          (alias) =>
            alias.identityId === to &&
            (alias.home !== owner.home || alias.kind !== kind || alias.source !== 'haus-mqtt'),
        )
      )
        throw Error('camera_migration_foreign_owner');
      if (!target) identities.set(to, { ...owner, id: to });
      for (const alias of aliases.filter((alias) => alias.identityId === from)) {
        if (alias.home !== owner.home || alias.kind !== owner.kind || alias.source !== 'haus-mqtt')
          throw Error('camera_migration_foreign_owner');
        alias.identityId = to;
      }
      if (owner.kind === 'endpoint') {
        const old = home.get(JSON.stringify(['endpoint_state', to]));
        const current = home.get(JSON.stringify(['endpoint_state', from]));
        if (current) {
          put('endpoint_state', to, { ...state(old), ...state(current) });
          remove('endpoint_state', from);
        }
      }
    }
    for (const [from, to] of graph.stateRedirects) {
      const previous = home.get(JSON.stringify(['endpoint_state', from]));
      if (previous)
        put('endpoint_state', to, {
          ...state(previous),
          ...state(home.get(JSON.stringify(['endpoint_state', to]))),
        });
    }
    for (const id of graph.removed) {
      if (
        !graph.redirects.has(id) &&
        (identities.has(id) || aliases.some((alias) => alias.identityId === id))
      )
        throw Error('camera_migration_foreign_owner');
      remove('endpoint_state', id);
    }
    const existing = native.filter(
      (row) =>
        row.cameraId === cameraId ||
        (row.bridgeId === inventory.bridgeId && row.physicalId === camera.id),
    );
    if (
      existing.some(
        (row) =>
          row.bridgeId !== inventory.bridgeId ||
          row.physicalId !== camera.id ||
          row.cameraId !== cameraId,
      )
    )
      throw Error('camera_migration_archive_conflict');
    if (!existing.length)
      native.push({ bridgeId: inventory.bridgeId, physicalId: camera.id, cameraId });
  }
  const mediaIds = new Set(cameras.map((camera) => camera.cameraId));
  for (const row of home.values()) {
    if (references(JSON.parse(row.value) as unknown, retired, mediaIds))
      throw Error('camera_migration_referenced_identity');
  }
  if ([...before.addresses, ...before.primary].some((row) => retired.has(row.identityId)))
    throw Error('camera_migration_referenced_identity');
  const after: CameraMigrationSnapshot = {
    ...before,
    home: [...home.values()],
    identities: [...identities.values()],
    aliases,
    native,
  };
  const homeKey = (row: StandaloneHomeEntryRow) => JSON.stringify([row.kind, row.entryId]);
  const identityKey = (row: IdentityRow) => row.id;
  return {
    beforeHash: snapshotHash(before),
    afterHash: snapshotHash(after),
    cameras,
    changes: {
      home: changes(before.home, after.home, homeKey),
      identities: changes(before.identities, after.identities, identityKey),
      aliases: changes(before.aliases, after.aliases, (row) =>
        JSON.stringify([row.home, row.kind, row.source, row.external]),
      ),
      native: changes(before.native, after.native, (row) =>
        JSON.stringify([row.bridgeId, row.physicalId]),
      ),
    },
  };
}

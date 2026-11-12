/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { BridgeCamera } from '@haus/bridge/protocol';
import type {
  CameraGraphMigration,
  StoredDevice,
  StoredEndpoint,
  StoredReference,
} from './types.js';

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function references(value: unknown): readonly StoredReference[] | undefined {
  if (value === undefined) return;
  if (!Array.isArray(value)) throw Error('camera_migration_device_invalid');
  return value.map((source: unknown) => {
    if (
      !record(source) ||
      typeof source.protocol !== 'string' ||
      typeof source.externalId !== 'string' ||
      (source.domain !== undefined && typeof source.domain !== 'string')
    )
      throw Error('camera_migration_device_invalid');
    return {
      ...source,
      protocol: source.protocol,
      externalId: source.externalId,
      ...(source.domain === undefined ? {} : { domain: source.domain }),
    };
  });
}

function storedEndpoint(value: unknown): StoredEndpoint {
  if (
    !record(value) ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    !Array.isArray(value.capabilities)
  )
    throw Error('camera_migration_device_invalid');
  const capabilities = value.capabilities.map((capability: unknown) => {
    if (!record(capability) || typeof capability.id !== 'string')
      throw Error('camera_migration_device_invalid');
    return { ...capability, id: capability.id };
  });
  return {
    ...value,
    id: value.id,
    name: value.name,
    capabilities,
    sourceRefs: references(value.sourceRefs),
  };
}

export function storedDevice(value: string): StoredDevice {
  const parsed: unknown = JSON.parse(value);
  if (
    !record(parsed) ||
    typeof parsed.id !== 'string' ||
    typeof parsed.name !== 'string' ||
    typeof parsed.category !== 'string' ||
    !record(parsed.connectivity) ||
    typeof parsed.connectivity.protocol !== 'string' ||
    typeof parsed.availability !== 'string' ||
    !record(parsed.source) ||
    typeof parsed.source.instanceId !== 'string' ||
    typeof parsed.source.externalId !== 'string' ||
    !Array.isArray(parsed.endpoints)
  )
    throw Error('camera_migration_device_invalid');
  return {
    ...parsed,
    id: parsed.id,
    name: parsed.name,
    source: {
      ...parsed.source,
      instanceId: parsed.source.instanceId,
      externalId: parsed.source.externalId,
    },
    sourceRefs: references(parsed.sourceRefs),
    endpoints: parsed.endpoints.map(storedEndpoint),
  };
}

const video = (endpoint: StoredEndpoint) => endpoint.capabilities.some((cap) => cap.id === 'video');

export function cameraGraphMigration(
  devices: readonly StoredDevice[],
  camera: BridgeCamera,
  cameraId: string,
): CameraGraphMigration {
  const legacy = devices.filter(
    (device) => device.source.instanceId === 'haus-mqtt' && device.source.externalId === camera.id,
  );
  const exact = devices.filter(
    (device) =>
      device.source.instanceId === 'haus-mqtt' &&
      camera.identifiers.includes(device.source.externalId),
  );
  const original = legacy[0],
    current = exact[0];
  if (
    legacy.length !== 1 ||
    exact.length !== 1 ||
    !original ||
    !current ||
    original.id === current.id
  )
    throw Error('camera_migration_device_ambiguous');
  if (
    [original, current].some(
      (device) =>
        device.endpoints.some((endpoint) => endpoint.sourceOwner) ||
        device.sourceRefs?.some((source) => source.protocol !== 'mqtt'),
    )
  )
    throw Error('camera_migration_foreign_owner');
  if (original.roomId !== current.roomId) throw Error('camera_migration_room_conflict');
  for (const field of ['metadata', 'customEntities', 'opaqueMetadata', 'relationships'] as const)
    if (
      original[field] &&
      current[field] &&
      JSON.stringify(original[field]) !== JSON.stringify(current[field])
    )
      throw Error('camera_migration_metadata_conflict');
  const redirects = new Map([[current.id, original.id]]);
  const consumed = new Set<string>();
  const definitions = [{ domain: 'camera', mqtt: camera.mqtt }, ...camera.entities];
  const endpoints = definitions.map((definition) => {
    const alias = definition.mqtt;
    if (!alias) throw Error('camera_migration_alias_missing');
    const found = current.endpoints.filter((endpoint) =>
      endpoint.sourceRefs?.some(
        (source) =>
          source.protocol === 'mqtt' &&
          source.domain === definition.domain &&
          source.externalId === alias.uniqueId,
      ),
    );
    const next = found[0];
    if (found.length !== 1 || !next) throw Error('camera_migration_endpoint_ambiguous');
    const previous = original.endpoints.filter((endpoint) =>
      [`ep_mqtt_${alias.uniqueId}`, `ep_${alias.uniqueId}`].includes(endpoint.id),
    );
    if (previous.length > 1) throw Error('camera_migration_endpoint_ambiguous');
    const old = previous[0];
    if (old?.sourceRefs?.some((source) => source.protocol !== 'mqtt'))
      throw Error('camera_migration_foreign_owner');
    if ([old, next].some((endpoint) => endpoint?.mediaId && endpoint.mediaId !== cameraId))
      throw Error('camera_migration_archive_conflict');
    if (old?.address && next.address && old.address !== next.address)
      throw Error('camera_migration_metadata_conflict');
    const id = old?.id ?? next.id;
    consumed.add(id);
    redirects.set(next.id, id);
    return {
      ...next,
      ...old,
      id,
      sourceRefs: next.sourceRefs,
      capabilities: next.capabilities,
      availability: next.availability,
      ...(definition.domain === 'camera' ? { mediaId: cameraId } : {}),
    };
  });
  if (
    new Set(endpoints.map((endpoint) => endpoint.id)).size !== endpoints.length ||
    endpoints.length !== current.endpoints.length
  )
    throw Error('camera_migration_endpoint_ambiguous');
  const syntheticIds = new Set(
    camera.entities.flatMap((entity) =>
      entity.mqtt ? [`ep_mqtt_${entity.mqtt.uniqueId}_camera`] : [],
    ),
  );
  const extras = original.endpoints.filter((endpoint) => !consumed.has(endpoint.id));
  if (
    extras.some(
      (endpoint) =>
        !syntheticIds.has(endpoint.id) ||
        !video(endpoint) ||
        endpoint.capabilities.length !== 1 ||
        endpoint.sourceRefs?.length,
    )
  )
    throw Error('camera_migration_unmapped_endpoint');
  const removed = new Set([current.id, ...extras.map((endpoint) => endpoint.id)]);
  const primaryVideo = endpoints.find(video);
  if (!primaryVideo) throw Error('camera_migration_endpoint_ambiguous');
  const stateRedirects = new Map(extras.map((endpoint) => [endpoint.id, primaryVideo.id]));
  const virtual = devices.filter((device) => device.id === cameraId);
  if (virtual.length) {
    const stub = virtual[0];
    if (!stub) throw Error('camera_migration_virtual_conflict');
    if (
      stub.source.instanceId !== 'haus-cameras' ||
      stub.source.externalId !== cameraId ||
      stub.endpoints.length !== 1 ||
      !stub.endpoints.every(video) ||
      stub.endpoints.some((endpoint) => endpoint.sourceOwner || endpoint.address) ||
      stub.sourceRefs?.some((source) => source.protocol !== 'virtual')
    )
      throw Error('camera_migration_virtual_conflict');
    removed.add(stub.id);
    for (const endpoint of stub.endpoints) {
      removed.add(endpoint.id);
      stateRedirects.set(endpoint.id, primaryVideo.id);
    }
  }
  const refs = new Map(
    [...(original.sourceRefs ?? []), ...(current.sourceRefs ?? [])].map((source) => [
      JSON.stringify([source.protocol, source.externalId]),
      source,
    ]),
  );
  return {
    device: {
      ...current,
      ...original,
      source: current.source,
      sourceRefs: [...refs.values()],
      endpoints,
      services: [],
      availability: current.availability,
    },
    redirects,
    stateRedirects,
    removed,
    deviceIds: [original.id, current.id, ...virtual.map((device) => device.id)],
  };
}

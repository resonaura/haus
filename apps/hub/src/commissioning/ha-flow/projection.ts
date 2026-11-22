/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { isDeepStrictEqual } from 'node:util';
import {
  normalizeDeviceEndpointsForHap,
  reconcileDeviceUserAssignments,
  type HausDevice,
  type SourceServiceRef,
} from '@haus/core';
import {
  HacsVirtualizer,
  type HaFlowRuntime,
  type HaRuntimeEntity,
  type HaRuntimeEvent,
} from '@haus/kitsune';
import type { StandaloneHomeService } from '../../home/home.service.js';
import type { IntegrationEntryState } from '../entry-helpers.js';

/** Prunes stale HA sub-devices whose endpoints were all absorbed by another active device in the same entry. */
export function pruneSupersededHaDevices(
  home: StandaloneHomeService | undefined,
  enabledEntries: ReadonlySet<string>,
  present: ReadonlySet<string>,
  inProgressInstances: ReadonlySet<string>,
): number {
  if (!home || present.size === 0) return 0;
  let pruned = 0;
  for (const device of home.devices.listDevices()) {
    if (!device.source.instanceId.startsWith('ha:')) continue;
    const entryId = device.source.instanceId.slice(3);
    if (!enabledEntries.has(entryId) || inProgressInstances.has(device.source.instanceId)) continue;
    if (present.has(device.id) || device.endpoints.length === 0) continue;
    const allAbsorbed = device.endpoints.every((ep) => {
      const owner = home.devices.getDeviceByEndpointId(ep.id);
      return (
        owner !== undefined &&
        owner.id !== device.id &&
        owner.source.instanceId === device.source.instanceId &&
        present.has(owner.id)
      );
    });
    if (allAbsorbed && home.removeDevice(device.id)) pruned += 1;
  }
  return pruned;
}

export function mapHaEntryState(rawState: string): IntegrationEntryState {
  if (rawState === 'loaded') return 'loaded';
  if (rawState === 'setup_retry') return 'setup_retry';
  if (rawState === 'not_loaded' || rawState === 'setup_in_progress') return 'not_loaded';
  return 'setup_error';
}

export function deviceStructureChanged(
  existing: HausDevice | undefined,
  next: HausDevice,
): boolean {
  if (!existing) return true;
  if (
    existing.name !== next.name ||
    existing.availability !== next.availability ||
    existing.roomId !== next.roomId ||
    existing.category !== next.category ||
    existing.manufacturer !== next.manufacturer ||
    existing.model !== next.model ||
    existing.endpoints.length !== next.endpoints.length
  ) {
    return true;
  }
  for (let i = 0; i < next.endpoints.length; i += 1) {
    const a = existing.endpoints[i];
    const b = next.endpoints[i];
    if (
      !a ||
      !b ||
      a.id !== b.id ||
      a.name !== b.name ||
      a.category !== b.category ||
      a.availability !== b.availability ||
      !isDeepStrictEqual(a.sourceOwner, b.sourceOwner) ||
      !isDeepStrictEqual(a.capabilities, b.capabilities)
    ) {
      return true;
    }
  }
  return false;
}

export function normalizeHaDevice(input: {
  readonly device: HausDevice;
  readonly existing: HausDevice | undefined;
  readonly entity: HaRuntimeEntity;
  readonly deviceEntities: readonly HaRuntimeEntity[];
  readonly source: SourceServiceRef;
  readonly roomId: string;
}): HausDevice {
  const { device, existing, entity, deviceEntities, source, roomId } = input;
  const states = deviceEntities.map((item) => item.state);
  const statelessReady = deviceEntities.some(
    (item) =>
      item.state === 'unknown' && ['notify', 'event', 'button', 'scene'].includes(item.domain),
  );
  const resolvedName = existing?.name ?? entity.deviceName ?? device.name;
  const rawNames = new Map(deviceEntities.map((item) => [item.entityId, item.name]));
  const rawEndpoints = device.endpoints.map((endpoint) => ({
    ...endpoint,
    name: rawNames.get(endpoint.id) ?? endpoint.name,
    sourceOwner: source,
  }));
  const endpoints = normalizeDeviceEndpointsForHap({
    name: resolvedName,
    category: device.category,
    model: entity.model ?? existing?.model ?? device.model,
    endpoints: rawEndpoints,
  });
  const resolvedRoomId = existing?.roomId ?? roomId;
  return reconcileDeviceUserAssignments(existing, {
    ...device,
    availability:
      states.some((state) => state !== 'unavailable' && state !== 'unknown') || statelessReady
        ? 'online'
        : states.includes('unavailable')
          ? 'offline'
          : 'unknown',
    name: resolvedName,
    source: { instanceId: `ha:${entity.entryId}`, externalId: entity.deviceId },
    sourceRefs: [
      { protocol: 'vendor', instanceId: entity.integration, externalId: entity.deviceId },
    ],
    manufacturer: entity.manufacturer,
    model: entity.model,
    roomId: resolvedRoomId,
    ...(existing?.areaId
      ? { areaId: existing.areaId }
      : resolvedRoomId !== 'unassigned'
        ? { areaId: resolvedRoomId }
        : {}),
    endpoints,
  });
}

export function resolveHaRoomId(
  home: StandaloneHomeService | undefined,
  entity: HaRuntimeEntity,
): string {
  if (entity.areaName) {
    const name = entity.areaName.trim().toLocaleLowerCase();
    const match = home?.roomManager
      .listRooms()
      .find((room) => room.name.trim().toLocaleLowerCase() === name);
    if (match) return match.id;
  }
  if (entity.areaId && home?.roomManager.getRoom(entity.areaId)) return entity.areaId;
  return 'unassigned';
}

export function markHaDevicesOffline(
  home: StandaloneHomeService | undefined,
  enabledEntries: ReadonlySet<string>,
  latestEntities: Map<string, HaRuntimeEntity>,
  entryId?: string,
  present?: ReadonlySet<string>,
  inProgressInstances?: ReadonlySet<string>,
): void {
  for (const device of home?.devices.listDevices() ?? []) {
    if (!device.source.instanceId.startsWith('ha:')) continue;
    const deviceEntryId = device.source.instanceId.slice(3);
    if (entryId ? deviceEntryId !== entryId : !enabledEntries.has(deviceEntryId)) continue;
    if (present?.has(device.id) || inProgressInstances?.has(device.source.instanceId)) continue;
    if (device.availability !== 'offline') {
      home?.registerDevice({ ...device, availability: 'offline' });
    }
    for (const endpoint of device.endpoints) latestEntities.delete(endpoint.id);
  }
}

export interface PreparedEndpointUpdate {
  readonly id: string;
  readonly patch: Record<string, unknown>;
  readonly previousState?: Record<string, unknown>;
  readonly dispatch: boolean;
}

export function prepareHaDeviceUpdate(input: {
  readonly home: StandaloneHomeService;
  readonly device: HausDevice;
  readonly existing: HausDevice | undefined;
  readonly entity: HaRuntimeEntity;
  readonly deviceEntities: readonly HaRuntimeEntity[];
  readonly source: SourceServiceRef;
  readonly observed: ReadonlySet<string>;
  readonly inFlightEndpoints?: ReadonlySet<string>;
}): {
  readonly normalized: HausDevice;
  readonly structureChanged: boolean;
  readonly updates: readonly PreparedEndpointUpdate[];
} {
  const { home, device, existing, entity, deviceEntities, source, observed, inFlightEndpoints } =
    input;
  const normalized = normalizeHaDevice({
    device,
    existing,
    entity,
    deviceEntities,
    source,
    roomId: resolveHaRoomId(home, entity),
  });
  const structureChanged = deviceStructureChanged(existing, normalized);
  const updates = normalized.endpoints.map((endpoint) => {
    const previousState = structureChanged ? home.getEndpointState(endpoint.id) : undefined;
    const forceAll = Boolean(!structureChanged && inFlightEndpoints?.has(endpoint.id));
    const patch = Object.fromEntries(
      Object.entries(endpoint.readings)
        .filter(
          ([key, reading]) =>
            forceAll ||
            !isDeepStrictEqual(home.getEndpointProperty(endpoint.id, key), reading.value),
        )
        .map(([key, reading]) => [key, reading.value]),
    );
    return { id: endpoint.id, patch, previousState, dispatch: observed.has(endpoint.id) };
  });
  return { normalized, structureChanged, updates };
}

export function createHaEntryProjection(input: {
  readonly entryId: string;
  readonly source: SourceServiceRef;
  readonly home?: StandaloneHomeService;
  readonly getRuntime: () => Pick<HaFlowRuntime, 'entityCommand'> | undefined;
}): { readonly projection: HacsVirtualizer; readonly unregister?: () => void } {
  const { entryId, source, home, getRuntime } = input;
  const projection = new HacsVirtualizer(undefined, async (payload) => {
    const runtime = getRuntime();
    const entityId = payload.serviceData?.entity_id;
    if (!runtime || typeof entityId !== 'string') throw Error('integration_unavailable');
    await runtime.entityCommand(entryId, entityId, payload.service, payload.serviceData ?? {});
  });
  const unregister = home?.registerCommandHandler(
    source,
    async (endpointId, capability, command, parameters) => {
      const deviceId =
        home.devices.getDeviceByEndpointId(endpointId)?.id ??
        projection
          .getDevices()
          .find((item) => item.endpoints.some((endpoint) => endpoint.id === endpointId))?.id;
      if (!deviceId) throw Error('integration_entity_unavailable');
      let value: unknown = parameters?.value;
      if (command === 'turn_on') value = true;
      if (command === 'turn_off') value = false;
      if (command === 'toggle') value = !home.getEndpointProperty(endpointId, 'power');
      await projection.executeCommand({
        deviceId,
        endpointId,
        capability,
        value,
        operation: command,
        parameters,
      });
    },
    { optimistic: false },
  );
  return { projection, unregister };
}

export function groupHaEntitiesByDevice(
  entities: readonly HaRuntimeEntity[],
): Map<string, HaRuntimeEntity[]> {
  const byDevice = new Map<string, HaRuntimeEntity[]>();
  for (const entity of entities) {
    const key = `ha:${entity.entryId}:${entity.deviceId}`;
    const list = byDevice.get(key);
    if (list) list.push(entity);
    else byDevice.set(key, [entity]);
  }
  return byDevice;
}

export type HaIntegrationRuntimePort = Pick<
  HaFlowRuntime,
  'setupEntry' | 'entitySnapshot' | 'entityCommand' | 'unloadEntry'
> &
  Partial<Pick<HaFlowRuntime, 'onEvent' | 'onEntityStates' | 'onWorkerExit' | 'isRunning'>>;

export type HaEntryStateCallback = (
  entryId: string,
  state: IntegrationEntryState,
  reason?: string | null,
) => Promise<void>;

export function dispatchHaAutomationEvent(
  home: StandaloneHomeService | undefined,
  event: HaRuntimeEvent,
  onWarn: (message: string) => void,
  label: string,
): Promise<unknown> {
  if (!home) return Promise.resolve();
  return home
    .dispatchAutomationEvent({
      type: 'event',
      eventType: event.eventType,
      endpointId: event.entityId,
      ...(event.data ? { data: event.data } : {}),
    })
    .catch((err: unknown) => {
      const detail = err instanceof Error ? err.message : String(err);
      onWarn(`${label} (${event.entityId}/${event.eventType}): ${detail}`);
    });
}

export function isTransientRefreshTimeout(
  error: unknown,
  runtime?: { readonly isRunning?: () => boolean },
): boolean {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined;
  return (
    code === 'request_timeout' && typeof runtime?.isRunning === 'function' && runtime.isRunning()
  );
}

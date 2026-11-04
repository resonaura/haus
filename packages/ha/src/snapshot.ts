/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { HaTransport } from './ha-client.js';
import type { Snapshot } from './types.js';
type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function serviceMap(value: unknown): Snapshot['services'] {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, Record<string, unknown>] =>
      isRecord(entry[1]),
    ),
  );
}

export function decodeHaSnapshot(value: unknown): Snapshot | undefined {
  if (
    !isRecord(value) ||
    !isRecord(value.config) ||
    !isRecord(value.services) ||
    !isRecord(value.user)
  )
    return;
  if (
    typeof value.config.location_name !== 'string' ||
    typeof value.user.name !== 'string' ||
    typeof value.user.is_admin !== 'boolean'
  )
    return;
  for (const [key, id] of [
    ['states', 'entity_id'],
    ['entities', 'entity_id'],
    ['devices', 'id'],
    ['areas', 'area_id'],
  ] as const) {
    const items = value[key];
    if (
      !Array.isArray(items) ||
      items.length > 30_000 ||
      items.some((item) => !isRecord(item) || typeof item[id] !== 'string')
    )
      return;
  }
  if (
    (value.states as unknown[]).some(
      (item) => !isRecord(item) || typeof item.state !== 'string' || !isRecord(item.attributes),
    )
  )
    return;
  return value as unknown as Snapshot;
}

async function optionalRequest<T>(
  transport: Pick<HaTransport, 'request'>,
  type: string,
  fallback: T,
): Promise<T> {
  try {
    return await transport.request<T>({ type });
  } catch {
    return fallback;
  }
}

export async function readHaSnapshot(transport: Pick<HaTransport, 'request'>): Promise<Snapshot> {
  const [states, config, user, services, areas, devices, entities] = await Promise.all([
    transport.request<unknown>({ type: 'get_states' }),
    transport.request<unknown>({ type: 'get_config' }),
    optionalRequest<unknown>(transport, 'auth/current_user', {}),
    optionalRequest<unknown>(transport, 'get_services', {}),
    optionalRequest<unknown>(transport, 'config/area_registry/list', []),
    optionalRequest<unknown>(transport, 'config/device_registry/list', []),
    optionalRequest<unknown>(transport, 'config/entity_registry/list', []),
  ]);
  if (!Array.isArray(states) || !isRecord(config))
    throw new Error('Home Assistant did not return its home state.');
  const locationName = text(config.location_name, 'Your home');
  const sessionUser = isRecord(user) ? user : {};
  const snapshot = {
    states: states.filter(
      (item): item is Snapshot['states'][number] =>
        isRecord(item) &&
        typeof item.entity_id === 'string' &&
        typeof item.state === 'string' &&
        isRecord(item.attributes),
    ),
    areas: Array.isArray(areas)
      ? areas.filter(
          (item): item is Snapshot['areas'][number] =>
            isRecord(item) && typeof item.area_id === 'string' && typeof item.name === 'string',
        )
      : [],
    devices: Array.isArray(devices)
      ? devices.filter(
          (item): item is Snapshot['devices'][number] =>
            isRecord(item) && typeof item.id === 'string',
        )
      : [],
    entities: Array.isArray(entities)
      ? entities.filter(
          (item): item is Snapshot['entities'][number] =>
            isRecord(item) && typeof item.entity_id === 'string',
        )
      : [],
    services: serviceMap(services),
    config: { ...config, location_name: locationName },
    user: {
      ...sessionUser,
      name: text(sessionUser.name, locationName),
      is_admin: sessionUser.is_admin === true,
    },
  } satisfies Snapshot;
  return snapshot;
}

/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { CompatView, HubDevice, HubRoom } from '../types';
import { isRecord } from '../types';
import {
  listHubStatisticIds,
  queryHubHistoryDuringPeriod,
  queryHubStatisticsDuringPeriod,
} from './hub-stats';

export interface HubRegistryContext {
  readonly api: (
    path: string,
    init?: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown },
  ) => Promise<unknown>;
  readonly refresh: () => Promise<void>;
  readonly getView: () => CompatView;
  readonly getDevices?: () => readonly HubDevice[];
  readonly recordCache: (
    type:
      'config/area_registry/list' | 'config/device_registry/list' | 'config/entity_registry/list',
    value: unknown,
  ) => void;
  readonly emitRegistryUpdated: (
    eventType: 'area_registry_updated' | 'device_registry_updated' | 'entity_registry_updated',
  ) => void;
}

const HUB_ROOM_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  room_name_exists: 'A room with this name already exists.',
  room_id_exists: 'A room with this name already exists.',
  invalid_room_name: 'Use a room name between 1 and 120 characters.',
  room_not_found: 'This room no longer exists.',
  target_room_not_found: 'This room no longer exists.',
  device_not_found: 'This device no longer exists.',
  invalid_device_name: 'Use a device name between 1 and 120 characters.',
  app_permission_denied: 'Only an administrator can organize rooms and devices.',
};

function translateHubRegistryError(error: unknown): never {
  if (error instanceof Error) {
    const codeMatch = /\(\d+:\s*([a-z0-9_]+)\)\.$/.exec(error.message);
    const code = codeMatch?.[1];
    if (code && HUB_ROOM_ERROR_MESSAGES[code]) {
      throw new Error(HUB_ROOM_ERROR_MESSAGES[code]);
    }
  }
  throw error;
}

function formatFallbackAreaName(roomId: string): string {
  return roomId.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/** Merges persisted Hub rooms with device-derived fallback rooms in HA area_registry shape. */
export function buildCompatAreas(
  devices: readonly HubDevice[],
  rooms: readonly HubRoom[] = [],
): CompatView['areas'] {
  const byId = new Map<string, Record<string, unknown>>();
  for (const room of rooms) {
    if (!room.id || room.id === 'unassigned') continue;
    byId.set(room.id, {
      area_id: room.id,
      name: room.name,
      ...(room.icon ? { icon: room.icon } : {}),
    });
  }
  for (const device of devices) {
    if (!device.roomId || device.roomId === 'unassigned' || byId.has(device.roomId)) continue;
    byId.set(device.roomId, {
      area_id: device.roomId,
      name: formatFallbackAreaName(device.roomId),
    });
  }
  return [...byId.values()];
}

function parseHubRoomResponse(body: unknown, fallbackId?: string, fallbackName?: string) {
  const room = isRecord(body) && isRecord(body.room) ? body.room : body;
  const id = isRecord(room) && typeof room.id === 'string' ? room.id : (fallbackId ?? '');
  const name = isRecord(room) && typeof room.name === 'string' ? room.name : (fallbackName ?? id);
  const icon = isRecord(room) && typeof room.icon === 'string' && room.icon ? room.icon : undefined;
  return {
    area_id: id,
    name,
    ...(icon ? { icon } : {}),
  };
}

const HUB_REGISTRY_TYPES = new Set([
  'config/area_registry/list',
  'config/area_registry/create',
  'config/area_registry/update',
  'config/area_registry/delete',
  'config/device_registry/list',
  'config/device_registry/update',
  'config/entity_registry/list',
  'config/entity_registry/update',
  'history/history_during_period',
  'recorder/statistics_during_period',
  'recorder/list_statistic_ids',
]);

/** Dispatches area/device/entity registry and history queries when applicable. */
export async function handleHubRegistryRpc(
  message: Record<string, unknown>,
  ctx: HubRegistryContext,
): Promise<{ handled: true; result: unknown } | { handled: false }> {
  const type = typeof message.type === 'string' ? message.type : '';
  if (!HUB_REGISTRY_TYPES.has(type)) return { handled: false };
  return { handled: true, result: await handleHubRegistryCommand(message, ctx) };
}

/** Computes changed compat states relative to the previous view snapshot. */
export function diffCompatStates(
  before: CompatView['states'],
  next: CompatView['states'],
): Array<{
  entity_id: string;
  new_state: CompatView['states'][number];
  old_state: CompatView['states'][number] | null;
}> {
  const previous = new Map(before.map((state) => [state.entity_id, state]));
  const changes: Array<{
    entity_id: string;
    new_state: CompatView['states'][number];
    old_state: CompatView['states'][number] | null;
  }> = [];
  for (const state of next) {
    const old = previous.get(state.entity_id);
    if (
      old &&
      old.state === state.state &&
      JSON.stringify(old.attributes) === JSON.stringify(state.attributes)
    ) {
      continue;
    }
    changes.push({ entity_id: state.entity_id, new_state: state, old_state: old ?? null });
  }
  return changes;
}

/** Handles HA area, device, and entity registry mutations against Hub REST endpoints. */
export async function handleHubRegistryCommand(
  message: Record<string, unknown>,
  ctx: HubRegistryContext,
): Promise<unknown> {
  try {
    switch (message.type) {
      case 'config/area_registry/list': {
        const areas = ctx.getView().areas;
        ctx.recordCache('config/area_registry/list', areas);
        return areas;
      }
      case 'config/device_registry/list': {
        const devices = ctx.getView().devices;
        ctx.recordCache('config/device_registry/list', devices);
        return devices;
      }
      case 'config/entity_registry/list': {
        const entities = ctx.getView().entities;
        ctx.recordCache('config/entity_registry/list', entities);
        return entities;
      }
      case 'history/history_during_period':
        return queryHubHistoryDuringPeriod(message, ctx);
      case 'recorder/statistics_during_period':
        return queryHubStatisticsDuringPeriod(message, ctx);
      case 'recorder/list_statistic_ids':
        return listHubStatisticIds(ctx);
      case 'config/area_registry/create': {
        const name = typeof message.name === 'string' ? message.name.trim() : '';
        const icon = typeof message.icon === 'string' && message.icon ? message.icon : undefined;
        const body = await ctx.api('/api/rooms', {
          method: 'POST',
          body: { name, ...(icon ? { icon } : {}) },
        });
        await ctx.refresh();
        ctx.recordCache('config/area_registry/list', ctx.getView().areas);
        ctx.emitRegistryUpdated('area_registry_updated');
        return parseHubRoomResponse(body, undefined, name);
      }
      case 'config/area_registry/update': {
        const areaId = typeof message.area_id === 'string' ? message.area_id : '';
        if (!areaId) throw new Error('This room no longer exists.');
        const patch: Record<string, unknown> = {};
        if (typeof message.name === 'string') patch.name = message.name;
        if ('icon' in message) patch.icon = typeof message.icon === 'string' ? message.icon : null;
        const body = await ctx.api(`/api/rooms/${encodeURIComponent(areaId)}`, {
          method: 'PATCH',
          body: patch,
        });
        await ctx.refresh();
        ctx.recordCache('config/area_registry/list', ctx.getView().areas);
        ctx.emitRegistryUpdated('area_registry_updated');
        return parseHubRoomResponse(body, areaId);
      }
      case 'config/area_registry/delete': {
        const areaId = typeof message.area_id === 'string' ? message.area_id : '';
        if (!areaId) throw new Error('This room no longer exists.');
        await ctx.api(`/api/rooms/${encodeURIComponent(areaId)}`, { method: 'DELETE' });
        await ctx.refresh();
        ctx.recordCache('config/area_registry/list', ctx.getView().areas);
        ctx.emitRegistryUpdated('area_registry_updated');
        ctx.emitRegistryUpdated('device_registry_updated');
        return { deleted: true };
      }
      case 'config/device_registry/update': {
        const deviceId = typeof message.device_id === 'string' ? message.device_id : '';
        if (!deviceId) throw new Error('This device no longer exists.');
        const patch: Record<string, unknown> = {};
        if ('area_id' in message) {
          patch.roomId =
            typeof message.area_id === 'string' && message.area_id ? message.area_id : null;
        }
        if (typeof message.name_by_user === 'string' && message.name_by_user.trim()) {
          patch.name = message.name_by_user.trim();
        }
        if (Object.keys(patch).length > 0) {
          await ctx.api(`/api/devices/${encodeURIComponent(deviceId)}`, {
            method: 'PATCH',
            body: patch,
          });
          await ctx.refresh();
          ctx.emitRegistryUpdated('device_registry_updated');
        }
        return (
          ctx.getView().devices.find((d) => d.id === deviceId) ?? {
            id: deviceId,
            area_id: typeof message.area_id === 'string' ? message.area_id : null,
          }
        );
      }
      case 'config/entity_registry/update': {
        const entityId = typeof message.entity_id === 'string' ? message.entity_id : '';
        if (!entityId) return { entity_entry: null };
        const view = ctx.getView();
        const current = view.entities.find((item) => item.entity_id === entityId);
        const deviceId =
          current && typeof current.device_id === 'string' ? current.device_id : undefined;
        const patch: Record<string, unknown> = {};
        if (typeof message.area_id === 'string' && message.area_id) {
          patch.roomId = message.area_id;
        }
        if (typeof message.name === 'string' && message.name.trim()) {
          patch.name = message.name.trim();
        }
        if (deviceId && Object.keys(patch).length > 0) {
          await ctx.api(`/api/devices/${encodeURIComponent(deviceId)}`, {
            method: 'PATCH',
            body: patch,
          });
          await ctx.refresh();
          ctx.emitRegistryUpdated('entity_registry_updated');
          ctx.emitRegistryUpdated('device_registry_updated');
        }
        const updated = ctx.getView().entities.find((item) => item.entity_id === entityId);
        return { entity_entry: updated ?? current ?? { entity_id: entityId } };
      }
      default:
        return undefined;
    }
  } catch (error) {
    translateHubRegistryError(error);
  }
}

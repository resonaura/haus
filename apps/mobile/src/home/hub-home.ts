/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { OptimisticState } from '@haus/core/optimistic';
import { orderClusterCandidateUrls } from '@haus/core/pairing';
import { defaults, sanitizePreferences, type Preferences } from '@haus/core/preferences';
import type { HaTransport } from '@haus/ha/ha-transport';
import { decodeHaSnapshot } from '@haus/ha/snapshot';
import { createHausHomeStore } from '@haus/ha/store';
import type { HassEntity } from '@haus/ha/types';
import type { MobileHubSessionManager } from '../auth/hub-session.js';
import type { MobileHomeRuntime } from './mobile-home.js';

interface HubDevicePayload {
  readonly id: string;
  readonly name: string;
  readonly category?: string;
  readonly areaId?: string;
  readonly roomId?: string;
  readonly availability?: string;
  readonly endpoints?: readonly {
    readonly id: string;
    readonly name: string;
    readonly capabilities?: readonly { readonly id: string }[];
  }[];
}

interface HubRoomPayload {
  readonly id: string;
  readonly name: string;
}

interface HubScenePayload {
  readonly id: string;
  readonly name: string;
  readonly roomId?: string;
  readonly icon?: string;
}

interface EndpointBinding {
  readonly deviceId: string;
  readonly endpointId: string;
  readonly capabilities: readonly string[];
  readonly friendlyName: string;
}

const HUB_SERVICES = {
  light: { turn_on: {}, turn_off: {}, toggle: {} },
  switch: { turn_on: {}, turn_off: {}, toggle: {} },
  fan: { turn_on: {}, turn_off: {}, toggle: {}, set_percentage: {} },
  cover: { open_cover: {}, close_cover: {}, stop_cover: {}, set_cover_position: {} },
  lock: { lock: {}, unlock: {} },
  climate: { set_temperature: {}, set_hvac_mode: {}, turn_off: {} },
  button: { press: {} },
  scene: { turn_on: {}, apply: {} },
} as const;

function mapEndpointEntityId(
  device: HubDevicePayload,
  epId: string,
  caps: readonly string[],
): string {
  const clean = epId.replace(/[^a-z0-9_]/gi, '_').toLowerCase();
  if (caps.includes('video') || device.category === 'cameras') {
    return device.id.startsWith('camera.') ? device.id : `camera.${clean}`;
  }
  if (caps.includes('light') || caps.includes('brightness') || device.category === 'lighting')
    return `light.${clean}`;
  if (caps.includes('climate') || caps.includes('thermostat') || device.category === 'climate')
    return `climate.${clean}`;
  if (caps.includes('lock')) return `lock.${clean}`;
  if (caps.includes('cover') || caps.includes('position')) return `cover.${clean}`;
  if (caps.includes('fan')) return `fan.${clean}`;
  if (caps.includes('button')) return `button.${clean}`;
  if (caps.includes('switch') || caps.includes('on_off')) return `switch.${clean}`;
  return `sensor.${clean}`;
}

function projectEndpointState(
  entityId: string,
  friendlyName: string,
  epState: Record<string, unknown>,
  offline: boolean,
  nowIso: string,
): HassEntity {
  const rawOn = epState.on ?? epState.power ?? epState.state;
  const stateStr = offline
    ? 'unavailable'
    : typeof rawOn === 'boolean'
      ? rawOn
        ? 'on'
        : 'off'
      : typeof rawOn === 'string'
        ? rawOn
        : typeof epState.value === 'number' || typeof epState.value === 'string'
          ? String(epState.value)
          : 'unknown';
  return {
    entity_id: entityId,
    state: stateStr,
    attributes: { friendly_name: friendlyName, ...epState },
    last_changed: nowIso,
    last_updated: nowIso,
  };
}

function buildHubCommandBody(
  binding: EndpointBinding,
  domain: string,
  service: string,
  data: Record<string, unknown>,
): {
  endpointId: string;
  capability: string;
  command: string;
  parameters?: Record<string, unknown>;
} {
  const pickCap = (...preferred: string[]) =>
    preferred.find((cap) => binding.capabilities.includes(cap)) ??
    binding.capabilities[0] ??
    (domain === 'light' ? 'light' : 'on_off');

  if (service === 'set_cover_position' && typeof data.position === 'number') {
    return {
      endpointId: binding.endpointId,
      capability: pickCap('position', 'cover'),
      command: 'set_position',
      parameters: { position: data.position },
    };
  }
  if (service === 'open_cover' || service === 'close_cover' || service === 'stop_cover') {
    return {
      endpointId: binding.endpointId,
      capability: pickCap('cover', 'position'),
      command: service.replace('_cover', ''),
    };
  }
  if (service === 'lock' || service === 'unlock') {
    return { endpointId: binding.endpointId, capability: pickCap('lock'), command: service };
  }
  if (service === 'set_temperature' && typeof data.temperature === 'number') {
    return {
      endpointId: binding.endpointId,
      capability: pickCap('thermostat', 'climate', 'temperature'),
      command: 'set_temperature',
      parameters: { temperature: data.temperature },
    };
  }
  if (service === 'set_hvac_mode' && typeof data.hvac_mode === 'string') {
    return {
      endpointId: binding.endpointId,
      capability: pickCap('thermostat', 'climate'),
      command: 'set_mode',
      parameters: { mode: data.hvac_mode },
    };
  }
  if (service === 'set_percentage' && typeof data.percentage === 'number') {
    return {
      endpointId: binding.endpointId,
      capability: pickCap('fan', 'speed', 'level'),
      command: 'set_percentage',
      parameters: { percentage: data.percentage },
    };
  }
  if (service === 'press') {
    return { endpointId: binding.endpointId, capability: pickCap('button'), command: 'press' };
  }
  const parameters: Record<string, unknown> = {};
  if (typeof data.brightness_pct === 'number') parameters.brightness = data.brightness_pct;
  else if (typeof data.brightness === 'number')
    parameters.brightness = Math.round(data.brightness / 2.55);
  if (Array.isArray(data.rgb_color)) parameters.rgb = data.rgb_color;
  if (typeof data.color_temp_kelvin === 'number') parameters.kelvin = data.color_temp_kelvin;
  if (typeof data.effect === 'string') parameters.effect = data.effect;
  const command = service === 'turn_off' ? 'turn_off' : service === 'toggle' ? 'toggle' : 'turn_on';
  return {
    endpointId: binding.endpointId,
    capability: pickCap('on_off', 'light', 'switch'),
    command,
    ...(Object.keys(parameters).length ? { parameters } : {}),
  };
}

export type MobileHubSessionPort = Pick<
  MobileHubSessionManager,
  'bearer' | 'getSession' | 'reconnect' | 'logout'
>;

export type MobileHubFetch = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface MobileHubHomeOptions {
  readonly fetchFn?: MobileHubFetch;
  readonly pollIntervalMs?: number;
}

export async function openMobileHubHome(
  manager: MobileHubSessionPort,
  initialHubName?: string,
  options: MobileHubHomeOptions = {},
): Promise<MobileHomeRuntime> {
  const bearer = manager.bearer();
  if (!bearer) throw new Error('Connect to your Haus Hub first.');
  const fetchImpl: MobileHubFetch = options.fetchFn ?? ((url, init) => globalThis.fetch(url, init));
  const pollIntervalMs = options.pollIntervalMs ?? 4_000;

  let alive = true;
  let foreground = true;
  let hubName = initialHubName || 'Haus';
  let preferences: Preferences = defaults;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let correlationSeq = 0;
  const homeId = bearer.url;
  const optimistic = new OptimisticState();
  const preferenceListeners = new Set<() => void>();
  const entityTargets = new Map<string, EndpointBinding>();
  const sceneTargets = new Map<string, string>();

  const hubRequest = async <T>(
    path: string,
    init?: { method?: string; body?: unknown },
  ): Promise<T> => {
    const active = manager.bearer();
    if (!active) throw new Error('offline');
    const urls = orderClusterCandidateUrls(active.url, active.clusterUrls);
    let lastErr: unknown;
    for (const baseUrl of urls) {
      try {
        const res = await fetchImpl(`${baseUrl}${path}`, {
          method: init?.method ?? 'GET',
          headers: {
            authorization: `Bearer ${active.token}`,
            ...(init?.body !== undefined ? { 'content-type': 'application/json' } : {}),
          },
          ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as T;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('offline');
  };

  const transport: HaTransport = {
    connected: true,
    close() {},
    watchEntities: () => () => {},
    watchState(callback) {
      callback('connected');
      return () => {};
    },
    async request<T>(message: Record<string, unknown>): Promise<T> {
      const correlationId = `hub-cmd-${++correlationSeq}`;
      if (message.type === 'call_service') {
        const domain = String(message.domain ?? '');
        const service = String(message.service ?? '');
        const serviceData =
          message.service_data && typeof message.service_data === 'object'
            ? (message.service_data as Record<string, unknown>)
            : {};
        const target = message.target as { entity_id?: string | string[] } | undefined;
        const rawIds = Array.isArray(target?.entity_id)
          ? target.entity_id
          : typeof target?.entity_id === 'string'
            ? [target.entity_id]
            : [];
        for (const entityId of rawIds) {
          if (domain === 'scene') {
            const sceneId = sceneTargets.get(entityId);
            if (sceneId) {
              await hubRequest(`/api/scenes/${encodeURIComponent(sceneId)}/apply`, {
                method: 'POST',
                body: {},
              });
            }
            continue;
          }
          const binding = entityTargets.get(entityId);
          if (!binding) continue;
          const body = buildHubCommandBody(binding, domain, service, serviceData);
          const receipt = await hubRequest<{ state?: Record<string, unknown> }>(
            `/api/devices/${encodeURIComponent(binding.deviceId)}/command`,
            { method: 'POST', body },
          );
          if (receipt?.state && typeof receipt.state === 'object') {
            const observed = projectEndpointState(
              entityId,
              binding.friendlyName,
              receipt.state,
              false,
              new Date().toISOString(),
            );
            store.getState().applyObservation(homeId, {
              entityId,
              value: observed,
              correlationId,
            });
          }
        }
        void refreshSnapshot();
      }
      return { context: { id: correlationId } } as T;
    },
  };

  const store = createHausHomeStore({
    optimistic,
    openTransport: async () => transport,
  });

  const refreshSnapshot = async (): Promise<void> => {
    if (!alive) return;
    try {
      const [idRes, devRes, stateRes, roomRes, sceneRes, prefRes] = await Promise.all([
        hubRequest<{ hub?: { name?: string; homeName?: string } }>('/api/auth/identity').catch(
          () => undefined,
        ),
        hubRequest<{ devices?: HubDevicePayload[] }>('/api/devices'),
        hubRequest<{ states?: Record<string, Record<string, unknown>> }>('/api/states'),
        hubRequest<{ rooms?: HubRoomPayload[] }>('/api/rooms').catch(() => ({ rooms: [] })),
        hubRequest<{ scenes?: HubScenePayload[] }>('/api/scenes').catch(() => ({ scenes: [] })),
        hubRequest<{ value?: unknown }>('/api/preferences').catch(() => undefined),
      ]);
      if (!alive) return;
      if (idRes?.hub?.homeName || idRes?.hub?.name) {
        hubName = idRes.hub.homeName || idRes.hub.name || hubName;
      }
      if (prefRes?.value && typeof prefRes.value === 'object') {
        const nextPref = sanitizePreferences(prefRes.value as Record<string, unknown>);
        optimistic.lightMemory.hydrate(homeId, nextPref.lightMemories?.[homeId]);
        if (JSON.stringify(nextPref) !== JSON.stringify(preferences)) {
          preferences = nextPref;
          for (const listener of preferenceListeners) listener();
        }
      }

      entityTargets.clear();
      sceneTargets.clear();
      const statesMap = stateRes.states ?? {};
      const nowIso = new Date().toISOString();
      const states: HassEntity[] = [];
      const entities: Array<Record<string, unknown>> = [];
      const devicesReg: Array<Record<string, unknown>> = [];

      for (const dev of devRes.devices ?? []) {
        devicesReg.push({
          id: dev.id,
          name: dev.name,
          area_id: dev.roomId ?? dev.areaId ?? null,
        });
        for (const ep of dev.endpoints ?? []) {
          const caps = (ep.capabilities ?? []).map((c) => c.id);
          const entityId = mapEndpointEntityId(dev, ep.id, caps);
          const friendlyName = ep.name || dev.name;
          entityTargets.set(entityId, {
            deviceId: dev.id,
            endpointId: ep.id,
            capabilities: caps,
            friendlyName,
          });
          entities.push({
            entity_id: entityId,
            device_id: dev.id,
            area_id: dev.roomId ?? dev.areaId ?? null,
            original_name: friendlyName,
          });
          states.push(
            projectEndpointState(
              entityId,
              friendlyName,
              statesMap[ep.id] ?? {},
              dev.availability === 'offline',
              nowIso,
            ),
          );
        }
      }

      for (const sc of sceneRes.scenes ?? []) {
        const entityId = `scene.${sc.id.replace(/[^a-z0-9_]/gi, '_').toLowerCase()}`;
        sceneTargets.set(entityId, sc.id);
        entities.push({
          entity_id: entityId,
          area_id: sc.roomId ?? null,
          original_name: sc.name,
        });
        states.push({
          entity_id: entityId,
          state: 'scening',
          attributes: { friendly_name: sc.name, ...(sc.icon ? { icon: sc.icon } : {}) },
          last_changed: nowIso,
          last_updated: nowIso,
        });
      }

      const decoded = decodeHaSnapshot({
        states,
        areas: (roomRes.rooms ?? []).map((r) => ({ area_id: r.id, name: r.name })),
        devices: devicesReg,
        entities,
        config: { location_name: hubName, version: 'haus-hub' },
        user: { name: 'Haus Mobile', is_admin: manager.getSession()?.clientRole === 'admin' },
        services: HUB_SERVICES,
      });
      if (decoded) {
        store.getState().syncLiveSnapshot(homeId, decoded);
      }
    } catch {
      // Preserve last known state and active optimistic overlays until next poll or failover.
    }
  };

  await store.getState().connectHome(homeId);
  await refreshSnapshot();

  const setActive = (active: boolean) => {
    foreground = active;
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = undefined;
    if (alive && foreground && pollIntervalMs > 0) {
      void refreshSnapshot();
      pollTimer = setInterval(() => void refreshSnapshot(), pollIntervalMs);
    }
  };
  setActive(true);

  return {
    store,
    session: {
      url: homeId,
      name: hubName,
      clientId: 'haus-hub',
      refreshToken: 'hub-session',
    },
    get preferences() {
      return preferences;
    },
    subscribePreferences(listener) {
      preferenceListeners.add(listener);
      return () => preferenceListeners.delete(listener);
    },
    setActive,
    async reconnect() {
      await manager.reconnect();
      await refreshSnapshot();
    },
    async logout() {
      alive = false;
      if (pollTimer) clearInterval(pollTimer);
      preferenceListeners.clear();
      store.getState().dispose();
      await manager.logout();
    },
    dispose() {
      alive = false;
      if (pollTimer) clearInterval(pollTimer);
      preferenceListeners.clear();
      store.getState().dispose();
    },
  };
}

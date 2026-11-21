/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { NativeEvent } from '../../../shared/native';
import type { HomeCache } from '../../home-cache';
import type { HubCommand } from '../commands';
import { buildView } from '../entities';
import {
  isRecord,
  parseDevices,
  parseRooms,
  parseStates,
  type CompatView,
  type HubDevice,
  type HubRoom,
} from '../types';
import type { HubRulesBridge } from './hub-automations';
import { diffCompatStates } from './hub-registry';

export interface HubStateDeltaInput {
  readonly devices: readonly HubDevice[];
  readonly rooms: readonly HubRoom[];
  readonly cachedEntries: ReadonlyArray<{ entry_id?: unknown; domain?: unknown }>;
  readonly knownEndpointIds: ReadonlySet<string>;
  readonly latestStates: Readonly<Record<string, Record<string, unknown>>>;
  readonly changes: Readonly<Record<string, Record<string, unknown>>>;
  readonly beforeView: CompatView;
  readonly rules: HubRulesBridge;
  readonly homeCache: HomeCache;
  readonly emit: (event: NativeEvent) => void;
}

export type HubStateDeltaResult =
  | { readonly needsRefresh: true; readonly emitted: 0 }
  | {
      readonly needsRefresh: false;
      readonly states: Record<string, Record<string, unknown>>;
      readonly view: CompatView;
      readonly emitted: number;
    };

/**
 * Applies pushed endpoint state deltas directly against the cached Hub device view
 * without any HTTP round-trips. Falls back to a full refresh if an unknown endpoint appears.
 */
export function applyHubStateDelta(input: HubStateDeltaInput): HubStateDeltaResult {
  const entries = Object.entries(input.changes);
  if (entries.length === 0) {
    return {
      needsRefresh: false,
      states: { ...input.latestStates },
      view: input.beforeView,
      emitted: 0,
    };
  }
  if (input.devices.length === 0) return { needsRefresh: true, emitted: 0 };

  for (const [endpointId] of entries) {
    if (!input.knownEndpointIds.has(endpointId) && !(endpointId in input.latestStates)) {
      return { needsRefresh: true, emitted: 0 };
    }
  }

  const nextStates: Record<string, Record<string, unknown>> = { ...input.latestStates };
  for (const [endpointId, patch] of entries) {
    nextStates[endpointId] = { ...patch };
  }
  const deviceView = buildView(
    [...input.devices],
    nextStates,
    undefined,
    [...input.cachedEntries],
    [...input.rooms],
  );
  const nextView = input.rules.applyView(deviceView);
  input.homeCache.record('get_states', nextView.states);
  const emitted = emitHubViewStateDiffs(input.beforeView, nextView, input.homeCache, input.emit);
  return { needsRefresh: false, states: nextStates, view: nextView, emitted };
}

/** Records updated states/registries in HomeCache and emits compat HA events for diffs. */
export function publishHubViewUpdate(params: {
  readonly before: CompatView;
  readonly next: CompatView;
  readonly registryChanged: boolean;
  readonly homeCache: HomeCache;
  readonly emit: (event: NativeEvent) => void;
}): number {
  params.homeCache.record('get_states', params.next.states);
  if (params.registryChanged) {
    params.homeCache.record('config/area_registry/list', params.next.areas);
    params.homeCache.record('config/device_registry/list', params.next.devices);
    params.homeCache.record('config/entity_registry/list', params.next.entities);
    params.emit({ type: 'ha-event', event: { event_type: 'device_registry_updated', data: {} } });
    return 0;
  }
  return emitHubViewStateDiffs(params.before, params.next, params.homeCache, params.emit);
}

function emitHubViewStateDiffs(
  before: CompatView,
  next: CompatView,
  homeCache: HomeCache,
  emit: (event: NativeEvent) => void,
): number {
  const diffs = diffCompatStates(before.states, next.states);
  for (const change of diffs) {
    homeCache.state(change);
    emit({ type: 'ha-event', event: { event_type: 'state_changed', data: change } });
  }
  return diffs.length;
}

/** Collects endpoint IDs across all cached Hub devices for O(1) delta validation. */
export function collectKnownEndpointIds(devices: readonly HubDevice[]): Set<string> {
  const ids = new Set<string>();
  for (const device of devices) {
    for (const endpoint of device.endpoints) {
      if (endpoint.id) ids.add(endpoint.id);
    }
  }
  return ids;
}

/**
 * Dispatches multi-device commands in parallel across distinct devices while preserving
 * strict FIFO order for multiple commands targeting the same device.
 */
export async function dispatchHubCommandsParallel(
  commands: readonly HubCommand[],
  send: (deviceId: string, body: Omit<HubCommand, 'deviceId'>) => Promise<unknown>,
): Promise<Record<string, Record<string, unknown>>> {
  const byDevice = new Map<string, HubCommand[]>();
  for (const cmd of commands) {
    let bucket = byDevice.get(cmd.deviceId);
    if (!bucket) {
      bucket = [];
      byDevice.set(cmd.deviceId, bucket);
    }
    bucket.push(cmd);
  }

  const receiptStates: Record<string, Record<string, unknown>> = {};
  await Promise.all(
    [...byDevice.entries()].map(async ([deviceId, queue]) => {
      for (const { deviceId: _ignored, ...body } of queue) {
        const response = await send(deviceId, body);
        if (isRecord(response) && isRecord(response.state) && Object.keys(response.state).length) {
          const endpointId =
            typeof response.endpointId === 'string' && response.endpointId
              ? response.endpointId
              : body.endpointId;
          receiptStates[endpointId] = response.state;
        }
      }
    }),
  );
  return receiptStates;
}

/** Coalesces concurrent Hub refresh calls while preserving any pending `force: true` request. */
export class CoalescedHubRefresh {
  private inFlight?: Promise<void>;
  private pendingForce?: boolean;

  constructor(private readonly execute: (force: boolean) => Promise<void>) {}

  run(force: boolean): Promise<void> {
    if (this.inFlight) {
      this.pendingForce = (this.pendingForce ?? false) || force;
      return this.inFlight;
    }
    const runLoop = async (initialForce: boolean): Promise<void> => {
      let nextForce: boolean | undefined = initialForce;
      while (nextForce !== undefined) {
        const currentForce = nextForce;
        this.pendingForce = undefined;
        await this.execute(currentForce);
        nextForce = this.pendingForce;
      }
    };
    const promise = runLoop(force).finally(() => {
      if (this.inFlight === promise) this.inFlight = undefined;
    });
    this.inFlight = promise;
    return promise;
  }

  /** Awaits any active refresh or triggers an initial load so registry/state reads stay atomic. */
  ensureLoaded(isLoaded: () => boolean): Promise<void> {
    if (this.inFlight) return this.inFlight;
    if (isLoaded()) return Promise.resolve();
    return this.run(false);
  }

  reset(): void {
    this.pendingForce = undefined;
  }
}

export interface HubRefreshSnapshotState {
  devices: HubDevice[];
  rooms: HubRoom[];
  knownEndpointIds: Set<string>;
  cachedEntries: Array<{ entry_id?: unknown; domain?: unknown }>;
  latestStates: Record<string, Record<string, unknown>>;
  devicesAt: number;
  view: CompatView;
}

/** Parses fetched Hub refresh payloads, rebuilds CompatView, and emits state or registry events. */
export function applyHubRefreshPayloads(params: {
  readonly state: HubRefreshSnapshotState;
  readonly devicesBody: unknown;
  readonly roomsBody: unknown;
  readonly statesBody: unknown;
  readonly integrationsBody: unknown;
  readonly nextRules: Parameters<HubRulesBridge['applyView']>[1];
  readonly rules: HubRulesBridge;
  readonly homeCache: HomeCache;
  readonly emit: (event: NativeEvent) => void;
}): void {
  const { state } = params;
  const before = state.view;
  const hadLoaded = state.devicesAt > 0;
  let registryChanged = false;
  if (
    params.integrationsBody &&
    isRecord(params.integrationsBody) &&
    Array.isArray(params.integrationsBody.entries)
  ) {
    state.cachedEntries = params.integrationsBody.entries as Array<{
      entry_id?: unknown;
      domain?: unknown;
    }>;
  }
  if (params.devicesBody !== undefined) {
    const devices = parseDevices(params.devicesBody);
    registryChanged = hadLoaded && JSON.stringify(devices) !== JSON.stringify(state.devices);
    state.devices = devices;
    state.knownEndpointIds = collectKnownEndpointIds(devices);
    state.devicesAt = Date.now();
  }
  if (params.roomsBody !== undefined) {
    const rooms = parseRooms(params.roomsBody);
    if (hadLoaded && JSON.stringify(rooms) !== JSON.stringify(state.rooms)) {
      registryChanged = true;
    }
    state.rooms = rooms;
  }
  state.latestStates = parseStates(params.statesBody);
  const deviceView = buildView(
    state.devices,
    state.latestStates,
    undefined,
    state.cachedEntries,
    state.rooms,
  );
  state.view = params.rules.applyView(deviceView, params.nextRules);
  publishHubViewUpdate({
    before,
    next: state.view,
    registryChanged,
    homeCache: params.homeCache,
    emit: params.emit,
  });
}

export function createInitialHubRefreshState(): HubRefreshSnapshotState {
  return {
    devices: [],
    rooms: [],
    latestStates: {},
    knownEndpointIds: new Set(),
    cachedEntries: [],
    devicesAt: 0,
    view: { states: [], devices: [], entities: [], areas: [], bindings: new Map() },
  };
}

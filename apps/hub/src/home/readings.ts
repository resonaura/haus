/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { isDeepStrictEqual } from 'node:util';
import type { HausDevice, HausEndpoint, SourceServiceRef, TriggerEvent } from '@haus/core';
import type { LiveService } from '../live/types.js';
import type { StandaloneHomePersistence } from './home.persistence.js';

export function buildEndpointStatePatchUpdate(
  canonicalEpId: string,
  prev: Readonly<Record<string, unknown>> | undefined,
  previousState: Readonly<Record<string, unknown>> | undefined,
  patch: Readonly<Record<string, unknown>>,
  dispatchTriggers: boolean,
): { readonly current: Record<string, unknown>; readonly pending: TriggerEvent[] } | undefined {
  const baseline = previousState ?? prev;
  const entries = Object.entries(patch);
  if (
    prev !== undefined &&
    entries.every(([k, v]) => isDeepStrictEqual(prev[k], v) && isDeepStrictEqual(baseline?.[k], v))
  ) {
    return undefined;
  }
  const current = { ...prev, ...patch };
  const pending: TriggerEvent[] = [];
  if (dispatchTriggers) {
    for (const [prop, val] of entries) {
      const prevVal = baseline?.[prop];
      if (prevVal === val) continue;
      pending.push({
        type: 'state',
        endpointId: canonicalEpId,
        property: prop,
        ...(prevVal !== undefined ? { from: prevVal } : {}),
        to: val,
      });
    }
  }
  return { current, pending };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function findEndpointDevice(
  devices: readonly HausDevice[],
  endpointId: string,
): HausDevice | undefined {
  return devices.find((device) => device.endpoints.some((endpoint) => endpoint.id === endpointId));
}

export function acceptsReadingForEndpoint(
  endpoint: HausEndpoint | undefined,
  source?: SourceServiceRef,
): boolean {
  const owner = endpoint?.sourceOwner;
  return Boolean(
    endpoint &&
    (!source ||
      !owner ||
      (owner.protocol === source.protocol &&
        owner.externalId === source.externalId &&
        owner.domain === source.domain)),
  );
}

export function acceptsReading(
  devices: readonly HausDevice[],
  id: string,
  source?: SourceServiceRef,
): boolean {
  const endpoint = findEndpointDevice(devices, id)?.endpoints.find((item) => item.id === id);
  return acceptsReadingForEndpoint(endpoint, source);
}

/** Preserve known state while accepting canonical and legacy endpoint readings. */
export function mergeEndpointReadings(
  current: Record<string, unknown>,
  readings: unknown,
): Record<string, unknown> {
  const next = { ...current };
  if (Array.isArray(readings)) {
    for (const reading of readings) {
      if (record(reading) && typeof reading.capabilityId === 'string')
        next[reading.capabilityId] = reading.value;
    }
  } else if (record(readings)) {
    for (const [key, reading] of Object.entries(readings)) {
      next[key] = record(reading) && 'value' in reading ? reading.value : reading;
    }
  }
  return next;
}

function stripReadingMetadataFromDevice(device: HausDevice): Record<string, unknown> {
  const { endpoints, services, ...rest } = device;
  return {
    ...rest,
    endpoints: endpoints.map(({ readings: _readings, ...epRest }) => epRest),
    ...(services !== undefined
      ? {
          services: services.map((service) => ({
            ...service,
            characteristics: service.characteristics.map((char) => {
              const { value: _value, metadata, ...charRest } = char;
              if (!metadata) return charRest;
              const { observedAt: _observedAt, freshness: _freshness, ...metaRest } = metadata;
              return { ...charRest, metadata: metaRest };
            }),
          })),
        }
      : {}),
  };
}

function omitUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(omitUndefined);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) out[key] = omitUndefined(item);
    }
    return out;
  }
  return value;
}

/** True when two normalized devices share identical persisted metadata, ignoring live readings. */
export function devicePersistedMetadataEqual(a: HausDevice, b: HausDevice): boolean {
  if (a === b) return true;
  if (
    a.id !== b.id ||
    a.name !== b.name ||
    a.availability !== b.availability ||
    a.roomId !== b.roomId ||
    a.areaId !== b.areaId ||
    a.category !== b.category ||
    a.deviceType !== b.deviceType ||
    a.manufacturer !== b.manufacturer ||
    a.model !== b.model ||
    a.endpoints.length !== b.endpoints.length ||
    (a.services?.length ?? 0) !== (b.services?.length ?? 0)
  ) {
    return false;
  }
  return isDeepStrictEqual(
    omitUndefined(stripReadingMetadataFromDevice(a)),
    omitUndefined(stripReadingMetadataFromDevice(b)),
  );
}

export class EndpointReadings {
  constructor(
    private readonly states: Map<string, Record<string, unknown>>,
    private readonly store: Pick<StandaloneHomePersistence, 'save' | 'remove'>,
    private readonly onStateUpdated?: (
      endpointId: string,
      fullState: Record<string, unknown>,
      patch: Record<string, unknown>,
    ) => void,
  ) {}

  remove(endpointId: string): void {
    this.states.delete(endpointId);
    void this.store.remove('endpoint_state', endpointId);
  }

  replace(previous: readonly HausEndpoint[], next: readonly HausEndpoint[]): void {
    const retained = new Set(next.map((endpoint) => endpoint.id));
    for (const endpoint of previous) {
      if (!retained.has(endpoint.id)) this.remove(endpoint.id);
    }
    for (const endpoint of next) {
      const hadPrev = this.states.has(endpoint.id);
      const prev = this.states.get(endpoint.id) ?? {};
      const state = mergeEndpointReadings(prev, endpoint.readings);
      if (hadPrev && isDeepStrictEqual(prev, state)) continue;
      this.states.set(endpoint.id, state);
      void this.store.save('endpoint_state', endpoint.id, state);
      if (Object.keys(state).length > 0 && !isDeepStrictEqual(prev, state)) {
        this.onStateUpdated?.(endpoint.id, state, state);
      }
    }
  }
}

/**
 * Coalesces same-tick endpoint state deltas via microtask (0ms timer wait) and pushes them
 * directly over LiveService so frontends update immediately without full snapshot reloads.
 */
export class LiveDevicePublisher {
  private readonly pendingStates = new Map<string, Record<string, unknown>>();
  private pendingRegistry = false;
  private microtaskScheduled = false;
  private immediateHandle?: NodeJS.Immediate;

  constructor(
    private readonly liveService: LiveService | undefined,
    private readonly listeners: ReadonlySet<() => void>,
  ) {}

  publishState(endpointId: string, fullState: Record<string, unknown>): void {
    this.pendingStates.set(endpointId, { ...fullState });
    if (this.microtaskScheduled) return;
    this.microtaskScheduled = true;
    queueMicrotask(() => {
      this.microtaskScheduled = false;
      this.flush();
    });
  }

  publishRegistry(): void {
    this.pendingRegistry = true;
    if (this.immediateHandle || this.microtaskScheduled) return;
    this.immediateHandle = setImmediate(() => {
      this.immediateHandle = undefined;
      this.flush();
    });
    this.immediateHandle.unref();
  }

  close(): void {
    if (this.immediateHandle) {
      clearImmediate(this.immediateHandle);
      this.immediateHandle = undefined;
    }
    this.pendingStates.clear();
    this.pendingRegistry = false;
  }

  private flush(): void {
    if (this.immediateHandle) {
      clearImmediate(this.immediateHandle);
      this.immediateHandle = undefined;
    }
    const registryChanged = this.pendingRegistry;
    this.pendingRegistry = false;
    const stateChanges =
      this.pendingStates.size > 0 ? Object.fromEntries(this.pendingStates.entries()) : undefined;
    this.pendingStates.clear();
    if (!registryChanged && !stateChanges) return;

    this.liveService?.publish('devices', {
      ...(stateChanges ? { stateChanges } : {}),
      registryChanged,
    });
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        process.emitWarning('home_device_listener_failed');
      }
    }
  }
}

export function readEndpointProperty(
  state: Readonly<Record<string, unknown>> | undefined,
  property: string,
): unknown {
  if (!state) return undefined;
  if (property in state) return state[property];
  if (property === 'power' && 'on_off' in state) return state.on_off;
  if (property === 'on_off' && typeof state.power === 'boolean') return state.power;
  return state.state ?? state.value;
}

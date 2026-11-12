/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { HausDevice, HausEndpoint, SourceServiceRef } from '@haus/core';
import type { StandaloneHomePersistence } from './home.persistence.js';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function findEndpointDevice(
  devices: readonly HausDevice[],
  endpointId: string,
): HausDevice | undefined {
  return devices.find((device) => device.endpoints.some((endpoint) => endpoint.id === endpointId));
}

export function acceptsReading(
  devices: readonly HausDevice[],
  id: string,
  source?: SourceServiceRef,
): boolean {
  const endpoint = findEndpointDevice(devices, id)?.endpoints.find((item) => item.id === id);
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

export class EndpointReadings {
  constructor(
    private readonly states: Map<string, Record<string, unknown>>,
    private readonly store: Pick<StandaloneHomePersistence, 'save' | 'remove'>,
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
      const state = mergeEndpointReadings(this.states.get(endpoint.id) ?? {}, endpoint.readings);
      this.states.set(endpoint.id, state);
      void this.store.save('endpoint_state', endpoint.id, state);
    }
  }
}

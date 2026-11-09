/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

/** The slice of a Hub device the desktop compatibility view relies on. */
export interface HubCapability {
  id: string;
  kind: string;
  operations: string[];
}

export interface HubEndpoint {
  id: string;
  name: string;
  capabilities: HubCapability[];
}

export interface HubDevice {
  id: string;
  name: string;
  category: string;
  roomId?: string;
  availability: string;
  manufacturer?: string;
  model?: string;
  protocol?: string;
  endpoints: HubEndpoint[];
}

export type EndpointStates = Record<string, Record<string, unknown>>;

export interface EntityBinding {
  deviceId: string;
  endpointId: string;
  capability: HubCapability;
  domain: string;
}

export interface CompatEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
}

export interface CompatView {
  states: CompatEntity[];
  devices: Record<string, unknown>[];
  entities: Record<string, unknown>[];
  areas: Record<string, unknown>[];
  bindings: Map<string, EntityBinding>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value ? value : undefined;

function parseCapability(value: unknown): HubCapability | undefined {
  if (!isRecord(value)) return undefined;
  const id = text(value.id);
  if (!id) return undefined;
  const operations = Array.isArray(value.operations)
    ? value.operations.filter((item): item is string => typeof item === 'string')
    : [];
  return { id, kind: text(value.kind) ?? 'custom', operations };
}

function parseEndpoint(value: unknown): HubEndpoint | undefined {
  if (!isRecord(value)) return undefined;
  const id = text(value.id);
  if (!id) return undefined;
  const capabilities = Array.isArray(value.capabilities)
    ? value.capabilities.flatMap((item) => parseCapability(item) ?? [])
    : [];
  return { id, name: text(value.name) ?? id, capabilities };
}

/** Untrusted Hub payloads are validated field by field; malformed devices are dropped. */
export function parseDevices(value: unknown): HubDevice[] {
  const list = isRecord(value) && Array.isArray(value.devices) ? value.devices : [];
  return list.flatMap((item): HubDevice[] => {
    if (!isRecord(item)) return [];
    const id = text(item.id);
    if (!id) return [];
    const connectivity = isRecord(item.connectivity) ? item.connectivity : {};
    return [
      {
        id,
        name: text(item.name) ?? id,
        category: text(item.category) ?? 'other',
        roomId: text(item.roomId),
        availability: text(item.availability) ?? 'online',
        manufacturer: text(item.manufacturer),
        model: text(item.model),
        protocol: text(connectivity.protocol),
        endpoints: Array.isArray(item.endpoints)
          ? item.endpoints.flatMap((endpoint) => parseEndpoint(endpoint) ?? [])
          : [],
      },
    ];
  });
}

export function parseStates(value: unknown): EndpointStates {
  const source = isRecord(value) && isRecord(value.states) ? value.states : {};
  const result: EndpointStates = {};
  for (const [id, state] of Object.entries(source)) if (isRecord(state)) result[id] = state;
  return result;
}

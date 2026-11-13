/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

/** The slice of a Hub device the desktop compatibility view relies on. */
export interface HubCapability {
  id: string;
  kind: string;
  operations: string[];
  name?: string;
  unit?: string;
  minimum?: number;
  maximum?: number;
  step?: number;
  displayPrecision?: number;
  choices?: string[];
  deviceClass?: string;
  entityCategory?: 'config' | 'diagnostic';
  icon?: string;
  supportedColorModes?: string[];
  effectList?: string[];
}

export interface HubEndpoint {
  id: string;
  mediaId?: string;
  hasCameraSource?: boolean;
  availability?: string;
  name: string;
  capabilities: HubCapability[];
}

export interface HubDevice {
  id: string;
  sourceInstanceId?: string;
  name: string;
  category: string;
  roomId?: string;
  availability: string;
  manufacturer?: string;
  model?: string;
  firmwareVersion?: string;
  hardwareVersion?: string;
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

import type { PairingGrant } from '@haus/core/pairing';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function isGrant(value: unknown): value is PairingGrant {
  return (
    isRecord(value) &&
    ['grantId', 'hubId', 'homeId', 'clientId', 'clientRole', 'clientName'].every(
      (key) => typeof value[key] === 'string',
    ) &&
    typeof value.issuedAt === 'number' &&
    typeof value.revoked === 'boolean'
  );
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value ? value : undefined;

const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const strArray = (value: unknown): string[] | undefined =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : undefined;

function parseCapability(value: unknown): HubCapability | undefined {
  if (!isRecord(value)) return undefined;
  const id = text(value.id);
  if (!id) return undefined;
  const operations = strArray(value.operations) ?? [];
  const rawCat = text(value.entityCategory);
  const entityCategory = rawCat === 'config' || rawCat === 'diagnostic' ? rawCat : undefined;
  return {
    id,
    kind: text(value.kind) ?? 'custom',
    operations,
    name: text(value.name),
    unit: text(value.unit),
    minimum: num(value.minimum),
    maximum: num(value.maximum),
    step: num(value.step),
    displayPrecision:
      Number.isSafeInteger(value.displayPrecision) && Number(value.displayPrecision) >= 0
        ? Number(value.displayPrecision)
        : undefined,
    choices: strArray(value.choices),
    deviceClass: text(value.deviceClass),
    entityCategory,
    icon: text(value.icon),
    supportedColorModes: strArray(value.supportedColorModes),
    effectList: strArray(value.effectList),
  };
}

function parseEndpoint(value: unknown): HubEndpoint | undefined {
  if (!isRecord(value)) return undefined;
  const id = text(value.id);
  if (!id) return undefined;
  const capabilities = Array.isArray(value.capabilities)
    ? value.capabilities.flatMap((item) => parseCapability(item) ?? [])
    : [];
  const mediaId = text(value.mediaId);
  const hasCameraSource =
    Array.isArray(value.sourceRefs) &&
    value.sourceRefs.some(
      (ref) => isRecord(ref) && (ref.domain === 'camera' || ref.protocol === 'virtual'),
    );
  return {
    id,
    name: text(value.name) ?? id,
    capabilities,
    availability: text(value.availability),
    ...(hasCameraSource ? { hasCameraSource: true } : {}),
    ...(mediaId && /^camera\.[a-z0-9_]+$/.test(mediaId) ? { mediaId } : {}),
  };
}

/** Untrusted Hub payloads are validated field by field; malformed devices are dropped. */
export function parseDevices(value: unknown): HubDevice[] {
  const list = isRecord(value) && Array.isArray(value.devices) ? value.devices : [];
  return list.flatMap((item): HubDevice[] => {
    if (!isRecord(item)) return [];
    const id = text(item.id);
    if (!id) return [];
    const connectivity = isRecord(item.connectivity) ? item.connectivity : {};
    const source = isRecord(item.source) ? item.source : {};
    const sourceInstanceId = text(source.instanceId);
    return [
      {
        id,
        ...(sourceInstanceId ? { sourceInstanceId } : {}),
        name: text(item.name) ?? id,
        category: text(item.category) ?? 'other',
        roomId: text(item.roomId),
        availability: text(item.availability) ?? 'online',
        manufacturer: text(item.manufacturer),
        model: text(item.model),
        firmwareVersion: text(item.firmwareVersion),
        hardwareVersion: text(item.hardwareVersion),
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

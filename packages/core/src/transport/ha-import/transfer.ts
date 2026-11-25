/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { asRecord } from '../automations/types.js';
import {
  MAX_HA_DATA_TRANSFER_BYTES,
  type HaDataImportProgress,
  type HaDataImportResult,
  type HaImportArea,
  type HaImportEntry,
  type HaImportSubentry,
  type HaImportSummary,
} from './types.js';

function parseRecords(value: unknown, label: string): Record<string, unknown>[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`The ${label} list is invalid.`);
  return value.map((item) => {
    const parsed = asRecord(item);
    if (!parsed) throw new Error(`The ${label} list is invalid.`);
    return parsed;
  });
}

export function parseHaImportEntry(value: unknown): HaImportEntry {
  const source = asRecord(value);
  const entry = asRecord(source?.entry);
  const data = asRecord(entry?.data);
  const options = entry?.options === undefined ? undefined : asRecord(entry.options);
  const rawSubentries = entry?.subentries;
  if (
    rawSubentries !== undefined &&
    (!Array.isArray(rawSubentries) || rawSubentries.length > 100)
  ) {
    throw new Error('The integration subentries are invalid.');
  }
  const subentryIds = new Set<string>();
  const subentryUniqueIds = new Set<string>();
  const subentries: HaImportSubentry[] | undefined = rawSubentries?.map((raw) => {
    const subentry = asRecord(raw);
    const subentryData = asRecord(subentry?.data);
    if (
      !subentry ||
      typeof subentry.subentryId !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(subentry.subentryId) ||
      subentryIds.has(subentry.subentryId) ||
      typeof subentry.subentryType !== 'string' ||
      !/^[a-z0-9_]{1,128}$/.test(subentry.subentryType) ||
      typeof subentry.title !== 'string' ||
      !subentry.title.trim() ||
      subentry.title.length > 256 ||
      !subentryData ||
      (subentry.uniqueId !== undefined &&
        subentry.uniqueId !== null &&
        (typeof subentry.uniqueId !== 'string' ||
          subentry.uniqueId.length > 1024 ||
          subentryUniqueIds.has(subentry.uniqueId)))
    ) {
      throw new Error('The integration subentries are invalid.');
    }
    subentryIds.add(subentry.subentryId);
    if (typeof subentry.uniqueId === 'string') subentryUniqueIds.add(subentry.uniqueId);
    return {
      subentryId: subentry.subentryId,
      subentryType: subentry.subentryType,
      title: subentry.title,
      data: subentryData,
      ...(typeof subentry.uniqueId === 'string' || subentry.uniqueId === null
        ? { uniqueId: subentry.uniqueId }
        : {}),
    };
  });
  if (
    !entry ||
    typeof entry.entryId !== 'string' ||
    typeof entry.domain !== 'string' ||
    !/^[a-z0-9_]{1,128}$/.test(entry.domain) ||
    typeof entry.title !== 'string' ||
    !data ||
    (entry.options !== undefined && !options) ||
    entry.disabledBy !== 'user'
  ) {
    throw new Error('This file is not a supported, disabled Home Assistant transfer bundle.');
  }

  const entities = parseRecords(source?.entities, 'entity');
  if (
    entities.some(
      (entity) =>
        entity.config_subentry_id !== undefined &&
        entity.config_subentry_id !== null &&
        (typeof entity.config_subentry_id !== 'string' ||
          !subentryIds.has(entity.config_subentry_id)),
    )
  ) {
    throw new Error('An entity refers to an integration subentry that is missing.');
  }
  const devices = parseRecords(source?.devices, 'device');
  if (
    devices.some(
      (device) =>
        device.config_subentry_id !== undefined &&
        device.config_subentry_id !== null &&
        (typeof device.config_subentry_id !== 'string' ||
          !subentryIds.has(device.config_subentry_id)),
    )
  ) {
    throw new Error('A device refers to an integration subentry that is missing.');
  }
  const areaRows = parseRecords(source?.areas, 'area');
  const areas: HaImportArea[] = areaRows.map((area) => {
    if (typeof area.id !== 'string' || typeof area.name !== 'string') {
      throw new Error('The area list is invalid.');
    }
    return { id: area.id, name: area.name };
  });
  const uniqueId = entry.uniqueId;
  const version = entry.version;
  const minorVersion = entry.minorVersion;
  if (
    (uniqueId !== undefined && uniqueId !== null && typeof uniqueId !== 'string') ||
    (version !== undefined && typeof version !== 'number') ||
    (minorVersion !== undefined && typeof minorVersion !== 'number')
  ) {
    throw new Error('The integration metadata is invalid.');
  }

  return {
    entry: {
      entryId: entry.entryId,
      domain: entry.domain,
      title: entry.title,
      data,
      ...(options ? { options } : {}),
      ...(typeof uniqueId === 'string' || uniqueId === null ? { uniqueId } : {}),
      ...(typeof version === 'number' ? { version } : {}),
      ...(typeof minorVersion === 'number' ? { minorVersion } : {}),
      ...(subentries !== undefined ? { subentries } : {}),
      disabledBy: 'user',
    },
    ...(entities.length ? { entities } : {}),
    ...(devices.length ? { devices } : {}),
    ...(areas.length ? { areas } : {}),
  };
}

export function parseHaImportBundleText(rawText: string, byteLength?: number): HaImportEntry[] {
  const bytes = byteLength ?? new TextEncoder().encode(rawText).byteLength;
  if (bytes > MAX_HA_DATA_TRANSFER_BYTES) {
    throw new Error('The transfer file exceeds 80 KB.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error('Choose a Home Assistant transfer JSON file.');
  }
  const bundle = asRecord(parsed);
  if (!bundle || !Array.isArray(bundle.entries) || bundle.entries.length === 0) {
    throw new Error('Choose a Home Assistant transfer JSON file.');
  }
  return bundle.entries.map(parseHaImportEntry);
}

export function buildHaImportSummaries(entries: readonly HaImportEntry[]): HaImportSummary[] {
  return entries.map((item) => ({
    id: item.entry.entryId,
    domain: item.entry.domain,
    title: item.entry.title,
    devices: item.devices?.length ?? 0,
    entities: item.entities?.length ?? 0,
  }));
}

export function describeHaImportFailure(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : '';
  if (message.includes('integration_entry_identity_conflict')) {
    return 'This physical integration already has an owner on Miku. The HA copy was left active.';
  }
  if (message.includes('integration_entity_conflict')) {
    return 'One or more entity IDs are already owned on Miku. Haus did not switch ownership; HA remains active.';
  }
  if (message.includes('integration_entry_conflict')) {
    return 'Miku already has a different copy of this integration entry. The HA copy was left active.';
  }
  if (message.includes('ha_flow_runtime_unavailable')) {
    return 'Miku could not start the integration runtime. HA remains active.';
  }
  if (message.includes('unsupported_import_domain')) {
    return 'Miku does not support this Home Assistant integration. The HA copy was left active.';
  }
  return message || 'Import stopped before completion.';
}

export async function stageHaImportEntries(
  entries: readonly HaImportEntry[],
  stageEntry: (entry: HaImportEntry) => Promise<unknown>,
  onProgress?: (progress: HaDataImportProgress) => void,
): Promise<HaDataImportResult> {
  let imported = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const item = entries[index];
    if (!item) throw new Error('The selected transfer data is no longer available.');
    await stageEntry(item);
    imported = index + 1;
    onProgress?.({ completed: imported });
  }
  return { completed: imported, imported };
}

export function buildDemoHaImportBundleJson(): string {
  return JSON.stringify(
    {
      entries: [
        {
          entry: {
            entryId: 'ha_hue_willow_bridge',
            domain: 'hue',
            title: 'Philips Hue Bridge',
            data: { host: '192.168.1.50' },
            disabledBy: 'user',
          },
          devices: [{ id: 'dev_hue_1', name: 'Corner lamp' }],
          entities: [{ entity_id: 'light.corner_lamp', device_id: 'dev_hue_1' }],
          areas: [{ id: 'living_room', name: 'Living Room' }],
        },
        {
          entry: {
            entryId: 'ha_mqtt_willow',
            domain: 'mqtt',
            title: 'Mosquitto Broker',
            data: { broker: '192.168.1.2' },
            disabledBy: 'user',
          },
          devices: [{ id: 'dev_mqtt_1', name: 'Front door lock' }],
          entities: [
            { entity_id: 'lock.front_door', device_id: 'dev_mqtt_1' },
            { entity_id: 'binary_sensor.front_door', device_id: 'dev_mqtt_1' },
          ],
          areas: [{ id: 'hallway', name: 'Hallway' }],
        },
      ],
    },
    null,
    2,
  );
}

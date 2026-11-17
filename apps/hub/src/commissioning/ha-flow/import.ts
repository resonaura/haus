/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { BadRequestException } from '@nestjs/common';
import type { HaEntryImport } from '@haus/kitsune';

const MAX_IMPORT_BYTES = 80 * 1024;
const MAX_ENTITIES = 600;
const MAX_DEVICES = 200;
const MAX_AREAS = 100;
const MAX_SUBENTRIES = 100;
const ENTITY_DISABLED_BY = new Set(['config_entry', 'device', 'hass', 'integration', 'user']);
const ENTITY_CATEGORIES = new Set(['config', 'diagnostic']);

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function boundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function safeJson(value: unknown, depth = 0): boolean {
  if (depth > 32) return false;
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
    return true;
  if (Array.isArray(value)) return value.every((item) => safeJson(item, depth + 1));
  const object = record(value);
  if (!object) return false;
  return Object.entries(object).every(
    ([key, item]) =>
      key !== '__proto__' &&
      key !== 'prototype' &&
      key !== 'constructor' &&
      safeJson(item, depth + 1),
  );
}

function optionalTextFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return fields.every(
    (field) =>
      value[field] === undefined || value[field] === null || typeof value[field] === 'string',
  );
}

function stringPairs(value: unknown): value is [string, string][] {
  return (
    Array.isArray(value) &&
    value.every(
      (pair: unknown) =>
        Array.isArray(pair) &&
        pair.length === 2 &&
        boundedString(pair[0], 1024) &&
        boundedString(pair[1], 1024),
    )
  );
}

function validateDevice(value: unknown, subentryIds: ReadonlySet<string>): boolean {
  const device = record(value);
  if (!device || !boundedString(device.id, 256)) return false;
  if (
    !optionalTextFields(device, [
      'name',
      'name_by_user',
      'manufacturer',
      'model',
      'sw_version',
      'hw_version',
      'configuration_url',
    ])
  )
    return false;
  const identifiers = device.identifiers;
  const connections = device.connections;
  if (identifiers !== undefined && !stringPairs(identifiers)) return false;
  if (connections !== undefined && !stringPairs(connections)) return false;
  return (
    (device.area_id === undefined ||
      device.area_id === null ||
      boundedString(device.area_id, 256)) &&
    (device.config_subentry_id === undefined ||
      device.config_subentry_id === null ||
      (boundedString(device.config_subentry_id, 128) && subentryIds.has(device.config_subentry_id)))
  );
}

function validateEntity(value: unknown, domain: string, subentryIds: ReadonlySet<string>): boolean {
  const entity = record(value);
  return Boolean(
    entity &&
    optionalTextFields(entity, [
      'name',
      'original_name',
      'icon',
      'device_class',
      'original_device_class',
      'original_icon',
      'unit_of_measurement',
      'entity_category',
      'translation_key',
    ]) &&
    (entity.has_entity_name === undefined || typeof entity.has_entity_name === 'boolean') &&
    (entity.supported_features === undefined ||
      (typeof entity.supported_features === 'number' &&
        Number.isSafeInteger(entity.supported_features))) &&
    boundedString(entity.entity_id, 256) &&
    /^[a-z0-9_]+\.[a-z0-9_]+$/.test(entity.entity_id) &&
    entity.platform === domain &&
    boundedString(entity.unique_id, 1024) &&
    (entity.disabled_by === undefined ||
      entity.disabled_by === null ||
      (typeof entity.disabled_by === 'string' && ENTITY_DISABLED_BY.has(entity.disabled_by))) &&
    (entity.entity_category === undefined ||
      entity.entity_category === null ||
      (typeof entity.entity_category === 'string' &&
        ENTITY_CATEGORIES.has(entity.entity_category))) &&
    (entity.device_id === undefined ||
      entity.device_id === null ||
      boundedString(entity.device_id, 256)) &&
    (entity.config_subentry_id === undefined ||
      entity.config_subentry_id === null ||
      (boundedString(entity.config_subentry_id, 128) &&
        subentryIds.has(entity.config_subentry_id))) &&
    (entity.area_id === undefined || entity.area_id === null || boundedString(entity.area_id, 256)),
  );
}

function parseSubentries(value: unknown): HaEntryImport['entry']['subentries'] {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_SUBENTRIES) {
    throw new BadRequestException({ error: 'invalid_import_subentries' });
  }
  const ids = new Set<string>();
  const uniqueIds = new Set<string>();
  return value.map((item) => {
    const row = record(item);
    const data = record(row?.data);
    if (
      !row ||
      !boundedString(row.subentryId, 128) ||
      !/^[a-zA-Z0-9_-]+$/.test(row.subentryId) ||
      ids.has(row.subentryId) ||
      !boundedString(row.subentryType, 128) ||
      !/^[a-z0-9_]+$/.test(row.subentryType) ||
      !boundedString(row.title, 256) ||
      !data ||
      (row.uniqueId !== undefined &&
        row.uniqueId !== null &&
        (typeof row.uniqueId !== 'string' ||
          row.uniqueId.length > 1024 ||
          uniqueIds.has(row.uniqueId)))
    ) {
      throw new BadRequestException({ error: 'invalid_import_subentries' });
    }
    ids.add(row.subentryId);
    if (typeof row.uniqueId === 'string') uniqueIds.add(row.uniqueId);
    return {
      subentryId: row.subentryId,
      subentryType: row.subentryType,
      title: row.title,
      data,
      ...(typeof row.uniqueId === 'string' || row.uniqueId === null
        ? { uniqueId: row.uniqueId }
        : {}),
    };
  });
}

function records(value: unknown, label: string, limit: number): Record<string, unknown>[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > limit) {
    throw new BadRequestException({ error: 'invalid_import_registry' });
  }
  const result: Record<string, unknown>[] = [];
  for (const item of value) {
    const row = record(item);
    if (!row) throw new BadRequestException({ error: 'invalid_import_registry', field: label });
    result.push(row);
  }
  return result;
}

export function parseHaEntryImport(value: unknown): HaEntryImport {
  let byteLength: number;
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== 'string') throw new Error('not_json');
    byteLength = Buffer.byteLength(serialized, 'utf8');
  } catch {
    throw new BadRequestException({ error: 'invalid_import_payload' });
  }
  if (byteLength > MAX_IMPORT_BYTES) {
    throw new BadRequestException({ error: 'import_payload_too_large' });
  }
  if (!safeJson(value)) throw new BadRequestException({ error: 'invalid_import_payload' });

  const root = record(value);
  const entry = record(root?.entry);
  const data = record(entry?.data);
  const options = entry?.options === undefined ? undefined : record(entry.options);
  const subentries = parseSubentries(entry?.subentries);
  const subentryIds = new Set(subentries?.map((subentry) => subentry.subentryId) ?? []);
  if (!entry || !data) throw new BadRequestException({ error: 'invalid_import_entry' });
  const domain = entry.domain;
  if (typeof domain !== 'string' || !/^[a-z0-9_]{1,128}$/.test(domain)) {
    throw new BadRequestException({ error: 'unsupported_import_domain' });
  }
  if (
    !boundedString(entry.entryId, 128) ||
    !/^[a-zA-Z0-9_-]+$/.test(entry.entryId) ||
    !boundedString(entry.title, 256) ||
    (entry.options !== undefined && !options) ||
    entry.disabledBy !== 'user'
  ) {
    throw new BadRequestException({ error: 'invalid_import_entry' });
  }

  const entities = records(root?.entities, 'entities', MAX_ENTITIES);
  const devices = records(root?.devices, 'devices', MAX_DEVICES);
  const rawAreas = records(root?.areas, 'areas', MAX_AREAS);
  const areas: { id: string; name: string }[] = [];
  const areaIds = new Set<string>();
  if (
    !entities.every((item) => validateEntity(item, domain, subentryIds)) ||
    !devices.every((item) => validateDevice(item, subentryIds))
  ) {
    throw new BadRequestException({ error: 'invalid_import_registry' });
  }
  for (const area of rawAreas) {
    if (!boundedString(area.id, 256) || !boundedString(area.name, 256) || areaIds.has(area.id)) {
      throw new BadRequestException({ error: 'invalid_import_registry' });
    }
    areaIds.add(area.id);
    areas.push({ id: area.id, name: area.name });
  }
  const deviceIds = new Set<string>();
  for (const device of devices) {
    if (!boundedString(device.id, 256) || deviceIds.has(device.id)) {
      throw new BadRequestException({ error: 'invalid_import_registry' });
    }
    if (
      typeof device.area_id === 'string' &&
      device.area_id.length > 0 &&
      !areaIds.has(device.area_id)
    ) {
      throw new BadRequestException({ error: 'invalid_import_registry' });
    }
    deviceIds.add(device.id);
  }
  const entityIds = new Set<string>();
  for (const entity of entities) {
    if (
      typeof entity.entity_id !== 'string' ||
      entityIds.has(entity.entity_id) ||
      (typeof entity.device_id === 'string' &&
        entity.device_id.length > 0 &&
        !deviceIds.has(entity.device_id)) ||
      (typeof entity.area_id === 'string' &&
        entity.area_id.length > 0 &&
        !areaIds.has(entity.area_id))
    ) {
      throw new BadRequestException({ error: 'invalid_import_registry' });
    }
    entityIds.add(entity.entity_id);
  }

  const uniqueId = entry.uniqueId;
  const version = entry.version;
  const minorVersion = entry.minorVersion;
  if (
    (uniqueId !== undefined && uniqueId !== null && typeof uniqueId !== 'string') ||
    (version !== undefined && (!Number.isSafeInteger(version) || Number(version) < 1)) ||
    (minorVersion !== undefined &&
      (!Number.isSafeInteger(minorVersion) || Number(minorVersion) < 0))
  ) {
    throw new BadRequestException({ error: 'invalid_import_entry' });
  }

  return {
    entry: {
      entryId: entry.entryId,
      domain,
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

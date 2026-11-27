/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  isLocalServerHostname as isLocalHostname,
  normalizeServerUrl,
  validateExternalUrl,
  validatePreferences,
} from '@haus/core/hub';
import { isRecord } from '@haus/core/record';
import { HACS_COMMANDS, validateHacsRequest } from './hacs-validation.js';

export {
  isLocalHostname,
  isRecord,
  normalizeServerUrl,
  validateExternalUrl,
  validatePreferences,
};

const REQUEST_TYPES = new Set([
  ...HACS_COMMANDS,
  'get_states',
  'search/related',
  'get_services',
  'get_config',
  'persistent_notification/get',
  'persistent_notification/subscribe',
  'repairs/list_issues',
  'repairs/ignore_issue',
  'repairs/get_issue_data',
  'haus/updates/list',
  'haus/updates/check',
  'haus/updates/install',
  'haus/discovery/scan',
  'haus/integration_meta',
  'config_entries/get',
  'config_entries/get_single',
  'config_entries/update',
  'config_entries/disable',
  'ha/config_entries/import',
  'config_entries/flow/progress',
  'config_entries/ignore_flow',
  'manifest/list',
  'manifest/get',
  'frontend/get_translations',
  'hassio/update/addon',
  'supervisor/api',
  'auth/current_user',
  'recorder/list_statistic_ids',
  'recorder/statistics_during_period',
  'history/history_during_period',
  'call_service',
  'config/area_registry/list',
  'config/area_registry/create',
  'config/area_registry/update',
  'config/area_registry/delete',
  'config/device_registry/list',
  'config/device_registry/update',
  'config/entity_registry/list',
  'config/entity_registry/get',
  'config/entity_registry/update',
  'config/floor_registry/list',
  'config/label_registry/list',
  'lovelace/dashboards/list',
  'lovelace/dashboards/create',
  'lovelace/dashboards/update',
  'lovelace/config',
  'lovelace/config/save',
  'automation/config',
  'script/config',
  'camera/capabilities',
  'generic_camera/start_preview',
  'camera/stream',
  'camera/web_rtc_offer',
  'camera/webrtc/get_client_config',
  'camera/webrtc/offer',
  'camera/webrtc/candidate',
]);
const HA_ENTITY_DISABLED_BY = new Set(['config_entry', 'device', 'hass', 'integration', 'user']);
const HA_ENTITY_CATEGORIES = new Set(['config', 'diagnostic']);

export function validateRequest(input: unknown): Record<string, unknown> {
  if (!isRecord(input) || typeof input.type !== 'string' || !REQUEST_TYPES.has(input.type)) {
    throw new Error('This Home Assistant command is not available in Haus.');
  }
  if (input.type.startsWith('hacs/')) validateHacsRequest(input);
  if ('id' in input || 'access_token' in input || 'refresh_token' in input) {
    throw new Error('Native transport owns command identifiers and authentication.');
  }
  if (input.type === 'ha/config_entries/import') validateHaEntryImportRequest(input);
  if (
    input.type === 'generic_camera/start_preview' &&
    (typeof input.flow_id !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(input.flow_id) ||
      Object.keys(input).some((key) => !['type', 'flow_id'].includes(key)))
  )
    throw new Error('Choose a valid camera setup preview.');
  if (
    input.type === 'search/related' &&
    (!['device', 'entity'].includes(String(input.item_type)) ||
      typeof input.item_id !== 'string' ||
      input.item_id.includes('..') ||
      (input.item_type === 'device'
        ? !/^[a-zA-Z0-9_.:-]{1,256}$/.test(input.item_id)
        : !/^[a-zA-Z0-9_.-]{1,160}$/.test(input.item_id)))
  )
    throw new Error('Choose a valid device or entity.');
  if (
    input.type === 'history/history_during_period' &&
    (!Array.isArray(input.entity_ids) ||
      !input.entity_ids.length ||
      input.entity_ids.length > 96 ||
      input.entity_ids.some(
        (id) =>
          typeof id !== 'string' ||
          !/^(light|sensor|binary_sensor|switch|cover|climate|fan|lock|media_player)\.[a-z0-9_]+$/.test(
            id,
          ),
      ) ||
      typeof input.start_time !== 'string' ||
      !Number.isFinite(Date.parse(input.start_time)) ||
      (input.end_time !== undefined &&
        (typeof input.end_time !== 'string' ||
          !Number.isFinite(Date.parse(input.end_time)) ||
          Date.parse(input.end_time) <= Date.parse(input.start_time) ||
          Date.parse(input.end_time) - Date.parse(input.start_time) > 7 * 86400000)))
  )
    throw new Error('Select devices and a valid history period.');
  if (
    input.type === 'supervisor/api' &&
    !(
      (['/addons', '/store', '/store/repositories'].includes(String(input.endpoint)) &&
        input.method === 'get' &&
        !('data' in input)) ||
      (typeof input.endpoint === 'string' &&
        /^\/store\/addons\/[a-zA-Z0-9_-]+$/.test(input.endpoint) &&
        input.method === 'get' &&
        !('data' in input)) ||
      (typeof input.endpoint === 'string' &&
        /^\/store\/addons\/[a-zA-Z0-9_-]+\/(install|update)$/.test(input.endpoint) &&
        input.method === 'post' &&
        !('data' in input)) ||
      (input.endpoint === '/store/reload' && input.method === 'post' && !('data' in input)) ||
      (input.endpoint === '/store/repositories' &&
        input.method === 'post' &&
        isRecord(input.data) &&
        typeof input.data.repository === 'string' &&
        input.data.repository.startsWith('https://')) ||
      (typeof input.endpoint === 'string' &&
        /^\/store\/repositories\/[a-zA-Z0-9_-]+$/.test(input.endpoint) &&
        input.method === 'delete' &&
        !('data' in input)) ||
      (typeof input.endpoint === 'string' &&
        /^\/addons\/[a-zA-Z0-9_-]+\/(info|stats)$/.test(input.endpoint) &&
        input.method === 'get' &&
        !('data' in input)) ||
      (typeof input.endpoint === 'string' &&
        /^\/addons\/[a-zA-Z0-9_-]+\/(start|stop|restart|install|rebuild)$/.test(input.endpoint) &&
        input.method === 'post' &&
        !('data' in input)) ||
      (typeof input.endpoint === 'string' &&
        /^\/addons\/[a-zA-Z0-9_-]+\/(options|options\/validate)$/.test(input.endpoint) &&
        input.method === 'post' &&
        isRecord(input.data)) ||
      (typeof input.endpoint === 'string' &&
        /^\/addons\/[a-zA-Z0-9_-]+\/uninstall$/.test(input.endpoint) &&
        input.method === 'post' &&
        isRecord(input.data) &&
        Object.keys(input.data).every((key) => key === 'remove_config') &&
        typeof input.data.remove_config === 'boolean')
    )
  ) {
    throw new Error('This Supervisor operation is not available in Haus.');
  }
  if (JSON.stringify(input).length > 256_000)
    throw new Error('Home Assistant command is too large.');
  return input;
}

function validateHaEntryImportRequest(input: Record<string, unknown>): void {
  const payload = isRecord(input.entry) ? input.entry : undefined;
  const entry = isRecord(payload?.entry) ? payload.entry : undefined;
  const byteLength =
    payload && safeJson(payload) ? Buffer.byteLength(JSON.stringify(payload), 'utf8') : Infinity;
  if (
    !payload ||
    Object.keys(input).some((key) => key !== 'type' && key !== 'entry') ||
    Object.keys(payload).some((key) => !['entry', 'entities', 'devices', 'areas'].includes(key)) ||
    byteLength > 80 * 1024 ||
    !safeJson(payload) ||
    !entry ||
    typeof entry.entryId !== 'string' ||
    entry.entryId.length > 128 ||
    !/^[a-zA-Z0-9_-]+$/.test(entry.entryId) ||
    typeof entry.domain !== 'string' ||
    !/^[a-z0-9_]{1,128}$/.test(entry.domain) ||
    typeof entry.title !== 'string' ||
    !entry.title.trim() ||
    entry.title.length > 256 ||
    !isRecord(entry.data) ||
    (entry.options !== undefined && !isRecord(entry.options)) ||
    entry.disabledBy !== 'user' ||
    (entry.uniqueId !== undefined &&
      entry.uniqueId !== null &&
      typeof entry.uniqueId !== 'string') ||
    (entry.version !== undefined &&
      (!Number.isSafeInteger(entry.version) || Number(entry.version) < 1)) ||
    (entry.minorVersion !== undefined &&
      (!Number.isSafeInteger(entry.minorVersion) || Number(entry.minorVersion) < 0)) ||
    !boundedSubentries(entry.subentries) ||
    !boundedEntities(payload.entities, entry.subentries) ||
    !boundedDevices(payload.devices, entry.subentries) ||
    !boundedArray(payload.areas, 100)
  ) {
    throw new Error('Choose a valid disabled Home Assistant transfer entry.');
  }
}

function boundedArray(value: unknown, limit: number): boolean {
  return (
    value === undefined || (Array.isArray(value) && value.length <= limit && value.every(isRecord))
  );
}

function boundedDevices(value: unknown, subentries: unknown): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > 200 || !value.every(isRecord)) return false;
  const subentryIds = new Set(
    Array.isArray(subentries)
      ? subentries.filter(isRecord).map((subentry) => subentry.subentryId)
      : [],
  );
  return value.every(
    (device) =>
      device.config_subentry_id === undefined ||
      device.config_subentry_id === null ||
      (typeof device.config_subentry_id === 'string' && subentryIds.has(device.config_subentry_id)),
  );
}

function boundedEntities(value: unknown, subentries: unknown): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > 600 || !value.every(isRecord)) return false;
  const subentryIds = new Set(
    Array.isArray(subentries)
      ? subentries.filter(isRecord).map((subentry) => subentry.subentryId)
      : [],
  );
  return value.every((entity) => {
    const disabledBy = entity.disabled_by;
    const category = entity.entity_category;
    return (
      (disabledBy === undefined ||
        disabledBy === null ||
        (typeof disabledBy === 'string' && HA_ENTITY_DISABLED_BY.has(disabledBy))) &&
      (category === undefined ||
        category === null ||
        (typeof category === 'string' && HA_ENTITY_CATEGORIES.has(category))) &&
      (entity.config_subentry_id === undefined ||
        entity.config_subentry_id === null ||
        (typeof entity.config_subentry_id === 'string' &&
          subentryIds.has(entity.config_subentry_id)))
    );
  });
}

function boundedSubentries(value: unknown): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > 100 || !value.every(isRecord)) return false;
  const ids = new Set<string>();
  const uniqueIds = new Set<string>();
  return value.every((subentry) => {
    if (
      typeof subentry.subentryId !== 'string' ||
      subentry.subentryId.length > 128 ||
      !/^[a-zA-Z0-9_-]+$/.test(subentry.subentryId) ||
      ids.has(subentry.subentryId) ||
      typeof subentry.subentryType !== 'string' ||
      !/^[a-z0-9_]{1,128}$/.test(subentry.subentryType) ||
      typeof subentry.title !== 'string' ||
      !subentry.title.trim() ||
      subentry.title.length > 256 ||
      !isRecord(subentry.data) ||
      (subentry.uniqueId !== undefined &&
        subentry.uniqueId !== null &&
        (typeof subentry.uniqueId !== 'string' ||
          subentry.uniqueId.length > 1024 ||
          uniqueIds.has(subentry.uniqueId)))
    ) {
      return false;
    }
    ids.add(subentry.subentryId);
    if (typeof subentry.uniqueId === 'string') uniqueIds.add(subentry.uniqueId);
    return true;
  });
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
  if (!isRecord(value)) return false;
  return Object.entries(value).every(
    ([key, item]) =>
      key !== '__proto__' &&
      key !== 'prototype' &&
      key !== 'constructor' &&
      safeJson(item, depth + 1),
  );
}

export function validateManagement(input: unknown): {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  data?: Record<string, unknown>;
} {
  if (
    !isRecord(input) ||
    !['GET', 'POST', 'DELETE'].includes(String(input.method)) ||
    typeof input.path !== 'string' ||
    JSON.stringify(input).length > 256_000
  )
    throw new Error('Invalid management request.');
  const { method, path, data } = input;
  if (path.includes('..')) throw new Error('Invalid management request.');
  if (data !== undefined && (!isRecord(data) || method !== 'POST'))
    throw new Error('Invalid management form.');
  const flow = /^config\/config_entries\/(?:options\/)?flow(?:\/[a-zA-Z0-9_.:%-]+)?$/.test(path);
  const entry = /^config\/config_entries\/entry\/[a-zA-Z0-9_.:%-]+(?:\/reload)?$/.test(path);
  const editableConfig = /^config\/(scene|automation|script)\/config\/[a-z0-9_-]{1,128}$/i.test(
    path,
  );
  const valid =
    editableConfig ||
    (/^repairs\/issues\/fix(?:\/[a-zA-Z0-9_.:%-]+)?$/.test(path) &&
      (method !== 'DELETE' || path !== 'repairs/issues/fix')) ||
    (flow && (method !== 'DELETE' || /\/flow\//.test(path))) ||
    (entry &&
      ((method === 'POST' && path.endsWith('/reload')) ||
        (method === 'DELETE' && !path.endsWith('/reload')))) ||
    (method === 'GET' && path === 'config/config_entries/flow_handlers') ||
    (method === 'GET' && /^diagnostics\/config_entry\/[a-zA-Z0-9_.:%-]+$/.test(path)) ||
    (method === 'GET' &&
      /^hassio\/addons\/[a-zA-Z0-9_.:%-]+\/(logs|documentation|changelog)$/.test(path));
  if (!valid) throw new Error('This management operation is not available in Haus.');
  return {
    method: method as 'GET' | 'POST' | 'DELETE',
    path,
    ...(data !== undefined ? { data } : {}),
  };
}

export async function boundedBody(response: Response, limit: number): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error('The server response is too large.');
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

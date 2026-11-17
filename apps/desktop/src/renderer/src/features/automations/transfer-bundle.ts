/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  record,
  type DeviceIdentity,
  type DeviceEntity,
  type RuleKind,
  type TransferBundle,
  type TransferRule,
} from './transfer-types';

function safeJson(value: unknown, depth = 0): boolean {
  if (depth > 48) return false;
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
    return true;
  if (Array.isArray(value)) return value.every((item) => safeJson(item, depth + 1));
  const object = record(value);
  return Boolean(
    object &&
    Object.entries(object).every(
      ([key, item]) =>
        key !== '__proto__' &&
        key !== 'prototype' &&
        key !== 'constructor' &&
        safeJson(item, depth + 1),
    ),
  );
}

function parseRule(value: unknown, kind: RuleKind): TransferRule {
  const item = record(value);
  const entityPrefix = kind === 'automation' ? 'automation' : 'script';
  if (
    !item ||
    typeof item.id !== 'string' ||
    !/^[a-z0-9_-]{1,128}$/.test(item.id) ||
    typeof item.name !== 'string' ||
    !item.name.trim() ||
    item.name.length > 256 ||
    typeof item.sourceEntityId !== 'string' ||
    !new RegExp(`^${entityPrefix}\\.[a-z0-9_]+$`).test(item.sourceEntityId) ||
    !record(item.config)
  ) {
    throw new Error(`The transfer file contains an invalid ${kind}.`);
  }
  if (kind === 'automation' && typeof item.sourceEnabled !== 'boolean') {
    throw new Error('The transfer file is missing an automation enabled state.');
  }
  return {
    id: item.id,
    name: item.name.trim(),
    sourceEntityId: item.sourceEntityId,
    ...(typeof item.sourceEnabled === 'boolean' ? { sourceEnabled: item.sourceEnabled } : {}),
    config: item.config as Record<string, unknown>,
  };
}

function parseDeviceEntities(value: unknown): Record<string, DeviceEntity[]> {
  const input = record(value);
  if (!input) throw new Error('The transfer file has no Home Assistant device map.');
  return Object.fromEntries(
    Object.entries(input).map(([deviceId, entities]) => {
      if (!/^[a-f0-9]{16,64}$/i.test(deviceId) || !Array.isArray(entities)) {
        throw new Error('The transfer file has an invalid device map.');
      }
      return [
        deviceId,
        entities.map((value) => {
          const entity = record(value);
          if (
            !entity ||
            typeof entity.entityId !== 'string' ||
            !/^[a-z_]+\.[a-z0-9_]+$/.test(entity.entityId) ||
            typeof entity.domain !== 'string' ||
            (entity.platform !== undefined &&
              (typeof entity.platform !== 'string' || !/^[a-z0-9_]{1,128}$/.test(entity.platform)))
          ) {
            throw new Error('The transfer file has an invalid device entity.');
          }
          if (
            entity.configEntryId !== undefined &&
            (typeof entity.configEntryId !== 'string' ||
              !/^[a-z0-9_-]{1,128}$/i.test(entity.configEntryId))
          ) {
            throw new Error('The transfer file has an invalid integration entry ID.');
          }
          if (
            entity.uniqueId !== undefined &&
            (typeof entity.uniqueId !== 'string' || entity.uniqueId.length > 1024)
          ) {
            throw new Error('The transfer file has an invalid entity unique ID.');
          }
          const rawIdentifiers = entity.deviceIdentifiers;
          if (
            rawIdentifiers !== undefined &&
            (!Array.isArray(rawIdentifiers) ||
              rawIdentifiers.length > 64 ||
              rawIdentifiers.some(
                (pair) =>
                  !Array.isArray(pair) ||
                  pair.length !== 2 ||
                  pair.some(
                    (part) =>
                      typeof part !== 'string' || part.trim().length === 0 || part.length > 1024,
                  ),
              ))
          ) {
            throw new Error('The transfer file has invalid device identifiers.');
          }
          for (const key of ['originalName', 'friendlyName'] as const) {
            if (
              entity[key] !== undefined &&
              (typeof entity[key] !== 'string' || entity[key].length > 512)
            ) {
              throw new Error('The transfer file has an invalid entity name.');
            }
          }
          return {
            entityId: entity.entityId,
            domain: entity.domain,
            ...(typeof entity.platform === 'string' ? { platform: entity.platform } : {}),
            ...(typeof entity.uniqueId === 'string' ? { uniqueId: entity.uniqueId } : {}),
            ...(Array.isArray(rawIdentifiers)
              ? { deviceIdentifiers: rawIdentifiers as DeviceIdentity[] }
              : {}),
            ...(typeof entity.configEntryId === 'string'
              ? { configEntryId: entity.configEntryId }
              : {}),
            ...(typeof entity.originalName === 'string'
              ? { originalName: entity.originalName }
              : {}),
            ...(typeof entity.friendlyName === 'string'
              ? { friendlyName: entity.friendlyName }
              : {}),
          };
        }),
      ];
    }),
  );
}

export async function readBundle(file: File): Promise<TransferBundle> {
  if (file.size > 1024 * 1024) throw new Error('The rule transfer file exceeds 1 MB.');
  const parsed: unknown = JSON.parse(await file.text());
  const root = record(parsed);
  if (
    !safeJson(parsed) ||
    !root ||
    root.schemaVersion !== 1 ||
    root.source !== 'home_assistant' ||
    !Array.isArray(root.automations) ||
    !Array.isArray(root.scripts) ||
    root.automations.length > 100 ||
    root.scripts.length > 100
  ) {
    throw new Error('Choose a valid Home Assistant rules transfer file.');
  }
  const automations = root.automations.map((item) => parseRule(item, 'automation'));
  const scripts = root.scripts.map((item) => parseRule(item, 'script'));
  const registryEntityIds = record(root.registryEntityIds);
  if (
    !registryEntityIds ||
    Object.entries(registryEntityIds).some(
      ([key, value]) =>
        !/^[a-f0-9]{16,64}$/i.test(key) ||
        typeof value !== 'string' ||
        !/^[a-z_]+\.[a-z0-9_]+$/.test(value),
    )
  ) {
    throw new Error('The transfer file has an invalid entity registry map.');
  }
  const ids = [...automations, ...scripts].map((rule) => rule.id);
  if (ids.length === 0 || new Set(ids).size !== ids.length) {
    throw new Error('The transfer file is empty or contains duplicate Haus IDs.');
  }
  return {
    automations,
    scripts,
    registryEntityIds: registryEntityIds as Record<string, string>,
    deviceEntities: parseDeviceEntities(root.deviceEntities),
  };
}

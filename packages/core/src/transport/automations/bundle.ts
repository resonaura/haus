/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import {
  asRecord,
  MAX_TRANSFER_BUNDLE_BYTES,
  type DeviceEntity,
  type DeviceIdentity,
  type RuleImportEntry,
  type RuleKind,
  type TransferBundle,
  type TransferRule,
} from './types.js';

function safeJson(value: unknown, depth = 0): boolean {
  if (depth > 48) return false;
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every((item) => safeJson(item, depth + 1));
  const object = asRecord(value);
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
  const item = asRecord(value);
  const entityPrefix = kind === 'automation' ? 'automation' : 'script';
  const cfg = item ? asRecord(item.config) : undefined;
  if (
    !item ||
    typeof item.id !== 'string' ||
    !/^[a-z0-9_-]{1,128}$/.test(item.id) ||
    typeof item.name !== 'string' ||
    !item.name.trim() ||
    item.name.length > 256 ||
    typeof item.sourceEntityId !== 'string' ||
    !new RegExp(`^${entityPrefix}\\.[a-z0-9_]+$`).test(item.sourceEntityId) ||
    !cfg
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
    config: cfg,
  };
}

function parseDeviceEntities(value: unknown): Record<string, DeviceEntity[]> {
  const input = asRecord(value);
  if (!input) throw new Error('The transfer file has no Home Assistant device map.');
  return Object.fromEntries(
    Object.entries(input).map(([deviceId, entities]) => {
      if (!/^[a-f0-9]{16,64}$/i.test(deviceId) || !Array.isArray(entities)) {
        throw new Error('The transfer file has an invalid device map.');
      }
      return [
        deviceId,
        entities.map((entryValue) => {
          const entity = asRecord(entryValue);
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
          const deviceIdentifiers: DeviceIdentity[] | undefined = Array.isArray(rawIdentifiers)
            ? rawIdentifiers.map((pair): DeviceIdentity => {
                if (
                  !Array.isArray(pair) ||
                  pair.length !== 2 ||
                  typeof pair[0] !== 'string' ||
                  typeof pair[1] !== 'string' ||
                  pair[0].trim().length === 0 ||
                  pair[1].trim().length === 0 ||
                  pair[0].length > 1024 ||
                  pair[1].length > 1024
                ) {
                  throw new Error('The transfer file has invalid device identifiers.');
                }
                return [pair[0], pair[1]];
              })
            : rawIdentifiers === undefined
              ? undefined
              : (() => {
                  throw new Error('The transfer file has invalid device identifiers.');
                })();
          if (deviceIdentifiers && deviceIdentifiers.length > 64) {
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
            ...(deviceIdentifiers ? { deviceIdentifiers } : {}),
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

export function parseTransferBundleText(rawText: string, byteLength?: number): TransferBundle {
  const bytes = byteLength ?? new TextEncoder().encode(rawText).byteLength;
  if (bytes > MAX_TRANSFER_BUNDLE_BYTES) {
    throw new Error('The rule transfer file exceeds 1 MB.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error('Choose a valid Home Assistant rules transfer file.');
  }
  const root = asRecord(parsed);
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
  const registryRecord = asRecord(root.registryEntityIds);
  if (!registryRecord) {
    throw new Error('The transfer file has an invalid entity registry map.');
  }
  const registryEntityIds: Record<string, string> = {};
  for (const [key, value] of Object.entries(registryRecord)) {
    if (
      !/^[a-f0-9]{16,64}$/i.test(key) ||
      typeof value !== 'string' ||
      !/^[a-z_]+\.[a-z0-9_]+$/.test(value)
    ) {
      throw new Error('The transfer file has an invalid entity registry map.');
    }
    registryEntityIds[key] = value;
  }
  const ids = [...automations, ...scripts].map((rule) => rule.id);
  if (ids.length === 0 || new Set(ids).size !== ids.length) {
    throw new Error('The transfer file is empty or contains duplicate Haus IDs.');
  }
  return {
    automations,
    scripts,
    registryEntityIds,
    deviceEntities: parseDeviceEntities(root.deviceEntities),
  };
}

export function buildInitialTransferEntries(bundle: TransferBundle): RuleImportEntry[] {
  return [
    ...bundle.scripts.map((rule): RuleImportEntry => ({
      key: `script:${rule.id}`,
      name: rule.name,
      kind: 'script',
      status: 'ready',
    })),
    ...bundle.automations.map((rule): RuleImportEntry => ({
      key: `automation:${rule.id}`,
      name: rule.name,
      kind: 'automation',
      status: 'ready',
    })),
  ];
}

export function buildDemoTransferBundleJson(): string {
  return JSON.stringify(
    {
      schemaVersion: 1,
      source: 'home_assistant',
      registryEntityIds: {},
      deviceEntities: {
        abcdef0123456789abcdef0123456789: [
          {
            entityId: 'light.hallway',
            domain: 'light',
            friendlyName: 'Hallway light',
          },
          {
            entityId: 'binary_sensor.front_door',
            domain: 'binary_sensor',
            friendlyName: 'Door sensor',
          },
        ],
      },
      scripts: [
        {
          id: 'welcome_hallway_glow',
          name: 'Welcome hallway glow',
          sourceEntityId: 'script.welcome_hallway_glow',
          config: {
            alias: 'Welcome hallway glow',
            sequence: [{ action: 'light.turn_on', target: { entity_id: 'light.hallway' } }],
          },
        },
      ],
      automations: [
        {
          id: 'front_door_evening_light',
          name: 'Front door evening light',
          sourceEntityId: 'automation.front_door_evening_light',
          sourceEnabled: true,
          config: {
            alias: 'Front door evening light',
            triggers: [{ trigger: 'state', entity_id: 'binary_sensor.front_door', to: 'on' }],
            actions: [{ action: 'light.turn_on', target: { entity_id: 'light.hallway' } }],
          },
        },
      ],
    },
    null,
    2,
  );
}

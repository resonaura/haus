/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  record,
  type DeviceEntity,
  type RuleKind,
  type TargetEntity,
  type TransferBundle,
  type TransferRule,
} from './transfer-types';

function entitiesForDevice(
  deviceId: unknown,
  domain: string | undefined,
  bundle: TransferBundle,
): string[] {
  if (typeof deviceId !== 'string') return [];
  return (bundle.deviceEntities[deviceId] ?? [])
    .filter((entry) => !domain || entry.domain === domain)
    .map((entry) => entry.entityId);
}

function normalizedLabel(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function labelMatches(target: string, source: string): boolean {
  const targetLabel = normalizedLabel(target);
  const sourceLabel = normalizedLabel(source);
  return (
    targetLabel.length > 0 &&
    sourceLabel.length > 0 &&
    (targetLabel === sourceLabel ||
      targetLabel.endsWith(`_${sourceLabel}`) ||
      sourceLabel.endsWith(`_${targetLabel}`))
  );
}

function sameDeviceIdentity(source: DeviceEntity, target: TargetEntity): boolean {
  return Boolean(
    source.deviceIdentifiers?.some(([protocol, externalId]) =>
      target.deviceIdentifiers?.some(
        ([targetProtocol, targetExternalId]) =>
          targetProtocol === protocol && targetExternalId === externalId,
      ),
    ),
  );
}

export function buildEntityAliases(
  bundle: TransferBundle,
  targets: readonly TargetEntity[],
): Map<string, string> {
  const targetsByDevice = new Map<string, TargetEntity[]>();
  const aliases = new Map(targets.map((target) => [target.entityId, target.entityId]));
  for (const target of targets) {
    const current = targetsByDevice.get(target.deviceId) ?? [];
    current.push(target);
    targetsByDevice.set(target.deviceId, current);
  }

  for (const [sourceDeviceId, sourceEntities] of Object.entries(bundle.deviceEntities)) {
    for (const source of sourceEntities) {
      const exactEntityMatches = targets.filter(
        (target) => target.domain === source.domain && target.entityId === source.entityId,
      );
      const exactEntityMatch = exactEntityMatches.length === 1 ? exactEntityMatches[0] : undefined;
      if (exactEntityMatch) {
        aliases.set(source.entityId, exactEntityMatch.entityId);
        continue;
      }
      if (exactEntityMatches.length > 1) continue;
      const uniqueIdMatches = source.uniqueId
        ? targets.filter(
            (target) =>
              target.domain === source.domain &&
              target.uniqueId === source.uniqueId &&
              (source.platform === undefined || target.platform === source.platform),
          )
        : [];
      const uniqueIdMatch = uniqueIdMatches.length === 1 ? uniqueIdMatches[0] : undefined;
      if (uniqueIdMatch) {
        aliases.set(source.entityId, uniqueIdMatch.entityId);
        continue;
      }
      if (uniqueIdMatches.length > 1) continue;
      const sourceMatches = targets.filter(
        (target) =>
          target.domain === source.domain &&
          (source.platform === undefined || target.platform === source.platform) &&
          typeof target.uniqueId === 'string' &&
          target.uniqueId.startsWith(`${source.entityId}:`),
      );
      if (sourceMatches.length === 1 && sourceMatches[0]) {
        aliases.set(source.entityId, sourceMatches[0].entityId);
        continue;
      }
      if (sourceMatches.length > 1) continue;
      const identityMatches = targets.filter(
        (target) => target.domain === source.domain && sameDeviceIdentity(source, target),
      );
      const sameIdentitySourceEntities = sourceEntities.filter(
        (entity) =>
          entity.domain === source.domain &&
          sameDeviceIdentity(source, {
            entityId: entity.entityId,
            deviceId: sourceDeviceId,
            domain: entity.domain,
            deviceIdentifiers: entity.deviceIdentifiers,
          }),
      );
      if (identityMatches.length === 1 && sameIdentitySourceEntities.length === 1) {
        const target = identityMatches[0];
        if (target) aliases.set(source.entityId, target.entityId);
        continue;
      }
      if (identityMatches.length > 1) {
        const names = [source.friendlyName, source.originalName].filter(
          (name): name is string => typeof name === 'string' && name.trim().length > 0,
        );
        const namedMatches = identityMatches.filter((target) =>
          names.some((name) => labelMatches(target.name ?? '', name)),
        );
        if (namedMatches.length === 1 && namedMatches[0]) {
          aliases.set(source.entityId, namedMatches[0].entityId);
        }
        continue;
      }
      if (!source.configEntryId) continue;
      const hausDeviceId = `ha:${source.configEntryId}:${sourceDeviceId}`;
      const names = [source.friendlyName, source.originalName].filter(
        (name): name is string => typeof name === 'string' && name.trim().length > 0,
      );
      if (names.length === 0) continue;
      const candidates = (targetsByDevice.get(hausDeviceId) ?? []).filter(
        (target) => target.domain === source.domain && target.name,
      );
      const matches = candidates.filter((target) =>
        names.some((name) => labelMatches(target.name ?? '', name)),
      );
      if (matches.length === 1) {
        const target = matches[0];
        if (target) aliases.set(source.entityId, target.entityId);
      }
    }
  }
  return aliases;
}

function mappedEntity(
  value: unknown,
  bundle: TransferBundle,
  aliases: ReadonlyMap<string, string>,
): string | undefined {
  if (typeof value !== 'string') return undefined;
  const sourceEntityId = bundle.registryEntityIds[value] ?? value;
  return aliases.get(sourceEntityId);
}

function normalizeCondition(
  value: unknown,
  bundle: TransferBundle,
  aliases: ReadonlyMap<string, string>,
): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeCondition(item, bundle, aliases));
  const item = record(value);
  if (!item) return value;
  if (item.condition === 'or' || item.condition === 'and' || item.condition === 'not') {
    return { ...item, conditions: normalizeCondition(item.conditions, bundle, aliases) };
  }
  if (item.condition === 'light.is_on' || item.condition === 'switch.is_on') {
    const target = record(item.target) ?? {};
    if (target.area_id !== undefined || target.device_id !== undefined)
      return { _hausUnsupported: 'device_condition_target_unavailable' };
    const ids = Array.isArray(target.entity_id)
      ? target.entity_id.flatMap((id) => {
          const mapped = mappedEntity(id, bundle, aliases);
          return mapped ? [mapped] : [];
        })
      : mappedEntity(target.entity_id, bundle, aliases)
        ? [mappedEntity(target.entity_id, bundle, aliases)].filter((id): id is string =>
            Boolean(id),
          )
        : [];
    const unique = [...new Set(ids)];
    if (unique.length !== 1) return { _hausUnsupported: 'device_condition_target_unavailable' };
    const conditions = unique.map((entity_id) => ({ condition: 'state', entity_id, state: 'on' }));
    return conditions[0];
  }
  if (typeof item.entity_id === 'string') {
    const entity_id = mappedEntity(item.entity_id, bundle, aliases);
    return entity_id
      ? { ...item, entity_id }
      : { _hausUnsupported: 'unsupported_automation_condition' };
  }
  if (Array.isArray(item.entity_id)) {
    if (item.entity_id.length !== 1)
      return { _hausUnsupported: 'unsupported_automation_condition' };
    const entity_id = mappedEntity(item.entity_id[0], bundle, aliases);
    return entity_id
      ? { ...item, entity_id }
      : { _hausUnsupported: 'unsupported_automation_condition' };
  }
  return item;
}

function normalizeStep(
  value: unknown,
  bundle: TransferBundle,
  aliases: ReadonlyMap<string, string>,
): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeStep(item, bundle, aliases));
  const item = record(value);
  if (!item) return value;
  if (
    typeof item.domain === 'string' &&
    typeof item.type === 'string' &&
    typeof item.entity_id === 'string' &&
    !item.action
  ) {
    const entity_id = mappedEntity(item.entity_id, bundle, aliases);
    if (!entity_id) return { _hausUnsupported: 'device_action_entity_unavailable' };
    return {
      action: `${item.domain}.${item.type}`,
      target: { entity_id },
    };
  }
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(item)) {
    if (key === 'if' || key === 'conditions' || key === 'condition') {
      output[key] = normalizeCondition(child, bundle, aliases);
      continue;
    }
    if (key === 'entity_id' && typeof child === 'string') {
      const entity_id = mappedEntity(child, bundle, aliases);
      if (!entity_id) return { _hausUnsupported: 'device_action_entity_unavailable' };
      output[key] = entity_id;
      continue;
    }
    if (key === 'entity_id' && Array.isArray(child)) {
      const entity_ids = child.map((id) => mappedEntity(id, bundle, aliases));
      if (entity_ids.some((id) => !id))
        return { _hausUnsupported: 'device_action_entity_unavailable' };
      output[key] = entity_ids;
      continue;
    }
    const target = key === 'target' ? record(child) : undefined;
    if (target) {
      const domain = typeof item.action === 'string' ? item.action.split('.')[0] : undefined;
      if (target.area_id !== undefined)
        return { _hausUnsupported: 'device_action_target_unavailable' };
      if (target.device_id !== undefined) {
        const deviceIds = Array.isArray(target.device_id)
          ? target.device_id.filter((id): id is string => typeof id === 'string')
          : typeof target.device_id === 'string'
            ? [target.device_id]
            : [];
        const sourceEntityIds = deviceIds.flatMap((id) => entitiesForDevice(id, domain, bundle));
        const mappedEntityIds = sourceEntityIds.map((entityId) =>
          mappedEntity(entityId, bundle, aliases),
        );
        if (mappedEntityIds.length === 0 || mappedEntityIds.some((entityId) => !entityId))
          return { _hausUnsupported: 'device_action_target_unavailable' };
        const ids = [...new Set(mappedEntityIds.filter((id): id is string => Boolean(id)))];
        output[key] = { ...target, entity_id: ids };
        delete (output[key] as Record<string, unknown>).device_id;
      } else if (typeof target.entity_id === 'string') {
        const entity_id = mappedEntity(target.entity_id, bundle, aliases);
        if (!entity_id) return { _hausUnsupported: 'device_action_entity_unavailable' };
        output[key] = {
          ...target,
          entity_id,
        };
      } else if (Array.isArray(target.entity_id)) {
        const entity_ids = target.entity_id.map((id) => mappedEntity(id, bundle, aliases));
        if (entity_ids.some((id) => !id))
          return { _hausUnsupported: 'device_action_entity_unavailable' };
        output[key] = {
          ...target,
          entity_id: entity_ids,
        };
      } else {
        output[key] = target;
      }
      continue;
    }
    if (Array.isArray(child) || record(child)) {
      output[key] = normalizeStep(child, bundle, aliases);
      continue;
    }
    output[key] = child;
  }
  if (
    typeof item.action === 'string' &&
    !record(item.target) &&
    typeof item.entity_id === 'string'
  ) {
    const entity_id = mappedEntity(item.entity_id, bundle, aliases);
    if (!entity_id) return { _hausUnsupported: 'device_action_entity_unavailable' };
    output.target = { entity_id };
  }
  return output;
}

function normalizeTriggers(
  value: unknown,
  bundle: TransferBundle,
  aliases: ReadonlyMap<string, string>,
): unknown {
  const triggers = Array.isArray(value) ? value : record(value) ? [value] : [];
  return triggers.map((raw) => {
    const trigger = record(raw);
    if (!trigger) return { _hausUnsupported: 'unsupported_automation_trigger' };
    const platform = trigger.trigger ?? trigger.platform;
    if (platform === 'state' || platform === 'numeric_state') {
      const rawEntityIds = trigger.entity_id;
      const entityIds =
        typeof rawEntityIds === 'string'
          ? [rawEntityIds]
          : Array.isArray(rawEntityIds) &&
              rawEntityIds.every((entityId) => typeof entityId === 'string')
            ? rawEntityIds
            : [];
      if (entityIds.length === 0) {
        return { _hausUnsupported: 'unsupported_automation_trigger' };
      }
      const mappedEntityIds = entityIds.map((entityId) => mappedEntity(entityId, bundle, aliases));
      if (mappedEntityIds.some((entityId) => !entityId)) {
        return { _hausUnsupported: 'automation_trigger_entity_unavailable' };
      }
      return {
        ...trigger,
        entity_id: Array.isArray(rawEntityIds) ? mappedEntityIds : mappedEntityIds[0],
      };
    }
    if (platform === 'event.received' || platform === 'event') {
      const target = record(trigger.target);
      const rawEntityIds = target?.entity_id ?? trigger.entity_id;
      const entityIds =
        typeof rawEntityIds === 'string'
          ? [rawEntityIds]
          : Array.isArray(rawEntityIds) &&
              rawEntityIds.every((entityId) => typeof entityId === 'string')
            ? rawEntityIds
            : [];
      if (entityIds.length === 0) {
        return { _hausUnsupported: 'unsupported_automation_trigger' };
      }
      const mappedEntityIds = entityIds.map((entityId) => mappedEntity(entityId, bundle, aliases));
      if (mappedEntityIds.some((entityId) => !entityId)) {
        return { _hausUnsupported: 'automation_trigger_entity_unavailable' };
      }
      const mappedIds = Array.isArray(rawEntityIds) ? mappedEntityIds : mappedEntityIds[0];
      return target
        ? { ...trigger, target: { ...target, entity_id: mappedIds } }
        : { ...trigger, entity_id: mappedIds };
    }
    if (platform === 'time' || platform === 'sun') return trigger;
    if (platform !== 'device') {
      return { _hausUnsupported: 'unsupported_automation_trigger' };
    }
    if (trigger.domain === 'xiaomi_ble' && typeof trigger.device_id === 'string') {
      const triggerType = typeof trigger.type === 'string' ? trigger.type : '';
      const subtype = typeof trigger.subtype === 'string' ? trigger.subtype : '';
      const candidates = (bundle.deviceEntities[trigger.device_id] ?? []).filter(
        (entry) =>
          entry.domain === 'event' &&
          (entry.entityId.endsWith(`_${triggerType}`) || entry.entityId.includes('dimmer')),
      );
      if (triggerType !== 'dimmer' || !subtype || candidates.length !== 1) {
        return { _hausUnsupported: 'unsupported_automation_device_trigger' };
      }
      const candidate = candidates[0];
      if (!candidate) return { _hausUnsupported: 'unsupported_automation_device_trigger' };
      const entityId = mappedEntity(candidate.entityId, bundle, aliases);
      if (!entityId) return { _hausUnsupported: 'automation_trigger_entity_unavailable' };
      return {
        trigger: 'event.received',
        target: { entity_id: entityId },
        options: { event_type: [subtype] },
      };
    }
    if (trigger.domain !== 'hue' || typeof trigger.device_id !== 'string') {
      return { _hausUnsupported: 'unsupported_automation_device_trigger' };
    }
    const subtype = String(trigger.subtype ?? '');
    const eventType = typeof trigger.type === 'string' ? trigger.type : '';
    const candidates = (bundle.deviceEntities[trigger.device_id] ?? []).filter(
      (entry) => entry.domain === 'event' && entry.entityId.endsWith(`_button_${subtype}`),
    );
    if (
      !/^\d+$/.test(subtype) ||
      !['initial_press', 'short_release', 'long_release', 'repeat'].includes(eventType) ||
      candidates.length !== 1
    ) {
      return { _hausUnsupported: 'unsupported_automation_device_trigger' };
    }
    const candidate = candidates[0];
    if (!candidate) return { _hausUnsupported: 'unsupported_automation_device_trigger' };
    const entityId = mappedEntity(candidate.entityId, bundle, aliases);
    if (!entityId) return { _hausUnsupported: 'automation_trigger_entity_unavailable' };
    return {
      trigger: 'event.received',
      target: { entity_id: entityId },
      options: { event_type: [eventType] },
    };
  });
}

function findTemplate(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(findTemplate);
  if (typeof value === 'string') return value.includes('{{') || value.includes('{%');
  const item = record(value);
  return item ? Object.values(item).some(findTemplate) : false;
}

export function normalizedRule(
  rule: TransferRule,
  kind: RuleKind,
  bundle: TransferBundle,
  aliases: ReadonlyMap<string, string>,
) {
  if (findTemplate(rule.config)) throw new Error('unsupported_automation_template');
  const configInput = { ...rule.config };
  if (kind === 'automation') {
    delete configInput.trigger;
    delete configInput.triggers;
  }
  const normalized = normalizeStep(configInput, bundle, aliases);
  const normalizedRecord = record(normalized);
  if (!normalizedRecord) throw new Error('The transfer file contains an invalid rule config.');
  const config = { ...normalizedRecord };
  if (kind === 'automation') {
    config.triggers = normalizeTriggers(
      rule.config.triggers ?? rule.config.trigger,
      bundle,
      aliases,
    );
  }
  const unsupported =
    (kind === 'automation' ? findUnsupported(config.triggers) : undefined) ??
    findUnsupported(config);
  if (unsupported) throw new Error(unsupported);
  return {
    ...config,
    ...(kind === 'automation'
      ? { actions: normalizeStep(config.actions ?? config.action, bundle, aliases) }
      : { sequence: normalizeStep(config.sequence, bundle, aliases) }),
    _hausMigration: {
      source: 'home_assistant',
      schemaVersion: 1,
      sourceEntityId: rule.sourceEntityId,
      ...(kind === 'automation' ? { sourceEnabled: rule.sourceEnabled === true } : {}),
    },
  };
}

function findUnsupported(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findUnsupported(item);
      if (found) return found;
    }
    return undefined;
  }
  const item = record(value);
  if (!item) return undefined;
  if (typeof item._hausUnsupported === 'string') return item._hausUnsupported;
  for (const child of Object.values(item)) {
    const found = findUnsupported(child);
    if (found) return found;
  }
  return undefined;
}

export { friendlyError } from './transfer-errors';

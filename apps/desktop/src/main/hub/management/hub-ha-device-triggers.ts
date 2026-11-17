/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { isRecord, type CompatView } from '../types';

function sourceDeviceMatches(device: Record<string, unknown>, sourceDeviceId: string): boolean {
  if (device.id === sourceDeviceId) return true;
  return (
    Array.isArray(device.identifiers) &&
    device.identifiers.some(
      (pair) =>
        Array.isArray(pair) && pair.length === 2 && pair[0] === 'ha' && pair[1] === sourceDeviceId,
    )
  );
}

function eventChoices(view: CompatView, entityId: string): string[] {
  const state = view.states.find((item) => item.entity_id === entityId);
  const choices = state?.attributes.event_types;
  return Array.isArray(choices)
    ? choices.filter((choice): choice is string => typeof choice === 'string')
    : [];
}

function normalized(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function subtypeMatches(
  entity: Record<string, unknown>,
  view: CompatView,
  subtype: string,
): boolean {
  const entityId = typeof entity.entity_id === 'string' ? entity.entity_id : '';
  const state = view.states.find((item) => item.entity_id === entityId);
  const label = normalized(
    [entityId, entity.name, entity.original_name, state?.attributes.friendly_name]
      .filter((value): value is string => typeof value === 'string')
      .join(' '),
  );
  const normalizedSubtype = normalized(subtype);
  const button = /^(?:button\s*)?(\d+)$/.exec(normalizedSubtype);
  return button?.[1]
    ? label.includes(`button ${Number(button[1])}`)
    : label.includes(normalizedSubtype);
}

/** Maps HA device triggers only when a preserved source device identity resolves to one Haus event. */
export function toHubDeviceTriggers(
  block: Record<string, unknown>,
  view: CompatView,
): Record<string, unknown>[] {
  const sourceDeviceId = typeof block.device_id === 'string' ? block.device_id : '';
  if (!sourceDeviceId) throw new Error('automation_trigger_device_required');

  const devices = view.devices.filter(
    (device): device is Record<string, unknown> =>
      isRecord(device) && sourceDeviceMatches(device, sourceDeviceId),
  );
  if (devices.length !== 1 || typeof devices[0]?.id !== 'string') {
    throw new Error('automation_trigger_device_unavailable');
  }

  const targetDeviceId = devices[0].id;
  const entities = view.entities.filter(
    (entity): entity is Record<string, unknown> =>
      isRecord(entity) &&
      entity.device_id === targetDeviceId &&
      typeof entity.entity_id === 'string' &&
      entity.entity_id.startsWith('event.'),
  );
  if (entities.length === 0) throw new Error('automation_trigger_event_unavailable');

  const domain = typeof block.domain === 'string' ? block.domain : '';
  const triggerType = typeof block.type === 'string' ? block.type : '';
  const subtype = typeof block.subtype === 'string' ? block.subtype : String(block.subtype ?? '');
  const eventType =
    domain === 'hue'
      ? triggerType
      : domain === 'xiaomi_ble' && triggerType === 'dimmer'
        ? subtype
        : ([triggerType, subtype].find((value) =>
            entities.some(
              (entity) =>
                typeof entity.entity_id === 'string' &&
                eventChoices(view, entity.entity_id).includes(value),
            ),
          ) ?? '');
  if (!eventType) throw new Error('unsupported_automation_device_trigger');

  const matchingEntities = entities.filter((entity) => {
    const entityId = typeof entity.entity_id === 'string' ? entity.entity_id : '';
    if (!entityId || !eventChoices(view, entityId).includes(eventType)) return false;
    if (!subtype) return true;
    if (domain === 'hue') {
      const matchingSubtype = entities.filter((candidate) =>
        subtypeMatches(candidate, view, subtype),
      );
      return matchingSubtype.length === 1 && matchingSubtype[0] === entity;
    }
    if (domain === 'xiaomi_ble' && triggerType === 'dimmer') {
      return subtypeMatches(entity, view, 'dimmer');
    }
    return true;
  });
  if (matchingEntities.length !== 1) throw new Error('automation_trigger_event_ambiguous');

  const entityId = matchingEntities[0]?.entity_id;
  if (typeof entityId !== 'string') throw new Error('automation_trigger_event_unavailable');
  const binding = view.bindings.get(entityId);
  if (!binding) throw new Error('automation_trigger_entity_unavailable');
  return [{ type: 'event', eventType, endpointId: binding.endpointId }];
}

/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { Capability, HausEndpoint, Reading, SourceServiceRef } from '@haus/core';
import type { BridgeEntity, LightState } from '@haus/bridge/protocol';
import { rgb } from './color.js';
type Json = Reading['value'];

export function entityEndpoint(
  entity: BridgeEntity,
  id: string,
  owner: SourceServiceRef,
  available: boolean,
): HausEndpoint {
  const operations = entity.writable ? ['set'] : [];
  const capabilities: Capability[] = [];
  const readings: Record<string, Reading> = {};
  const field = (capability: Capability, value: Json) => {
    capabilities.push(capability);
    readings[capability.id] = {
      value,
      freshness: available ? 'live' : 'cached',
      observedAt: new Date(entity.updatedAt).toISOString(),
    };
  };
  const basic = (capId: string, kind: string, value: Json) =>
    field(
      {
        id: capId,
        kind,
        readable: true,
        operations,
        deviceClass: entity.deviceClass,
        unit: entity.unit,
      },
      value,
    );
  switch (entity.domain) {
    case 'light': {
      const value: LightState | undefined =
        entity.state !== null && typeof entity.state === 'object' ? entity.state : undefined;
      basic('on_off', 'binary', value?.on ?? null);
      if (entity.brightness)
        field(
          {
            id: 'brightness',
            kind: 'numeric',
            readable: true,
            operations,
            minimum: 0,
            maximum: 255,
          },
          value?.brightness === undefined ? null : Math.round((value.brightness * 255) / 100),
        );
      if (entity.colorTemperature)
        field(
          {
            id: 'color_temp',
            kind: 'numeric',
            readable: true,
            operations,
            minimum: entity.colorTemperature.minKelvin,
            maximum: entity.colorTemperature.maxKelvin,
          },
          value?.colorTemperature ?? null,
        );
      if (entity.color) {
        basic(
          'color',
          'complex',
          value?.hue !== undefined && value.saturation !== undefined
            ? rgb(value.hue, value.saturation)
            : null,
        );
      }
      break;
    }
    case 'switch':
      basic('on_off', 'binary', typeof entity.state === 'boolean' ? entity.state : null);
      break;
    case 'binary_sensor':
      basic(
        entity.deviceClass ?? 'state',
        'binary',
        typeof entity.state === 'boolean' ? entity.state : null,
      );
      break;
    case 'sensor':
      basic(
        entity.deviceClass ?? 'value',
        typeof entity.state === 'number' ? 'numeric' : 'string',
        typeof entity.state === 'object' ||
          (typeof entity.state === 'string' &&
            /(?:https?|rtsps?|rtmp|srt|file):\/\/|data:/i.test(entity.state))
          ? null
          : entity.state,
      );
      break;
    case 'number':
      field(
        {
          id: 'number',
          kind: 'numeric',
          readable: true,
          operations,
          minimum: entity.min,
          maximum: entity.max,
          step: entity.step,
          unit: entity.unit,
        },
        typeof entity.state === 'number' ? entity.state : null,
      );
      break;
    case 'select':
      field(
        { id: 'select', kind: 'enum', readable: true, operations, choices: entity.options },
        typeof entity.state === 'string' ? entity.state : null,
      );
      break;
    case 'button':
      field(
        {
          id: 'press',
          kind: 'action',
          readable: false,
          operations: entity.writable ? ['press'] : [],
        },
        null,
      );
      break;
  }
  return {
    id,
    name: entity.name,
    category: entity.domain === 'light' ? 'lighting' : 'generic',
    capabilities,
    readings,
    availability: available ? 'online' : 'offline',
    sourceRefs: [owner],
    sourceOwner: owner,
  };
}

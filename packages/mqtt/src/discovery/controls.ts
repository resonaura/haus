/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { Capability } from '@haus/core';
import type { HaMqttComponentConfig } from '../types.js';

export function numberCapability(
  config: HaMqttComponentConfig,
  entityCategory: Capability['entityCategory'],
  writable: boolean,
): Capability {
  return {
    id: 'number',
    kind: 'numeric',
    readable: true,
    operations: writable ? ['set'] : [],
    unit: config.unit_of_measurement,
    minimum: config.min ?? 1,
    maximum: config.max ?? 100,
    step: config.step ?? 1,
    deviceClass: config.device_class,
    entityCategory,
    icon: config.icon,
  };
}

export function selectCapability(
  config: HaMqttComponentConfig,
  entityCategory: Capability['entityCategory'],
  writable: boolean,
): Capability {
  return {
    id: 'select',
    kind: 'enum',
    readable: true,
    operations: writable && Boolean(config.options?.length) ? ['set'] : [],
    choices: config.options ? [...config.options] : [],
    deviceClass: config.device_class,
    entityCategory,
    icon: config.icon,
  };
}

/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { Capability } from '@haus/core';
import type { HaMqttComponentConfig } from '../types.js';

export function fanCapabilities(
  config: HaMqttComponentConfig,
  entityCategory: Capability['entityCategory'],
  hasCommandTopic: boolean,
): Capability[] {
  const capabilities: Capability[] = [
    {
      id: 'fan',
      kind: 'binary',
      readable: true,
      operations: hasCommandTopic ? ['set', 'turn_on', 'turn_off'] : [],
      entityCategory,
      icon: config.icon,
    },
  ];

  if (config.percentage_state_topic || config.percentage_command_topic) {
    capabilities.push({
      id: 'fan_speed',
      kind: 'numeric',
      readable: Boolean(config.percentage_state_topic),
      operations: config.percentage_command_topic ? ['set'] : [],
      minimum: 0,
      maximum: 100,
      unit: '%',
    });
  }
  return capabilities;
}

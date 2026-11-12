/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import {
  validateCommand,
  type BridgeCommand,
  type BridgeEntity,
  type LightState,
} from '@haus/bridge/protocol';
import { hueSaturation } from './color.js';

export function entityCommand(
  entity: BridgeEntity,
  capability: string,
  command: string,
  parameters: Record<string, unknown> = {},
): BridgeCommand {
  let candidate: unknown;
  if (entity.domain === 'button' && capability === 'press' && command === 'press')
    candidate = { action: 'press' };
  else if (entity.domain === 'light') {
    const value: Partial<LightState> = {};
    if (command === 'turn_on') value.on = true;
    else if (command === 'turn_off') value.on = false;
    else if (command === 'set' && capability === 'on_off' && typeof parameters.value === 'boolean')
      value.on = parameters.value;
    else if (command !== 'set') throw Error('invalid_bridge_command');
    const brightness =
      parameters.brightness ?? (capability === 'brightness' ? parameters.value : undefined);
    if (brightness !== undefined) {
      if (
        typeof brightness !== 'number' ||
        brightness < 0 ||
        brightness > 255 ||
        !Number.isFinite(brightness)
      )
        throw Error('invalid_bridge_command');
      value.brightness = (brightness * 100) / 255;
    }
    const kelvin =
      parameters.color_temp_kelvin ?? (capability === 'color_temp' ? parameters.value : undefined);
    if (kelvin !== undefined) {
      if (typeof kelvin !== 'number') throw Error('invalid_bridge_command');
      value.colorTemperature = kelvin;
    }
    if (parameters.color_temp !== undefined) {
      if (
        typeof parameters.color_temp !== 'number' ||
        !Number.isFinite(parameters.color_temp) ||
        parameters.color_temp <= 0
      )
        throw Error('invalid_bridge_command');
      value.colorTemperature = Math.round(1_000_000 / parameters.color_temp);
    }
    const color = parameters.color ?? (capability === 'color' ? parameters.value : undefined);
    if (color !== undefined) Object.assign(value, hueSaturation(color));
    if (capability === 'hue' && typeof parameters.value === 'number') value.hue = parameters.value;
    if (capability === 'saturation' && typeof parameters.value === 'number')
      value.saturation = parameters.value;
    if (
      Object.keys(parameters).some(
        (key) => !['value', 'brightness', 'color', 'color_temp', 'color_temp_kelvin'].includes(key),
      )
    )
      throw Error('invalid_bridge_command');
    candidate = { action: 'set', value };
  } else if (entity.domain === 'switch' && ['on_off', 'power'].includes(capability)) {
    candidate = {
      action: 'set',
      value:
        command === 'turn_on'
          ? true
          : command === 'turn_off'
            ? false
            : command === 'set'
              ? parameters.value
              : undefined,
    };
  } else if (
    (entity.domain === 'number' && capability === 'number') ||
    (entity.domain === 'select' && capability === 'select')
  ) {
    if (command !== 'set') throw Error('invalid_bridge_command');
    candidate = { action: 'set', value: parameters.value };
  } else throw Error('invalid_bridge_command');
  return validateCommand(entity, candidate);
}

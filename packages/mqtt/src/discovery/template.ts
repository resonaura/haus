/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { hsToRgb, rgbToHs } from '@haus/core';
import type { MqttEndpointBinding } from '../types.js';

function unquote(literal: string): unknown {
  const trimmed = literal.trim();
  if (trimmed === 'none' || trimmed === 'None' || trimmed === 'null') return undefined;
  if (trimmed === 'true' || trimmed === 'True') return true;
  if (trimmed === 'false' || trimmed === 'False') return false;
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  const num = Number(trimmed);
  return Number.isNaN(num) ? trimmed : num;
}

function resolveJsonPath(root: Record<string, unknown>, path: string): unknown {
  let curr: unknown = root;
  for (const part of path.split('.')) {
    if (!curr || typeof curr !== 'object') return undefined;
    curr = (curr as Record<string, unknown>)[part];
  }
  return curr;
}

/**
 * Evaluates Home Assistant MQTT `value_template` expressions against a JSON
 * or scalar payload (`value_json.<field>`, `| default(...)`, `| round(...)`,
 * `| float`, `| int`, ternary `'ON' if ... else 'OFF'`, and `{{ value }}`).
 */
export function evaluateValueTemplate(
  template: string,
  valueJson: Record<string, unknown> | undefined,
  rawText: string,
): unknown {
  const expr = template
    .replace(/^\s*\{\{\s*/, '')
    .replace(/\s*\}\}\s*$/, '')
    .trim();
  if (expr === 'value') return rawText;

  // Pattern 1: Ternary `'ON' if value_json.<prop> [== <val>] else 'OFF'`
  const ternaryMatch = expr.match(
    /^(.+?)\s+if\s+value_json\.([a-zA-Z0-9_.]+)(?:\s*==\s*(.+?))?\s+else\s+(.+)$/,
  );
  if (ternaryMatch && valueJson) {
    const [, truthyBranch, propPath, eqLiteral, falsyBranch] = ternaryMatch;
    const rawVal = resolveJsonPath(valueJson, propPath!);
    const cond = eqLiteral !== undefined ? rawVal === unquote(eqLiteral) : Boolean(rawVal);
    return unquote(cond ? truthyBranch! : falsyBranch!);
  }

  // Pattern 2: `value_json.<prop>` or `value_json['<prop>']` with optional filter chain
  const propMatch = expr.match(
    /^value_json(?:\.([a-zA-Z0-9_.]+)|\[['"]([a-zA-Z0-9_-]+)['"]\])(.*)$/,
  );
  if (propMatch && valueJson) {
    const propPath = propMatch[1] ?? propMatch[2]!;
    const filters = propMatch[3]?.trim() ?? '';
    let val: unknown = resolveJsonPath(valueJson, propPath);

    if (filters.startsWith('|')) {
      for (const rawFilter of filters.slice(1).split('|')) {
        const f = rawFilter.trim();
        const defMatch = f.match(/^default\(([^)]*)\)$/);
        if (defMatch) {
          if (val === undefined || val === null) {
            val = unquote(defMatch[1]!);
          }
          continue;
        }
        if (f === 'float' || f.startsWith('float(')) {
          const n = Number(val);
          if (!Number.isNaN(n)) val = n;
          continue;
        }
        if (f === 'int' || f.startsWith('int(')) {
          const n = Number(val);
          if (!Number.isNaN(n)) val = Math.trunc(n);
          continue;
        }
        const roundMatch = f.match(/^round(?:\((\d+)\))?$/);
        if (roundMatch && typeof val === 'number') {
          const digits = roundMatch[1] ? Number(roundMatch[1]) : 0;
          const factor = 10 ** digits;
          val = Math.round(val * factor) / factor;
        }
      }
    }

    return val === null ? undefined : val;
  }

  return undefined;
}

export function extractTemplatePropertyKey(template?: string): string | undefined {
  if (!template) return undefined;
  const match = template.match(/value_json(?:\.([a-zA-Z0-9_]+)|\[['"]([a-zA-Z0-9_-]+)['"]\])/);
  return match?.[1] ?? match?.[2];
}

function parseBooleanValue(
  val: unknown,
  payloadOn = 'ON',
  payloadOff = 'OFF',
): boolean | undefined {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val !== 0;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    const upper = trimmed.toUpperCase();
    if (trimmed === payloadOn || upper === payloadOn.toUpperCase()) return true;
    if (trimmed === payloadOff || upper === payloadOff.toUpperCase()) return false;
    if (['ON', 'TRUE', '1', 'OPEN', 'LOCKED', 'DETECTED'].includes(upper)) return true;
    if (['OFF', 'FALSE', '0', 'CLOSED', 'UNLOCKED', 'CLEAR'].includes(upper)) return false;
  }
  return undefined;
}

export function extractEndpointStatePatch(
  binding: MqttEndpointBinding,
  rawPayload: string,
): Record<string, unknown> {
  const text = rawPayload.trim();
  let valueJson: Record<string, unknown> | undefined;

  if (text.startsWith('{') && text.endsWith('}')) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        valueJson = parsed as Record<string, unknown>;
      }
    } catch {
      // Fallback to scalar payload
    }
  }

  if (binding.component === 'water_heater' || binding.component === 'climate') {
    const patch: Record<string, unknown> = {};
    const modeVal = binding.modeStateTemplate
      ? evaluateValueTemplate(binding.modeStateTemplate, valueJson, text)
      : (valueJson?.mode ?? valueJson?.hvac_mode ?? (valueJson ? undefined : text));
    const currentTemp = binding.currentTemperatureTemplate
      ? evaluateValueTemplate(binding.currentTemperatureTemplate, valueJson, text)
      : valueJson?.current_temperature;
    const targetTemp = binding.temperatureStateTemplate
      ? evaluateValueTemplate(binding.temperatureStateTemplate, valueJson, text)
      : (valueJson?.target_temperature ?? valueJson?.temperature);

    if (typeof modeVal === 'string' && modeVal) {
      const mode = modeVal.toLowerCase();
      patch.mode = mode;
      patch.operation_mode = mode;
      patch.hvac_mode = mode;
      patch.state = mode;
      patch.on_off = mode !== 'off';
      patch[binding.primaryCapabilityId] = mode;
    }
    if (typeof currentTemp === 'number' && Number.isFinite(currentTemp)) {
      patch.current_temperature = currentTemp;
      patch.temperature = currentTemp;
    }
    if (typeof targetTemp === 'number' && Number.isFinite(targetTemp)) {
      patch.target_temperature = targetTemp;
    }
    if (typeof valueJson?.action === 'string') {
      patch.activity = valueJson.action;
    }
    return patch;
  }

  if (binding.component === 'light') {
    const patch: Record<string, unknown> = {};
    const rawState = valueJson ? valueJson.state : text;
    const boolState = parseBooleanValue(rawState, binding.payloadOn, binding.payloadOff);
    if (boolState !== undefined) {
      patch.state = boolState ? 'on' : 'off';
      patch.on_off = boolState;
      patch.power = boolState;
    }
    if (valueJson) {
      if (typeof valueJson.brightness === 'number' && Number.isFinite(valueJson.brightness)) {
        const scale =
          binding.brightnessScale && binding.brightnessScale > 0 ? binding.brightnessScale : 255;
        patch.brightness = Math.max(
          0,
          Math.min(255, Math.round((valueJson.brightness / scale) * 255)),
        );
      }
      if (valueJson.color && typeof valueJson.color === 'object') {
        const colorObj = valueJson.color as Record<string, unknown>;
        if (
          typeof colorObj.r === 'number' &&
          typeof colorObj.g === 'number' &&
          typeof colorObj.b === 'number'
        ) {
          patch.color = { r: colorObj.r, g: colorObj.g, b: colorObj.b };
        } else if (typeof colorObj.h === 'number' && typeof colorObj.s === 'number') {
          patch.hs_color = [colorObj.h, colorObj.s];
          patch.color = hsToRgb(colorObj.h, colorObj.s);
        }
      }
      if (typeof valueJson.color_temp === 'number' && valueJson.color_temp > 0) {
        const ct = valueJson.color_temp;
        patch.color_temp_kelvin = ct > 1000 ? Math.round(ct) : Math.round(1_000_000 / ct);
      } else if (
        typeof valueJson.color_temp_kelvin === 'number' &&
        valueJson.color_temp_kelvin > 0
      ) {
        patch.color_temp_kelvin = Math.round(valueJson.color_temp_kelvin);
      }
      if (typeof valueJson.effect === 'string') {
        patch.effect = valueJson.effect;
      }
    }
    return patch;
  }

  let extracted: unknown;
  if (binding.valueTemplate) {
    extracted = evaluateValueTemplate(binding.valueTemplate, valueJson, text);
  } else if (binding.propertyKey && valueJson && binding.propertyKey in valueJson) {
    extracted = valueJson[binding.propertyKey];
  } else if (valueJson) {
    extracted = valueJson[binding.primaryCapabilityId] ?? valueJson.state ?? valueJson.value;
  } else {
    const num = Number(text);
    extracted = text !== '' && !Number.isNaN(num) ? num : text;
  }

  if (extracted === undefined) return {};

  if (binding.component === 'switch' || binding.component === 'binary_sensor') {
    const boolVal = parseBooleanValue(extracted, binding.payloadOn, binding.payloadOff);
    if (boolVal === undefined) return {};
    return {
      state: boolVal ? 'on' : 'off',
      on_off: boolVal,
      power: boolVal,
      [binding.primaryCapabilityId]: boolVal,
    };
  }

  return {
    state: extracted,
    value: extracted,
    [binding.primaryCapabilityId]: extracted,
  };
}

export function buildCommandMessages(
  binding: MqttEndpointBinding,
  capability: string,
  command: string,
  parameters?: Record<string, unknown>,
): Array<{ topic: string; payload: string }> {
  if (binding.component === 'water_heater' || binding.component === 'climate') {
    const out: Array<{ topic: string; payload: string }> = [];
    const tempVal = parameters?.target_temperature ?? parameters?.temperature ?? parameters?.value;
    if (
      (capability === 'target_temperature' ||
        command === 'set_temperature' ||
        parameters?.target_temperature !== undefined ||
        parameters?.temperature !== undefined) &&
      typeof tempVal === 'number'
    ) {
      const topic = binding.temperatureCommandTopic ?? binding.commandTopic;
      if (topic) out.push({ topic, payload: String(Math.round(tempVal)) });
      return out;
    }

    if (command === 'turn_on' || command === 'turn_off') {
      if (binding.powerCommandTopic) {
        out.push({
          topic: binding.powerCommandTopic,
          payload: command === 'turn_on' ? binding.payloadOn : binding.payloadOff,
        });
      } else if (binding.modeCommandTopic ?? binding.commandTopic) {
        const topic = (binding.modeCommandTopic ?? binding.commandTopic)!;
        const defaultOnMode = binding.component === 'water_heater' ? 'electric' : 'heat';
        out.push({ topic, payload: command === 'turn_on' ? defaultOnMode : 'off' });
      }
      return out;
    }

    const modeVal =
      parameters?.operation_mode ?? parameters?.hvac_mode ?? parameters?.mode ?? parameters?.value;
    if (typeof modeVal === 'string') {
      const topic = binding.modeCommandTopic ?? binding.commandTopic;
      if (topic) out.push({ topic, payload: modeVal });
      return out;
    }
  }

  if (!binding.commandTopic) return [];

  const booleanSet =
    command === 'set' &&
    ['on_off', 'power'].includes(capability) &&
    typeof parameters?.value === 'boolean'
      ? parameters.value
      : undefined;
  if (binding.component === 'switch' && booleanSet !== undefined) {
    return [
      { topic: binding.commandTopic, payload: booleanSet ? binding.payloadOn : binding.payloadOff },
    ];
  }

  if (binding.isJsonSchema || binding.component === 'light') {
    if (command === 'turn_off' || booleanSet === false) {
      return [{ topic: binding.commandTopic, payload: JSON.stringify({ state: 'OFF' }) }];
    }
    const body: Record<string, unknown> = { state: 'ON' };
    if (typeof parameters?.brightness === 'number') {
      const scale =
        binding.brightnessScale && binding.brightnessScale > 0 ? binding.brightnessScale : 255;
      body.brightness = Math.max(
        0,
        Math.min(scale, Math.round((parameters.brightness / 255) * scale)),
      );
    }
    if (parameters?.color && typeof parameters.color === 'object') {
      const c = parameters.color as Record<string, unknown>;
      if (typeof c.r === 'number' && typeof c.g === 'number' && typeof c.b === 'number') {
        const prefersHs =
          binding.supportedColorModes?.includes('hs') &&
          !binding.supportedColorModes?.includes('rgb');
        body.color = prefersHs ? rgbToHs(c.r, c.g, c.b) : { r: c.r, g: c.g, b: c.b };
      } else {
        body.color = parameters.color;
      }
    }
    if (typeof parameters?.color_temp_kelvin === 'number') {
      body.color_temp = Math.round(parameters.color_temp_kelvin);
    } else if (typeof parameters?.color_temp === 'number') {
      body.color_temp = Math.round(parameters.color_temp);
    }
    if (typeof parameters?.effect === 'string') {
      body.effect = parameters.effect;
    }
    return [{ topic: binding.commandTopic, payload: JSON.stringify(body) }];
  }

  let payload: string;
  if (command === 'turn_on' || command === 'press') {
    payload = binding.payloadOn;
  } else if (command === 'turn_off') {
    payload = binding.payloadOff;
  } else if (parameters?.value !== undefined) {
    payload =
      typeof parameters.value === 'string' ? parameters.value : JSON.stringify(parameters.value);
  } else {
    payload = command;
  }

  return [{ topic: binding.commandTopic, payload }];
}

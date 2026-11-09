/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { hsToRgb } from '@haus/core';
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
export type ValueTemplateResult =
  { readonly kind: 'value'; readonly value: unknown } | { readonly kind: 'unsupported' };

export function evaluateValueTemplateResult(
  template: string,
  valueJson: Record<string, unknown> | undefined,
  rawText: string,
): ValueTemplateResult {
  const expr = template
    .replace(/^\s*\{\{\s*/, '')
    .replace(/\s*\}\}\s*$/, '')
    .trim();
  if (expr === 'value') return { kind: 'value', value: rawText };

  // Pattern 1: Ternary `'ON' if value_json.<prop> [| default(...)] [== <val>] else 'OFF'`
  const ternaryMatch = expr.match(
    /^(.+?)\s+if\s+value_json\.([a-zA-Z0-9_.]+)(\s*\|\s*default\([^)]*\))?(?:\s*==\s*(.+?))?\s+else\s+(.+)$/,
  );
  if (ternaryMatch) {
    const [, truthyBranch, propPath, defaultFilter, eqLiteral, falsyBranch] = ternaryMatch;
    let rawVal = valueJson ? resolveJsonPath(valueJson, propPath!) : undefined;
    const defaultMatch = defaultFilter?.match(/^\s*\|\s*default\(([^)]*)\)$/);
    if (defaultFilter && !defaultMatch) return { kind: 'unsupported' };
    if ((rawVal === undefined || rawVal === null) && defaultMatch) {
      rawVal = unquote(defaultMatch[1]!);
    }
    const cond = eqLiteral !== undefined ? rawVal === unquote(eqLiteral) : Boolean(rawVal);
    return { kind: 'value', value: unquote(cond ? truthyBranch! : falsyBranch!) };
  }

  // Pattern 2: `value_json.<prop>` or `value_json['<prop>']` with optional filter chain
  const propMatch = expr.match(
    /^value_json(?:\.([a-zA-Z0-9_.]+)|\[['"]([a-zA-Z0-9_-]+)['"]\])(.*)$/,
  );
  if (propMatch) {
    const propPath = propMatch[1] ?? propMatch[2]!;
    const filters = propMatch[3]?.trim() ?? '';
    let val: unknown = valueJson ? resolveJsonPath(valueJson, propPath) : undefined;

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
        if (f === 'float') {
          const n = Number(val);
          if (!Number.isNaN(n)) val = n;
          continue;
        }
        if (f === 'int') {
          const n = Number(val);
          if (!Number.isNaN(n)) val = Math.trunc(n);
          continue;
        }
        const roundMatch = f.match(/^round(?:\((\d+)\))?$/);
        if (roundMatch && typeof val === 'number') {
          const digits = roundMatch[1] ? Number(roundMatch[1]) : 0;
          const factor = 10 ** digits;
          val = Math.round(val * factor) / factor;
          continue;
        }
        return { kind: 'unsupported' };
      }
    } else if (filters !== '') {
      return { kind: 'unsupported' };
    }

    return { kind: 'value', value: val === null ? undefined : val };
  }

  return { kind: 'unsupported' };
}

export function evaluateValueTemplate(
  template: string,
  valueJson: Record<string, unknown> | undefined,
  rawText: string,
): unknown {
  const result = evaluateValueTemplateResult(template, valueJson, rawText);
  return result.kind === 'value' ? result.value : undefined;
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

function parseFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function fanPercentage(value: number, minimum: number, maximum: number): number | undefined {
  if (!Number.isInteger(minimum) || !Number.isInteger(maximum) || minimum < 1 || maximum < minimum)
    return undefined;
  if (value <= minimum - 1) return 0;
  return Math.max(0, Math.min(100, ((value - minimum + 1) / (maximum - minimum + 1)) * 100));
}

export function extractEndpointStatePatch(
  binding: MqttEndpointBinding,
  rawPayload: string,
  topic?: string,
): Record<string, unknown> {
  if (binding.component === 'fan') return extractFanStatePatch(binding, rawPayload, topic).patch;

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
    extracted = text;
  }

  if (extracted === undefined) return {};

  if (
    typeof extracted === 'string' &&
    (binding.component !== 'sensor' || binding.numericState !== false)
  ) {
    const num = Number(extracted);
    if (extracted.trim() !== '' && Number.isFinite(num)) extracted = num;
  }

  if (binding.component === 'sensor' && binding.primaryCapabilityId === 'enum') {
    if (
      typeof extracted !== 'string' &&
      typeof extracted !== 'number' &&
      typeof extracted !== 'boolean'
    ) {
      return {};
    }
    const enumState = String(extracted);
    if (!binding.enumOptions?.includes(enumState)) return {};
    extracted = enumState;
  }

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

export function extractFanStatePatch(
  binding: MqttEndpointBinding,
  rawPayload: string,
  topic?: string,
): { readonly patch: Record<string, unknown>; readonly unsupportedTemplate: boolean } {
  const text = rawPayload.trim();
  let valueJson: Record<string, unknown> | undefined;
  if (text.startsWith('{') && text.endsWith('}')) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        valueJson = parsed as Record<string, unknown>;
    } catch {
      // A malformed JSON packet remains an unknown reading.
    }
  }

  const patch: Record<string, unknown> = {};
  let unsupportedTemplate = false;
  const stateTopicReceived = topic === undefined || topic === binding.stateTopic;
  const percentageTopicReceived =
    binding.percentageStateTopic !== undefined &&
    (topic === binding.percentageStateTopic ||
      (topic === undefined && binding.percentageStateTopic === binding.stateTopic));

  if (stateTopicReceived) {
    if (text === 'None') {
      patch.state = null;
      patch.on_off = null;
      patch.power = null;
      patch.fan = null;
    } else {
      const rendered = binding.stateValueTemplate
        ? evaluateValueTemplateResult(binding.stateValueTemplate, valueJson, text)
        : {
            kind: 'value' as const,
            value: valueJson?.state ?? valueJson?.value ?? (valueJson ? undefined : text),
          };
      if (rendered.kind === 'unsupported') {
        unsupportedTemplate = true;
      } else {
        const on = parseBooleanValue(rendered.value, binding.payloadOn, binding.payloadOff);
        if (on !== undefined) {
          patch.state = on ? 'on' : 'off';
          patch.on_off = on;
          patch.power = on;
          patch.fan = on;
        }
      }
    }
  }

  if (percentageTopicReceived) {
    if (text === (binding.payloadResetPercentage ?? 'None')) {
      patch.percentage = null;
      patch.fan_speed = null;
    } else {
      const rendered = binding.percentageValueTemplate
        ? evaluateValueTemplateResult(binding.percentageValueTemplate, valueJson, text)
        : {
            kind: 'value' as const,
            value: valueJson?.percentage ?? valueJson?.value ?? (valueJson ? undefined : text),
          };
      if (rendered.kind === 'unsupported') {
        unsupportedTemplate = true;
      } else {
        const numeric = parseFiniteNumber(rendered.value);
        if (numeric !== undefined) {
          const percentage = fanPercentage(
            numeric,
            binding.speedRangeMin ?? 1,
            binding.speedRangeMax ?? 100,
          );
          if (percentage !== undefined) {
            patch.percentage = percentage;
            patch.fan_speed = percentage;
          }
        }
      }
    }
  }

  return { patch, unsupportedTemplate };
}

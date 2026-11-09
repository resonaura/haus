/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { MqttEndpointBinding } from '../types.js';
import { evaluateValueTemplate } from './template.js';
import { discoveryObject } from './validation.js';

export type JsonAttributesResult =
  | { readonly kind: 'valid'; readonly value: Record<string, unknown> }
  | { readonly kind: 'invalid' | 'unsupported' };

function parseObject(value: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    return discoveryObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function expressionOf(template: string): string {
  return template
    .replace(/^\s*\{\{\s*/, '')
    .replace(/\s*\}\}\s*$/, '')
    .trim();
}

function projectedValue(
  expression: string,
  valueJson: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const match = expression.match(/^\{\s*(['"])([^'"]+)\1\s*:\s*value_json\.([\w.]+)\s*\}$/);
  const key = match?.[2];
  const path = match?.[3];
  if (!key || !path || !valueJson) return undefined;
  let value: unknown = valueJson;
  for (const part of path.split('.')) {
    if (!discoveryObject(value)) return undefined;
    value = value[part];
  }
  if (value === undefined) return undefined;
  return Object.fromEntries([[key, value]]);
}

function evaluateAttributesTemplate(
  template: string,
  valueJson: Record<string, unknown> | undefined,
  raw: string,
): Record<string, unknown> | undefined {
  let expression = expressionOf(template);
  const toJson = expression.match(/^(.*?)\s*\|\s*tojson\s*$/);
  if (toJson?.[1] !== undefined) expression = toJson[1].trim();
  if (expression.includes('|')) return undefined;
  if (expression === 'value_json') return valueJson;

  const projected = projectedValue(expression, valueJson);
  if (projected) return projected;

  const rendered = evaluateValueTemplate(`{{ ${expression} }}`, valueJson, raw);
  if (discoveryObject(rendered)) return rendered;
  if (typeof rendered === 'string') return parseObject(rendered);
  return undefined;
}

/** Reads HA-style JSON attribute payloads without replacing good state on bad input. */
export function extractJsonAttributes(
  binding: MqttEndpointBinding,
  payload: string,
): JsonAttributesResult {
  const valueJson = parseObject(payload);
  if (!binding.attributesTemplate) {
    return valueJson ? { kind: 'valid', value: valueJson } : { kind: 'invalid' };
  }
  if (!valueJson) return { kind: 'invalid' };

  const value = evaluateAttributesTemplate(binding.attributesTemplate, valueJson, payload);
  return value ? { kind: 'valid', value } : { kind: 'unsupported' };
}

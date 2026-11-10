/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { MqttEndpointBinding } from '../types.js';
import { evaluateValueTemplateResult } from './template.js';

export type MqttEventResult =
  | { readonly kind: 'event'; readonly eventType: string; readonly data: Record<string, unknown> }
  | { readonly kind: 'invalid' | 'unsupported' | 'unknown' };

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function parseObject(value: unknown): Record<string, unknown> | undefined {
  if (isRecord(value)) return value;
  if (typeof value !== 'string') return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Parse an HA MQTT Event payload without turning retained messages into events. */
export function extractMqttEvent(
  binding: MqttEndpointBinding,
  rawPayload: string,
): MqttEventResult {
  const text = rawPayload.trim();
  if (!text || !binding.eventTypes?.length) return { kind: 'invalid' };

  let rawJson: Record<string, unknown> | undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    if (isRecord(parsed)) rawJson = parsed;
  } catch {
    // Event payloads must be JSON unless a supported value template produces it.
  }

  let eventPayload: Record<string, unknown> | undefined;
  if (binding.valueTemplate) {
    const templated = evaluateValueTemplateResult(binding.valueTemplate, rawJson, text);
    if (templated.kind === 'unsupported') return { kind: 'unsupported' };
    eventPayload = parseObject(templated.value);
  } else {
    eventPayload = rawJson;
  }
  if (!eventPayload) return { kind: 'invalid' };

  const eventType = eventPayload.event_type;
  if (typeof eventType !== 'string' || !eventType.trim()) return { kind: 'invalid' };
  if (!binding.eventTypes.includes(eventType)) return { kind: 'unknown' };

  const data = Object.fromEntries(
    Object.entries(eventPayload).filter(([key]) => key !== 'event_type'),
  );
  return { kind: 'event', eventType, data };
}

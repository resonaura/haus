/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { Availability } from '@haus/core';
import type { HaMqttComponentConfig, MqttAvailabilityRule } from '../types.js';
import { evaluateValueTemplate } from './template.js';

export function inheritAvailability(
  root: HaMqttComponentConfig,
  component: HaMqttComponentConfig,
): HaMqttComponentConfig {
  const hasComponentAvailability =
    component.availability !== undefined || component.availability_topic !== undefined;
  const availability = hasComponentAvailability ? component.availability : root.availability;
  const availabilityTopic = hasComponentAvailability
    ? component.availability_topic
    : root.availability_topic;

  return {
    ...component,
    availability,
    availability_topic: availabilityTopic,
    availability_mode: component.availability_mode ?? root.availability_mode,
    availability_template: component.availability_template ?? root.availability_template,
    payload_available: component.payload_available ?? root.payload_available,
    payload_not_available: component.payload_not_available ?? root.payload_not_available,
  };
}

export function buildAvailabilityRule(
  config: HaMqttComponentConfig,
): MqttAvailabilityRule | undefined {
  const configured =
    config.availability ??
    (config.availability_topic ? [{ topic: config.availability_topic }] : undefined);
  if (!configured?.length) return undefined;

  return {
    mode: config.availability_mode ?? 'latest',
    topics: configured.map((item) => ({
      topic: item.topic,
      payload_available: item.payload_available ?? config.payload_available ?? 'online',
      payload_not_available:
        item.payload_not_available ?? config.payload_not_available ?? 'offline',
      value_template: item.value_template ?? config.availability_template,
    })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function readAvailability(
  rule: MqttAvailabilityRule,
  topic: string,
  rawPayload: string,
): { readonly availability: Availability; readonly templateResultAvailable: boolean } {
  const entry = rule.topics.find((item) => item.topic === topic);
  if (!entry) return { availability: 'unknown', templateResultAvailable: true };

  const text = rawPayload.trim();
  let value: unknown = text;
  if (entry.value_template) {
    let json: Record<string, unknown> | undefined;
    try {
      const parsed: unknown = JSON.parse(text);
      if (isRecord(parsed)) json = parsed;
    } catch {
      // Scalar MQTT payloads are valid template input too.
    }
    value = evaluateValueTemplate(entry.value_template, json, text);
    if (value === undefined || value === null) {
      return { availability: 'unknown', templateResultAvailable: false };
    }
  }

  const normalized = typeof value === 'string' ? value : String(value);
  if (normalized === entry.payload_available) {
    return { availability: 'online', templateResultAvailable: true };
  }
  if (normalized === entry.payload_not_available) {
    return { availability: 'offline', templateResultAvailable: true };
  }
  return { availability: 'unknown', templateResultAvailable: true };
}

export function combineAvailability(
  rule: MqttAvailabilityRule,
  states: ReadonlyMap<string, Availability>,
  latestTopic?: string,
): Availability {
  const values = rule.topics.map((entry) => states.get(entry.topic) ?? 'unknown');
  if (rule.mode === 'latest') {
    return latestTopic ? (states.get(latestTopic) ?? 'unknown') : 'unknown';
  }
  if (rule.mode === 'all') {
    if (values.includes('offline')) return 'offline';
    return values.every((value) => value === 'online') ? 'online' : 'unknown';
  }
  if (values.includes('online')) return 'online';
  return values.every((value) => value === 'offline') ? 'offline' : 'unknown';
}

export function sameAvailabilityRule(
  left: MqttAvailabilityRule | undefined,
  right: MqttAvailabilityRule | undefined,
): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

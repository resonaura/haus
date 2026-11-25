/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { ManagementPort } from './config-editor.js';

export interface BridgeSuggestionDevice {
  readonly id: string;
  readonly name: string;
}

export interface BridgeSuggestion {
  readonly name: string;
  readonly devices: readonly BridgeSuggestionDevice[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSuggestedDevice(value: unknown): value is BridgeSuggestionDevice {
  return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string';
}

function isSuggestion(value: unknown): value is BridgeSuggestion {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    Array.isArray(value.devices) &&
    value.devices.every(isSuggestedDevice)
  );
}

export function parseBridgeSuggestionsResponse(value: unknown): BridgeSuggestion[] {
  if (
    !isRecord(value) ||
    !Array.isArray(value.suggestions) ||
    !value.suggestions.every(isSuggestion)
  ) {
    throw new Error('invalid_bridge_suggestions');
  }
  return value.suggestions.map((group) => ({
    name: group.name,
    devices: group.devices.map((device) => ({ id: device.id, name: device.name })),
  }));
}

export async function fetchBridgeSuggestions(port: ManagementPort): Promise<BridgeSuggestion[]> {
  const response = await port.management({
    method: 'GET',
    path: 'homekit/bridge/suggestions',
  });
  return parseBridgeSuggestionsResponse(response);
}

export function buildDemoBridgeSuggestions(): BridgeSuggestion[] {
  return [
    {
      name: 'Lighting',
      devices: [
        { id: 'light.living_floor', name: 'Floor Lamp' },
        { id: 'light.hall_pendant', name: 'Hall Pendant' },
        { id: 'light.kitchen_strip', name: 'Counter Strip' },
      ],
    },
    {
      name: 'Climate & Shades',
      devices: [
        { id: 'climate.living_thermostat', name: 'Main Thermostat' },
        { id: 'cover.bedroom_shades', name: 'Bedroom Shades' },
      ],
    },
  ];
}

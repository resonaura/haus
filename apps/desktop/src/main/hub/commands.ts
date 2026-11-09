/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { EntityBinding } from './types';

export interface HubCommand {
  deviceId: string;
  endpointId: string;
  capability: string;
  command: string;
  parameters?: Record<string, unknown>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function entityIds(target: unknown): string[] {
  if (!isRecord(target)) return [];
  const value = target.entity_id;
  if (typeof value === 'string') return [value];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

const byte = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(255, Math.round(value)))
    : undefined;

function lightParameters(data: Record<string, unknown>): Record<string, unknown> {
  const parameters: Record<string, unknown> = {};
  const pct = typeof data.brightness_pct === 'number' ? data.brightness_pct : undefined;
  const brightness = pct !== undefined ? (pct * 255) / 100 : data.brightness;
  const level = byte(brightness);
  if (level !== undefined) parameters.brightness = level;
  if (Array.isArray(data.rgb_color)) {
    const [r, g, b] = data.rgb_color.map(byte);
    if (r !== undefined && g !== undefined && b !== undefined) parameters.color = { r, g, b };
  }
  return parameters;
}

/**
 * Maps one legacy `call_service` request to Hub commands. Unsupported domains or
 * services reject instead of silently doing nothing.
 */
export function translateService(
  bindings: Map<string, EntityBinding>,
  message: Record<string, unknown>,
  isOn: (entityId: string) => boolean,
): HubCommand[] {
  const service = typeof message.service === 'string' ? message.service : '';
  const data = isRecord(message.service_data) ? message.service_data : {};
  const ids = entityIds(message.target);
  if (!ids.length) throw new Error('Choose an accessory first.');
  return ids.map((id) => {
    const binding = bindings.get(id);
    if (!binding) throw new Error('This accessory is no longer available.');
    const base = { deviceId: binding.deviceId, endpointId: binding.endpointId };
    const capability = binding.capability.id;
    if (binding.domain === 'button' && service === 'press')
      return { ...base, capability, command: 'press' };
    if (!['light', 'switch'].includes(binding.domain))
      throw new Error('This accessory cannot be controlled from here yet.');
    const command =
      service === 'toggle'
        ? isOn(id)
          ? 'turn_off'
          : 'turn_on'
        : service === 'turn_on' || service === 'turn_off'
          ? service
          : '';
    if (!command) throw new Error(`This accessory does not support ${service}.`);
    const parameters =
      binding.domain === 'light' && command === 'turn_on' ? lightParameters(data) : {};
    return {
      ...base,
      capability,
      command,
      ...(Object.keys(parameters).length ? { parameters } : {}),
    };
  });
}

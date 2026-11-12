/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { EntityBinding } from './types';

export interface HubCommand {
  deviceId: string;
  endpointId: string;
  capability: string;
  command: string;
  parameters?: Record<string, unknown>;
}

export const SERVICES = {
  light: { turn_on: {}, turn_off: {}, toggle: {} },
  switch: { turn_on: {}, turn_off: {}, toggle: {} },
  button: { press: {} },
  climate: { set_temperature: {}, set_hvac_mode: {}, turn_on: {}, turn_off: {} },
  water_heater: { set_temperature: {}, set_operation_mode: {}, turn_on: {}, turn_off: {} },
  cover: { open_cover: {}, close_cover: {}, stop_cover: {}, set_cover_position: {} },
  lock: { lock: {}, unlock: {} },
  fan: { turn_on: {}, turn_off: {}, set_percentage: {} },
  number: { set_value: {} },
  select: { select_option: {} },
};

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
  if (typeof data.color_temp_kelvin === 'number' && Number.isFinite(data.color_temp_kelvin)) {
    parameters.color_temp_kelvin = Math.round(data.color_temp_kelvin);
  } else if (typeof data.color_temp === 'number' && Number.isFinite(data.color_temp)) {
    parameters.color_temp = Math.round(data.color_temp);
  }
  if (typeof data.effect === 'string' && data.effect) {
    parameters.effect = data.effect;
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

    if (binding.domain === 'button' && service === 'press') {
      return { ...base, capability, command: 'press' };
    }

    if (binding.domain === 'climate') {
      if (service === 'set_temperature' && typeof data.temperature === 'number') {
        return {
          ...base,
          capability: 'target_temperature',
          command: 'set',
          parameters: { value: data.temperature, target_temperature: data.temperature },
        };
      }
      if (service === 'set_hvac_mode' && typeof data.hvac_mode === 'string') {
        return {
          ...base,
          capability: 'hvac_mode',
          command: 'set',
          parameters: { value: data.hvac_mode, hvac_mode: data.hvac_mode },
        };
      }
      if (service === 'set_fan_mode' && typeof data.fan_mode === 'string') {
        return {
          ...base,
          capability: 'fan_mode',
          command: 'set',
          parameters: { value: data.fan_mode, fan_mode: data.fan_mode },
        };
      }
      if (service === 'set_swing_mode' && typeof data.swing_mode === 'string') {
        return {
          ...base,
          capability: 'swing_mode',
          command: 'set',
          parameters: { value: data.swing_mode, swing_mode: data.swing_mode },
        };
      }
      if (service === 'turn_on' || service === 'turn_off') {
        return { ...base, capability: 'on_off', command: service };
      }
      throw new Error(`This climate device does not support ${service}.`);
    }

    if (binding.domain === 'water_heater') {
      if (service === 'set_temperature' && typeof data.temperature === 'number') {
        return {
          ...base,
          capability: 'target_temperature',
          command: 'set',
          parameters: { value: data.temperature, target_temperature: data.temperature },
        };
      }
      if (service === 'set_operation_mode' && typeof data.operation_mode === 'string') {
        return {
          ...base,
          capability: 'water_heater',
          command: 'set',
          parameters: { value: data.operation_mode, operation_mode: data.operation_mode },
        };
      }
      if (service === 'turn_on' || service === 'turn_off') {
        return { ...base, capability: 'on_off', command: service };
      }
      throw new Error(`This water heater does not support ${service}.`);
    }

    if (binding.domain === 'number') {
      if (service === 'set_value' && typeof data.value === 'number') {
        return {
          ...base,
          capability,
          command: 'set',
          parameters: { value: data.value },
        };
      }
      throw new Error(`This number control does not support ${service}.`);
    }

    if (binding.domain === 'select') {
      if (service === 'select_option' && typeof data.option === 'string') {
        return {
          ...base,
          capability,
          command: 'set',
          parameters: { value: data.option, option: data.option },
        };
      }
      throw new Error(`This select control does not support ${service}.`);
    }

    if (binding.domain === 'cover') {
      if (service === 'open_cover') {
        return {
          ...base,
          capability: 'position',
          command: 'set',
          parameters: { value: 100, position: 100 },
        };
      }
      if (service === 'close_cover') {
        return {
          ...base,
          capability: 'position',
          command: 'set',
          parameters: { value: 0, position: 0 },
        };
      }
      if (service === 'stop_cover') {
        return { ...base, capability: 'position', command: 'stop' };
      }
      if (service === 'set_cover_position' && typeof data.position === 'number') {
        return {
          ...base,
          capability: 'position',
          command: 'set',
          parameters: { value: data.position, position: data.position },
        };
      }
      throw new Error(`This cover does not support ${service}.`);
    }

    if (binding.domain === 'lock') {
      if (service === 'lock' || service === 'unlock') {
        const locked = service === 'lock';
        return {
          ...base,
          capability: 'lock',
          command: 'set',
          parameters: { value: locked ? 'locked' : 'unlocked', locked },
        };
      }
      throw new Error(`This lock does not support ${service}.`);
    }

    if (binding.domain === 'fan') {
      if (service === 'turn_on' || service === 'turn_off') {
        return { ...base, capability: 'on_off', command: service };
      }
      if (service === 'set_percentage' && typeof data.percentage === 'number') {
        return {
          ...base,
          capability: 'fan_speed',
          command: 'set',
          parameters: { value: data.percentage, percentage: data.percentage },
        };
      }
      throw new Error(`This fan does not support ${service}.`);
    }

    if (binding.domain === 'media_player') {
      if (service === 'turn_on' || service === 'turn_off') {
        return { ...base, capability: 'on_off', command: service };
      }
      if (['media_play', 'media_pause', 'media_play_pause', 'media_stop'].includes(service)) {
        return {
          ...base,
          capability: 'media_playback',
          command: service.replace(/^media_/, ''),
        };
      }
      if (service === 'select_source' && typeof data.source === 'string') {
        return {
          ...base,
          capability: 'source',
          command: 'set',
          parameters: { source: data.source, option: data.source },
        };
      }
      if (service === 'volume_set' && typeof data.volume_level === 'number') {
        const volume = Math.max(0, Math.min(100, Math.round(data.volume_level * 100)));
        return {
          ...base,
          capability: 'volume',
          command: 'set',
          parameters: { value: volume, volume },
        };
      }
      if (service === 'volume_up' || service === 'volume_down') {
        return { ...base, capability: 'volume', command: service };
      }
      if (service === 'volume_mute') {
        const mute = Boolean(data.is_volume_muted);
        return {
          ...base,
          capability: 'mute',
          command: 'set',
          parameters: { value: mute, mute },
        };
      }
      throw new Error(`This media player does not support ${service}.`);
    }

    if (binding.domain === 'remote') {
      if (service === 'send_command') {
        const cmd = data.command;
        return {
          ...base,
          capability: 'remote_key',
          command: 'send',
          parameters: { command: cmd, key: cmd },
        };
      }
      if (service === 'turn_on' || service === 'turn_off') {
        return { ...base, capability: 'on_off', command: service };
      }
      throw new Error(`This remote does not support ${service}.`);
    }

    if (binding.domain === 'scene') {
      if (service === 'turn_on') {
        return { ...base, capability: 'scene', command: 'turn_on' };
      }
      throw new Error(`This scene does not support ${service}.`);
    }

    if (binding.domain === 'update') {
      if (service === 'install') {
        return { ...base, capability: 'update', command: 'install' };
      }
      throw new Error(`This update control does not support ${service}.`);
    }

    if (binding.domain === 'notify') {
      if (service === 'send_message' || service === 'notify') {
        const messageText = typeof data.message === 'string' ? data.message : '';
        return {
          ...base,
          capability: 'notify',
          command: 'send_message',
          parameters: {
            message: messageText,
            ...(typeof data.title === 'string' ? { title: data.title } : {}),
          },
        };
      }
      throw new Error(`This notification service does not support ${service}.`);
    }

    if (!['light', 'switch'].includes(binding.domain)) {
      throw new Error('This accessory cannot be controlled from here yet.');
    }
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

export function mapPairingNotifications(raw: unknown) {
  const requests =
    isRecord(raw) && Array.isArray(raw.requests)
      ? (raw.requests as Array<{ sessionId: string; challengeCode: string; createdAt: number }>)
      : [];
  return requests.map((p) => ({
    notification_id: `pairing-${p.sessionId}`,
    title: 'Pairing Request',
    message: `A new device wants to connect to your Haus Hub.\n\nPairing code: **${p.challengeCode}**`,
    created_at: new Date(p.createdAt).toISOString(),
  }));
}

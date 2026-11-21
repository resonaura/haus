/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import { rgbToHs } from '@haus/core/device';

export const HACS_CAPABILITY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  power: ['power', 'on_off'],
  on_off: ['on_off', 'power'],
  target_temperature: ['temperature', 'target_temperature', 'climate'],
  temperature: ['temperature', 'target_temperature', 'climate'],
  hvac_mode: ['hvac_mode', 'climate'],
  fan_mode: ['fan_mode', 'climate'],
  swing_mode: ['swing_mode', 'climate'],
  swing_horizontal_mode: ['swing_horizontal_mode', 'climate'],
  press: ['press', 'button'],
  button: ['press', 'button'],
  effect: ['effect', 'light'],
  color_temp: ['color_temp', 'light'],
  color_temp_kelvin: ['color_temp', 'light'],
  color_hsv: ['color_hsv', 'light'],
  color: ['color_hsv', 'light'],
  hs_color: ['color_hsv', 'light'],
  scene: ['scene', 'action', 'on_off'],
  action: ['scene', 'action', 'button', 'press'],
  event: ['event'],
  select: ['select', 'select_option', 'mode'],
  select_option: ['select', 'select_option', 'mode'],
  update: ['update', 'install', 'on_off'],
  install: ['update', 'install', 'on_off'],
  device_tracker: ['device_tracker', 'presence', 'contact'],
  presence: ['device_tracker', 'presence', 'contact'],
  weather: ['weather'],
  notify: ['notify', 'service', 'send_message'],
  send_message: ['notify', 'service', 'send_message'],
  media_playback: ['media_playback'],
  volume: ['volume'],
  mute: ['mute'],
  source: ['source'],
  remote_key: ['remote_key'],
};

function toHaBrightness(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  if (raw > 100) return Math.min(255, Math.round(raw));
  return Math.round((Math.max(0, raw) / 100) * 255);
}

function toHaHsColor(value: unknown): [number, number] | undefined {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const val = value as Record<string, unknown>;
    if (typeof val.hue === 'number' && typeof val.saturation === 'number') {
      return [val.hue, val.saturation];
    }
    if (typeof val.h === 'number' && typeof val.s === 'number') {
      return [val.h, val.s];
    }
    if (typeof val.r === 'number' && typeof val.g === 'number' && typeof val.b === 'number') {
      const hs = rgbToHs(val.r, val.g, val.b);
      return [hs.h, hs.s];
    }
  } else if (Array.isArray(value) && value.length >= 2) {
    const h = Number(value[0]);
    const s = Number(value[1]);
    if (Number.isFinite(h) && Number.isFinite(s)) return [h, s];
  }
  return undefined;
}

export function buildHacsServiceCall(input: {
  readonly domain: string;
  readonly endpointId: string;
  readonly capabilityKind: string;
  readonly value: unknown;
  readonly operation?: string;
  readonly params?: Record<string, unknown>;
}): { readonly service: string; readonly serviceData: Record<string, unknown> } {
  const { domain, endpointId, capabilityKind, value, operation, params } = input;
  let service = 'turn_on';
  const serviceData: Record<string, unknown> = { entity_id: endpointId };

  if (capabilityKind === 'on_off' || capabilityKind === 'power') {
    service = value ? 'turn_on' : 'turn_off';
    if (domain === 'climate' && params) {
      if (typeof params.temperature === 'number') serviceData.temperature = params.temperature;
      if (typeof params.target_temperature === 'number')
        serviceData.temperature = params.target_temperature;
      if (typeof params.hvac_mode === 'string') serviceData.hvac_mode = params.hvac_mode;
    } else if (value && params) {
      if (typeof params.brightness === 'number') {
        serviceData.brightness = toHaBrightness(params.brightness);
      } else if (
        typeof params.brightness_pct === 'number' &&
        Number.isFinite(params.brightness_pct)
      ) {
        serviceData.brightness_pct = params.brightness_pct;
      } else if (
        typeof params.brightness_step_pct === 'number' &&
        Number.isFinite(params.brightness_step_pct)
      ) {
        serviceData.brightness_step_pct = params.brightness_step_pct;
      } else if (
        typeof params.brightness_step === 'number' &&
        Number.isFinite(params.brightness_step)
      ) {
        serviceData.brightness_step = params.brightness_step;
      }
      if (typeof params.color_temp === 'number' || typeof params.color_temp_kelvin === 'number') {
        serviceData.kelvin = Number(params.color_temp_kelvin ?? params.color_temp);
      } else {
        const hs = toHaHsColor(params.color_hsv ?? params.hs_color ?? params.color);
        if (hs) serviceData.hs_color = hs;
      }
      if (typeof params.effect === 'string') {
        serviceData.effect = params.effect;
      }
      if (
        typeof params.transition === 'number' &&
        Number.isFinite(params.transition) &&
        params.transition >= 0
      ) {
        serviceData.transition = params.transition;
      }
    } else if (!value && params) {
      if (
        typeof params.transition === 'number' &&
        Number.isFinite(params.transition) &&
        params.transition >= 0
      ) {
        serviceData.transition = params.transition;
      }
    }
  } else if (capabilityKind === 'effect') {
    service = 'turn_on';
    serviceData.effect = String(value ?? params?.effect);
  } else if (capabilityKind === 'brightness') {
    service = 'turn_on';
    if (
      typeof params?.brightness_step_pct === 'number' &&
      Number.isFinite(params.brightness_step_pct)
    ) {
      serviceData.brightness_step_pct = params.brightness_step_pct;
    } else if (
      typeof params?.brightness_step === 'number' &&
      Number.isFinite(params.brightness_step)
    ) {
      serviceData.brightness_step = params.brightness_step;
    } else if (
      typeof params?.brightness_pct === 'number' &&
      Number.isFinite(params.brightness_pct)
    ) {
      serviceData.brightness_pct = params.brightness_pct;
    } else {
      serviceData.brightness = toHaBrightness(Number(value));
    }
    if (
      typeof params?.transition === 'number' &&
      Number.isFinite(params.transition) &&
      params.transition >= 0
    ) {
      serviceData.transition = params.transition;
    }
  } else if (capabilityKind === 'color_temp' || capabilityKind === 'color_temp_kelvin') {
    service = 'turn_on';
    serviceData.kelvin = Number(value);
  } else if (
    capabilityKind === 'color_hsv' ||
    capabilityKind === 'color' ||
    capabilityKind === 'hs_color'
  ) {
    service = 'turn_on';
    const hs = toHaHsColor(value);
    if (hs) serviceData.hs_color = hs;
  } else if (capabilityKind === 'lock') {
    service = value === 'locked' || value === true ? 'lock' : 'unlock';
  } else if (capabilityKind === 'cover') {
    if (typeof value === 'number') {
      service = 'set_cover_position';
      serviceData.position = value;
    } else {
      service = value === 'open' || value === true ? 'open_cover' : 'close_cover';
    }
  } else if (
    capabilityKind === 'temperature' ||
    capabilityKind === 'target_temperature' ||
    capabilityKind === 'climate'
  ) {
    service = 'set_temperature';
    if (typeof value === 'number') {
      serviceData.temperature = value;
    } else if (typeof params?.temperature === 'number') {
      serviceData.temperature = params.temperature;
    } else if (typeof params?.target_temperature === 'number') {
      serviceData.temperature = params.target_temperature;
    }
    if (typeof params?.hvac_mode === 'string') serviceData.hvac_mode = params.hvac_mode;
    if (typeof params?.fan_mode === 'string') serviceData.fan_mode = params.fan_mode;
    if (typeof params?.swing_mode === 'string') serviceData.swing_mode = params.swing_mode;
  } else if (capabilityKind === 'hvac_mode') {
    service = 'set_hvac_mode';
    serviceData.hvac_mode = String(value);
    if (typeof params?.temperature === 'number') serviceData.temperature = params.temperature;
  } else if (capabilityKind === 'fan_mode') {
    service = 'set_fan_mode';
    serviceData.fan_mode = String(value);
  } else if (capabilityKind === 'swing_mode') {
    service = 'set_swing_mode';
    serviceData.swing_mode = String(value);
  } else if (capabilityKind === 'swing_horizontal_mode') {
    service = 'set_swing_horizontal_mode';
    serviceData.swing_horizontal_mode = String(value);
  } else if (capabilityKind === 'press' || capabilityKind === 'button') {
    service = 'press';
  } else if (capabilityKind === 'scene' || domain === 'scene') {
    service = 'turn_on';
  } else if (
    capabilityKind === 'select' ||
    capabilityKind === 'select_option' ||
    domain === 'select'
  ) {
    service = 'select_option';
    serviceData.option =
      typeof value === 'string' ? value : String(params?.option ?? params?.value ?? '');
  } else if (capabilityKind === 'update' || capabilityKind === 'install' || domain === 'update') {
    service = 'install';
  } else if (
    capabilityKind === 'notify' ||
    capabilityKind === 'send_message' ||
    domain === 'notify'
  ) {
    service = 'send_message';
    if (typeof value === 'string') serviceData.message = value;
    if (typeof params?.message === 'string') serviceData.message = params.message;
    if (typeof params?.title === 'string') serviceData.title = params.title;
  } else if (capabilityKind === 'media_playback') {
    const services: Record<string, string> = {
      play: 'media_play',
      pause: 'media_pause',
      play_pause: 'media_play_pause',
      stop: 'media_stop',
    };
    service = services[operation ?? ''] ?? '';
    if (!service) throw new Error('kitsune_invalid_media_operation');
  } else if (capabilityKind === 'volume') {
    const mediaOperation = operation ?? 'set';
    if (mediaOperation === 'volume_up' || mediaOperation === 'volume_down') {
      service = mediaOperation;
    } else {
      const rawVolume = typeof value === 'number' ? value : params?.volume;
      if (typeof rawVolume !== 'number' || !Number.isFinite(rawVolume)) {
        throw new Error('kitsune_invalid_media_volume');
      }
      service = 'volume_set';
      serviceData.volume_level = Math.max(0, Math.min(100, rawVolume)) / 100;
    }
  } else if (capabilityKind === 'mute') {
    const mute = typeof value === 'boolean' ? value : params?.mute;
    if (typeof mute !== 'boolean') throw new Error('kitsune_invalid_media_mute');
    service = 'volume_mute';
    serviceData.is_volume_muted = mute;
  } else if (capabilityKind === 'source') {
    const source = params?.source ?? params?.option ?? value;
    if (typeof source !== 'string') throw new Error('kitsune_invalid_media_source');
    service = 'select_source';
    serviceData.source = source;
  } else if (capabilityKind === 'remote_key') {
    const remoteCommand = params?.command ?? params?.key ?? value;
    if (typeof remoteCommand !== 'string' && !Array.isArray(remoteCommand)) {
      throw new Error('kitsune_invalid_remote_command');
    }
    service = 'send_command';
    serviceData.command = remoteCommand;
  }

  return { service, serviceData };
}

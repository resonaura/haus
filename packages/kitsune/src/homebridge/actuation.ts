/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import { rgbToHs, kelvinToMireds } from '@haus/core/device';
import {
  MockAccessory,
  MockCharacteristic,
  type CharacteristicValue,
  HAPCharacteristics,
  HAPServices,
  ServiceUUID,
  RemoteKey,
  VolumeSelector,
  TargetMediaState,
} from './hap.js';
import { matchesProjectedEndpointService } from './hap-metadata.js';

export function parseHs(value: unknown): { h: number; s: number } | undefined {
  if (Array.isArray(value) && value.length >= 3) {
    return rgbToHs(Number(value[0]), Number(value[1]), Number(value[2]));
  }
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    if (typeof obj.r === 'number' && typeof obj.g === 'number' && typeof obj.b === 'number') {
      return rgbToHs(obj.r, obj.g, obj.b);
    }
    const h = typeof obj.hue === 'number' ? obj.hue : typeof obj.h === 'number' ? obj.h : undefined;
    const s =
      typeof obj.saturation === 'number'
        ? obj.saturation
        : typeof obj.s === 'number'
          ? obj.s
          : undefined;
    if (h !== undefined || s !== undefined) {
      return { h: h ?? 0, s: s ?? 100 };
    }
  }
  return undefined;
}

export function mapRemoteKeyNameToCode(key: unknown): number | undefined {
  if (typeof key === 'number' && Number.isFinite(key)) return key;
  if (typeof key !== 'string') return undefined;
  const normalized = key
    .trim()
    .toLowerCase()
    .replace(/[-_\s]+/g, '');
  switch (normalized) {
    case 'rewind':
      return RemoteKey.REWIND;
    case 'fastforward':
    case 'fast_forward':
      return RemoteKey.FAST_FORWARD;
    case 'nexttrack':
    case 'next_track':
    case 'next':
      return RemoteKey.NEXT_TRACK;
    case 'previoustrack':
    case 'previous_track':
    case 'previous':
      return RemoteKey.PREVIOUS_TRACK;
    case 'up':
    case 'arrowup':
      return RemoteKey.ARROW_UP;
    case 'down':
    case 'arrowdown':
      return RemoteKey.ARROW_DOWN;
    case 'left':
    case 'arrowleft':
      return RemoteKey.ARROW_LEFT;
    case 'right':
    case 'arrowright':
      return RemoteKey.ARROW_RIGHT;
    case 'select':
    case 'ok':
    case 'enter':
      return RemoteKey.SELECT;
    case 'back':
    case 'menu':
      return RemoteKey.BACK;
    case 'exit':
    case 'home':
      return RemoteKey.EXIT;
    case 'play':
    case 'pause':
    case 'playpause':
    case 'play_pause':
      return RemoteKey.PLAY_PAUSE;
    case 'info':
    case 'information':
      return RemoteKey.INFORMATION;
    default:
      return undefined;
  }
}

export function executeAccessoryCommand(
  acc: MockAccessory,
  capabilityKind: string,
  value: unknown,
  parameters?: Record<string, unknown>,
  endpointId?: string,
): boolean | Promise<boolean> {
  const promises: Promise<unknown>[] = [];

  const applySet = (char: MockCharacteristic | undefined, val: CharacteristicValue) => {
    if (!char) return;
    if (char.setter) {
      try {
        const res = char.setter(val);
        if (res instanceof Promise) {
          promises.push(
            res.then(() => {
              char.updateValue(val);
            }),
          );
          return;
        }
      } catch (err) {
        promises.push(Promise.reject(err));
        return;
      }
    }
    char.updateValue(val);
  };

  let targetServices = acc.services;
  if (endpointId) {
    const matched = acc.services.filter((service, index) =>
      matchesProjectedEndpointService(service, index, endpointId),
    );
    const hasTv = matched.some(
      (s) => s.displayName === 'Television' || s.UUID === HAPServices.Television.UUID,
    );
    if (hasTv) {
      const speakers = acc.services.filter(
        (s) =>
          s.displayName === 'TelevisionSpeaker' ||
          s.displayName === 'Speaker' ||
          s.UUID === ServiceUUID.Speaker,
      );
      targetServices = [...matched, ...speakers];
    } else {
      targetServices = matched;
    }
  }

  let handled = false;

  for (const service of targetServices) {
    if (capabilityKind === 'on_off') {
      const activeChar =
        service.characteristics.get('Active') ??
        service.characteristics.get(HAPCharacteristics.Active.UUID);
      const onChar =
        service.characteristics.get('On') ??
        service.characteristics.get(HAPCharacteristics.On.UUID);
      const targetChar = activeChar ?? onChar;
      if (targetChar) {
        applySet(targetChar, targetChar === activeChar ? (value ? 1 : 0) : !!value);
        handled = true;
      }
      if (parameters) {
        if (parameters.brightness !== undefined) {
          const briChar =
            service.characteristics.get('Brightness') ??
            service.characteristics.get(HAPCharacteristics.Brightness.UUID);
          if (briChar) {
            const b = Number(parameters.brightness);
            applySet(briChar, b > 100 ? Math.min(100, Math.round((b / 255) * 100)) : b);
          }
        }
        const tempVal = parameters.color_temp_kelvin ?? parameters.color_temp;
        if (tempVal !== undefined) {
          const ctChar =
            service.characteristics.get('ColorTemperature') ??
            service.characteristics.get(HAPCharacteristics.ColorTemperature.UUID);
          if (ctChar) {
            const raw = Number(tempVal);
            applySet(ctChar, raw > 1000 ? kelvinToMireds(raw) : raw);
          }
        }
        const colorVal = parameters.color ?? parameters.color_hsv ?? parameters.rgb_color;
        if (colorVal !== undefined) {
          const hs = parseHs(colorVal);
          if (hs) {
            const hueChar =
              service.characteristics.get('Hue') ??
              service.characteristics.get(HAPCharacteristics.Hue.UUID);
            const satChar =
              service.characteristics.get('Saturation') ??
              service.characteristics.get(HAPCharacteristics.Saturation.UUID);
            if (hueChar) applySet(hueChar, hs.h);
            if (satChar) applySet(satChar, hs.s);
          }
        }
      }
    } else if (capabilityKind === 'remote_key' || capabilityKind === 'remote') {
      const remoteChar =
        service.characteristics.get('RemoteKey') ??
        service.characteristics.get(HAPCharacteristics.RemoteKey.UUID);
      if (remoteChar) {
        const rawCmd = parameters?.command ?? parameters?.key ?? value;
        const code = mapRemoteKeyNameToCode(rawCmd);
        if (code !== undefined) {
          applySet(remoteChar, code);
          handled = true;
        }
      }
    } else if (capabilityKind === 'media_playback') {
      const targetMediaChar =
        service.characteristics.get('TargetMediaState') ??
        service.characteristics.get(HAPCharacteristics.TargetMediaState.UUID);
      const remoteChar =
        service.characteristics.get('RemoteKey') ??
        service.characteristics.get(HAPCharacteristics.RemoteKey.UUID);
      const action = String(parameters?.command ?? value).toLowerCase();
      if (targetMediaChar) {
        if (action === 'play') applySet(targetMediaChar, TargetMediaState.PLAY);
        else if (action === 'pause') applySet(targetMediaChar, TargetMediaState.PAUSE);
        else if (action === 'stop') applySet(targetMediaChar, TargetMediaState.STOP);
        else if (action === 'play_pause' || action === 'play-pause') {
          // Toggle or RemoteKey
          if (remoteChar) applySet(remoteChar, RemoteKey.PLAY_PAUSE);
          else applySet(targetMediaChar, TargetMediaState.PLAY);
        }
        handled = true;
      } else if (remoteChar) {
        applySet(remoteChar, RemoteKey.PLAY_PAUSE);
        handled = true;
      }
    } else if (capabilityKind === 'source' || capabilityKind === 'select') {
      const activeIdChar =
        service.characteristics.get('ActiveIdentifier') ??
        service.characteristics.get(HAPCharacteristics.ActiveIdentifier.UUID);
      if (activeIdChar) {
        const target = parameters?.source ?? parameters?.option ?? value;
        if (typeof target === 'number') {
          applySet(activeIdChar, target);
          handled = true;
        } else if (typeof target === 'string') {
          let matchedId: number | undefined;
          for (let i = 0; i < acc.services.length; i++) {
            const s = acc.services[i];
            if (
              s.displayName === 'InputSource' ||
              s.UUID === '000000D9-0000-1000-8000-0026BB765291'
            ) {
              const nameChar =
                s.characteristics.get('ConfiguredName') ??
                s.characteristics.get(HAPCharacteristics.ConfiguredName.UUID) ??
                s.characteristics.get('Name');
              const name = String(nameChar?.getValue() ?? s.displayName);
              if (name.toLowerCase() === target.toLowerCase()) {
                const idChar =
                  s.characteristics.get('Identifier') ??
                  s.characteristics.get(HAPCharacteristics.Identifier.UUID);
                matchedId = idChar ? Number(idChar.getValue()) : i;
                break;
              }
            }
          }
          if (matchedId !== undefined) {
            applySet(activeIdChar, matchedId);
            handled = true;
          }
        }
      }
    } else if (capabilityKind === 'volume') {
      const volChar =
        service.characteristics.get('Volume') ??
        service.characteristics.get(HAPCharacteristics.Volume.UUID);
      const volSelectorChar =
        service.characteristics.get('VolumeSelector') ??
        service.characteristics.get(HAPCharacteristics.VolumeSelector.UUID);
      const rawCmd = String(parameters?.command ?? value).toLowerCase();
      if (rawCmd === 'volume_up' || rawCmd === 'up') {
        if (volSelectorChar) {
          applySet(volSelectorChar, VolumeSelector.INCREMENT);
          handled = true;
        }
      } else if (rawCmd === 'volume_down' || rawCmd === 'down') {
        if (volSelectorChar) {
          applySet(volSelectorChar, VolumeSelector.DECREMENT);
          handled = true;
        }
      } else if (volChar) {
        const num = Number(value);
        if (Number.isFinite(num)) {
          applySet(volChar, Math.max(0, Math.min(100, Math.round(num))));
          handled = true;
        }
      }
    } else if (capabilityKind === 'mute') {
      const muteChar =
        service.characteristics.get('Mute') ??
        service.characteristics.get(HAPCharacteristics.Mute.UUID);
      if (muteChar) {
        applySet(muteChar, Boolean(value));
        handled = true;
      }
    } else if (capabilityKind === 'brightness') {
      const char =
        service.characteristics.get('Brightness') ??
        service.characteristics.get(HAPCharacteristics.Brightness.UUID);
      if (char) {
        const num = Number(value);
        applySet(char, num > 100 ? Math.min(100, Math.round((num / 255) * 100)) : num);
        handled = true;
      }
    } else if (capabilityKind === 'color_temp') {
      const ctChar =
        service.characteristics.get('ColorTemperature') ??
        service.characteristics.get(HAPCharacteristics.ColorTemperature.UUID);
      if (ctChar) {
        const num = Number(value);
        applySet(ctChar, num > 1000 ? kelvinToMireds(num) : num);
        handled = true;
      }
    } else if (capabilityKind === 'color_hsv' || capabilityKind === 'color') {
      const hueChar =
        service.characteristics.get('Hue') ??
        service.characteristics.get(HAPCharacteristics.Hue.UUID);
      const satChar =
        service.characteristics.get('Saturation') ??
        service.characteristics.get(HAPCharacteristics.Saturation.UUID);
      if (hueChar || satChar) {
        const hs = parseHs(value);
        if (hs) {
          if (hueChar) applySet(hueChar, hs.h);
          if (satChar) applySet(satChar, hs.s);
          handled = true;
        }
      }
    } else if (capabilityKind === 'lock') {
      const target =
        service.characteristics.get('LockTargetState') ??
        service.characteristics.get(HAPCharacteristics.LockTargetState.UUID);
      if (target) {
        applySet(target, value === 'locked' || value === true ? 1 : 0);
        handled = true;
      }
    } else if (capabilityKind === 'cover') {
      const targetPos =
        service.characteristics.get('TargetPosition') ??
        service.characteristics.get(HAPCharacteristics.TargetPosition.UUID);
      if (targetPos) {
        const numVal =
          typeof value === 'number' ? value : value === 'open' || value === true ? 100 : 0;
        applySet(targetPos, numVal);
        handled = true;
      }
    } else if (capabilityKind === 'temperature') {
      const targetTemp =
        service.characteristics.get('TargetTemperature') ??
        service.characteristics.get(HAPCharacteristics.TargetTemperature.UUID);
      if (targetTemp) {
        applySet(targetTemp, Number(value));
        handled = true;
      }
    }
  }

  if (promises.length > 0) {
    return Promise.all(promises).then(() => handled);
  }
  return handled;
}

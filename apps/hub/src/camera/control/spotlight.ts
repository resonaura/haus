/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { spotlightIdentity } from '@haus/kitsune/native';

export interface CameraSpotlightState {
  id: string;
  available: boolean;
  on: boolean;
  brightness?: number;
  hue?: number;
  saturation?: number;
  colorTemperature?: number;
  capabilities: {
    brightness: boolean;
    color: boolean;
    colorTemperature?: { minKelvin: number; maxKelvin: number };
  };
}

export interface CameraSpotlightRegistry {
  cameras: {
    id: string;
    available?: boolean;
    deviceId?: string;
    deviceIds?: string[];
    nativeProvider?: unknown;
  }[];
  devices?: {
    id: string;
    manufacturer?: string;
    model?: string;
  }[];
  entities?: {
    entity_id: string;
    device_id?: string;
    platform?: string;
    unique_id?: string;
    translation_key?: string;
    disabled_by?: unknown;
    hidden_by?: unknown;
  }[];
  states?: {
    entity_id: string;
    state: string;
    attributes?: Record<string, unknown>;
  }[];
}

/** Only one registered light on the camera's physical device can become its spotlight. */
export function cameraSpotlight({
  registry,
  ha,
  native,
}: {
  registry: () => CameraSpotlightRegistry;
  ha: {
    connected?: boolean;
    request?(payload: Record<string, unknown>): Promise<unknown>;
  };
  native?: {
    spotlight(cameraId: string): CameraSpotlightState | undefined;
    writeSpotlight(cameraId: string, entityId: string, value: unknown): Promise<unknown>;
  };
}) {
  const read = (cameraId: string): CameraSpotlightState | undefined => {
    const data = registry();
    const camera = data.cameras.find((item) => item.id === cameraId);
    if (!camera) return undefined;
    if (camera.nativeProvider && native) return native.spotlight(cameraId);
    const devices = new Set(
      [camera.deviceId, ...(camera.deviceIds ?? [])].filter((id): id is string => Boolean(id)),
    );
    const physical = new Map((data.devices ?? []).map((device) => [device.id, device]));
    const lights = (data.entities ?? []).filter(
      (entity) =>
        entity.entity_id.startsWith('light.') &&
        Boolean(entity.device_id && devices.has(entity.device_id)) &&
        !entity.disabled_by &&
        !entity.hidden_by &&
        (spotlightIdentity(
          { ...entity, device_id: entity.device_id ?? undefined },
          entity.device_id
            ? {
                manufacturer: physical.get(entity.device_id)?.manufacturer ?? undefined,
                model: physical.get(entity.device_id)?.model ?? undefined,
              }
            : undefined,
        ) ||
          (data.states ?? []).some(
            (state) =>
              state.entity_id === entity.entity_id &&
              state.attributes?.haus_camera_role === 'spotlight',
          )),
    );
    if (lights.length !== 1) return undefined;
    const state = (data.states ?? []).find((item) => item.entity_id === lights[0].entity_id);
    if (!state) return undefined;
    const attrs = state.attributes ?? {};
    const modes = Array.isArray(attrs.supported_color_modes)
      ? (attrs.supported_color_modes as string[])
      : [];
    const minKelvin = attrs.min_color_temp_kelvin;
    const maxKelvin = attrs.max_color_temp_kelvin;
    const temperature =
      modes.includes('color_temp') &&
      typeof minKelvin === 'number' &&
      Number.isFinite(minKelvin) &&
      typeof maxKelvin === 'number' &&
      Number.isFinite(maxKelvin)
        ? { minKelvin, maxKelvin }
        : undefined;
    return {
      id: state.entity_id,
      available: Boolean(camera.available) && !['unknown', 'unavailable'].includes(state.state),
      on: state.state === 'on',
      brightness:
        typeof attrs.brightness === 'number' && Number.isFinite(attrs.brightness)
          ? Math.round((attrs.brightness / 255) * 100)
          : undefined,
      hue: Array.isArray(attrs.hs_color) ? (attrs.hs_color[0] as number | undefined) : undefined,
      saturation: Array.isArray(attrs.hs_color)
        ? (attrs.hs_color[1] as number | undefined)
        : undefined,
      colorTemperature:
        typeof attrs.color_temp_kelvin === 'number' && Number.isFinite(attrs.color_temp_kelvin)
          ? attrs.color_temp_kelvin
          : undefined,
      capabilities: {
        brightness: modes.some((mode) =>
          ['brightness', 'color_temp', 'hs', 'rgb', 'rgbw', 'rgbww', 'xy', 'white'].includes(mode),
        ),
        color: modes.some((mode) => ['hs', 'rgb', 'rgbw', 'rgbww', 'xy'].includes(mode)),
        colorTemperature: temperature,
      },
    };
  };
  return {
    read,
    async write(cameraId: string, entityId: string, value: unknown): Promise<void> {
      const current = read(cameraId);
      const nativeProvider = registry().cameras.find(
        (camera) => camera.id === cameraId,
      )?.nativeProvider;
      const useNative = Boolean(nativeProvider && native);
      if (!current?.available || current.id !== entityId || (!useNative && ha.connected === false))
        throw Error('spotlight_unavailable');
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        !Object.keys(value).length ||
        Object.keys(value).some(
          (key) => !['on', 'brightness', 'hue', 'saturation', 'colorTemperature'].includes(key),
        )
      )
        throw Error('invalid_spotlight_command');
      const command = value as {
        on?: unknown;
        brightness?: unknown;
        hue?: unknown;
        saturation?: unknown;
        colorTemperature?: unknown;
      };
      if (command.on !== undefined && typeof command.on !== 'boolean')
        throw Error('invalid_spotlight_command');
      const inRange = (number: unknown, min: number, max: number): number is number =>
        typeof number === 'number' && Number.isFinite(number) && number >= min && number <= max;
      if (
        command.brightness !== undefined &&
        (!current.capabilities.brightness || !inRange(command.brightness, 0, 100))
      )
        throw Error('invalid_spotlight_command');
      if (
        command.hue !== undefined &&
        (!current.capabilities.color || !inRange(command.hue, 0, 360))
      )
        throw Error('invalid_spotlight_command');
      if (
        command.saturation !== undefined &&
        (!current.capabilities.color || !inRange(command.saturation, 0, 100))
      )
        throw Error('invalid_spotlight_command');
      if (
        command.colorTemperature !== undefined &&
        (!current.capabilities.colorTemperature ||
          !inRange(
            command.colorTemperature,
            current.capabilities.colorTemperature.minKelvin,
            current.capabilities.colorTemperature.maxKelvin,
          ))
      )
        throw Error('invalid_spotlight_command');

      if (useNative && native) {
        await native.writeSpotlight(cameraId, entityId, value);
        return;
      }

      const service = command.on === false ? 'turn_off' : 'turn_on';
      const service_data: Record<string, unknown> = { entity_id: entityId };
      if (service === 'turn_on') {
        if (command.brightness !== undefined) service_data.brightness_pct = command.brightness;
        if (command.colorTemperature !== undefined)
          service_data.color_temp_kelvin = command.colorTemperature;
        if (command.hue !== undefined || command.saturation !== undefined)
          service_data.hs_color = [
            (command.hue as number | undefined) ?? current.hue ?? 0,
            (command.saturation as number | undefined) ?? current.saturation ?? 0,
          ];
      }
      if (!ha.request) throw Error('spotlight_unavailable');
      await ha.request({ type: 'call_service', domain: 'light', service, service_data });
    },
  };
}

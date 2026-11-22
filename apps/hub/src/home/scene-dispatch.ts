/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { isActiveLightEffect, type DeviceRegistry } from '@haus/core';

const COMPOUND_LIGHT_KEYS = new Set([
  'on_off',
  'power',
  'brightness',
  'color_temp',
  'color_temp_kelvin',
  'color',
  'color_hsv',
  'hs_color',
  'effect',
]);

export interface SceneMemberDispatcherDeps {
  readonly devices: DeviceRegistry;
  readonly resolveEndpointId: (ref: string) => string;
  readonly executeDeviceCommand: (
    endpointId: string,
    capability: string,
    command: string,
    params?: Record<string, unknown>,
    dispatchTriggers?: boolean,
  ) => Promise<unknown>;
}

/**
 * Coalesces multi-attribute light/power target states into a single atomic device command
 * for HA-flow and Homebridge/virtual endpoints, avoiding sequential multi-request storms,
 * color flashing, and unsupported derived attribute errors during parallel scene activation.
 */
export function createSceneMemberDispatcher(deps: SceneMemberDispatcherDeps) {
  return async (
    endpointId: string,
    targetState: Readonly<Record<string, unknown>>,
    transitionSeconds?: number,
    signal?: AbortSignal,
  ): Promise<boolean> => {
    if (signal?.aborted) throw new Error('Scene execution aborted.');

    const canonicalId = deps.resolveEndpointId(endpointId);
    const resolved = deps.devices.getEndpoint(canonicalId);
    if (!resolved) return false;

    const { device, endpoint } = resolved;
    const ownerDomain = endpoint.sourceOwner?.domain;
    const protocol =
      endpoint.sourceOwner?.protocol ??
      device.sourceRefs?.[0]?.protocol ??
      device.connectivity?.protocol;

    // Coalesce HA-flow, Homebridge/virtual, and non-conflicting MQTT light/power targets into one
    // compound call. When an MQTT scene explicitly supplies both native color_temp and color_hsv,
    // keep per-capability dispatch so explicit multi-step profile writes stay intact.
    const isMqtt = protocol === 'mqtt' || device.connectivity?.protocol === 'mqtt';
    const hasConflictingNativeColor =
      targetState.color_temp !== undefined && targetState.color_hsv !== undefined;
    const supportsCompound =
      ownerDomain === 'ha' ||
      protocol === 'virtual' ||
      device.connectivity?.protocol === 'virtual' ||
      (isMqtt && !hasConflictingNativeColor);
    if (!supportsCompound) return false;

    const entries = Object.entries(targetState).filter(([, value]) => value !== undefined);
    if (entries.length === 0) return true;
    if (!entries.every(([key]) => COMPOUND_LIGHT_KEYS.has(key))) return false;

    const explicitPower =
      typeof targetState.power === 'boolean'
        ? targetState.power
        : typeof targetState.on_off === 'boolean'
          ? targetState.on_off
          : undefined;
    const isMultiKey = entries.length > 1;
    const hasHaColorAlias =
      targetState.color_temp_kelvin !== undefined ||
      targetState.color !== undefined ||
      targetState.hs_color !== undefined;

    if (!isMultiKey && !hasHaColorAlias) {
      return false;
    }

    const transition =
      typeof transitionSeconds === 'number' &&
      Number.isFinite(transitionSeconds) &&
      transitionSeconds >= 0
        ? transitionSeconds
        : undefined;

    if (explicitPower === false) {
      await deps.executeDeviceCommand(
        canonicalId,
        'on_off',
        'turn_off',
        transition !== undefined ? { transition } : undefined,
        false,
      );
      return true;
    }

    const params: Record<string, unknown> = {};
    if (typeof targetState.brightness === 'number' && Number.isFinite(targetState.brightness)) {
      params.brightness = targetState.brightness;
    }
    const omitColorForDynamicEffect = isMqtt && isActiveLightEffect(targetState.effect);
    if (!omitColorForDynamicEffect) {
      if (
        typeof targetState.color_temp_kelvin === 'number' &&
        Number.isFinite(targetState.color_temp_kelvin)
      ) {
        params.color_temp_kelvin = targetState.color_temp_kelvin;
      } else if (
        typeof targetState.color_temp === 'number' &&
        Number.isFinite(targetState.color_temp)
      ) {
        params.color_temp_kelvin = targetState.color_temp;
      } else if (targetState.color_hsv !== undefined) {
        params.color_hsv = targetState.color_hsv;
      } else if (isMqtt && targetState.color !== undefined) {
        params.color = targetState.color;
      } else if (targetState.hs_color !== undefined) {
        params.hs_color = targetState.hs_color;
      } else if (targetState.color !== undefined) {
        params.color = targetState.color;
      }
    }
    if (typeof targetState.effect === 'string' && targetState.effect.length > 0) {
      params.effect = targetState.effect;
    }
    if (transition !== undefined) {
      params.transition = transition;
    }

    await deps.executeDeviceCommand(
      canonicalId,
      'on_off',
      'turn_on',
      Object.keys(params).length > 0 ? params : undefined,
      false,
    );
    return true;
  };
}
